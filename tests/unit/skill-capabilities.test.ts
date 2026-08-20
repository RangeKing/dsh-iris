import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SkillSummary } from '@deepseek-ai/dsh-skill'
import { describe, expect, it } from 'vitest'

import type { Context as CordisContext } from '@deepseek-ai/cordis'
import { DshSkillCapabilitySource } from '../../src/dsh/index.js'

interface FakeAgent extends Agent {
  readonly session: { readonly header: { readonly cwd: string } }
}

function fakeAgent(cwd: string): FakeAgent {
  return { session: { header: { cwd } } } as unknown as FakeAgent
}

/**
 * A single cordis context carrying an agent identity and a `tools` service that
 * reports a native `skill` tool in the ceiling. Crucially it does NOT inject or
 * provide `skills`, matching the real host where agent contexts only inject
 * `tools` (direct property access on an absent service throws).
 */
function agentWithSkillToolInCeiling(agent: FakeAgent): CordisContext {
  const ctx = new Context()
  ctx.provide('tools', {
    get: (name: string, scope: Agent) => (name === 'skill' && scope === agent ? {} : undefined),
  } as never)
  Object.defineProperty(ctx, 'agent', { value: agent })
  return ctx
}

function summary(name: string): SkillSummary {
  return {
    name,
    description: `Description for ${name}.`,
    invocation: { modelInvocable: true, userInvocable: true },
    source: 'bundled',
    provider: 'test',
  }
}

async function snapshotWith(skills: readonly SkillSummary[]) {
  return { complete: true, skills: [...skills] }
}

describe('DSH native Skill capability source', () => {
  it('returns an empty catalog instead of throwing when `skills` is absent from the scope', async () => {
    const agent = fakeAgent('/workspace')
    const agentCtx = agentWithSkillToolInCeiling(agent)

    const source = new DshSkillCapabilitySource(agentCtx)
    await expect(source.list()).resolves.toEqual([])
  })

  it('lists model-invocable skills resolved through the supplied skills-capable context', async () => {
    const agent = fakeAgent('/workspace')
    const agentCtx = agentWithSkillToolInCeiling(agent)

    const skillsCtx = new Context()
    skillsCtx.provide('skills', {
      snapshot: async () => snapshotWith([summary('alpha'), summary('beta')]),
    } as never)

    const source = new DshSkillCapabilitySource(agentCtx, () => skillsCtx)
    const catalog = await source.list()

    expect(catalog.map(capability => capability.id).sort()).toEqual(['skill:alpha', 'skill:beta'])
    expect(catalog[0]).toMatchObject({
      kind: 'skill',
      name: 'alpha',
      providerId: 'test',
    })
  })

  it('surfaces an empty catalog when the resolving context itself carries no `skills`', async () => {
    const agent = fakeAgent('/workspace')
    const agentCtx = agentWithSkillToolInCeiling(agent)
    const bareCtx = new Context()

    const source = new DshSkillCapabilitySource(agentCtx, () => bareCtx)
    await expect(source.list()).resolves.toEqual([])
  })
})
