import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Context, type Fiber } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import * as McpClient from '@deepseek-ai/dsh-mcp-client'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import type { SessionId } from '@deepseek-ai/dsh-session'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as ToolSkill from '@deepseek-ai/dsh-tool-skill'
import ToolRuntime, { RUN_CODE_NAME } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Config } from '../../src/config.js'
import * as irisPlugin from '../../src/index.js'
import * as fixtureProvider from '../fixtures/providers/iris-fixture-echo.mjs'

interface McpTestAgent extends Agent {
  readonly preset: string
}

interface CodeRequest {
  readonly bindings: readonly [{
    readonly functions: Record<string, ((args: Record<string, unknown>) => Promise<unknown>) | undefined>
  }]
}

interface CodeRuntime {
  readonly language: 'typescript'
  readonly isolation: 'test'
  behavior(request: CodeRequest): Promise<{ readonly logs: readonly string[]; readonly value?: unknown }>
  run(request: CodeRequest): Promise<{ readonly logs: readonly string[]; readonly value?: unknown }>
}

interface AgentOwner {
  readonly agent: McpTestAgent
  readonly scope: Scope
  readonly mcpFiber?: Fiber
}

const fixtureServer = fileURLToPath(new URL('../fixtures/mcp/iris-mcp-server.mjs', import.meta.url))
const providerModule = new URL('../fixtures/providers/iris-fixture-echo.mjs', import.meta.url).href
const contexts: Context[] = []
const tempDirectories: string[] = []

function config(): Config {
  return {
    iris: {
      logLevel: 'silent',
      discovery: { enabled: false },
      providers: [{
        id: 'fixture.issue-helper',
        module: providerModule,
        capabilities: [{
          id: fixtureProvider.toolName,
          name: 'local_issue_helper',
          kind: 'tool',
          description: 'Prepare a GitHub issue locally.',
          keywords: ['github issue'],
          ptcCompatible: true,
        }],
      }],
    },
  }
}

async function harness(): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SkillRegistry)
  ctx.provide('agentPresets', {
    composedPreset: (agentCtx: Context) => (
      agentCtx as unknown as { agent: McpTestAgent }
    ).agent.preset,
    resolve: (id: string) => Promise.resolve({
      id,
      trust: 'system',
      path: `/presets/${id}/agent.cordis.yml`,
    }),
  } as never)
  await ctx.plugin(irisPlugin, config())
  return ctx
}

async function traceFile(): Promise<{ readonly directory: string; readonly path: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-iris-mcp-'))
  tempDirectories.push(directory)
  return { directory, path: join(directory, 'trace.log') }
}

function mcpConfig(serverName: string, tracePath: string): McpClient.Config {
  return {
    transport: 'stdio',
    serverName,
    command: process.execPath,
    args: [fixtureServer],
    env: { IRIS_MCP_TRACE_PATH: tracePath },
    cwd: process.cwd(),
    toolCallTimeoutMs: 5_000,
    failOnStartupError: true,
    reconnect: { enabled: false },
  }
}

async function publishAgent(
  ctx: Context,
  options: {
    readonly id: string
    readonly preset?: string
    readonly mcp?: { readonly serverName: string; readonly tracePath: string }
    readonly runtimeSkill?: boolean
  },
): Promise<AgentOwner> {
  let scope!: Scope
  let agent!: McpTestAgent
  let mcpFiber: Fiber | undefined
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
          header: { cwd: process.cwd() },
          append(type: string, data: unknown) { this.events.push({ type, data }) },
        },
        runMaintenance: <T>(task: (signal: AbortSignal) => Promise<T>) => (
          task(new AbortController().signal)
        ),
      }
      scope = createScope(inner, draft)
      agent = Object.assign(draft, { ctx: scope.ctx }) as unknown as McpTestAgent
      Object.defineProperty(scope.ctx, 'agent', { value: agent })
      if (options.runtimeSkill === true) {
        scope.ctx.skills.register({
          name: 'github-workflow',
          description: 'Review and prepare a GitHub issue workflow.',
          whenToUse: 'Use when reviewing a repository issue.',
          content: 'Use the native DSH Skill runtime.',
          source: 'runtime',
        })
        await scope.ctx.plugin(ToolSkill)
      }
      if (options.mcp !== undefined) {
        mcpFiber = scope.ctx.plugin(McpClient, mcpConfig(options.mcp.serverName, options.mcp.tracePath))
        await mcpFiber
      }
      scope.ctx.effect(() => inner.agents.register(agent), 'unified-mcp-test.agent()')
    },
    { inject: ['agents', 'tools', 'skills', 'systemPrompt'] },
  ))
  await owner
  return { agent, scope, ...mcpFiber === undefined ? {} : { mcpFiber } }
}

