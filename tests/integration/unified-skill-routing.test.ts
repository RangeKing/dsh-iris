import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import type { SessionId } from '@deepseek-ai/dsh-session'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillFileSystem from '@deepseek-ai/dsh-skill-filesystem'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as ToolSkill from '@deepseek-ai/dsh-tool-skill'
import ToolRuntime, { RUN_CODE_NAME } from '@deepseek-ai/dsh-tools'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Config } from '../../src/config.js'
import * as irisPlugin from '../../src/index.js'
import * as fixture from '../fixtures/providers/iris-fixture-echo.mjs'

interface SkillTestAgent extends Agent {
  readonly preset: string
}

interface RuntimeSkill {
  readonly name: string
  readonly description: string
  readonly content: string
  readonly modelInvocable?: boolean
}

interface ProductCodeRequest {
  readonly bindings: readonly [{
    readonly functions: Record<string, ((args: Record<string, unknown>) => Promise<unknown>) | undefined>
  }]
}

interface ProductCodeRuntime {
  readonly language: 'typescript'
  readonly isolation: 'test'
  behavior(request: ProductCodeRequest): Promise<{ readonly logs: readonly string[]; readonly value?: unknown }>
  run(request: ProductCodeRequest): Promise<{ readonly logs: readonly string[]; readonly value?: unknown }>
}

const fixtureSkills = fileURLToPath(new URL('../fixtures/skills', import.meta.url))
const providerModule = new URL('../fixtures/providers/iris-fixture-echo.mjs', import.meta.url).href

function irisConfig(): Config {
  return {
    iris: {
      logLevel: 'silent',
      discovery: { enabled: false },
      providers: [{
        id: 'fixture.review',
        module: providerModule,
        capabilities: [{
          id: 'repo-review',
          name: 'repo-review',
          kind: 'tool',
          description: 'Review repository source using a configured Tool provider.',
          keywords: ['review codebase'],
          ptcCompatible: true,
        }],
      }],
    },
  }
}

async function harness(config: Config = irisConfig()): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SkillRegistry)
  ctx.provide('agentPresets', {
    composedPreset: (agentCtx: Context) => (
      agentCtx as unknown as { agent: SkillTestAgent }
    ).agent.preset,
    resolve: (id: string) => Promise.resolve({
      id,
      trust: 'system',
      path: `/presets/${id}/agent.cordis.yml`,
    }),
  } as never)
  await ctx.plugin(irisPlugin, config)
  return ctx
}

async function publishAgent(
  ctx: Context,
  options: {
    readonly id: string
    readonly preset?: string
    readonly skillDirectory?: string
    readonly runtimeSkills?: readonly RuntimeSkill[]
    readonly nativeSkillTool?: boolean
  },
): Promise<{ readonly agent: SkillTestAgent; readonly scope: Scope }> {
  let scope!: Scope
  let agent!: SkillTestAgent
  const owner = ctx.plugin(Object.assign(
    async (inner: Context) => {
      const id = options.id as SessionId
      const draft = {
        id,
        preset: options.preset ?? 'standard',
        session: {
          id,
          events: [] as Array<{ type: string; data: unknown }>,
          surface: { nodes: [] as number[] },
          header: { cwd: fixtureSkills },
          append(type: string, data: unknown) { this.events.push({ type, data }) },
        },
        runMaintenance: <T>(task: (signal: AbortSignal) => Promise<T>) => (
          task(new AbortController().signal)
        ),
      }
      scope = createScope(inner, draft)
      agent = Object.assign(draft, { ctx: scope.ctx }) as unknown as SkillTestAgent
      Object.defineProperty(scope.ctx, 'agent', { value: agent })
      if (options.skillDirectory !== undefined) {
        await scope.ctx.plugin(SkillFileSystem, {
          includeDefaultRoots: false,
          customSkillDirs: [options.skillDirectory],
          watch: false,
        })
      }
      for (const skill of options.runtimeSkills ?? []) {
        scope.ctx.skills.register({
          name: skill.name,
          description: skill.description,
          content: skill.content,
          source: 'runtime',
          invocation: {
            modelInvocable: skill.modelInvocable ?? true,
            userInvocable: true,
          },
        })
      }
      if (options.nativeSkillTool !== false) await scope.ctx.plugin(ToolSkill)
      scope.ctx.effect(() => inner.agents.register(agent), 'unified-skill-test.agent()')
    },
    { inject: ['agents', 'tools', 'skills', 'systemPrompt'] },
  ))
  await owner
  return { agent, scope }
}

