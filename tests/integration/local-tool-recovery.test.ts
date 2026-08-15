import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import type { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { RUN_CODE_NAME } from '@deepseek-ai/dsh-tools'
import type { Plugin } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'

import type { CapabilityCandidate, CapabilityRequirement } from '../../src/domain/index.js'
import {
  applyLocalToolDecision,
  installLocalToolRecovery,
  type LocalToolProvider,
} from '../../src/dsh/local-tool-recovery.js'
import { evaluateIrisFailure } from '../../src/dsh/evaluate-iris-failure.js'
import type { IrisDryRunEvaluation } from '../../src/dsh/evaluate-iris-failure.js'
import { MountCoordinator } from '../../src/mounting/coordinator.js'
import { DirectFiberMountAdapter } from '../../src/mounting/direct-fiber.js'
import type { MountAdapter } from '../../src/mounting/index.js'
import { observeUnknownTool } from '../../src/sensing/index.js'
import * as fixture from '../fixtures/providers/iris-fixture-echo.mjs'

interface TestAgent extends Agent {
  readonly preset: string
}

async function harness(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime)
  ctx.provide('agentPresets', {
    composedPreset: (agentCtx: Context) => (
      agentCtx as unknown as { agent: TestAgent }
    ).agent.preset,
    resolve: (id: string) => Promise.resolve({
      id,
      trust: 'system',
      path: `/presets/${id}/agent.cordis.yml`,
    }),
  } as never)
  return ctx
}

