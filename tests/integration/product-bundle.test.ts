import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import type { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool, RUN_CODE_NAME } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Config, ConfiguredPolicy } from '../../src/config.js'
import * as irisPlugin from '../../src/index.js'
import * as fixture from '../fixtures/providers/iris-fixture-echo.mjs'
import * as upperFixture from '../fixtures/providers/iris-fixture-upper.mjs'

interface ProductAgent extends Agent {
  readonly preset: string
}

interface ProductCodeRequest {
  readonly bindings: readonly [{
    readonly functions: Record<string, ((args: Record<string, unknown>) => Promise<unknown>) | undefined>
  }]
}

interface ProductCodeRuntime {
  behavior(request: ProductCodeRequest): Promise<{ readonly logs: readonly string[]; readonly value?: unknown }>
  run(request: ProductCodeRequest): Promise<{ readonly logs: readonly string[]; readonly value?: unknown }>
}

const providerModule = new URL('../fixtures/providers/iris-fixture-echo.mjs', import.meta.url).href
const upperProviderModule = new URL('../fixtures/providers/iris-fixture-upper.mjs', import.meta.url).href
const exampleProviderModule = new URL('../../examples/local-text-tools/provider.mjs', import.meta.url).href

function localConfig(policy: ConfiguredPolicy = 'auto'): Config {
  return {
    iris: {
      policy,
      logLevel: 'silent',
      providers: [{
        id: 'fixture.echo',
        module: providerModule,
        capabilities: [{
          id: fixture.toolName,
          kind: 'tool',
          ptcCompatible: true,
        }],
      }],
    },
  }
}

