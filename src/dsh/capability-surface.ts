import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt'

import {
  CapabilitySurfaceState,
  type CapabilitySurfaceSnapshot,
  type CapabilitySearchResult,
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

    if (this.policy.id !== 'preserve') {
      const allow = this.options.inheritedAllow
        ?? this.agentCtx.tools.schemas().map(tool => tool.name)
      this.disposers.push(this.agentCtx.tools.restrict({ allow: [...allow] }))
    }

    for (const tool of this.agentCtx.tools.schemas(this.agent)) {
      const descriptor = runtimeToolDescriptor(tool)
      this.descriptors.set(descriptor.id, descriptor)
      this.state.activate(descriptor.id)
      this.state.reveal(descriptor.id)
      if (this.policy.isPinned(descriptor)) this.state.pin(descriptor.id)
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
      if (this.policy.visibilityCommit === 'next-assembly') this.commitCodeAssembly(assembled)
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
    if (this.policy.visibilityCommit === 'next-assembly') this.state.stage(capability.id)
    else this.state.reveal(capability.id)
    return true
  }

  snapshot(): CapabilitySurfaceSnapshot {
    return this.state.snapshot()
  }

  dispose(): void {
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
}