async function runtimeFor(ctx: Context, agent: Agent) {
  const runtime = ctx.iris.runtimeFor(agent)
  expect(runtime).toBeDefined()
  await runtime!.ready
  return runtime!
}

function executeControl(
  ctx: Context,
  agent: Agent,
  name: 'iris_search' | 'iris_recommend' | 'iris_activate' | 'skill',
  args: Record<string, unknown>,
  callId: string,
) {
  return ctx.tools.execute({
    agent,
    arguments: args,
    callId: CallId(callId),
    name,
    signal: new AbortController().signal,
  })
}

function enableCodeMode(ctx: Context, owner: { agent: Agent; scope: Scope }): ProductCodeRuntime {
  const runtime: ProductCodeRuntime = {
    language: 'typescript',
    isolation: 'test',
    behavior: () => Promise.resolve({ logs: [] }),
    run(request) { return this.behavior(request) },
  }
  ctx.provide('codeRuntime', runtime as never)
  owner.scope.ctx.tools.presentAs('code')
  return runtime
}

afterEach(() => { vi.restoreAllMocks() })

describe('Unified Tool and native Skill discovery bridge', () => {
  it('discovers a filesystem Skill as metadata without loading its body', async () => {
    const ctx = await harness()
    const owner = await publishAgent(ctx, {
      id: 'skill-metadata',
      skillDirectory: fixtureSkills,
    })
    await runtimeFor(ctx, owner.agent)
    const get = vi.spyOn(ctx.skills, 'get')

    const search = await executeControl(
      ctx,
      owner.agent,
      'iris_search',
      { query: 'inspect repository risks' },
      'search-native-skill',
    )
    const recommendation = await executeControl(
      ctx,
      owner.agent,
      'iris_recommend',
      { query: 'review this repository for implementation risks' },
      'recommend-native-skill',
    )

    expect(search.isError).toBe(false)
    expect((search.value as { results: unknown[] }).results).toContainEqual(expect.objectContaining({
      id: 'skill:repo-review',
      kind: 'skill',
      route: { kind: 'dsh-skill', skillName: 'repo-review', toolName: 'skill' },
    }))
    expect(recommendation.isError).toBe(false)
    expect((recommendation.value as { results: unknown[] }).results).toContainEqual(expect.objectContaining({
      id: 'skill:repo-review',
      kind: 'skill',
    }))
    expect(get).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('delegates iris_activate for a Skill without loading or mounting it', async () => {
    fixture.fixtureState.reset()
    const ctx = await harness()
    const owner = await publishAgent(ctx, {
      id: 'skill-delegation',
      skillDirectory: fixtureSkills,
    })
    await runtimeFor(ctx, owner.agent)
    const get = vi.spyOn(ctx.skills, 'get')

    const result = await executeControl(
      ctx,
      owner.agent,
      'iris_activate',
      { capabilityId: 'skill:repo-review' },
      'activate-native-skill',
    )

    expect(result).toMatchObject({
      isError: false,
      value: {
        status: 'delegated',
        capabilityId: 'skill:repo-review',
        route: { kind: 'dsh-skill', skillName: 'repo-review', toolName: 'skill' },
      },
    })
    expect(result.additionalContexts).toBeUndefined()
    expect(get).not.toHaveBeenCalled()
    expect(fixture.fixtureState.applies).toBe(0)
    await ctx.fiber.dispose()
  })

  it('loads the real Skill body only through the DSH native skill Tool', async () => {
    const ctx = await harness()
    const owner = await publishAgent(ctx, {
      id: 'native-skill-load',
      skillDirectory: fixtureSkills,
    })
    await runtimeFor(ctx, owner.agent)
    const get = vi.spyOn(ctx.skills, 'get')

    await executeControl(ctx, owner.agent, 'iris_search', { query: 'repository review' }, 'before-native-load')
    expect(get).not.toHaveBeenCalled()
    const loaded = await executeControl(
      ctx,
      owner.agent,
      'skill',
      { name: 'repo-review' },
      'native-skill-load-call',
    )

    expect(loaded).toMatchObject({
      isError: false,
      value: {
        name: 'repo-review',
        provider: 'filesystem',
        content: expect.stringContaining('Inspect the repository evidence first.'),
      },
    })
    expect(get).toHaveBeenCalledTimes(1)
    expect(get).toHaveBeenCalledWith('repo-review', {
      cwd: fixtureSkills,
      signal: expect.any(AbortSignal),
      scope: owner.agent,
    })
    await ctx.fiber.dispose()
  })

  it('excludes Skills that DSH marks non-model-invocable', async () => {
    const ctx = await harness()
    const owner = await publishAgent(ctx, {
      id: 'skill-invocation-policy',
      skillDirectory: fixtureSkills,
    })
    await runtimeFor(ctx, owner.agent)

    const result = await executeControl(
      ctx,
      owner.agent,
      'iris_search',
      { query: 'user only review', kind: 'skill' },
      'search-user-only-skill',
    )

    expect(result.isError).toBe(false)
    expect((result.value as { results: Array<{ id: string }> }).results.map(item => item.id))
      .not.toContain('skill:user-only-review')
    await ctx.fiber.dispose()
  })

  it('keeps same-name Tool and Skill identities and routes distinct', async () => {
    const ctx = await harness()
    const owner = await publishAgent(ctx, {
      id: 'mixed-collision',
      skillDirectory: fixtureSkills,
    })
    await runtimeFor(ctx, owner.agent)

    const result = await executeControl(
      ctx,
      owner.agent,
      'iris_search',
      { query: 'repo review' },
      'mixed-collision-search',
    )
    const results = (result.value as { results: Array<{ id: string; route: { kind: string } }> }).results

    expect(results).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'tool:repo-review',
        route: { kind: 'iris-activate', capabilityId: 'tool:repo-review' },
      }),
      expect.objectContaining({
        id: 'skill:repo-review',
        route: { kind: 'dsh-skill', skillName: 'repo-review', toolName: 'skill' },
      }),
    ]))
    expect(new Set(results.map(item => item.id)).size).toBe(results.length)
    await ctx.fiber.dispose()
  })

  it('reads the DSH Skill registry at query time and preserves Agent scope', async () => {
    const ctx = await harness()
    const ownerA = await publishAgent(ctx, {
      id: 'skill-scope-a',
      runtimeSkills: [{
        name: 'agent-a-review',
        description: 'Review only Agent A workspace.',
        content: 'Agent A only.',
      }],
    })
    const ownerB = await publishAgent(ctx, { id: 'skill-scope-b' })
    const runtimeA = await runtimeFor(ctx, ownerA.agent)
    const runtimeB = await runtimeFor(ctx, ownerB.agent)

    expect((await runtimeA.search('Agent A workspace')).map(result => result.capability.id))
      .toContain('skill:agent-a-review')
    expect((await runtimeB.search('Agent A workspace')).map(result => result.capability.id))
      .not.toContain('skill:agent-a-review')

    ownerA.scope.ctx.skills.register({
      name: 'late-skill',
      description: 'A newly registered late capability.',
      content: 'Late body.',
      source: 'runtime',
    })
    expect((await runtimeA.search('newly registered late')).map(result => result.capability.id))
      .toContain('skill:late-skill')
    await ctx.fiber.dispose()
  })

  it('routes native Skills through the DSH-generated Code Mode SDK', async () => {
    const ctx = await harness()
    const owner = await publishAgent(ctx, {
      id: 'code-native-skill',
      preset: 'code',
      skillDirectory: fixtureSkills,
    })
    const codeRuntime = enableCodeMode(ctx, owner)
    await runtimeFor(ctx, owner.agent)
    const get = vi.spyOn(ctx.skills, 'get')
    const assembly = await ctx.systemPrompt.assemble({ scope: owner.agent })
    expect(assembly.sections.find(section => section.name === 'tools:sdk')?.text)
      .toContain('skill:')

    codeRuntime.behavior = async (request) => {
      const skill = request.bindings[0].functions.skill
      if (skill === undefined) throw new Error('native skill binding missing')
      return { logs: [], value: await skill({ name: 'repo-review' }) }
    }
    const loaded = await ctx.tools.execute({
      agent: owner.agent,
      arguments: { code: 'await skill({ name: "repo-review" })', description: 'Load a native DSH Skill' },
      callId: CallId('code-native-skill-load'),
      name: RUN_CODE_NAME,
      signal: new AbortController().signal,
    })

    expect(loaded).toMatchObject({
      isError: false,
      value: { result: { content: expect.stringContaining('Inspect the repository evidence first.') } },
    })
    expect(get).toHaveBeenCalledTimes(1)
    await ctx.fiber.dispose()
  })

  it('keeps Minimal free of Iris controls and Skill routing', async () => {
    const ctx = await harness()
    const owner = await publishAgent(ctx, {
      id: 'minimal-skill-preserve',
      preset: 'minimal',
      nativeSkillTool: false,
    })
    const runtime = await runtimeFor(ctx, owner.agent)

    expect(runtime.modePolicy.id).toBe('preserve')
    expect(ctx.tools.get('iris_search', owner.agent)).toBeUndefined()
    expect(ctx.tools.get('iris_recommend', owner.agent)).toBeUndefined()
    expect(ctx.tools.get('iris_activate', owner.agent)).toBeUndefined()
    expect(ctx.tools.get('skill', owner.agent)).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('routes Creator Skills to DSH while keeping Iris activation out of the body path', async () => {
    const ctx = await harness()
    const owner = await publishAgent(ctx, {
      id: 'creator-native-skill',
      preset: 'cordis',
      skillDirectory: fixtureSkills,
    })
    const runtime = await runtimeFor(ctx, owner.agent)
    const get = vi.spyOn(ctx.skills, 'get')

    expect(runtime.modePolicy.id).toBe('adaptive-creator')
    const delegated = await executeControl(
      ctx,
      owner.agent,
      'iris_activate',
      { capabilityId: 'skill:repo-review' },
      'creator-skill-route',
    )
    expect(delegated).toMatchObject({
      isError: false,
      value: { status: 'delegated', route: { kind: 'dsh-skill', skillName: 'repo-review' } },
    })
    expect(get).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('bounds Agent-scoped recommendation query deduplication', async () => {
    const ctx = await harness()
    const owner = await publishAgent(ctx, { id: 'bounded-recommendations' })
    const runtime = await runtimeFor(ctx, owner.agent)

    for (let index = 0; index <= 256; index += 1) {
      expect((await runtime.recommend(`unique query ${index}`)).deduplicated).toBe(false)
    }
    expect((await runtime.recommend('unique query 0')).deduplicated).toBe(false)
    await ctx.fiber.dispose()
  })

  it('does not let Skill discovery disturb configured Tool lazy activation', async () => {
    fixture.fixtureState.reset()
    const ctx = await harness()
    const owner = await publishAgent(ctx, {
      id: 'skill-tool-lazy-regression',
      skillDirectory: fixtureSkills,
    })
    await runtimeFor(ctx, owner.agent)

    await executeControl(ctx, owner.agent, 'iris_search', { query: 'repository risks' }, 'skill-lazy-search')
    await executeControl(ctx, owner.agent, 'iris_recommend', { query: 'review repository' }, 'skill-lazy-recommend')

    expect(fixture.fixtureState.applies).toBe(0)
    expect(ctx.tools.get('repo-review', owner.agent)).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('keeps mixed Tool and Skill ranking deterministic', async () => {
    const ctx = await harness()
    const owner = await publishAgent(ctx, {
      id: 'mixed-ranking',
      skillDirectory: fixtureSkills,
    })
    const runtime = await runtimeFor(ctx, owner.agent)

    const first = await runtime.search('review repository')
    const second = await runtime.search('review repository')
    expect(second).toEqual(first)
    expect(first.map(result => result.capability.kind)).toEqual(expect.arrayContaining(['tool', 'skill']))
    await ctx.fiber.dispose()
  })
})
