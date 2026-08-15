import { Context } from '@deepseek-ai/cordis'
import type { Plugin } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { CallId } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'

import { DirectFiberMountAdapter } from '../../src/mounting/direct-fiber.js'
import { ExperimentalLoaderMountAdapter } from '../../src/mounting/loader.js'
import { MountCoordinator } from '../../src/mounting/coordinator.js'
import * as fixture from '../fixtures/providers/iris-fixture-echo.mjs'

const neverAborted = new AbortController().signal

interface AgentScope {
  readonly agent: Agent
  readonly scope: Scope
}

async function harness(options: { loader?: boolean } = {}): Promise<Context> {
  const ctx = new Context()
  if (options.loader) await ctx.plugin(Loader)
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime)
  return ctx
}

async function agentScope(ctx: Context, id: string): Promise<AgentScope> {
  const agent = { id: id as SessionId } as Agent
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

function candidate(config: Parameters<typeof fixture.apply>[1] = {}) {
  return {
    capabilityId: fixture.toolName,
    plugin: fixture as Plugin,
    loaderSpecifier: new URL('../fixtures/providers/iris-fixture-echo.mjs', import.meta.url).href,
    config,
  }
}

describe('Direct Fiber Agent-scoped mounting', () => {
  it('makes the fixture tool visible and callable only after mount', async () => {
    const ctx = await harness()
    const owner = await agentScope(ctx, 'agent-a')
    const adapter = new DirectFiberMountAdapter()

    expect(ctx.tools.get(fixture.toolName, owner.agent)).toBeUndefined()

    const handle = await adapter.mount(owner.scope.ctx, candidate())

    expect(handle.verification).toEqual({
      capabilityId: fixture.toolName,
      source: 'ctx.tools',
      visible: true,
    })
    expect(ctx.tools.get(fixture.toolName, owner.agent)).toBeDefined()
    const result = await ctx.tools.execute({
      agent: owner.agent,
      arguments: { text: 'ready' },
      callId: CallId('fixture-call'),
      name: fixture.toolName,
      signal: neverAborted,
    })
    expect(result.isError).toBe(false)
    expect(result.content).toEqual([{ type: 'text', text: 'echo:ready' }])
  })

  it('single-flights concurrent mounts and clears a failed generation', async () => {
    fixture.fixtureState.reset()
    const ctx = await harness()
    const owner = await agentScope(ctx, 'agent-single-flight')
    const coordinator = new MountCoordinator(new DirectFiberMountAdapter())

    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const pending = Array.from(
      { length: 16 },
      () => coordinator.mount(owner.scope.ctx, candidate({ gate })),
    )
    await Promise.resolve()
    release()
    const handles = await Promise.all(pending)

    expect(fixture.fixtureState.applies).toBe(1)
    expect(new Set(handles)).toHaveLength(1)

    await handles[0]!.dispose()
    fixture.fixtureState.reset()
    const failed = await Promise.allSettled(Array.from(
      { length: 16 },
      () => coordinator.mount(
        owner.scope.ctx,
        candidate({ failAfterRegister: true }),
      ),
    ))
    const reasons = failed.map((result) => {
      expect(result.status).toBe('rejected')
      return result.status === 'rejected' ? result.reason as unknown : undefined
    })

    expect(fixture.fixtureState.applies).toBe(1)
    expect(new Set(reasons)).toHaveLength(1)
    expect(ctx.tools.get(fixture.toolName, owner.agent)).toBeUndefined()

    const retry = await coordinator.mount(owner.scope.ctx, candidate())
    expect(retry.state).toBe('mounted')
    expect(fixture.fixtureState.applies).toBe(2)
  })

  it('isolates the mounted tool from another Agent and removes it on dispose', async () => {
    const ctx = await harness()
    const owner = await agentScope(ctx, 'agent-a')
    const other = await agentScope(ctx, 'agent-b')
    const handle = await new DirectFiberMountAdapter().mount(owner.scope.ctx, candidate())

    expect(ctx.tools.get(fixture.toolName, owner.agent)).toBeDefined()
    expect(ctx.tools.get(fixture.toolName, other.agent)).toBeUndefined()
    expect(handle.ownerIdentity).toBe('agent-a')

    await handle.dispose()
    await handle.dispose()

    expect(handle.state).toBe('disposed')
    expect(ctx.tools.get(fixture.toolName, owner.agent)).toBeUndefined()
    expect(ctx.tools.get(fixture.toolName, other.agent)).toBeUndefined()
  })

  it('rolls back a failed apply and permits a clean retry', async () => {
    fixture.fixtureState.reset()
    const ctx = await harness()
    const owner = await agentScope(ctx, 'agent-rollback')
    const adapter = new DirectFiberMountAdapter()

    await expect(adapter.mount(
      owner.scope.ctx,
      candidate({ failAfterRegister: true }),
    )).rejects.toThrow(/failed to mount/)

    expect(ctx.tools.get(fixture.toolName, owner.agent)).toBeUndefined()
    expect(ctx.registry.has(fixture.apply)).toBe(false)
    expect(fixture.fixtureState).toMatchObject({ applies: 1, disposes: 1 })

    const retry = await adapter.mount(owner.scope.ctx, candidate())
    expect(retry.state).toBe('mounted')
    expect(ctx.tools.get(fixture.toolName, owner.agent)).toBeDefined()
  })

  it('settles owner teardown while apply is still pending without residue', async () => {
    fixture.fixtureState.reset()
    const ctx = await harness()
    const owner = await agentScope(ctx, 'agent-pending-teardown')
    const adapter = new DirectFiberMountAdapter()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })

    const mounting = adapter.mount(owner.scope.ctx, candidate({ gate }))
    await Promise.resolve()
    const teardown = owner.scope.dispose()
    release()

    await expect(mounting).rejects.toThrow(/disposed while mounting/)
    await teardown
    expect(ctx.tools.get(fixture.toolName, owner.agent)).toBeUndefined()
    expect(ctx.registry.has(fixture.apply)).toBe(false)
    expect(fixture.fixtureState).toMatchObject({ applies: 1, disposes: 1 })
  })

  it('makes completed mount disposal idempotent under an owner teardown race', async () => {
    const ctx = await harness()
    const owner = await agentScope(ctx, 'agent-dispose-race')
    const handle = await new DirectFiberMountAdapter().mount(
      owner.scope.ctx,
      candidate(),
    )

    await Promise.all([
      handle.dispose(),
      handle.dispose(),
      owner.scope.dispose(),
    ])

    expect(handle.state).toBe('disposed')
    expect(ctx.tools.get(fixture.toolName, owner.agent)).toBeUndefined()
  })

  it('tears down one Agent without affecting another Agent mount', async () => {
    const ctx = await harness()
    const first = await agentScope(ctx, 'agent-first')
    const second = await agentScope(ctx, 'agent-second')
    const adapter = new DirectFiberMountAdapter()
    await adapter.mount(first.scope.ctx, candidate())
    const survivor = await adapter.mount(second.scope.ctx, candidate())

    await first.scope.dispose()

    expect(ctx.tools.get(fixture.toolName, first.agent)).toBeUndefined()
    expect(ctx.tools.get(fixture.toolName, second.agent)).toBeDefined()
    expect(survivor.state).toBe('mounted')
  })
})

