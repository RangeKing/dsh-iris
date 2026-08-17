import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import { createScope } from '@deepseek-ai/dsh-scope'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'

import { irisModePolicyFor } from '../../src/capabilities/index.js'
import {
  DshCapabilitySurface,
  IRIS_MINIMAL_REASONING_PERSONA,
  IRIS_MINIMAL_REASONING_VOICE,
  IRIS_REASONING_VOICE_SECTION,
  EXTERNAL_REASONING_OWNER_SECTIONS,
} from '../../src/dsh/capability-surface.js'
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
  it('yields its reasoning scaffold to an explicit router prompt owner', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRuntime)
    ctx.tools.register(tool('bash'))
    const draft = { id: 'iris-owner-guard' }
    const scope = createScope(ctx, draft)
    const agent = Object.assign(draft, { ctx: scope.ctx })
    Object.defineProperty(scope.ctx, 'agent', { value: agent })
    let surface!: DshCapabilitySurface
    await scope.ctx.plugin(Object.assign((inner: Context) => {
      inner.systemPrompt.section({ name: EXTERNAL_REASONING_OWNER_SECTIONS[0], order: 1, text: 'External router owns the reasoning contract.' })
      surface = new DshCapabilitySurface(inner, irisModePolicyFor('adaptive'), new ConfiguredLocalProviderCatalog([]))
      surface.start()
    }, { inject: ['tools', 'systemPrompt'] }))

    const assembled = await ctx.systemPrompt.assemble({ scope: agent })
    expect(assembled.sections.map(section => section.name)).toContain('router-persona')
    expect(assembled.sections.map(section => section.name)).not.toContain('deployment:persona')
    expect(assembled.sections.map(section => section.name)).not.toContain(IRIS_REASONING_VOICE_SECTION)
    expect(surface.metrics().reasoningOwner).toBe('external:router-persona')
    await scope.dispose()
    await ctx.fiber.dispose()
  })

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

  it('starts Standard on core and reveals native packs monotonically', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRuntime)
    for (const name of ['bash', 'read', 'write', 'web_search']) {
      ctx.tools.register(tool(name))
      ctx.systemPrompt.section({ name: `tool:${name}`, order: 100, text: `${name} guidance` })
    }
    const draft = { id: 'iris-standard-aperture' }
    const scope = createScope(ctx, draft)
    const agent = Object.assign(draft, { ctx: scope.ctx })
    Object.defineProperty(scope.ctx, 'agent', { value: agent })
    let surface!: DshCapabilitySurface
    await scope.ctx.plugin(Object.assign((inner: Context) => {
      surface = new DshCapabilitySurface(
        inner,
        irisModePolicyFor('adaptive'),
        new ConfiguredLocalProviderCatalog([]),
      )
      inner.effect(() => {
        surface.start()
        return () => { surface.dispose() }
      })
    }, { inject: ['tools', 'systemPrompt'] }))

    expect(ctx.tools.schemas(agent).map(item => item.name).sort()).toEqual([
      'bash',
      'iris_search',
      'read',
    ])
    const initial = await ctx.systemPrompt.assemble({ scope: agent })
    expect(initial.sections.find(section => section.name === 'deployment:persona')?.text)
      .toBe(IRIS_MINIMAL_REASONING_PERSONA)
    expect(initial.sections.find(section => section.name === IRIS_REASONING_VOICE_SECTION)?.text)
      .toBe(IRIS_MINIMAL_REASONING_VOICE)
    expect(initial.sections.map(section => section.name)).toContain('tool:bash')
    expect(initial.sections.map(section => section.name)).not.toContain('tool:web_search')

    expect(surface.revealNative('tool:web_search', 'explicit-activation')).toBe(true)
    expect(ctx.tools.schemas(agent).map(item => item.name)).toContain('web_search')
    const expanded = await ctx.systemPrompt.assemble({ scope: agent })
    expect(expanded.sections.map(section => section.name)).toContain('tool:web_search')
    expect(surface.snapshot().revealedPacks).toEqual(['core', 'search'])
    await scope.dispose()
    await ctx.fiber.dispose()
  })

  it('keeps Code SDK stable until the next assembly commits a staged pack', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRuntime, { mode: 'code' })
    ctx.provide('codeRuntime', {
      language: 'typescript',
      isolation: 'test',
      run: () => Promise.resolve({ logs: [] }),
    } as never)
    ctx.tools.register(tool('bash'))
    ctx.tools.register(tool('web_search'))
    const draft = { id: 'iris-code-aperture' }
    const scope = createScope(ctx, draft)
    const agent = Object.assign(draft, { ctx: scope.ctx })
    Object.defineProperty(scope.ctx, 'agent', { value: agent })
    let surface!: DshCapabilitySurface
    await scope.ctx.plugin(Object.assign((inner: Context) => {
      surface = new DshCapabilitySurface(
        inner,
        irisModePolicyFor('adaptive-code'),
        new ConfiguredLocalProviderCatalog([]),
      )
      inner.effect(() => {
        surface.start()
        return () => { surface.dispose() }
      })
    }, { inject: ['tools', 'systemPrompt'] }))

    const stepN = await ctx.systemPrompt.assemble({ scope: agent })
    expect(stepN.sections.find(section => section.name === 'deployment:persona')?.text)
      .toBe(IRIS_MINIMAL_REASONING_PERSONA)
    expect(stepN.sections.find(section => section.name === IRIS_REASONING_VOICE_SECTION)?.text)
      .toBe(IRIS_MINIMAL_REASONING_VOICE)
    expect(stepN.sections.find(section => section.name === 'tools:sdk')?.text).toContain('bash:')
    expect(stepN.sections.find(section => section.name === 'tools:sdk')?.text).not.toContain('web_search:')
    expect(surface.revealNative('tool:web_search', 'explicit-activation')).toBe(true)
    expect(surface.snapshot().staged).toContain('tool:web_search')

    const stepNPlusOne = await ctx.systemPrompt.assemble({ scope: agent })
    expect(stepNPlusOne.sections.find(section => section.name === 'tools:sdk')?.text).toContain('web_search:')
    expect(surface.snapshot().staged).not.toContain('tool:web_search')
    expect(surface.snapshot().revealedPacks).toEqual(['core', 'search'])
    await scope.dispose()
    await ctx.fiber.dispose()
  })

  it('preserves Minimal without Iris controls or restrictions', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, { persona: 'Native Minimal persona.' })
    await ctx.plugin(ToolRuntime)
    ctx.tools.register(tool('bash'))
    ctx.tools.register(tool('str_replace_editor'))
    const draft = { id: 'iris-minimal-preserve' }
    const scope = createScope(ctx, draft)
    const agent = Object.assign(draft, { ctx: scope.ctx })
    Object.defineProperty(scope.ctx, 'agent', { value: agent })
    const before = ctx.tools.schemas(agent)
    let surface!: DshCapabilitySurface
    await scope.ctx.plugin(Object.assign((inner: Context) => {
      surface = new DshCapabilitySurface(
        inner,
        irisModePolicyFor('preserve'),
        new ConfiguredLocalProviderCatalog([]),
      )
      inner.effect(() => {
        surface.start()
        return () => { surface.dispose() }
      })
    }, { inject: ['tools', 'systemPrompt'] }))

    expect(ctx.tools.schemas(agent)).toEqual(before)
    expect(ctx.tools.get('iris_search', agent)).toBeUndefined()
    expect((await ctx.systemPrompt.assemble({ scope: agent })).sections
      .find(section => section.name === 'deployment:persona')?.text)
      .toBe('Native Minimal persona.')
    expect((await ctx.systemPrompt.assemble({ scope: agent })).sections
      .find(section => section.name === IRIS_REASONING_VOICE_SECTION))
      .toBeUndefined()
    expect(surface.snapshot().revealedPacks).toEqual(['native-minimal'])
    await scope.dispose()
    await ctx.fiber.dispose()
  })

  it('uses the Minimal reasoning scaffold for Creator core and restores its native persona with the creator pack', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, { persona: 'Native Cordis trust-critical persona.' })
    await ctx.plugin(ToolRuntime)
    ctx.tools.register(tool('bash'))
    ctx.tools.register(tool('cordis_define'))
    const draft = { id: 'iris-creator-reasoning' }
    const scope = createScope(ctx, draft)
    const agent = Object.assign(draft, { ctx: scope.ctx })
    Object.defineProperty(scope.ctx, 'agent', { value: agent })
    let surface!: DshCapabilitySurface
    await scope.ctx.plugin(Object.assign((inner: Context) => {
      surface = new DshCapabilitySurface(
        inner,
        irisModePolicyFor('adaptive-creator'),
        new ConfiguredLocalProviderCatalog([]),
      )
      inner.effect(() => {
        surface.start()
        return () => { surface.dispose() }
      })
    }, { inject: ['tools', 'systemPrompt'] }))

    const initial = await ctx.systemPrompt.assemble({ scope: agent })
    expect(initial.sections.find(section => section.name === 'deployment:persona')?.text)
      .toBe(IRIS_MINIMAL_REASONING_PERSONA)
    expect(initial.sections.find(section => section.name === IRIS_REASONING_VOICE_SECTION)?.text)
      .toBe(IRIS_MINIMAL_REASONING_VOICE)

    expect(surface.revealNative('tool:cordis_define', 'explicit-activation')).toBe(true)
    const creator = await ctx.systemPrompt.assemble({ scope: agent })
    expect(creator.sections.find(section => section.name === 'deployment:persona')?.text)
      .toBe('Native Cordis trust-critical persona.')
    expect(creator.sections.find(section => section.name === IRIS_REASONING_VOICE_SECTION)?.text)
      .toBe(IRIS_MINIMAL_REASONING_VOICE)
    await scope.dispose()
    await ctx.fiber.dispose()
  })
})