async function agentScope(
  ctx: Context,
  preset: string,
  id = `recovery-${preset}`,
): Promise<{ agent: TestAgent; scope: Scope }> {
  const agent = { id: id as SessionId, preset } as TestAgent
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

function localProvider(
  capability: Partial<CapabilityCandidate['capability']> = {},
  config: Parameters<typeof fixture.apply>[1] = {},
  options: { readonly omitPtcCompatibility?: boolean } = {},
): LocalToolProvider {
  const descriptor = {
    id: 'tool:iris_fixture_echo',
    kind: 'tool' as const,
    name: fixture.toolName,
    source: 'local' as const,
    trust: 'trusted' as const,
    providerId: 'fixture.echo',
    ...options.omitPtcCompatibility === true ? {} : { ptcCompatible: true },
    ...capability,
  }
  const candidate: CapabilityCandidate = {
    capability: descriptor,
    availability: 'local',
    evidence: [{ source: 'catalog', detail: 'local fixture catalog' }],
  }
  return {
    candidate,
    mount: {
      capabilityId: fixture.toolName,
      plugin: fixture as Plugin,
      loaderSpecifier: new URL('../fixtures/providers/iris-fixture-echo.mjs', import.meta.url).href,
      config,
    },
  }
}

async function executeMissing(
  ctx: Context,
  agent: Agent,
  callId: string,
  signal = new AbortController().signal,
) {
  return ctx.tools.execute({
    agent,
    arguments: { text: callId },
    callId: CallId(callId),
    name: fixture.toolName,
    signal,
  })
}

function enableCodeMode(ctx: Context, owner: { agent: Agent; scope: Scope }): void {
  ctx.provide('codeRuntime', {
    language: 'typescript',
    isolation: 'test',
    run: () => Promise.resolve({ logs: [] }),
  } as never)
  owner.scope.ctx.tools.presentAs('code')
}

async function until(check: () => boolean): Promise<void> {
  for (let attempts = 0; attempts < 100; attempts += 1) {
    if (check()) return
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  throw new Error('condition did not become true')
}

async function evaluationFor(
  ctx: Context,
  owner: { agent: TestAgent; scope: Scope },
  provider: LocalToolProvider,
  callId: string,
) {
  const execution = {
    agent: owner.agent,
    arguments: {},
    callId: CallId(callId),
    name: fixture.toolName,
    signal: new AbortController().signal,
  }
  const result = await ctx.tools.execute(execution)
  const signal = observeUnknownTool(execution, result)
  if (signal === undefined) throw new Error('expected UNKNOWN_TOOL signal')
  return evaluateIrisFailure({
    agentCtx: owner.scope.ctx,
    signal,
    catalog: [provider.candidate],
    config: {},
  })
}

describe('local Tool Iris recovery', () => {
  it('keeps the original UNKNOWN_TOOL and prepares Standard for a normal next call', async () => {
    fixture.fixtureState.reset()
    const ctx = await harness()
    const owner = await agentScope(ctx, 'standard')
    const finalizedCallIds: string[] = []
    owner.scope.ctx.on('tools/result', exec => {
      finalizedCallIds.push(String(exec.callId))
    })
    installLocalToolRecovery(owner.scope.ctx, {
      config: {},
      providers: [localProvider()],
    })

    const result = await executeMissing(ctx, owner.agent, 'original-call')

    expect(result).toMatchObject({
      isError: true,
      error: { info: { name: 'ToolNotFoundError', code: 'UNKNOWN_TOOL' } },
    })
    expect(result.additionalContexts).toMatchObject([{
      source: { kind: 'plugin', plugin: 'dsh-iris' },
    }])
    expect(result.additionalContexts?.[0]?.content).toContainEqual({
      type: 'text',
      text: expect.stringContaining('original-call'),
    })
    const nextAssembly = await ctx.systemPrompt.assemble({ scope: owner.agent })
    expect(nextAssembly.tools.map(tool => tool.name)).toContain(fixture.toolName)
    expect(fixture.fixtureState).toMatchObject({ applies: 1, calls: 0 })
    expect(finalizedCallIds).toEqual(['original-call'])

    owner.scope.ctx.tools.guard(exec => exec.name === fixture.toolName ? 'normal guard denied retry' : undefined)
    const guardedNextCall = await ctx.tools.execute({
      agent: owner.agent,
      arguments: { text: 'normal next call' },
      callId: CallId('new-normal-call'),
      name: fixture.toolName,
      signal: new AbortController().signal,
    })
    expect(guardedNextCall).toMatchObject({
      isError: true,
      error: { message: 'normal guard denied retry' },
    })
    expect(finalizedCallIds).toEqual(['original-call', 'new-normal-call'])
    expect(fixture.fixtureState.calls).toBe(0)
  })

  it('keeps Minimal observational and leaves the Tool surface unchanged', async () => {
    fixture.fixtureState.reset()
    const ctx = await harness()
    const owner = await agentScope(ctx, 'minimal')
    installLocalToolRecovery(owner.scope.ctx, { config: {}, providers: [localProvider()] })

    const result = await executeMissing(ctx, owner.agent, 'minimal-call')

    expect(result.error?.info?.code).toBe('UNKNOWN_TOOL')
    expect(result.additionalContexts).toBeUndefined()
    expect(ctx.tools.get(fixture.toolName, owner.agent)).toBeUndefined()
    expect(fixture.fixtureState.applies).toBe(0)
  })

  it('publishes a PTC-compatible local Tool through the next Code Mode SDK', async () => {
    fixture.fixtureState.reset()
    const ctx = await harness()
    const owner = await agentScope(ctx, 'code')
    enableCodeMode(ctx, owner)
    installLocalToolRecovery(owner.scope.ctx, { config: {}, providers: [localProvider()] })

    const result = await executeMissing(ctx, owner.agent, 'ptc-compatible-call')

    expect(result.additionalContexts).toHaveLength(1)
    const nextAssembly = await ctx.systemPrompt.assemble({ scope: owner.agent })
    expect(nextAssembly.tools.map(tool => tool.name)).toEqual([RUN_CODE_NAME])
    expect(nextAssembly.sections.find(section => section.name === 'tools:sdk')?.text)
      .toContain(`${fixture.toolName}:`)
    expect(fixture.fixtureState).toMatchObject({ applies: 1, calls: 0 })
  })

  it.each([
    ['false', localProvider({ ptcCompatible: false })],
    ['unproven', localProvider({}, {}, { omitPtcCompatibility: true })],
  ])('does not mount a PTC-%s candidate', async (_case, provider) => {
    fixture.fixtureState.reset()
    const ctx = await harness()
    const owner = await agentScope(ctx, 'code', `ptc-${_case}`)
    enableCodeMode(ctx, owner)
    installLocalToolRecovery(owner.scope.ctx, { config: {}, providers: [provider] })

    const result = await executeMissing(ctx, owner.agent, `ptc-${_case}-call`)

    expect(result.additionalContexts).toBeUndefined()
    expect(ctx.tools.get(fixture.toolName, owner.agent)).toBeUndefined()
    expect(fixture.fixtureState.applies).toBe(0)
  })

  it('lets Creation reuse a trusted local Tool without invoking creation', async () => {
    fixture.fixtureState.reset()
    const ctx = await harness()
    const owner = await agentScope(ctx, 'cordis')
    installLocalToolRecovery(owner.scope.ctx, { config: {}, providers: [localProvider()] })

    const result = await executeMissing(ctx, owner.agent, 'creation-local-call')

    expect(result.additionalContexts).toHaveLength(1)
    expect(ctx.tools.get(fixture.toolName, owner.agent)).toBeDefined()
    expect(fixture.fixtureState).toMatchObject({ applies: 1, calls: 0 })
  })

  it('keeps Creation at discover when no local candidate exists', async () => {
    fixture.fixtureState.reset()
    const ctx = await harness()
    const owner = await agentScope(ctx, 'cordis', 'creation-discover')
    installLocalToolRecovery(owner.scope.ctx, { config: {}, providers: [] })

    const result = await executeMissing(ctx, owner.agent, 'creation-discover-call')

    expect(result.additionalContexts).toBeUndefined()
    expect(ctx.tools.get(fixture.toolName, owner.agent)).toBeUndefined()
    expect(fixture.fixtureState.applies).toBe(0)
  })

  it('rolls back when the provider does not publish the verified Tool', async () => {
    fixture.fixtureState.reset()
    const ctx = await harness()
    const owner = await agentScope(ctx, 'standard', 'verification-rollback')
    installLocalToolRecovery(owner.scope.ctx, {
      config: {},
      providers: [localProvider({}, { skipRegister: true })],
    })

    const result = await executeMissing(ctx, owner.agent, 'verification-failure-call')

    expect(result.error?.info?.code).toBe('UNKNOWN_TOOL')
    expect(result.additionalContexts).toBeUndefined()
    expect(ctx.tools.get(fixture.toolName, owner.agent)).toBeUndefined()
    expect(fixture.fixtureState).toMatchObject({ applies: 1, disposes: 1, calls: 0 })
  })

  it('clears a failed verification generation so the next UNKNOWN_TOOL can recover', async () => {
    fixture.fixtureState.reset()
    const ctx = await harness()
    const owner = await agentScope(ctx, 'standard', 'verification-retry')
    let attempts = 0
    const config = {
      get skipRegister(): boolean {
        attempts += 1
        return attempts === 1
      },
    }
    installLocalToolRecovery(owner.scope.ctx, {
      config: {},
      providers: [localProvider({}, config)],
    })

    const failed = await executeMissing(ctx, owner.agent, 'verification-retry-first')
    const recovered = await executeMissing(ctx, owner.agent, 'verification-retry-second')

    expect(failed.additionalContexts).toBeUndefined()
    expect(recovered.additionalContexts).toHaveLength(1)
    expect(ctx.tools.get(fixture.toolName, owner.agent)).toBeDefined()
    expect(fixture.fixtureState).toMatchObject({ applies: 2, disposes: 1, calls: 0 })
  })

  it('single-flights repeated UNKNOWN_TOOL while preserving each original call identity', async () => {
    fixture.fixtureState.reset()
    const ctx = await harness()
    const owner = await agentScope(ctx, 'standard', 'repeated-unknown')
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    installLocalToolRecovery(owner.scope.ctx, {
      config: {},
      providers: [localProvider({}, { gate })],
    })

    const pending = Array.from({ length: 16 }, (_, index) => (
      executeMissing(ctx, owner.agent, `repeated-${index}`)
    ))
    await until(() => fixture.fixtureState.applies === 1)
    release()
    const results = await Promise.all(pending)

    expect(fixture.fixtureState).toMatchObject({ applies: 1, calls: 0 })
    expect(results.every(result => result.error?.info?.code === 'UNKNOWN_TOOL')).toBe(true)
    const handoffTexts = results.map(result => {
      expect(result.additionalContexts).toHaveLength(1)
      const block = result.additionalContexts?.[0]?.content[0]
      return block?.type === 'text' ? block.text : ''
    })
    expect(new Set(handoffTexts)).toHaveLength(16)
    for (let index = 0; index < 16; index += 1) {
      expect(handoffTexts[index]).toContain(`repeated-${index}`)
    }
  })

  it('hands off a late UNKNOWN_TOOL waiter when another generation already made the Tool ready', async () => {
    fixture.fixtureState.reset()
    const ctx = await harness()
    const owner = await agentScope(ctx, 'standard', 'late-unknown-waiter')
    let releaseLate!: () => void
    let lateObserved = false
    const lateGate = new Promise<void>((resolve) => { releaseLate = resolve })
    owner.scope.ctx.on('tools/post-execute', async (exec, _result, next) => {
      if (exec.callId === CallId('late-waiter')) {
        lateObserved = true
        await lateGate
      }
      return next()
    })
    installLocalToolRecovery(owner.scope.ctx, { config: {}, providers: [localProvider()] })

    const latePending = executeMissing(ctx, owner.agent, 'late-waiter')
    await until(() => lateObserved)
    const winner = await executeMissing(ctx, owner.agent, 'mount-winner')
    releaseLate()
    const late = await latePending

    expect(winner.additionalContexts).toHaveLength(1)
    expect(late.additionalContexts).toHaveLength(1)
    expect(late.additionalContexts?.[0]?.content).toContainEqual({
      type: 'text',
      text: expect.stringContaining('late-waiter'),
    })
    expect(fixture.fixtureState).toMatchObject({ applies: 1, calls: 0 })
  })

  it('emits no handoff and leaves no Tool when Agent teardown wins a pending mount', async () => {
    fixture.fixtureState.reset()
    const ctx = await harness()
    const owner = await agentScope(ctx, 'standard', 'pending-teardown')
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    installLocalToolRecovery(owner.scope.ctx, {
      config: {},
      providers: [localProvider({}, { gate })],
    })

    const pending = executeMissing(ctx, owner.agent, 'pending-teardown-call')
    await until(() => fixture.fixtureState.applies === 1)
    const teardown = owner.scope.dispose()
    release()
    const result = await pending
    await teardown

    expect(result.additionalContexts).toBeUndefined()
    expect(ctx.tools.get(fixture.toolName, owner.agent)).toBeUndefined()
    expect(fixture.fixtureState).toMatchObject({ applies: 1, disposes: 1, calls: 0 })
  })

  it('disposes a verified mount when cancellation lands before handoff creation', async () => {
    fixture.fixtureState.reset()
    const ctx = await harness()
    const owner = await agentScope(ctx, 'standard', 'cancel-after-verify')
    const provider = localProvider()
    const evaluation = await evaluationFor(ctx, owner, provider, 'cancel-after-verify-call')
    const abort = new AbortController()
    const adapter: MountAdapter = {
      async mount(agentCtx, candidate) {
        const handle = await new DirectFiberMountAdapter().mount(agentCtx, candidate)
        abort.abort('test cancellation after authoritative verify')
        return handle
      },
    }

    const handoff = await applyLocalToolDecision({
      agentCtx: owner.scope.ctx,
      evaluation,
      providers: [provider],
      coordinator: new MountCoordinator(adapter),
      signal: abort.signal,
    })

    expect(handoff).toMatchObject({ status: 'blocked', reason: 'cancelled' })
    expect(ctx.tools.get(fixture.toolName, owner.agent)).toBeUndefined()
    expect(fixture.fixtureState).toMatchObject({ applies: 1, disposes: 1, calls: 0 })
  })

  it('does not claim readiness when Agent teardown follows verify before handoff', async () => {
    fixture.fixtureState.reset()
    const ctx = await harness()
    const owner = await agentScope(ctx, 'standard', 'teardown-after-verify')
    const provider = localProvider()
    const evaluation = await evaluationFor(ctx, owner, provider, 'teardown-after-verify-call')
    const adapter: MountAdapter = {
      async mount(agentCtx, candidate) {
        const handle = await new DirectFiberMountAdapter().mount(agentCtx, candidate)
        await owner.scope.dispose()
        return handle
      },
    }

    const handoff = await applyLocalToolDecision({
      agentCtx: owner.scope.ctx,
      evaluation,
      providers: [provider],
      coordinator: new MountCoordinator(adapter),
      signal: new AbortController().signal,
    })

    expect(handoff).toMatchObject({ status: 'blocked', reason: 'verification-failed' })
    expect(ctx.tools.get(fixture.toolName, owner.agent)).toBeUndefined()
    expect(fixture.fixtureState).toMatchObject({ applies: 1, disposes: 1, calls: 0 })
  })

  it('returns the original failure promptly on cancellation and later cleans a pending mount', async () => {
    fixture.fixtureState.reset()
    const ctx = await harness()
    const owner = await agentScope(ctx, 'standard', 'cancel-pending')
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    installLocalToolRecovery(owner.scope.ctx, {
      config: {},
      providers: [localProvider({}, { gate })],
    })
    const abort = new AbortController()

    const pending = executeMissing(ctx, owner.agent, 'cancel-pending-call', abort.signal)
    await until(() => fixture.fixtureState.applies === 1)
    abort.abort('cancel Iris waiter')
    const result = await pending

    expect(result.error?.info?.code).toBe('UNKNOWN_TOOL')
    expect(result.additionalContexts).toBeUndefined()
    release()
    await until(() => fixture.fixtureState.disposes === 1)
    expect(ctx.tools.get(fixture.toolName, owner.agent)).toBeUndefined()
    expect(fixture.fixtureState.calls).toBe(0)
  })

  it('starts no recovery for an already-cancelled Tool execution', async () => {
    fixture.fixtureState.reset()
    const ctx = await harness()
    const owner = await agentScope(ctx, 'standard', 'cancel-before-recovery')
    installLocalToolRecovery(owner.scope.ctx, { config: {}, providers: [localProvider()] })
    const abort = new AbortController()
    abort.abort('cancel before Tool dispatch')

    const result = await executeMissing(ctx, owner.agent, 'cancel-before-call', abort.signal)

    expect(result.error?.info?.code).toBe('ABORTED_BEFORE_DISPATCH')
    expect(result.additionalContexts).toBeUndefined()
    expect(ctx.tools.get(fixture.toolName, owner.agent)).toBeUndefined()
    expect(fixture.fixtureState.applies).toBe(0)
  })

  it('keeps two Agents on independent mounts and teardown ownership', async () => {
    fixture.fixtureState.reset()
    const ctx = await harness()
    const first = await agentScope(ctx, 'standard', 'isolation-a')
    const second = await agentScope(ctx, 'standard', 'isolation-b')
    installLocalToolRecovery(first.scope.ctx, { config: {}, providers: [localProvider()] })
    installLocalToolRecovery(second.scope.ctx, { config: {}, providers: [localProvider()] })

    const [firstResult, secondResult] = await Promise.all([
      executeMissing(ctx, first.agent, 'isolation-call-a'),
      executeMissing(ctx, second.agent, 'isolation-call-b'),
    ])

    expect(firstResult.additionalContexts).toHaveLength(1)
    expect(secondResult.additionalContexts).toHaveLength(1)
    expect(fixture.fixtureState.applies).toBe(2)
    expect(ctx.tools.get(fixture.toolName, first.agent)).toBeDefined()
    expect(ctx.tools.get(fixture.toolName, second.agent)).toBeDefined()

    await first.scope.dispose()
    expect(ctx.tools.get(fixture.toolName, first.agent)).toBeUndefined()
    expect(ctx.tools.get(fixture.toolName, second.agent)).toBeDefined()
    expect(fixture.fixtureState.disposes).toBe(1)
  })

  it('records UNKNOWN_TOOL through handoff before final result and next model assembly', async () => {
    fixture.fixtureState.reset()
    const trace: string[] = []
    const ctx = await harness()
    const owner = await agentScope(ctx, 'standard', 'ordered-recovery')
    owner.scope.ctx.on('tools/execute', async (_exec, next) => {
      const result = await next()
      if (result.error?.info?.code === 'UNKNOWN_TOOL') trace.push('UNKNOWN_TOOL produced')
      return result
    })
    owner.scope.ctx.on('tools/post-execute', async (_exec, result, next) => {
      if (result.error?.info?.code === 'UNKNOWN_TOOL') trace.push('Iris detects')
      const decision = await next()
      if (decision.additionalContexts?.some(context => (
        context.source.kind === 'plugin' && context.source.plugin === 'dsh-iris'
      )) === true) trace.push('handoff prepared')
      return decision
    })
    owner.scope.ctx.on('tools/result', () => { trace.push('original Tool result finalized') })
    const adapter: MountAdapter = {
      async mount(agentCtx, candidate) {
        trace.push('mount starts')
        const handle = await new DirectFiberMountAdapter().mount(agentCtx, candidate)
        trace.push('mount finishes')
        if (handle.verification.visible) trace.push('verify succeeds')
        return handle
      },
    }
    installLocalToolRecovery(owner.scope.ctx, {
      config: {},
      providers: [localProvider()],
      coordinator: new MountCoordinator(adapter),
    })

    await executeMissing(ctx, owner.agent, 'ordered-recovery-call')
    const nextAssembly = await ctx.systemPrompt.assemble({ scope: owner.agent })
    if (nextAssembly.tools.some(tool => tool.name === fixture.toolName)) {
      trace.push('next model Tool surface assembled')
    }

    expect(trace).toEqual([
      'UNKNOWN_TOOL produced',
      'Iris detects',
      'mount starts',
      'mount finishes',
      'verify succeeds',
      'handoff prepared',
      'original Tool result finalized',
      'next model Tool surface assembled',
    ])
  })

  it('returns unsupported-for-live-recovery for a Skill decision', async () => {
    fixture.fixtureState.reset()
    const ctx = await harness()
    const owner = await agentScope(ctx, 'standard', 'skill-unsupported')
    const provider = localProvider()
    const toolEvaluation = await evaluationFor(ctx, owner, provider, 'skill-source-call')
    const requirement: CapabilityRequirement = {
      id: 'skill:fixture_skill',
      kind: 'skill',
      requestedName: 'fixture_skill',
      evidence: toolEvaluation.requirement.evidence,
    }
    const skillCandidate: CapabilityCandidate = {
      capability: {
        id: requirement.id,
        kind: 'skill',
        name: 'fixture_skill',
        source: 'local',
        trust: 'trusted',
        providerId: 'fixture.skill',
      },
      availability: 'local',
      evidence: [{ source: 'catalog', detail: 'skill fixture' }],
    }
    const evaluation: IrisDryRunEvaluation = {
      ...toolEvaluation,
      requirement,
      resolution: {
        requirement,
        status: 'candidates',
        candidates: [skillCandidate],
        evidence: requirement.evidence,
      },
      decision: {
        action: 'mount-candidate',
        reason: 'trusted-local',
        candidate: skillCandidate,
      },
    }

    const handoff = await applyLocalToolDecision({
      agentCtx: owner.scope.ctx,
      evaluation,
      providers: [],
      coordinator: new MountCoordinator(new DirectFiberMountAdapter()),
      signal: new AbortController().signal,
    })

    expect(handoff).toMatchObject({
      status: 'not-applicable',
      reason: 'unsupported-for-live-recovery',
    })
    expect(fixture.fixtureState.applies).toBe(0)
  })
})
