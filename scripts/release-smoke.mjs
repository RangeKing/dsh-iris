import { pathToFileURL } from 'node:url'

import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import { createScope } from '@deepseek-ai/dsh-scope'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'

const modulePath = process.argv[2] ?? './lib/index.js'
const irisPlugin = await import(pathToFileURL(modulePath).href)

const cases = [
  {
    preset: 'minimal',
    policy: 'preserve',
    nativeTools: ['bash', 'str_replace_editor'],
    visible: ['bash', 'str_replace_editor'],
    hidden: ['iris_search', 'iris_activate', 'iris_recommend'],
  },
  {
    preset: 'standard',
    policy: 'adaptive',
    nativeTools: ['bash', 'str_replace_editor', 'web_search', 'subagent'],
    visible: ['bash', 'str_replace_editor', 'iris_search', 'iris_activate', 'iris_recommend'],
    hidden: ['web_search', 'subagent'],
  },
  {
    preset: 'code',
    policy: 'adaptive-code',
    nativeTools: ['bash', 'str_replace_editor', 'web_search'],
    visible: ['bash', 'str_replace_editor', 'iris_search', 'iris_activate', 'iris_recommend'],
    hidden: ['web_search'],
  },
  {
    preset: 'cordis',
    policy: 'adaptive-creator',
    nativeTools: ['bash', 'str_replace_editor', 'cordis_inspect_list', 'cordis_define'],
    visible: ['bash', 'str_replace_editor', 'iris_search', 'iris_activate', 'iris_recommend'],
    hidden: ['cordis_inspect_list', 'cordis_define'],
  },
]

function nativeTool(name) {
  return defineTool({
    name,
    description: `${name} release-smoke Tool`,
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute: () => Promise.resolve(name),
  })
}

for (const testCase of cases) {
  const ctx = new Context()
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SkillRegistry)
  for (const name of testCase.nativeTools) ctx.tools.register(nativeTool(name))
  ctx.provide('agentPresets', {
    composedPreset: agentCtx => agentCtx.agent.preset,
    resolve: id => Promise.resolve({
      id,
      trust: 'system',
      path: `/presets/${id}/agent.cordis.yml`,
    }),
  })
  await ctx.plugin(irisPlugin, { iris: { logLevel: 'silent' } })

  let scope
  let agent
  const owner = ctx.plugin(Object.assign((inner) => {
    const draft = {
      id: `release-smoke-${testCase.preset}`,
      preset: testCase.preset,
      session: {
        id: `release-smoke-${testCase.preset}`,
        header: {},
        append() {},
      },
      runMaintenance: task => task(new AbortController().signal),
    }
    scope = createScope(inner, draft)
    agent = Object.assign(draft, { ctx: scope.ctx })
    Object.defineProperty(scope.ctx, 'agent', { value: agent })
    scope.ctx.effect(() => inner.agents.register(agent), 'release-smoke.agent()')
  }, { inject: ['agents', 'tools', 'skills', 'systemPrompt'] }))
  await owner
  const runtime = ctx.iris.runtimeFor(agent)
  if (runtime === undefined) throw new Error(`${testCase.preset}: Iris Runtime missing`)
  await runtime.ready
  if (runtime.modePolicy.id !== testCase.policy) {
    throw new Error(`${testCase.preset}: expected ${testCase.policy}, got ${runtime.modePolicy.id}`)
  }
  for (const name of testCase.visible) {
    if (ctx.tools.get(name, agent) === undefined) {
      throw new Error(`${testCase.preset}: expected visible Tool ${name}`)
    }
  }
  for (const name of testCase.hidden) {
    if (ctx.tools.get(name, agent) !== undefined) {
      throw new Error(`${testCase.preset}: expected hidden Tool ${name}`)
    }
  }
  const snapshot = await ctx.irisRemote.snapshot(agent.id)
  if (!snapshot.enabled || snapshot.mode !== testCase.preset) {
    throw new Error(`${testCase.preset}: invalid Host snapshot`)
  }
  await scope.dispose()
  await owner.dispose()
  await ctx.fiber.dispose()
}

console.log('packed Bundle four-mode smoke: ok')
