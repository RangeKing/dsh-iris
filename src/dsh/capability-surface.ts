import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import { PERSONA_ORDER, PERSONA_SECTION } from '@deepseek-ai/dsh-system-prompt'

import {
  CapabilitySurfaceState,
  capabilityPackForPromptSection,
  capabilityPackForTool,
  type CapabilitySurfaceSnapshot,
  type CapabilitySearchResult,
  type CapabilityPackId,
  type IrisModePolicy,
} from '../capabilities/index.js'
import type { CapabilityDescriptor } from '../domain/index.js'
import type { LocalProviderCatalog } from '../providers/index.js'
import { mcpToolCapability } from './mcp-capabilities.js'
import {
  installIrisActivate,
  IRIS_ACTIVATE_TOOL_NAME,
  type IrisActivationControlResult,
} from './iris-activate.js'
import {
  installIrisRecommend,
  IRIS_RECOMMEND_TOOL_NAME,
  type IrisRecommendationControlResult,
} from './iris-recommend.js'
import { installIrisSearch, IRIS_SEARCH_TOOL_NAME } from './iris-search.js'

/** The exact DSH Minimal persona used to anchor Minimal-style reasoning language. */
export const IRIS_MINIMAL_REASONING_PERSONA = 'You are a helpful software engineer assistant.'

/** Agent-scoped section that makes the Minimal reasoning-language preference explicit. */
export const IRIS_REASONING_VOICE_SECTION = 'iris:reasoning-voice'

/** Static wording constraint; it changes reasoning language, not capability or execution policy. */
export const IRIS_MINIMAL_REASONING_VOICE =
  'Begin each reasoning block with "We need ..." or "Need to ...". '
  + 'Do not begin reasoning with "Let me ...", "I will ...", or "I need ...". '
  + 'Keep reasoning concise and task-directed.'

/** Explicit prompt owners Iris currently knows how to yield to. */
export const EXTERNAL_REASONING_OWNER_SECTIONS = ['router-persona'] as const

export interface DshCapabilitySurfaceOptions {
  readonly inheritedAllow?: readonly string[]
  readonly search?: (
    query: string,
    kind?: 'tool' | 'skill' | 'mcp',
    signal?: AbortSignal,
  ) => Promise<readonly CapabilitySearchResult[]> | readonly CapabilitySearchResult[]
  readonly activate?: (
    capabilityId: string,
    signal: AbortSignal,
  ) => Promise<IrisActivationControlResult>
  readonly recommend?: (
    query: string,
    signal?: AbortSignal,
  ) => Promise<IrisRecommendationControlResult> | IrisRecommendationControlResult
}

export interface IrisSurfaceTransition {
  readonly sequence: number
  readonly pack: CapabilityPackId
  readonly reason: 'explicit-activation' | 'unknown-tool' | 'provider-activation'
}

export interface IrisSurfaceMetrics {
  readonly nativeToolCount: number
  readonly visibleToolCount: number
  readonly visibleSchemaChars: number
  readonly promptChars?: number
  readonly codeSdkChars?: number
  readonly reasoningOwner: 'iris' | 'native' | `external:${string}`
}

function toolDescriptor(name: string): CapabilityDescriptor {
  return {
    id: `tool:${name}`,
    kind: 'tool',
    name,
    source: 'installed',
    trust: 'known',
    provenance: { kind: 'dsh-runtime' },
  }
}

interface ToolSchemaObservation {
  readonly name: string
  readonly description: string
  readonly parameters: unknown
}

function runtimeToolDescriptor(tool: ToolSchemaObservation): CapabilityDescriptor {
  return mcpToolCapability(tool) ?? toolDescriptor(tool.name)
}

function irisControlDescriptor(name: string): CapabilityDescriptor {
  return {
    ...toolDescriptor(name),
    provenance: { kind: 'iris-control' },
  }
}

function sdkContains(assembly: PromptAssembly, name: string): boolean {
  return assembly.sections.find(section => section.name === 'tools:sdk')?.text
    .includes(`${name}:`) === true
}

/** Applies one Agent's aperture to DSH's authoritative ToolRuntime. */
export class DshCapabilitySurface {
  readonly state: CapabilitySurfaceState

  private readonly agent: Agent
  private readonly disposers: Array<() => void> = []
  private readonly descriptors = new Map<string, CapabilityDescriptor>()
  private readonly ceilingByName = new Map<string, CapabilityDescriptor>()
  private readonly activeAllow = new Set<string>()
  private readonly transitionsValue: IrisSurfaceTransition[] = []
  private restrictionDisposer: (() => void) | undefined
  private reasoningScaffoldDisposer: (() => void) | undefined
  private sequence = 0
  private promptChars: number | undefined
  private codeSdkChars: number | undefined
  private reasoningOwner: IrisSurfaceMetrics['reasoningOwner'] = 'native'
  private started = false

