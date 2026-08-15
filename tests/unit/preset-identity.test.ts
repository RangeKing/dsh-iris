import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'

import {
  readAgentPresetIdentity,
  type AgentPresetIdentity,
} from '../../src/dsh/preset-identity.js'

function context(options: {
  readonly id?: string
  readonly trust?: 'system' | 'user'
  readonly sessionPreset?: string
  readonly selected?: readonly string[]
}): Context {
  const agent = {
    id: 'preset-agent',
    session: {
      header: options.sessionPreset === undefined ? {} : { agentPreset: options.sessionPreset },
      events: (options.selected ?? []).map((agentPreset, index) => ({
        type: 'agent-preset/selected',
        seq: index,
        time: 0,
        data: { agentPreset },
      })),
    },
  }
  const presets = options.id === undefined ? undefined : {
    composedPreset: () => options.id,
    resolve: (id: string) => Promise.resolve({
      id,
      trust: options.trust ?? 'system',
      path: `/presets/${id}/agent.cordis.yml`,
    }),
  }
  return {
    agent,
    get: (name: string) => name === 'agentPresets' ? presets : undefined,
  } as unknown as Context
}

describe('readAgentPresetIdentity', () => {
  it.each<[string, AgentPresetIdentity['builtinKind']]>([
    ['standard', 'standard'],
    ['code', 'ptc'],
    ['minimal', 'minimal'],
    ['cordis', 'creation'],
  ])('maps system preset id %s to %s', async (id, builtinKind) => {
    await expect(readAgentPresetIdentity(context({ id }))).resolves.toEqual({
      id,
      source: `/presets/${id}/agent.cordis.yml`,
      builtinKind,
    })
  })

  it('does not classify a user preset from a builtin-looking id', async () => {
    await expect(readAgentPresetIdentity(context({ id: 'standard', trust: 'user' })))
      .resolves.toMatchObject({ id: 'standard', builtinKind: 'custom' })
  })

  it('uses the latest durable session selection only as a custom fallback', async () => {
    await expect(readAgentPresetIdentity(context({
      sessionPreset: 'standard',
      selected: ['minimal', 'my-preset'],
    }))).resolves.toEqual({
      id: 'my-preset',
      source: 'session-metadata',
      builtinKind: 'custom',
    })
  })
})
