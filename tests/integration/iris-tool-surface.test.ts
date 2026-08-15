import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import { createScope } from '@deepseek-ai/dsh-scope'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'

import { irisModePolicyFor } from '../../src/capabilities/index.js'
import { DshCapabilitySurface } from '../../src/dsh/capability-surface.js'
import { ConfiguredLocalProviderCatalog } from '../../src/providers/index.js'

function tool(name: string) {
  return defineTool({
    name,
    description: `${name} test Tool`,
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute: () => Promise.resolve(name),
  })
}

describe('DSH capability visibility seam', () => {
  it('uses tools.restrict for presentation, lookup, and execution authority', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRuntime)
    ctx.tools.register(tool('core_allowed'))
    ctx.tools.register(tool('global_hidden'))
    const draft = { id: 'iris-surface-agent' }
    const scope = createScope(ctx, draft)
    const agent = Object.assign(draft, { ctx: scope.ctx })
    Object.defineProperty(scope.ctx, 'agent', { value: agent })
    let surface!: DshCapabilitySurface
    await scope.ctx.plugin(Object.assign((inner: Context) => {
      surface = new DshCapabilitySurface(
        inner,
        irisModePolicyFor('adaptive'),
        new ConfiguredLocalProviderCatalog([]),
        { inheritedAllow: ['core_allowed'] },
      )
      inner.effect(() => {
        surface.start()
        return () => { surface.dispose() }
      })
    }, { inject: ['tools', 'systemPrompt'] }))

    expect(ctx.tools.schemas(agent).map(item => item.name)).toEqual([
      'core_allowed',
      'iris_search',
    ])
    expect(ctx.tools.get('global_hidden', agent)).toBeUndefined()
    await expect(ctx.tools.execute({
      agent: agent as never,
      name: 'global_hidden',
      arguments: {},
      callId: CallId('iris-hidden-call'),
      signal: new AbortController().signal,
    })).resolves.toMatchObject({ error: { info: { code: 'UNKNOWN_TOOL' } } })
    await expect(ctx.tools.execute({
      agent: agent as never,
      name: 'core_allowed',
      arguments: {},
      callId: CallId('iris-allowed-call'),
      signal: new AbortController().signal,
    })).resolves.toMatchObject({ isError: false, value: 'core_allowed' })
    await scope.dispose()
    await ctx.fiber.dispose()
  })
})