  constructor(
    private readonly agentCtx: Context,
    readonly policy: IrisModePolicy,
    private readonly catalog: LocalProviderCatalog,
    private readonly options: DshCapabilitySurfaceOptions = {},
  ) {
    const agent = (agentCtx as Context & { readonly agent?: Agent }).agent
    if (agent === undefined) throw new Error('dsh-iris: CapabilitySurface requires agentCtx.agent')
    this.agent = agent
    const catalogued = catalog.list().map(candidate => candidate.capability)
    this.state = new CapabilitySurfaceState(catalogued)
    for (const capability of catalogued) this.descriptors.set(capability.id, capability)
  }

  start(): void {
    if (this.started) return
    this.started = true

    const ceiling = this.agentCtx.tools.schemas(this.agent)
    for (const tool of ceiling) {
      const descriptor = runtimeToolDescriptor(tool)
      this.descriptors.set(descriptor.id, descriptor)
      this.ceilingByName.set(descriptor.name, descriptor)
      this.state.catalogue(descriptor.id)
      this.state.activate(descriptor.id)
    }

    if (this.policy.id === 'preserve') {
      for (const descriptor of this.ceilingByName.values()) this.state.reveal(descriptor.id)
      this.state.revealPack('native-minimal')
    } else {
      const allow = this.options.inheritedAllow
        ?? ceiling.map(tool => tool.name).filter(name => capabilityPackForTool(name) === 'core')
      for (const name of allow) this.activeAllow.add(name)
      this.replaceRestriction()
      this.state.revealPack('core')
      for (const name of allow) {
        const descriptor = this.ceilingByName.get(name)
        if (descriptor !== undefined) this.state.reveal(descriptor.id)
      }
      if (this.policy.reasoningScaffold === 'minimal') {
        this.reasoningScaffoldDisposer = this.agentCtx.systemPrompt.section({
          name: PERSONA_SECTION,
          order: PERSONA_ORDER,
          text: IRIS_MINIMAL_REASONING_PERSONA,
        })
        this.disposers.push(this.agentCtx.systemPrompt.section({
          name: IRIS_REASONING_VOICE_SECTION,
          order: PERSONA_ORDER + 1,
          text: IRIS_MINIMAL_REASONING_VOICE,
        }))
      }
    }

    if (this.policy.search) {
      this.disposers.push(installIrisSearch(this.agentCtx, this.catalog, this.options.search))
      this.pinControlTool(IRIS_SEARCH_TOOL_NAME)
      if (this.options.activate !== undefined) {
        this.disposers.push(installIrisActivate(this.agentCtx, { activate: this.options.activate }))
        this.pinControlTool(IRIS_ACTIVATE_TOOL_NAME)
      }
      if (this.options.recommend !== undefined) {
        this.disposers.push(installIrisRecommend(this.agentCtx, { recommend: this.options.recommend }))
        this.pinControlTool(IRIS_RECOMMEND_TOOL_NAME)
      }
    }

    this.disposers.push(this.agentCtx.on('system-prompt/assemble', async (
      _assembly,
      _context,
      next,
    ) => {
      const assembled = await next()
      const externalOwner = EXTERNAL_REASONING_OWNER_SECTIONS.find(name => (
        assembled.sections.some(section => section.name === name)
      ))
      if (externalOwner !== undefined) {
        assembled.sections = assembled.sections.filter(section => (
          section.name !== PERSONA_SECTION && section.name !== IRIS_REASONING_VOICE_SECTION
        ))
        this.reasoningOwner = `external:${externalOwner}`
      } else if (this.reasoningScaffoldDisposer !== undefined) {
        this.reasoningOwner = 'iris'
      } else {
        this.reasoningOwner = 'native'
      }
      if (this.policy.id !== 'preserve') {
        assembled.sections = assembled.sections.filter((section) => {
          if (section.name === 'tools:sdk' || section.name === 'tools:code-only') return true
          const pack = capabilityPackForPromptSection(section.name)
          return pack === undefined || this.state.snapshot().revealedPacks.includes(pack)
        })
      }
      if (this.policy.visibilityCommit === 'next-assembly') this.commitCodeAssembly(assembled)
      this.promptChars = assembled.sections.reduce((total, section) => total + section.text.length, 0)
      this.codeSdkChars = assembled.sections.find(section => section.name === 'tools:sdk')?.text.length
      return assembled
    }))
  }

