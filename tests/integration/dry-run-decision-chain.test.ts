import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import type { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'

import type { CapabilityCandidate } from '../../src/domain/index.js'
import { evaluateIrisFailure } from '../../src/dsh/evaluate-iris-failure.js'
import { observeUnknownTool, type CapabilityFailureSignal } from '../../src/sensing/index.js'
import * as fixture from '../fixtures/providers/iris-fixture-echo.mjs'

const neverAborted = new AbortController().signal

const compatibleCandidate: CapabilityCandidate = {
  capability: {
    id: 'tool:iris_fixture_echo',
    kind: 'tool',
    name: fixture.toolName,
    source: 'local',
    trust: 'trusted',
    providerId: 'fixture.echo',
    ptcCompatible: true,
  },
  availability: 'local',
  evidence: [{ source: 'catalog', detail: 'local fixture catalog' }],
}

async function harness(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime)
  ctx.provide('agentPresets', {
    composedPreset: (agentCtx: Context) => (
      agentCtx as unknown as { agent: { preset: string } }
    ).agent.preset,
    resolve: (id: string) => Promise.resolve({
      id,
      trust: id === 'research' ? 'user' : 'system',
      path: `/presets/${id}/agent.cordis.yml`,
    }),
  } as never)
  return ctx
}

async function agentScope(ctx: Context, preset: string): Promise<{ agent: Agent; scope: Scope }> {
  const agent = { id: `dry-${preset}` as SessionId, preset } as unknown as Agent
  let scope!: Scope
  await ctx.plugin(Object.assign(
    (inner: Context) => {
      scope = createScope(inner, agent)
      Object.defineProperty(scope.ctx, 'agent', { value: agent })
    },
    { inject: ['tools', 'systemPrompt'] },
  ))
  return { agent, scope }
}

async function unknownSignal(ctx: Context, agent: Agent): Promise<CapabilityFailureSignal> {
  const execution = {
    agent,
    arguments: {},
    callId: CallId(`missing-${agent.id}`),
    name: fixture.toolName,
    signal: neverAborted,
  }
  const result = await ctx.tools.execute(execution)
  const signal = observeUnknownTool(execution, result)
  if (signal === undefined) throw new Error('expected UNKNOWN_TOOL signal')
  return signal
}

describe('UNKNOWN_TOOL dry-run decision chain', () => {
  it.each([
    ['minimal', 'observe'],
    ['standard', 'mount-candidate'],
    ['code', 'mount-candidate'],
    ['cordis', 'mount-candidate'],
  ] as const)('%s produces %s without mounting', async (preset, action) => {
    const ctx = await harness()
    const owner = await agentScope(ctx, preset)
    const signal = await unknownSignal(ctx, owner.agent)

    const evaluation = await evaluateIrisFailure({
      agentCtx: owner.scope.ctx,
      signal,
      catalog: [compatibleCandidate],
      config: {},
    })

    expect(evaluation.decision.action).toBe(action)
    expect(ctx.tools.get(fixture.toolName, owner.agent)).toBeUndefined()
  })

  it('rejects an unproven PTC candidate and discovers when Creation has none', async () => {
    const ctx = await harness()
    const ptc = await agentScope(ctx, 'code')
    const creation = await agentScope(ctx, 'cordis')
    const incompatible = {
      ...compatibleCandidate,
      capability: {
        id: compatibleCandidate.capability.id,
        kind: compatibleCandidate.capability.kind,
        name: compatibleCandidate.capability.name,
        source: compatibleCandidate.capability.source,
        trust: compatibleCandidate.capability.trust,
          providerId: 'fixture.echo',
      },
    }

    const ptcEvaluation = await evaluateIrisFailure({
      agentCtx: ptc.scope.ctx,
      signal: await unknownSignal(ctx, ptc.agent),
      catalog: [incompatible],
      config: {},
    })
    const creationEvaluation = await evaluateIrisFailure({
      agentCtx: creation.scope.ctx,
      signal: await unknownSignal(ctx, creation.agent),
      catalog: [],
      config: {},
    })

    expect(ptcEvaluation.decision).toEqual({
      action: 'unresolved', reason: 'ptc-compatibility-unproven',
    })
    expect(creationEvaluation.decision).toEqual({
      action: 'discover', reason: 'no-reusable-candidate',
    })
  })

  it('returns noop for an already visible tool and keeps Agent snapshots isolated', async () => {
    const ctx = await harness()
    const first = await agentScope(ctx, 'standard')
    const second = await agentScope(ctx, 'standard')
    const firstSignal = await unknownSignal(ctx, first.agent)
    const secondSignal = await unknownSignal(ctx, second.agent)
    const unregister = first.scope.ctx.tools.register(fixture.definition)

    const firstEvaluation = await evaluateIrisFailure({
      agentCtx: first.scope.ctx, signal: firstSignal, catalog: [compatibleCandidate], config: {},
    })
    const secondEvaluation = await evaluateIrisFailure({
      agentCtx: second.scope.ctx, signal: secondSignal, catalog: [compatibleCandidate], config: {},
    })

    expect(firstEvaluation.resolution.status).toBe('satisfied')
    expect(firstEvaluation.decision.action).toBe('noop')
    expect(secondEvaluation.resolution.status).toBe('candidates')
    expect(secondEvaluation.decision.action).toBe('mount-candidate')
    unregister()
  })

  it('defaults custom presets to observe and honors explicit named configuration', async () => {
    const ctx = await harness()
    const custom = await agentScope(ctx, 'research')
    const signal = await unknownSignal(ctx, custom.agent)
    const input = { agentCtx: custom.scope.ctx, signal, catalog: [compatibleCandidate] }

    expect((await evaluateIrisFailure({ ...input, config: {} })).decision.action)
      .toBe('observe')
    expect((await evaluateIrisFailure({
      ...input, config: { policy: 'resolve' },
    })).decision.action).toBe('mount-candidate')
  })

  it('is deeply deterministic for identical runtime facts', async () => {
    const ctx = await harness()
    const owner = await agentScope(ctx, 'standard')
    const input = {
      agentCtx: owner.scope.ctx,
      signal: await unknownSignal(ctx, owner.agent),
      catalog: [compatibleCandidate],
      config: {},
    }

    expect(await evaluateIrisFailure(input)).toEqual(await evaluateIrisFailure(input))
  })
})