async function runtimeFor(ctx: Context, agent: Agent) {
  const runtime = ctx.iris.runtimeFor(agent)
  expect(runtime).toBeDefined()
  await runtime!.ready
  return runtime!
}

function execute(
  ctx: Context,
  agent: Agent,
  name: string,
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

async function trace(path: string): Promise<readonly string[]> {
  return (await readFile(path, 'utf8')).trim().split('\n').filter(Boolean)
}

function enableCodeMode(ctx: Context, owner: AgentOwner): CodeRuntime {
  const runtime: CodeRuntime = {
    language: 'typescript',
    isolation: 'test',
    behavior: () => Promise.resolve({ logs: [] }),
    run(request) { return this.behavior(request) },
  }
  ctx.provide('codeRuntime', runtime as never)
  owner.scope.ctx.tools.presentAs('code')
  return runtime
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(tempDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('Unified connected MCP discovery and routing', () => {
  it('discovers, recommends, and directly routes a connected MCP Tool without discovery side effects', async () => {
    fixtureProvider.fixtureState.reset()
    const { path } = await traceFile()
    const ctx = await harness()
    const owner = await publishAgent(ctx, {
      id: 'mcp-unified',
      mcp: { serverName: 'github', tracePath: path },
      runtimeSkill: true,
    })
    const runtime = await runtimeFor(ctx, owner.agent)
    const skillGet = vi.spyOn(ctx.skills, 'get')
    const before = await trace(path)

    const search = await execute(ctx, owner.agent, 'iris_search', { query: 'github issue' }, 'mcp-search')
    const recommendation = await execute(ctx, owner.agent, 'iris_recommend', { query: 'create a github issue' }, 'mcp-recommend')

    expect(search.isError).toBe(false)
    expect((search.value as { results: unknown[] }).results).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: `tool:${fixtureProvider.toolName}`,
        kind: 'tool',
        route: { kind: 'iris-activate', capabilityId: `tool:${fixtureProvider.toolName}` },
      }),
      expect.objectContaining({
        id: 'skill:github-workflow',
        kind: 'skill',
        route: { kind: 'dsh-skill', skillName: 'github-workflow', toolName: 'skill' },
      }),
      expect.objectContaining({
        id: 'mcp:github/create_issue',
        kind: 'mcp',
        status: 'available',
        route: {
          kind: 'dsh-mcp-tool',
          serverName: 'github',
          toolName: 'create_issue',
          dshToolName: 'mcp__github__create_issue',
        },
      }),
    ]))
    expect((recommendation.value as { results: Array<{ id: string }> }).results.map(result => result.id))
      .toContain('mcp:github/create_issue')
    expect(await trace(path)).toEqual(before)
    expect(fixtureProvider.fixtureState.applies).toBe(0)
    expect(skillGet).not.toHaveBeenCalled()

    const activated = await execute(
      ctx,
      owner.agent,
      'iris_activate',
      { capabilityId: 'mcp:github/create_issue' },
      'mcp-already-available',
    )
    expect(activated).toMatchObject({
      isError: false,
      value: {
        status: 'already-available',
        capabilityId: 'mcp:github/create_issue',
        route: {
          kind: 'dsh-mcp-tool',
          dshToolName: 'mcp__github__create_issue',
        },
      },
    })
    expect(await trace(path)).toEqual(before)
    expect(runtime.lastOutcome).toMatchObject({ status: 'already-available' })
  })

  it('executes the routed MCP Tool through DSH guards and the normal ToolRuntime', async () => {
    const { path } = await traceFile()
    const ctx = await harness()
    const owner = await publishAgent(ctx, {
      id: 'mcp-native-execution',
      mcp: { serverName: 'github_exec', tracePath: path },
    })
    await runtimeFor(ctx, owner.agent)
    const guarded: string[] = []
    owner.scope.ctx.tools.guard((exec) => {
      guarded.push(exec.name)
      return undefined
    })

    const result = await execute(ctx, owner.agent, 'mcp__github_exec__create_issue', {
      repository: 'deepseek-ai/deepseek-harness',
      title: 'MCP routing',
      body: 'Owned by DSH.',
    }, 'mcp-native-call')

    expect(result).toMatchObject({ isError: false })
    expect(guarded).toContain('mcp__github_exec__create_issue')
    expect(await trace(path)).toContain('tools/call:create_issue')
  })

  it('preserves Agent ownership for delayed MCP registration and removes Tools on teardown', async () => {
    const { path } = await traceFile()
    const ctx = await harness()
    const ownerA = await publishAgent(ctx, {
      id: 'mcp-scope-a',
      mcp: { serverName: 'scoped', tracePath: path },
    })
    const ownerB = await publishAgent(ctx, { id: 'mcp-scope-b' })
    const runtimeA = await runtimeFor(ctx, ownerA.agent)
    const runtimeB = await runtimeFor(ctx, ownerB.agent)

    expect(ctx.tools.get('mcp__scoped__create_issue', ownerA.agent)).toBeDefined()
    expect(ctx.tools.get('mcp__scoped__create_issue', ownerB.agent)).toBeUndefined()
    expect((await runtimeA.search('create issue')).map(result => result.capability.id))
      .toContain('mcp:scoped/create_issue')
    expect((await runtimeB.search('create issue')).map(result => result.capability.id))
      .not.toContain('mcp:scoped/create_issue')

    await ownerA.mcpFiber!.dispose()
    expect(ctx.tools.get('mcp__scoped__create_issue', ownerA.agent)).toBeUndefined()
    expect(ctx.tools.get('mcp__scoped__create_issue', ownerB.agent)).toBeUndefined()
    expect(await runtimeA.activate('mcp:scoped/create_issue', new AbortController().signal))
      .toEqual({
        status: 'not-found',
        capabilityId: 'mcp:scoped/create_issue',
        reason: 'not-catalogued',
      })
  })

  it('confirms DSH reserves one MCP server namespace across Agent scopes', async () => {
    const firstTrace = await traceFile()
    const secondTrace = await traceFile()
    const ctx = await harness()
    const ownerA = await publishAgent(ctx, {
      id: 'mcp-namespace-a',
      mcp: { serverName: 'shared_server', tracePath: firstTrace.path },
    })

    await expect(publishAgent(ctx, {
      id: 'mcp-namespace-b',
      mcp: { serverName: 'shared_server', tracePath: secondTrace.path },
    })).rejects.toThrow(/serverName "shared_server" is already in use/)

    expect(ctx.tools.get('mcp__shared_server__create_issue', ownerA.agent)).toBeDefined()
    await expect(readFile(secondTrace.path, 'utf8')).rejects.toThrow()
  })

  it('lets DSH generate and execute the connected MCP binding in Code Mode', async () => {
    const { path } = await traceFile()
    const ctx = await harness()
    const owner = await publishAgent(ctx, {
      id: 'mcp-code',
      preset: 'code',
      mcp: { serverName: 'code_mcp', tracePath: path },
    })
    const codeRuntime = enableCodeMode(ctx, owner)
    await runtimeFor(ctx, owner.agent)

    const assembly = await ctx.systemPrompt.assemble({ scope: owner.agent })
    expect(assembly.sections.find(section => section.name === 'tools:sdk')?.text)
      .toContain('mcp__code_mcp__create_issue:')

    codeRuntime.behavior = async (request) => {
      const call = request.bindings[0].functions.mcp__code_mcp__create_issue
      if (call === undefined) throw new Error('MCP binding missing')
      return {
        logs: [],
        value: await call({ repository: 'dsh/iris', title: 'Code MCP' }),
      }
    }
    const result = await execute(ctx, owner.agent, RUN_CODE_NAME, {
      code: 'await mcp__code_mcp__create_issue({ repository: "dsh/iris", title: "Code MCP" })',
      description: 'Call the native MCP binding',
    }, 'mcp-code-call')

    expect(result).toMatchObject({ isError: false })
    expect(await trace(path)).toContain('tools/call:create_issue')
  })
})
