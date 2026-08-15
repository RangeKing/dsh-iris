import { describe, expect, it } from 'vitest'

import type { CapabilityRequirement } from '../../src/domain/index.js'
import { ConfiguredLocalProviderCatalog } from '../../src/providers/configured-local.js'

const requirement: CapabilityRequirement = {
  id: 'tool:example_tool',
  kind: 'tool',
  requestedName: 'example_tool',
  evidence: [],
}

describe('ConfiguredLocalProviderCatalog', () => {
  it('indexes declarations without importing provider code and lazy-loads only on demand', async () => {
    const imports: string[] = []
    const plugin = { name: 'example-provider', apply() {} }
    const catalog = new ConfiguredLocalProviderCatalog([{
      id: 'example',
      module: '/opt/dsh/providers/example.mjs',
      capabilities: [{ id: 'example_tool', kind: 'tool', ptcCompatible: true }],
    }], {
      importModule: (specifier) => {
        imports.push(specifier)
        return Promise.resolve(plugin)
      },
    })

    const [candidate] = catalog.find(requirement)
    expect(candidate).toMatchObject({
      availability: 'local',
      capability: {
        id: 'tool:example_tool',
        name: 'example_tool',
        providerId: 'example',
        source: 'local',
        trust: 'trusted',
        ptcCompatible: true,
      },
    })
    expect(imports).toEqual([])

    const loaded = await catalog.load(candidate!)
    expect(imports).toEqual(['file:///opt/dsh/providers/example.mjs'])
    expect(loaded.mount).toMatchObject({
      capabilityId: 'example_tool',
      loaderSpecifier: 'file:///opt/dsh/providers/example.mjs',
    })
  })

  it('keeps a large metadata Catalog independent from provider initialization', () => {
    let imports = 0
    const catalog = new ConfiguredLocalProviderCatalog(Array.from({ length: 128 }, (_, index) => ({
      id: `provider-${index}`,
      module: `/opt/dsh/providers/provider-${index}.mjs`,
      capabilities: [{
        id: `tool_${index}`,
        kind: 'tool' as const,
        description: `Local capability ${index}`,
        keywords: [`capability ${index}`],
      }],
    })), {
      importModule: () => {
        imports += 1
        return Promise.resolve({ name: 'unreachable', apply() {} })
      },
    })

    expect(catalog.list()).toHaveLength(128)
    expect(imports).toBe(0)
  })
})
