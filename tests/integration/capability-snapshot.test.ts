import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import type { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'

import {
  capabilitySnapshotVersion,
  createCapabilitySnapshot,
} from '../../src/dsh/capability-snapshot.js'
import type { CapabilityDescriptor } from '../../src/domain/index.js'
import * as fixture from '../fixtures/providers/iris-fixture-echo.mjs'

async function harness(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime)
  ctx.provide('skills', {
    snapshot: ({ scope }: { scope?: object }) => Promise.resolve({
      complete: true,
      skills: scope === undefined ? [] : [{
        name: 'fixture-skill',
        source: 'bundled',
        provider: 'fixture-provider',
      }],
    }),
  } as never)
  return ctx
}

async function agentScope(ctx: Context, id: string): Promise<{ agent: Agent; scope: Scope }> {
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

describe('Agent-scoped capability snapshot', () => {
  it('reads authoritative tools and skills and restores its stable version', async () => {
    const ctx = await harness()
    const first = await agentScope(ctx, 'snapshot-a')
    const second = await agentScope(ctx, 'snapshot-b')
    const before = await createCapabilitySnapshot(first.scope.ctx)
    const secondBefore = await createCapabilitySnapshot(second.scope.ctx)

    expect(before.skills.map(skill => skill.id)).toEqual(['skill:fixture-skill'])
    expect(before.version).toBe(secondBefore.version)

    const unregister = first.scope.ctx.tools.register(fixture.definition)
    const mounted = await createCapabilitySnapshot(first.scope.ctx)
    const isolated = await createCapabilitySnapshot(second.scope.ctx)

    expect(mounted.tools.map(tool => tool.id)).toContain('tool:iris_fixture_echo')
    expect(isolated.tools.map(tool => tool.id)).not.toContain('tool:iris_fixture_echo')
    expect(mounted.version).not.toBe(before.version)
    expect(isolated.version).toBe(secondBefore.version)

    unregister()
    expect((await createCapabilitySnapshot(first.scope.ctx)).version).toBe(before.version)
  })

  it('hashes equivalent capability sets independently of input order', () => {
    const alpha: CapabilityDescriptor = {
      id: 'tool:alpha', kind: 'tool', name: 'alpha', source: 'local', trust: 'trusted',
    }
    const beta: CapabilityDescriptor = {
      id: 'tool:beta', kind: 'tool', name: 'beta', source: 'local', trust: 'trusted',
      permissions: ['write', 'read'],
    }

    expect(capabilitySnapshotVersion([alpha, beta], []))
      .toBe(capabilitySnapshotVersion([{ ...beta, permissions: ['read', 'write'] }, alpha], []))
  })
})