describe('Loader mounting experiment', () => {
  it('records that a root Loader entry is visible to both Agents', async () => {
    const ctx = await harness({ loader: true })
    const owner = await agentScope(ctx, 'agent-a')
    const other = await agentScope(ctx, 'agent-b')

    const handle = await new ExperimentalLoaderMountAdapter().mount(
      owner.scope.ctx,
      candidate(),
    )

    expect(handle.ownerIdentity).toBe('loader-root')
    expect(ctx.tools.get(fixture.toolName, owner.agent)).toBeDefined()
    expect(ctx.tools.get(fixture.toolName, other.agent)).toBeDefined()

    await handle.dispose()

    expect(ctx.tools.get(fixture.toolName, owner.agent)).toBeUndefined()
    expect(ctx.tools.get(fixture.toolName, other.agent)).toBeUndefined()
    expect([...ctx.loader.entries()]).toEqual([])
  })

  it('outlives the requesting Agent until the Loader entry is removed', async () => {
    const ctx = await harness({ loader: true })
    const owner = await agentScope(ctx, 'loader-owner')
    const other = await agentScope(ctx, 'loader-observer')
    const handle = await new ExperimentalLoaderMountAdapter().mount(
      owner.scope.ctx,
      candidate(),
    )

    await owner.scope.dispose()

    expect(handle.state).toBe('mounted')
    expect(ctx.tools.get(fixture.toolName, other.agent)).toBeDefined()
    expect([...ctx.loader.entries()]).toHaveLength(1)

    await handle.dispose()
    expect(ctx.tools.get(fixture.toolName, other.agent)).toBeUndefined()
  })

  it('removes a failed entry and permits a later Loader mount', async () => {
    fixture.fixtureState.reset()
    const ctx = await harness({ loader: true })
    const owner = await agentScope(ctx, 'loader-rollback')
    const adapter = new ExperimentalLoaderMountAdapter()

    await expect(adapter.mount(
      owner.scope.ctx,
      candidate({ failAfterRegister: true }),
    )).rejects.toThrow(/Loader failed to mount/)

    expect(ctx.tools.get(fixture.toolName, owner.agent)).toBeUndefined()
    expect([...ctx.loader.entries()]).toEqual([])
    expect(ctx.registry.has(fixture.apply)).toBe(false)

    const retry = await adapter.mount(owner.scope.ctx, candidate())
    expect(retry.state).toBe('mounted')
    expect([...ctx.loader.entries()]).toHaveLength(1)
  })
})
