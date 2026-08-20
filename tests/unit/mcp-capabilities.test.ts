import { describe, expect, it } from 'vitest'

import { searchCapabilityCatalog } from '../../src/capabilities/index.js'
import type { CapabilityDescriptor } from '../../src/domain/index.js'
import {
  mcpToolCapability,
  parseDshMcpToolName,
} from '../../src/dsh/index.js'

describe('DSH connected MCP capability adapter', () => {
  it('maps the published DSH name into a kind-qualified identity and native route', () => {
    const capability = mcpToolCapability({
      name: 'mcp__github__create_issue',
      description: 'Create an issue in a repository.',
      parameters: {
        type: 'object',
        properties: { title: { type: 'string' }, repository: { type: 'string' } },
      },
    })

    expect(capability).toMatchObject({
      id: 'mcp:github/create_issue',
      kind: 'mcp',
      name: 'mcp__github__create_issue',
      providerId: 'github',
      keywords: ['github', 'repository', 'title'],
      provenance: {
        kind: 'dsh-mcp-tool',
        reference: 'mcp__github__create_issue',
        serverName: 'github',
        toolName: 'create_issue',
      },
    })
    expect(searchCapabilityCatalog([capability!], { query: 'create repository issue' }))
      .toEqual([expect.objectContaining({
        capability,
        status: 'available',
        route: {
          kind: 'dsh-mcp-tool',
          serverName: 'github',
          toolName: 'create_issue',
          dshToolName: 'mcp__github__create_issue',
        },
      })])
  })

  it('keeps normalized DSH tokens stable and rejects ordinary Tools', () => {
    expect(parseDshMcpToolName('ordinary_tool')).toBeUndefined()
    expect(parseDshMcpToolName('mcp__missing_separator')).toBeUndefined()
    expect(parseDshMcpToolName('mcp__srv__admin_reset_0123456789ab')).toEqual({
      serverName: 'srv',
      toolName: 'admin_reset_0123456789ab',
      dshToolName: 'mcp__srv__admin_reset_0123456789ab',
    })
  })

  it('addresses every MCP capability by its registered DSH Tool token', () => {
    // The capability `name` feeds `tools.get`/`tools.restrict` through the
    // surface's allow set, so it must equal the registered DSH token, never the
    // abbreviated tool name (a bare name would fail the restrict allow check).
    const registered = ['mcp__github__create_issue', 'mcp__github__list_issues', 'mcp__argo__argo_search']
    const capabilities = registered
      .map(name => mcpToolCapability({ name, description: 't', parameters: {} })!)
    expect(capabilities.map(capability => capability.name).sort()).toEqual([...registered].sort())
    for (const capability of capabilities) {
      expect(registered).toContain(capability.name)
    }
  })

  it('ranks Tool, Skill, and MCP metadata together deterministically', () => {
    const capabilities: CapabilityDescriptor[] = [
      {
        id: 'tool:issue-draft',
        kind: 'tool',
        name: 'issue-draft',
        description: 'Draft an issue locally.',
        source: 'local',
        trust: 'trusted',
      },
      {
        id: 'skill:issue-review',
        kind: 'skill',
        name: 'issue-review',
        description: 'Review an issue workflow.',
        source: 'builtin',
        trust: 'builtin',
      },
      mcpToolCapability({
        name: 'mcp__github__create_issue',
        description: 'Create a GitHub issue.',
        parameters: { type: 'object' },
      })!,
    ]

    const first = searchCapabilityCatalog(capabilities, { query: 'issue' })
    const second = searchCapabilityCatalog([...capabilities].reverse(), { query: 'issue' })

    expect(second).toEqual(first)
    expect(first.map(result => result.capability.id).sort()).toEqual([
      'mcp:github/create_issue',
      'skill:issue-review',
      'tool:issue-draft',
    ])
    expect(first.map(result => result.route.kind).sort()).toEqual([
      'dsh-mcp-tool',
      'dsh-skill',
      'iris-activate',
    ])
  })
})
