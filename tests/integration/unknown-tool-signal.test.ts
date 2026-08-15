import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import type { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'

import { observeUnknownTool } from '../../src/sensing/unknown-tool.js'

const neverAborted = new AbortController().signal

async function scopedHarness(): Promise<{
  ctx: Context
  agent: Agent
  scope: Scope
}> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime)
  const agent = { id: 'signal-agent' as SessionId } as Agent
  let scope!: Scope
  await ctx.plugin(Object.assign(
    (inner: Context) => {
      scope = createScope(inner, agent)
      Object.defineProperty(scope.ctx, 'agent', { value: agent })
    },
    { inject: ['tools', 'systemPrompt'] },
  ))
  return { agent, ctx, scope }
}

describe('UNKNOWN_TOOL failure signal', () => {
  it('translates the actual structured DSH error without changing its result', async () => {
    const { agent, ctx } = await scopedHarness()
    const execution = {
      agent,
      arguments: {},
      callId: CallId('missing-call'),
      name: 'iris_missing_fixture',
      signal: neverAborted,
    }
    const result = await ctx.tools.execute(execution)
    const original = structuredClone(result)

    const signal = observeUnknownTool(execution, result)

    expect(signal).toEqual({
      capability: { kind: 'tool', name: 'iris_missing_fixture' },
      evidence: {
        callId: 'missing-call',
        errorCode: 'UNKNOWN_TOOL',
        errorName: 'ToolNotFoundError',
        source: 'tools/result',
      },
      kind: 'capability-failure',
      owner: { agentId: 'signal-agent' },
    })
    expect(result).toEqual(original)
  })

  it('ignores failures without the exact structured identity', () => {
    const execution = {
      arguments: {},
      callId: 'other-call',
      name: 'some_tool',
      signal: neverAborted,
    }

    expect(observeUnknownTool(execution, {
      error: { message: 'unknown tool in free text' },
      isError: true,
    })).toBeUndefined()
  })
})