async function harness(config: Config = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime)
  ctx.provide('agentPresets', {
    composedPreset: (agentCtx: Context) => (
      agentCtx as unknown as { agent: ProductAgent }
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
  preset: string,
  id = `product-${preset}`,
  nativeTools: readonly string[] = [],
): Promise<{ readonly agent: ProductAgent; readonly scope: Scope }> {
  let scope!: Scope
  let agent!: ProductAgent
  const owner = ctx.plugin(Object.assign(
    (inner: Context) => {
      const draft = {
        id: id as SessionId,
        preset,
        session: {
          id: id as SessionId,
          events: [] as Array<{ type: string; data: unknown }>,
          header: {},
          append(type: string, data: unknown) { this.events.push({ type, data }) },
        },
        runMaintenance: <T>(task: (signal: AbortSignal) => Promise<T>) => (
          task(new AbortController().signal)
        ),
      }
      scope = createScope(inner, draft)
      agent = Object.assign(draft, { ctx: scope.ctx }) as unknown as ProductAgent
      Object.defineProperty(scope.ctx, 'agent', { value: agent })
      for (const name of nativeTools) {
        scope.ctx.tools.register(defineTool({
          name,
          description: `${name} native preset Tool`,
          parameters: {},
          output: {
            schema: { type: 'string' },
            render: (_args, value) => [{ type: 'text', text: value }],
          },
          execute: () => Promise.resolve(name),
        }))
      }
      scope.ctx.effect(() => inner.agents.register(agent), 'product-test.agent()')
    },
    { inject: ['agents', 'tools', 'systemPrompt'] },
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

function enableCodeMode(ctx: Context, owner: { agent: Agent; scope: Scope }): ProductCodeRuntime {
  const runtime: ProductCodeRuntime = {
    language: 'typescript',
    isolation: 'test',
    behavior: () => Promise.resolve({ logs: [] }),
    run(request) { return this.behavior(request) },
  } as ProductCodeRuntime
  ctx.provide('codeRuntime', runtime as never)
  owner.scope.ctx.tools.presentAs('code')
  return runtime
}

function activateCapabilityInCode(
  ctx: Context,
  agent: Agent,
  runtime: ProductCodeRuntime,
  capabilityId: string = `tool:${fixture.toolName}`,
  callId = `code-activate-${capabilityId}`,
) {
  runtime.behavior = async (request) => {
    const activate = request.bindings[0].functions.iris_activate
    if (activate === undefined) throw new Error('iris_activate missing from Code bindings')
    const value = await activate({ capabilityId })
    return { logs: [], value }
  }
  return ctx.tools.execute({
    agent,
    arguments: { code: 'await iris_activate({ capabilityId })', description: 'Activate an Iris capability' },
    callId: CallId(callId),
    name: RUN_CODE_NAME,
    signal: new AbortController().signal,
  })
}

function executeMissing(ctx: Context, agent: Agent, name: string = fixture.toolName) {
  return ctx.tools.execute({
    agent,
    arguments: { text: 'hello' },
    callId: CallId(`product-${name}`),
    name,
    signal: new AbortController().signal,
  })
}

function activateCapability(
  ctx: Context,
  agent: Agent,
  capabilityId: string = `tool:${fixture.toolName}`,
  callId = `activate-${capabilityId}`,
) {
  return ctx.tools.execute({
    agent,
    arguments: { capabilityId },
    callId: CallId(callId),
    name: 'iris_activate',
    signal: new AbortController().signal,
  })
}

function recommendCapabilities(
  ctx: Context,
  agent: Agent,
  query: string,
  callId = `recommend-${query}`,
) {
  return ctx.tools.execute({
    agent,
    arguments: { query },
    callId: CallId(callId),
    name: 'iris_recommend',
    signal: new AbortController().signal,
  })
}

afterEach(() => { vi.unstubAllGlobals() })

describe('dsh-iris v0.1 Bundle product path', () => {
  it('starts with the default empty configuration', async () => {
    const ctx = await harness()
    const owner = await publishAgent(ctx, 'standard', 'default-empty')

    const runtime = await runtimeFor(ctx, owner.agent)
    expect(runtime.modePolicy.id).toBe('adaptive')
    expect(ctx.tools.get('iris_search', owner.agent)).toBeDefined()
    expect(ctx.tools.get('iris_activate', owner.agent)).toBeDefined()
    expect(ctx.tools.get('iris_recommend', owner.agent)).toBeDefined()
    await owner.scope.dispose()
    await ctx.fiber.dispose()
  })

  it('automatically lazy-loads, mounts, and hands off a Standard local Tool', async () => {
    fixture.fixtureState.reset()
    const ctx = await harness(localConfig())
    const owner = await publishAgent(ctx, 'standard')
    const runtime = await runtimeFor(ctx, owner.agent)
    expect(fixture.fixtureState.applies).toBe(0)
    expect(ctx.tools.get(fixture.toolName, owner.agent)).toBeUndefined()
    expect(runtime.surface.snapshot()).toMatchObject({
      catalogued: [`tool:${fixture.toolName}`],
      activated: ['tool:iris_activate', 'tool:iris_recommend', 'tool:iris_search'],
      visible: ['tool:iris_activate', 'tool:iris_recommend', 'tool:iris_search'],
      pinned: ['tool:iris_activate', 'tool:iris_recommend', 'tool:iris_search'],
      staged: [],
    })

    const result = await executeMissing(ctx, owner.agent)

    expect(result.error?.info?.code).toBe('UNKNOWN_TOOL')
    expect(result.additionalContexts).toHaveLength(1)
    expect(fixture.fixtureState.applies).toBe(1)
    expect(ctx.tools.get(fixture.toolName, owner.agent)).toBeDefined()
    expect((await ctx.systemPrompt.assemble({ scope: owner.agent })).tools.map(tool => tool.name))
      .toContain(fixture.toolName)
    expect(runtime.surface.snapshot().activated).toContain(`tool:${fixture.toolName}`)
    expect(runtime.surface.snapshot().visible).toContain(`tool:${fixture.toolName}`)
    await ctx.fiber.dispose()
  })

  it('searches Catalog metadata without importing or applying the Provider', async () => {
    fixture.fixtureState.reset()
    const ctx = await harness({
      iris: {
        logLevel: 'silent',
        providers: [{
          id: 'fixture.echo',
          module: providerModule,
          capabilities: [{
            id: fixture.toolName,
            kind: 'tool',
            description: 'Count words in local text.',
            keywords: ['count words'],
            ptcCompatible: true,
          }],
        }],
      },
    })
    const owner = await publishAgent(ctx, 'standard', 'catalog-search')
    await runtimeFor(ctx, owner.agent)

    const result = await ctx.tools.execute({
      agent: owner.agent,
      arguments: { query: 'count words' },
      callId: CallId('iris-search'),
      name: 'iris_search',
      signal: new AbortController().signal,
    })

    expect(result).toMatchObject({
      isError: false,
      value: { results: [{ id: `tool:${fixture.toolName}`, status: 'catalogued' }] },
    })
    expect(fixture.fixtureState.applies).toBe(0)
    expect(ctx.tools.get(fixture.toolName, owner.agent)).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('searches, explicitly activates, and uses a local Tool without UNKNOWN_TOOL', async () => {
    fixture.fixtureState.reset()
    const ctx = await harness({
      iris: {
        logLevel: 'silent',
        providers: [{
          id: 'fixture.echo',
          module: providerModule,
          capabilities: [{
            id: fixture.toolName,
            kind: 'tool',
            description: 'Echo local text.',
            keywords: ['echo text'],
            ptcCompatible: true,
          }],
        }],
      },
    })
    const owner = await publishAgent(ctx, 'standard', 'explicit-standard')
    await runtimeFor(ctx, owner.agent)

    const search = await ctx.tools.execute({
      agent: owner.agent,
      arguments: { query: 'echo text' },
      callId: CallId('explicit-search'),
      name: 'iris_search',
      signal: new AbortController().signal,
    })
    expect(search).toMatchObject({
      isError: false,
      value: { results: [{ id: `tool:${fixture.toolName}` }] },
    })
    expect(fixture.fixtureState.applies).toBe(0)

    const activated = await activateCapability(ctx, owner.agent)
    expect(activated).toMatchObject({
      isError: false,
      value: {
        status: 'capability-ready',
        capabilityId: `tool:${fixture.toolName}`,
        readiness: 'immediate',
      },
      additionalContexts: [expect.any(Object)],
    })
    expect(fixture.fixtureState.applies).toBe(1)

    const nextCall = await ctx.tools.execute({
      agent: owner.agent,
      arguments: { text: 'hello' },
      callId: CallId('explicit-next-normal-call'),
      name: fixture.toolName,
      signal: new AbortController().signal,
    })
    expect(nextCall).toMatchObject({ isError: false, value: 'echo:hello' })
    await ctx.fiber.dispose()
  })

  it('returns typed explicit-activation failures and keeps repeat activation idempotent', async () => {
    fixture.fixtureState.reset()
    const ctx = await harness(localConfig())
    const owner = await publishAgent(ctx, 'standard', 'explicit-idempotent')
    await runtimeFor(ctx, owner.agent)

    const missing = await activateCapability(
      ctx,
      owner.agent,
      'tool:missing-capability',
      'activate-missing',
    )
    expect(missing).toMatchObject({
      isError: false,
      value: {
        status: 'not-found',
        capabilityId: 'tool:missing-capability',
        reason: 'not-catalogued',
      },
    })
    expect(fixture.fixtureState.applies).toBe(0)

    const first = await activateCapability(ctx, owner.agent, undefined, 'activate-first')
    const second = await activateCapability(ctx, owner.agent, undefined, 'activate-second')
    expect(first).toMatchObject({ value: { status: 'capability-ready' } })
    expect(second).toMatchObject({ value: { status: 'already-active' } })
    expect(fixture.fixtureState.applies).toBe(1)
    await ctx.fiber.dispose()
  })

  it('single-flights concurrent iris_activate calls', async () => {
    fixture.fixtureState.reset()
    const ctx = await harness(localConfig())
    const owner = await publishAgent(ctx, 'standard', 'explicit-single-flight')
    await runtimeFor(ctx, owner.agent)

    const results = await Promise.all(Array.from({ length: 16 }, (_, index) => (
      activateCapability(ctx, owner.agent, undefined, `activate-concurrent-${index}`)
    )))

    expect(results.every(result => result.isError === false)).toBe(true)
    expect(fixture.fixtureState.applies).toBe(1)
    expect(ctx.tools.get(fixture.toolName, owner.agent)).toBeDefined()
    await ctx.fiber.dispose()
  })

  it('recommends at most three relevant capabilities without loading Providers and deduplicates the query', async () => {
    fixture.fixtureState.reset()
    upperFixture.fixtureState.reset()
    const ctx = await harness({
      iris: {
        logLevel: 'silent',
        providers: [
          {
            id: 'fixture.echo',
            module: providerModule,
            capabilities: [{
              id: fixture.toolName,
              name: 'text_word_count',
              kind: 'tool',
              description: 'Count words, characters, and lines in text.',
              keywords: ['count words', 'text statistics'],
              ptcCompatible: true,
            }],
          },
          {
            id: 'fixture.upper',
            module: upperProviderModule,
            capabilities: [{
              id: upperFixture.toolName,
              name: 'text_uppercase',
              kind: 'tool',
              description: 'Convert local text to uppercase.',
              keywords: ['uppercase text'],
              ptcCompatible: false,
            }],
          },
          ...['text_lines', 'text_bytes', 'text_trim'].map(id => ({
            id: `fixture.${id}`,
            module: providerModule,
            capabilities: [{
              id,
              kind: 'tool' as const,
              description: `Optional ${id} text utility.`,
              keywords: ['text utility'],
              ptcCompatible: true,
            }],
          })),
        ],
      },
    })
    const owner = await publishAgent(ctx, 'standard', 'recommend-standard')
    await runtimeFor(ctx, owner.agent)

    const first = await recommendCapabilities(
      ctx,
      owner.agent,
      'Count the words in this text',
      'recommend-first',
    )
    const repeated = await recommendCapabilities(
      ctx,
      owner.agent,
      'Count the words in this text',
      'recommend-repeated',
    )

    expect(first).toMatchObject({ isError: false, value: { deduplicated: false } })
    expect((first.value as { results: unknown[] }).results[0]).toMatchObject({
      id: `tool:${fixture.toolName}`,
      name: 'text_word_count',
    })
    expect((first.value as { results: unknown[] }).results.length).toBeLessThanOrEqual(3)
    expect(repeated).toMatchObject({
      isError: false,
      value: { deduplicated: true, results: [] },
    })
    expect(fixture.fixtureState.applies).toBe(0)
    expect(upperFixture.fixtureState.applies).toBe(0)
    await ctx.fiber.dispose()
  })

  it('runs the packaged local text provider after the normal next-call boundary', async () => {
    const ctx = await harness({
      iris: {
        logLevel: 'silent',
        providers: [{
          id: 'example.local-text-tools',
          module: exampleProviderModule,
          capabilities: [{ id: 'text_word_count', kind: 'tool', ptcCompatible: true }],
        }],
      },
    })
    const owner = await publishAgent(ctx, 'standard', 'packaged-example')

    const missing = await executeMissing(ctx, owner.agent, 'text_word_count')
    const normalNextCall = await ctx.tools.execute({
      agent: owner.agent,
      arguments: { text: 'Iris stays dormant\nuntil needed.' },
      callId: CallId('packaged-example-next-call'),
      name: 'text_word_count',
      signal: new AbortController().signal,
    })

    expect(missing.additionalContexts).toHaveLength(1)
    expect(normalNextCall).toMatchObject({
      isError: false,
      value: { words: 5, characters: 32, lines: 2 },
    })
    await ctx.fiber.dispose()
  })

  it('keeps Minimal observational and never calls discovery', async () => {
    fixture.fixtureState.reset()
    const request = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', request)
    const ctx = await harness(localConfig())
    const native = ['persistent_bash', 'str_replace_editor']
    const owner = await publishAgent(ctx, 'minimal', 'minimal-preserve', native)
    const runtime = await runtimeFor(ctx, owner.agent)

    expect(runtime.modePolicy.id).toBe('preserve')
    expect(ctx.tools.schemas(owner.agent).map(tool => tool.name)).toEqual(native)
    expect(ctx.tools.get('iris_search', owner.agent)).toBeUndefined()
    expect(ctx.tools.get('iris_activate', owner.agent)).toBeUndefined()
    expect(ctx.tools.get('iris_recommend', owner.agent)).toBeUndefined()

    const result = await executeMissing(ctx, owner.agent)

    expect(result.additionalContexts).toBeUndefined()
    expect(fixture.fixtureState.applies).toBe(0)
    expect(ctx.tools.get(fixture.toolName, owner.agent)).toBeUndefined()
    expect(request).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('stages an explicitly activated compatible PTC Tool for the next Code Mode SDK', async () => {
    fixture.fixtureState.reset()
    const ctx = await harness(localConfig())
    const owner = await publishAgent(ctx, 'code')
    const codeRuntime = enableCodeMode(ctx, owner)
    const runtime = await runtimeFor(ctx, owner.agent)
    const stepN = await ctx.systemPrompt.assemble({ scope: owner.agent })
    expect(stepN.sections.find(section => section.name === 'tools:sdk')?.text)
      .toContain('iris_activate:')
    expect(stepN.sections.find(section => section.name === 'tools:sdk')?.text)
      .toContain('iris_recommend:')
    expect(stepN.sections.find(section => section.name === 'tools:sdk')?.text)
      .not.toContain(`${fixture.toolName}:`)

    const result = await activateCapabilityInCode(
      ctx,
      owner.agent,
      codeRuntime,
      undefined,
      'code-explicit-activate',
    )
    expect(runtime.surface.snapshot().staged).toEqual([`tool:${fixture.toolName}`])
    expect(runtime.surface.snapshot().visible).not.toContain(`tool:${fixture.toolName}`)
    const assembly = await ctx.systemPrompt.assemble({ scope: owner.agent })

    expect(result).toMatchObject({
      isError: false,
      value: { result: { status: 'capability-ready', readiness: 'next-step' } },
      additionalContexts: [expect.any(Object)],
    })
    expect(assembly.tools.map(tool => tool.name)).toEqual([RUN_CODE_NAME])
    expect(assembly.sections.find(section => section.name === 'tools:sdk')?.text)
      .toContain(`${fixture.toolName}:`)
    expect(runtime.surface.snapshot().staged).toEqual([])
    expect(runtime.surface.snapshot().visible).toContain(`tool:${fixture.toolName}`)
    expect(runtime.lastOutcome).toMatchObject({
      status: 'capability-ready',
      readiness: 'next-step',
    })
    await ctx.fiber.dispose()
  })

  it.each([false, undefined])('keeps Code SDK unchanged when PTC compatibility is %s', async (ptcCompatible) => {
    fixture.fixtureState.reset()
    const capability = {
      id: fixture.toolName,
      kind: 'tool' as const,
      ...ptcCompatible === undefined ? {} : { ptcCompatible },
    }
    const ctx = await harness({
      iris: {
        logLevel: 'silent',
        discovery: { enabled: false },
        providers: [{ id: 'fixture.echo', module: providerModule, capabilities: [capability] }],
      },
    })
    const owner = await publishAgent(ctx, 'code', `code-${String(ptcCompatible)}`)
    const codeRuntime = enableCodeMode(ctx, owner)
    await runtimeFor(ctx, owner.agent)

    const before = await ctx.systemPrompt.assemble({ scope: owner.agent })
    const result = await activateCapabilityInCode(
      ctx,
      owner.agent,
      codeRuntime,
      undefined,
      `code-incompatible-${String(ptcCompatible)}`,
    )
    const after = await ctx.systemPrompt.assemble({ scope: owner.agent })

    expect(result).toMatchObject({
      isError: false,
      value: { result: {
        status: 'denied',
        reason: ptcCompatible === false
          ? 'ptc-incompatible'
          : 'ptc-compatibility-unproven',
      } },
    })
    expect(result.additionalContexts).toBeUndefined()
    expect(fixture.fixtureState.applies).toBe(0)
    expect(before.sections.find(section => section.name === 'tools:sdk')?.text)
      .toBe(after.sections.find(section => section.name === 'tools:sdk')?.text)
    await ctx.fiber.dispose()
  })

  it('pins Creator control-plane Tools while work Providers stay catalogued', async () => {
    fixture.fixtureState.reset()
    const ctx = await harness(localConfig())
    const creatorControlPlane = [
      'cordis_inspect_list',
      'cordis_inspect_query',
      'cordis_inspect_self',
      'cordis_define',
      'cordis_run',
      'cordis_stop',
      'cordis_undefine',
    ]
    const owner = await publishAgent(ctx, 'cordis', 'creator-control', creatorControlPlane)
    const runtime = await runtimeFor(ctx, owner.agent)

    expect(runtime.modePolicy.id).toBe('adaptive-creator')
    expect(ctx.tools.get('iris_activate', owner.agent)).toBeDefined()
    expect(ctx.tools.get('iris_recommend', owner.agent)).toBeDefined()
    expect(runtime.surface.snapshot().pinned).toEqual([
      'tool:cordis_define',
      'tool:cordis_inspect_list',
      'tool:cordis_inspect_query',
      'tool:cordis_inspect_self',
      'tool:cordis_run',
      'tool:cordis_stop',
      'tool:cordis_undefine',
      'tool:iris_activate',
      'tool:iris_recommend',
      'tool:iris_search',
    ])
    expect(ctx.tools.get(fixture.toolName, owner.agent)).toBeUndefined()
    expect(fixture.fixtureState.applies).toBe(0)
    await ctx.fiber.dispose()
  })

  it('explicitly activates a local Creator data-plane Tool without unpinning its control plane', async () => {
    fixture.fixtureState.reset()
    const ctx = await harness(localConfig())
    const creatorControlPlane = [
      'cordis_inspect_list',
      'cordis_inspect_query',
      'cordis_inspect_self',
      'cordis_define',
      'cordis_run',
      'cordis_stop',
      'cordis_undefine',
    ]
    const owner = await publishAgent(ctx, 'cordis', 'creator-explicit', creatorControlPlane)
    const runtime = await runtimeFor(ctx, owner.agent)

    const result = await activateCapability(ctx, owner.agent, undefined, 'creator-explicit-activate')

    expect(result).toMatchObject({
      isError: false,
      value: { status: 'capability-ready', readiness: 'immediate' },
    })
    expect(fixture.fixtureState.applies).toBe(1)
    expect(ctx.tools.get(fixture.toolName, owner.agent)).toBeDefined()
    expect(runtime.surface.snapshot().pinned).toEqual(expect.arrayContaining([
      'tool:cordis_define',
      'tool:cordis_inspect_list',
      'tool:iris_activate',
      'tool:iris_recommend',
      'tool:iris_search',
    ]))
    await ctx.fiber.dispose()
  })

  it('activates only the demanded Provider from a multi-Provider Catalog', async () => {
    fixture.fixtureState.reset()
    upperFixture.fixtureState.reset()
    const ctx = await harness({
      iris: {
        logLevel: 'silent',
        providers: [
          {
            id: 'fixture.echo',
            module: providerModule,
            capabilities: [{ id: fixture.toolName, kind: 'tool', ptcCompatible: true }],
          },
          {
            id: 'fixture.upper',
            module: upperProviderModule,
            capabilities: [{ id: upperFixture.toolName, kind: 'tool', ptcCompatible: true }],
          },
        ],
      },
    })
    const owner = await publishAgent(ctx, 'standard', 'provider-selectivity')
    await runtimeFor(ctx, owner.agent)

    await executeMissing(ctx, owner.agent)

    expect(fixture.fixtureState.applies).toBe(1)
    expect(upperFixture.fixtureState.applies).toBe(0)
    expect(ctx.tools.get(upperFixture.toolName, owner.agent)).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('keeps activation and visibility Agent-scoped', async () => {
    fixture.fixtureState.reset()
    const ctx = await harness(localConfig())
    const ownerA = await publishAgent(ctx, 'standard', 'iris-agent-a')
    const ownerB = await publishAgent(ctx, 'standard', 'iris-agent-b')
    const runtimeA = await runtimeFor(ctx, ownerA.agent)
    const runtimeB = await runtimeFor(ctx, ownerB.agent)

    await activateCapability(ctx, ownerA.agent, undefined, 'agent-a-explicit-activate')

    expect(runtimeA.surface.snapshot().visible).toContain(`tool:${fixture.toolName}`)
    expect(runtimeB.surface.snapshot().visible).not.toContain(`tool:${fixture.toolName}`)
    expect(ctx.tools.get(fixture.toolName, ownerA.agent)).toBeDefined()
    expect(ctx.tools.get(fixture.toolName, ownerB.agent)).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('runs real Creation discovery and returns ranked candidate metadata', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      items: [{
        full_name: 'deepseek-community/dsh-calendar',
        html_url: 'https://github.com/deepseek-community/dsh-calendar',
        description: 'DeepSeek Harness community_calendar Tool',
        topics: ['dsh-plugin'],
        updated_at: '2026-08-01T00:00:00Z',
        pushed_at: '2026-08-01T00:00:00Z',
        stargazers_count: 12,
        archived: false,
      }],
    }), { status: 200 }))
    vi.stubGlobal('fetch', request)
    const ctx = await harness({
      iris: { logLevel: 'silent', providers: [] },
    })
    const owner = await publishAgent(ctx, 'cordis', 'creation-discovery')

    const result = await executeMissing(ctx, owner.agent, 'community_calendar')

    expect(request).toHaveBeenCalledTimes(1)
    expect(result.additionalContexts?.[0]?.content).toContainEqual({
      type: 'text',
      text: expect.stringContaining('deepseek-community/dsh-calendar'),
    })
    expect(ctx.tools.get('community_calendar', owner.agent)).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('offers discovery metadata to Standard without installing it', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      items: [{
        full_name: 'deepseek-community/dsh-weather',
        html_url: 'https://github.com/deepseek-community/dsh-weather',
        description: 'DeepSeek Harness community_weather Tool',
        topics: ['dsh-plugin'],
        updated_at: '2026-08-01T00:00:00Z',
        pushed_at: '2026-08-01T00:00:00Z',
        stargazers_count: 8,
        archived: false,
      }],
    }), { status: 200 }))
    vi.stubGlobal('fetch', request)
    const ctx = await harness({ iris: { logLevel: 'silent', providers: [] } })
    const owner = await publishAgent(ctx, 'standard', 'standard-discovery')

    const result = await executeMissing(ctx, owner.agent, 'community_weather')

    expect(result.additionalContexts?.[0]?.content).toContainEqual({
      type: 'text',
      text: expect.stringContaining('not installed'),
    })
    expect(ctx.tools.get('community_weather', owner.agent)).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('records creator-fallback when Creation discovery is exhausted', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      items: [],
    }), { status: 200 })))
    const ctx = await harness({ iris: { logLevel: 'silent', providers: [] } })
    const owner = await publishAgent(ctx, 'cordis', 'creation-fallback')

    const result = await executeMissing(ctx, owner.agent, 'missing_everywhere')

    expect(result.additionalContexts).toBeUndefined()
    expect(ctx.iris.runtimeFor(owner.agent)?.lastOutcome).toMatchObject({
      status: 'creator-fallback',
      evaluation: { policyId: 'evolve' },
    })
    await ctx.fiber.dispose()
  })

  it('disposes the Agent runtime and mounted provider with Agent teardown', async () => {
    fixture.fixtureState.reset()
    const ctx = await harness(localConfig())
    const owner = await publishAgent(ctx, 'standard', 'product-teardown')
    await executeMissing(ctx, owner.agent)

    await owner.scope.dispose()

    expect(ctx.iris.runtimeFor(owner.agent)).toBeUndefined()
    expect(ctx.tools.get(fixture.toolName, owner.agent)).toBeUndefined()
    expect(fixture.fixtureState.disposes).toBe(1)
    await ctx.fiber.dispose()
  })
})