  markActivated(capability: CapabilityDescriptor): void {
    this.descriptors.set(capability.id, capability)
    this.state.activate(capability.id)
  }

  reveal(capability: CapabilityDescriptor): boolean {
    if (!this.policy.canReveal(capability)) return false
    if (this.agentCtx.tools.get(capability.name, this.agent) === undefined) return false
    const pack = capabilityPackForTool(capability.name)
    this.state.revealPack(pack)
    if (this.policy.visibilityCommit === 'next-assembly') this.state.stage(capability.id)
    else this.state.reveal(capability.id)
    this.recordTransition(pack, 'provider-activation')
    return true
  }

  nativeCandidate(capabilityId: string): CapabilityDescriptor | undefined {
    const descriptor = this.descriptors.get(capabilityId)
    if (descriptor?.provenance?.kind !== 'dsh-runtime') return undefined
    return {
      ...descriptor,
      source: 'builtin',
      trust: 'builtin',
      ptcCompatible: true,
    }
  }

  nativeCapabilities(): readonly CapabilityDescriptor[] {
    return [...this.ceilingByName.values()]
  }

  capabilities(): readonly CapabilityDescriptor[] {
    return [...this.descriptors.values()]
  }

  revealNative(
    capabilityId: string,
    reason: 'explicit-activation' | 'unknown-tool',
  ): boolean {
    if (this.policy.id === 'preserve') return false
    const requested = this.nativeCandidate(capabilityId)
    if (requested === undefined) return false
    const pack = capabilityPackForTool(requested.name)
    if (pack === 'creator' && this.policy.id !== 'adaptive-creator') return false
    const packCapabilities = [...this.ceilingByName.values()]
      .filter(capability => capabilityPackForTool(capability.name) === pack)
    for (const capability of packCapabilities) this.activeAllow.add(capability.name)
    this.replaceRestriction()
    this.state.revealPack(pack)
    for (const capability of packCapabilities) {
      if (this.policy.visibilityCommit === 'next-assembly') this.state.stage(capability.id)
      else this.state.reveal(capability.id)
    }
    if (pack === 'creator') {
      this.reasoningScaffoldDisposer?.()
      this.reasoningScaffoldDisposer = undefined
    }
    this.recordTransition(pack, reason)
    return this.agentCtx.tools.get(requested.name, this.agent) !== undefined
  }

  transitions(): readonly IrisSurfaceTransition[] {
    return [...this.transitionsValue]
  }

  metrics(): IrisSurfaceMetrics {
    const schemas = this.agentCtx.tools.schemas(this.agent)
    return {
      nativeToolCount: this.ceilingByName.size,
      visibleToolCount: schemas.length,
      visibleSchemaChars: JSON.stringify(schemas).length,
      reasoningOwner: this.reasoningOwner,
      ...this.promptChars === undefined ? {} : { promptChars: this.promptChars },
      ...this.codeSdkChars === undefined ? {} : { codeSdkChars: this.codeSdkChars },
    }
  }

  snapshot(): CapabilitySurfaceSnapshot {
    return this.state.snapshot()
  }

  dispose(): void {
    this.reasoningScaffoldDisposer?.()
    this.reasoningScaffoldDisposer = undefined
    this.restrictionDisposer?.()
    this.restrictionDisposer = undefined
    while (this.disposers.length > 0) this.disposers.pop()?.()
    this.started = false
  }

  private commitCodeAssembly(assembly: PromptAssembly): void {
    for (const id of this.state.snapshot().staged) {
      const capability = this.descriptors.get(id)
      if (capability !== undefined && sdkContains(assembly, capability.name)) {
        this.state.commit(id)
      }
    }
  }

  private pinControlTool(name: string): void {
    const descriptor = irisControlDescriptor(name)
    this.descriptors.set(descriptor.id, descriptor)
    this.state.activate(descriptor.id)
    this.state.pin(descriptor.id)
  }

  private replaceRestriction(): void {
    this.restrictionDisposer?.()
    this.restrictionDisposer = this.agentCtx.tools.restrict({ allow: [...this.activeAllow] })
  }

  private recordTransition(
    pack: CapabilityPackId,
    reason: IrisSurfaceTransition['reason'],
  ): void {
    if (this.transitionsValue.some(transition => transition.pack === pack)) return
    this.transitionsValue.push({ sequence: ++this.sequence, pack, reason })
    if (this.transitionsValue.length > 20) this.transitionsValue.shift()
  }
}
