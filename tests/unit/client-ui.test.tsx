import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const React = await import('react')
  return {
    Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => React.createElement('button', props, children),
    Pill: ({ children }: { children?: React.ReactNode }) => React.createElement('span', null, children),
    StateDot: ({ state }: { state: string }) => React.createElement('i', { 'data-state': state }),
  }
})

import { IrisSnapshotController } from '../../src/client/controller.js'
import { IrisSection, type IrisSectionProps } from '../../src/client/IrisSection.js'
import { en, zh, type IrisLocaleKey } from '../../src/client/locales.js'
import type { IrisSessionSnapshot } from '../../src/runtime/snapshot.js'

const snapshot: IrisSessionSnapshot = {
  enabled: true,
  agentId: 'session-1',
  mode: 'standard',
  strategy: 'adaptive',
  ceiling: { availableCapabilityCount: 8, nativeToolCount: 5 },
  revealedPacks: ['core'],
  packs: [
    { id: 'core', status: 'revealed', visibleCount: 3, availableCount: 3 },
    { id: 'search', status: 'ready', visibleCount: 0, availableCount: 2 },
  ],
  capabilities: [
    { id: 'tool:bash', name: 'bash', kind: 'tool', pack: 'core', status: 'visible', origin: 'dsh-runtime', route: { kind: 'iris-activate', capabilityId: 'tool:bash' } },
    { id: 'skill:review', name: 'review', kind: 'skill', pack: 'extensions', status: 'ready', origin: 'dsh-native-skill', route: { kind: 'dsh-skill', skillName: 'review', toolName: 'skill' } },
    { id: 'mcp:github/create_issue', name: 'create_issue', kind: 'mcp', pack: 'extensions', status: 'ready', origin: 'dsh-mcp', route: { kind: 'dsh-mcp-tool', serverName: 'github', toolName: 'create_issue', dshToolName: 'mcp__github__create_issue' } },
  ],
  visibleToolCount: 3,
  availableCapabilityCount: 8,
  hiddenCapabilityCount: 5,
  visibleSchemaChars: 1240,
  promptChars: 4200,
  transitions: [{ sequence: 1, pack: 'core', reason: 'provider-activation' }],
}

async function html(dictionary: Record<IrisLocaleKey, string>, value = snapshot): Promise<string> {
  const controller = new IrisSnapshotController(async () => value)
  await controller.refresh()
  const props = { controller, close: () => undefined, t: (key: IrisLocaleKey) => dictionary[key] } as unknown as IrisSectionProps
  return renderToStaticMarkup(<IrisSection {...props} />)
}

describe('Iris Settings UI', () => {
  it('renders aperture, four modes, capability kinds, and recent reveals', async () => {
    const output = await html(en)
    expect(output).toContain('Minimal surface. Full capability.')
    expect(output).toContain('Standard')
    expect(output).toContain('Code')
    expect(output).toContain('Creator')
    expect(output).toContain('tool:bash')
    expect(output).toContain('skill:review')
    expect(output).toContain('mcp:github/create_issue')
    expect(output).toContain('provider-activation')
  })

  it('renders Simplified Chinese through the DSH locale dictionary', async () => {
    const output = await html(zh)
    expect(output).toContain('最小界面，完整能力。')
    expect(output).toContain('当前能力光圈')
    expect(output).toContain('创造模式')
  })

  it('renders the authoritative inactive state', async () => {
    const controller = new IrisSnapshotController(async () => ({ enabled: false as const, reason: 'no-active-agent' as const }))
    await controller.refresh()
    const props = { controller, close: () => undefined, t: (key: IrisLocaleKey) => en[key] } as unknown as IrisSectionProps
    const output = renderToStaticMarkup(<IrisSection {...props} />)
    expect(output).toContain('Iris is not active for this session.')
    expect(output).not.toContain('Capability Surface')
  })
})
