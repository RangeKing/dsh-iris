import type { Context, Fiber } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type {
  PostToolDecision,
  ToolExecution,
  ToolExecutionResult,
} from '@deepseek-ai/dsh-tools'

import {
  demandFromExplicitActivation,
  demandFromUnknownTool,
  CAPABILITY_PACK_ORDER,
  capabilityPackForTool,
  buildCatalogSnapshot,
  capabilityCatalogFingerprint,
  creationBriefFor,
  searchCapabilitySnapshot,
  selectIrisModePolicy,
  routeCapability,
  type CapabilityRoute,
  type CapabilityDemand,
  type CapabilitySearchResult,
  type IrisModePolicy,
  type CatalogSnapshot,
} from '../capabilities/index.js'
import type { ConfiguredPolicy, IrisLogLevel } from '../config.js'
import type { PluginFinder, RankedPluginCandidate } from '../discovery/index.js'
import {
  activateLocalTool,
  DshCapabilitySurface,
  DshMcpCapabilitySource,
  DshSkillCapabilitySource,
  evaluateIrisFailure,
  evaluateIrisRequirement,
  readAgentPresetIdentity,
  type AgentPresetIdentity,
  type IrisActivationControlResult,
  type IrisDryRunEvaluation,
  type IrisEvaluation,
  IRIS_RECOMMENDATION_LIMIT,
  type IrisRecommendationControlResult,
} from '../dsh/index.js'
import { MountCoordinator } from '../mounting/coordinator.js'
import { DirectFiberMountAdapter } from '../mounting/direct-fiber.js'
import type { CapabilityDescriptor, CapabilityRequirement, CreationBrief } from '../domain/index.js'
import type { LocalProviderCatalog } from '../providers/index.js'
import type { RetryHandoff } from '../retry-handoff/index.js'
import {
  observeUnknownTool,
  type CapabilityFailureSignal,
} from '../sensing/index.js'
import type { IrisSessionSnapshot } from './snapshot.js'

export type IrisRuntimeOutcome =
  | { readonly status: 'not-applicable' }
  | {
    readonly status: 'searched'
    readonly demand: Extract<CapabilityDemand, { kind: 'search' }>
    readonly results: readonly CapabilitySearchResult[]
  }
  | { readonly status: 'evaluated'; readonly evaluation: IrisEvaluation }
  | { readonly status: 'already-active'; readonly evaluation: IrisEvaluation }
  | {
    readonly status: 'delegated'
    readonly evaluation: IrisEvaluation
    readonly capabilityId: string
    readonly route: Extract<CapabilityRoute, { kind: 'dsh-skill' }>
  }
  | {
    readonly status: 'already-available'
    readonly evaluation: IrisEvaluation
    readonly capabilityId: string
    readonly route: Extract<CapabilityRoute, { kind: 'dsh-mcp-tool' }>
  }
  | { readonly status: 'not-found'; readonly evaluation: IrisEvaluation }
  | {
    readonly status: 'capability-ready'
    readonly evaluation: IrisEvaluation
    readonly capabilityId: string
    readonly requestedToolName: string
    readonly readiness: 'immediate' | 'next-step'
    readonly handoff?: Extract<RetryHandoff, { status: 'capability-ready' }>
  }
  | {
    readonly status: 'discovered'
    readonly evaluation: IrisEvaluation
    readonly candidates: readonly RankedPluginCandidate[]
  }
  | {
    readonly status: 'creation-brief'
    readonly evaluation: IrisEvaluation
    readonly brief: CreationBrief
  }
  | { readonly status: 'blocked'; readonly evaluation?: IrisEvaluation; readonly reason: string }

export interface IrisRuntimeOptions {
  readonly policy: ConfiguredPolicy
  readonly catalog: LocalProviderCatalog
  readonly finder?: PluginFinder
  readonly logLevel: IrisLogLevel
  readonly coordinator?: MountCoordinator
}

function discoveryText(
  policy: IrisModePolicy,
  candidates: readonly RankedPluginCandidate[],
): string {
  const heading = policy.creation === 'fallback'
    ? 'Iris found existing capability candidates:'
    : 'Capability is unavailable locally. Iris found these compatible plugins:'
  const rows = candidates.slice(0, 3).map((candidate, index) => (
    `${index + 1}. ${candidate.repository} (${candidate.url})`
  ))
  return [heading, ...rows, 'These candidates are not installed.'].join('\n')
}

function mergeContext(
  decision: Extract<PostToolDecision, { kind: 'accept' }>,
  text: string,
): PostToolDecision {
  return {
    ...decision,
    additionalContexts: [
      ...decision.additionalContexts ?? [],
      createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'plugin', plugin: 'dsh-iris' },
      }),
    ],
  }
}

function creationBriefText(brief: CreationBrief): string {
  return `Capability ${brief.capabilityId} does not currently exist in the active catalog. `
    + 'The native DSH Creator route is available for the next normal model step. '
    + 'Use cordis_define and, only after the normal DSH decision, cordis_run; Iris does not define, execute, install, or replay a Tool. '
    + `This CreationBrief is a suggested scaffold, not a Tool result or generated schema: ${JSON.stringify(brief)}`
}

/** One Agent's Demand-to-Reveal control layer. */
export class IrisRuntime {
  readonly agent: Agent
  readonly configuredPolicy: ConfiguredPolicy
  readonly catalog: LocalProviderCatalog
  readonly finder: PluginFinder | undefined

  private readonly coordinator: MountCoordinator
  private readonly mcpSource: DshMcpCapabilitySource
  private readonly skillSource: DshSkillCapabilitySource
  private readonly logLevel: IrisLogLevel
  private readonly lifetime = new AbortController()
  private runtimeFiber: Fiber | undefined
  private initialization: Promise<void> | undefined
  private disposal: Promise<void> | undefined
  private outcome: IrisRuntimeOutcome | undefined
  private modeValue: IrisModePolicy | undefined
  private presetValue: AgentPresetIdentity | undefined
  private surfaceValue: DshCapabilitySurface | undefined
  private runtimeCtx: Context | undefined
  private capabilityIndexValue: CatalogSnapshot | undefined
  private localCapabilitiesValue: readonly CapabilityDescriptor[] | undefined
  private readonly recommendedQueries = new Set<string>()
  private static readonly RECOMMENDED_QUERY_LIMIT = 256

  constructor(readonly agentCtx: Context, options: IrisRuntimeOptions) {
    const agent = (agentCtx as Context & { readonly agent?: Agent }).agent
    if (agent === undefined) throw new Error('dsh-iris: IrisRuntime requires agentCtx.agent')
    this.agent = agent
    this.configuredPolicy = options.policy
    this.catalog = options.catalog
    this.finder = options.finder
    this.logLevel = options.logLevel
    this.coordinator = options.coordinator ?? new MountCoordinator(new DirectFiberMountAdapter())
    this.mcpSource = new DshMcpCapabilitySource(agentCtx)
    this.skillSource = new DshSkillCapabilitySource(agentCtx)
  }

  get ready(): Promise<void> {
    return this.start()
  }

  get modePolicy(): IrisModePolicy {
    if (this.modeValue === undefined) throw new Error('dsh-iris: IrisRuntime is not initialized')
    return this.modeValue
  }

  get surface(): DshCapabilitySurface {
    if (this.surfaceValue === undefined) throw new Error('dsh-iris: IrisRuntime is not initialized')
    return this.surfaceValue
  }

  get lastOutcome(): IrisRuntimeOutcome | undefined {
    return this.outcome
  }

  start(signal: AbortSignal = new AbortController().signal): Promise<void> {
    return this.initialization ??= this.initialize(AbortSignal.any([signal, this.lifetime.signal]))
  }

  async search(
    query: string,
    kind?: 'tool' | 'skill' | 'mcp',
    signal?: AbortSignal,
  ): Promise<readonly CapabilitySearchResult[]> {
    await this.ready
    if (!this.modePolicy.search) return []
    const demand: Extract<CapabilityDemand, { kind: 'search' }> = {
      kind: 'search',
      query,
      ...kind === undefined ? {} : { capabilityKind: kind },
    }
    return await this.searchDemand(demand, signal)
  }

  async recommend(query: string, signal?: AbortSignal): Promise<IrisRecommendationControlResult> {
    await this.ready
    if (!this.modePolicy.search) return { deduplicated: false, results: [] }
    const fingerprint = query.trim().toLowerCase().replace(/\s+/gu, ' ')
    if (this.recommendedQueries.has(fingerprint)) return { deduplicated: true, results: [] }
    this.rememberRecommendation(fingerprint)
    const snapshot = await this.discoverySnapshot(signal)
    return {
      deduplicated: false,
      results: this.projectDiscoveryRoutes(searchCapabilitySnapshot(
        snapshot,
        {
          query,
          visible: this.surface.snapshot().visible,
          requirePtcCompatible: this.modePolicy.requirePtcCompatibility,
          limit: IRIS_RECOMMENDATION_LIMIT,
        },
      )),
    }
  }

  async snapshot(signal?: AbortSignal): Promise<IrisSessionSnapshot> {
    await this.ready
    const capabilities = [
      ...await this.discoveryCapabilities(signal),
      ...this.surface.capabilities(),
    ]
    const unique = new Map(capabilities.map(capability => [capability.id, capability]))
    const surface = this.surface.snapshot()
    const visible = new Set(surface.visible)
    const staged = new Set(surface.staged)
    const capabilityViews = [...unique.values()]
      .map(capability => ({
        id: capability.id,
        name: capability.name,
        kind: capability.kind,
        pack: capability.provenance?.kind === 'dsh-runtime'
          ? capabilityPackForTool(capability.name)
          : capability.provenance?.kind === 'iris-control'
            ? 'core' as const
            : 'extensions' as const,
        status: visible.has(capability.id)
          ? 'visible' as const
          : staged.has(capability.id)
            ? 'staged' as const
            : 'ready' as const,
        origin: capability.provenance?.kind ?? capability.source,
        ...capability.description === undefined ? {} : { description: capability.description },
        route: routeCapability(capability),
      }))
      .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
    const metrics = this.surface.metrics()
    const packViews = CAPABILITY_PACK_ORDER.map((id) => {
      const members = capabilityViews.filter(capability => capability.pack === id)
      const availableCount = members.length
      const visibleCount = members.filter(capability => capability.status === 'visible').length
      return {
        id,
        status: surface.revealedPacks.includes(id)
          ? 'revealed' as const
          : availableCount > 0 ? 'ready' as const : 'unavailable' as const,
        visibleCount,
        availableCount,
      }
    })
    const visibleToolCount = metrics.visibleToolCount
    return {
      enabled: true,
      agentId: this.agent.id,
      mode: this.presetValue?.id ?? 'unknown',
      strategy: this.modePolicy.id,
      ceiling: {
        availableCapabilityCount: capabilityViews.length,
        nativeToolCount: metrics.nativeToolCount,
      },
      revealedPacks: surface.revealedPacks,
      packs: packViews,
      capabilities: capabilityViews,
      visibleToolCount,
      availableCapabilityCount: capabilityViews.length,
      hiddenCapabilityCount: capabilityViews.length - visibleToolCount,
      visibleSchemaChars: metrics.visibleSchemaChars,
      reasoningOwner: metrics.reasoningOwner,
      ...metrics.promptChars === undefined ? {} : { promptChars: metrics.promptChars },
      ...metrics.codeSdkChars === undefined ? {} : { codeSdkChars: metrics.codeSdkChars },
      transitions: this.surface.transitions(),
    }
  }

  private searchDemand(
    demand: Extract<CapabilityDemand, { kind: 'search' }>,
    signal?: AbortSignal,
  ): Promise<readonly CapabilitySearchResult[]> {
    return this.discoverySnapshot(signal).then(snapshot => this.projectDiscoveryRoutes(searchCapabilitySnapshot(
      snapshot,
      { query: demand.query, ...demand.capabilityKind === undefined ? {} : { kind: demand.capabilityKind } },
    )))
  }

  async evaluate(demand: Extract<CapabilityDemand, { kind: 'unknown-tool' }>): Promise<IrisDryRunEvaluation> {
    await this.ready
    return evaluateIrisFailure({
      agentCtx: this.runtimeCtx ?? this.agentCtx,
      signal: demand.signal,
      catalog: this.catalog.find(demand.requirement),
      config: { policy: this.modePolicy.resolutionPolicy },
    })
  }

  async activate(
    capabilityId: string,
    cancellation: AbortSignal,
  ): Promise<IrisActivationControlResult> {
    const demand = demandFromExplicitActivation(capabilityId)
    if (demand.requirement.requestedName?.length === 0) {
      return { status: 'blocked', capabilityId: demand.requirement.id, reason: 'invalid-capability-id' }
    }
    const outcome = await this.handleDemand(demand, cancellation)
    switch (outcome.status) {
      case 'capability-ready':
        return {
          status: 'capability-ready',
          capabilityId: outcome.capabilityId,
          readiness: outcome.readiness,
        }
      case 'already-active':
        return { status: 'already-active', capabilityId: outcome.evaluation.requirement.id }
      case 'delegated':
        return {
          status: 'delegated',
          capabilityId: outcome.capabilityId,
          route: outcome.route,
        }
      case 'already-available':
        return {
          status: 'already-available',
          capabilityId: outcome.capabilityId,
          route: outcome.route,
        }
      case 'creation-brief':
        return {
          status: 'creation-brief',
          capabilityId: outcome.brief.capabilityId,
          brief: outcome.brief,
        }
      case 'not-found':
        return {
          status: 'not-found',
          capabilityId: outcome.evaluation.requirement.id,
          reason: 'not-catalogued',
        }
      case 'blocked':
        return { status: 'blocked', capabilityId: demand.requirement.id, reason: outcome.reason }
      case 'evaluated':
        return {
          status: 'denied',
          capabilityId: outcome.evaluation.requirement.id,
          reason: outcome.evaluation.decision.reason,
        }
      case 'not-applicable':
        return { status: 'denied', capabilityId: demand.requirement.id, reason: 'policy-declined' }
      case 'searched':
      case 'discovered':
        return { status: 'blocked', capabilityId: demand.requirement.id, reason: 'invalid-runtime-outcome' }
    }
  }

  async handleDemand(
    demand: CapabilityDemand,
    cancellation: AbortSignal,
  ): Promise<IrisRuntimeOutcome> {
    await this.ready
    if (demand.kind === 'search') {
      if (!this.modePolicy.search) return this.record({ status: 'not-applicable' })
      return this.record({ status: 'searched', demand, results: await this.searchDemand(demand, cancellation) })
    }
    if (demand.kind === 'unknown-tool' && demand.signal.owner.agentId !== this.agent.id) {
      return this.record({ status: 'blocked', reason: 'agent-ownership-unproven' })
    }
    const requirement = demand.requirement
    this.info(`capability demand: ${requirement.id}`)
    const nativeCandidate = requirement.kind === 'tool'
      ? this.surface.nativeCandidate(requirement.id)
      : undefined
    const catalog = [
      ...this.catalog.find(requirement),
      ...nativeCandidate === undefined ? [] : [{
        capability: nativeCandidate,
        availability: 'local' as const,
        evidence: [{ source: 'catalog' as const, detail: 'DSH preset capability ceiling' }],
      }],
    ]
    const evaluation = demand.kind === 'unknown-tool'
      ? await evaluateIrisFailure({
        agentCtx: this.runtimeCtx ?? this.agentCtx,
        signal: demand.signal,
        catalog,
        config: { policy: this.modePolicy.resolutionPolicy },
      })
      : await evaluateIrisRequirement({
        agentCtx: this.runtimeCtx ?? this.agentCtx,
        requirement,
        catalog,
        config: { policy: this.modePolicy.resolutionPolicy },
      })
    this.debug(`policy ${this.modePolicy.id}: ${evaluation.decision.action}`)

    if (demand.kind === 'explicit-activation' && requirement.kind === 'skill') {
      if (!this.modePolicy.search) return this.record({ status: 'evaluated', evaluation })
      const skill = await this.skillSource.find(requirement.id, cancellation)
      if (skill === undefined) return this.record({ status: 'not-found', evaluation })
      if (!this.toolVisible('skill')
        && !this.surface.revealNative('tool:skill', 'explicit-activation')) {
        return this.record({ status: 'blocked', evaluation, reason: 'native-skill-route-reveal-failed' })
      }
      const route = routeCapability(skill)
      if (route.kind !== 'dsh-skill') {
        return this.record({ status: 'blocked', evaluation, reason: 'invalid-skill-route' })
      }
      return this.record({
        status: 'delegated',
        evaluation,
        capabilityId: skill.id,
        route,
      })
    }

    if (demand.kind === 'explicit-activation' && requirement.kind === 'mcp') {
      if (!this.modePolicy.search) return this.record({ status: 'evaluated', evaluation })
      const capability = this.mcpSource.find(requirement.id)
        ?? this.surface.nativeCandidate(requirement.id)
      if (capability === undefined) return this.record({ status: 'not-found', evaluation })
      const mcpToolName = capability.provenance?.reference
      if ((mcpToolName === undefined || !this.toolVisible(mcpToolName))
        && !this.surface.revealNative(capability.id, 'explicit-activation')) {
        return this.record({ status: 'blocked', evaluation, reason: 'native-mcp-route-reveal-failed' })
      }
      const route = routeCapability(capability)
      if (route.kind !== 'dsh-mcp-tool') {
        return this.record({ status: 'blocked', evaluation, reason: 'invalid-mcp-route' })
      }
      return this.record({
        status: 'already-available',
        evaluation,
        capabilityId: capability.id,
        route,
      })
    }

    if (demand.kind === 'explicit-activation'
      && evaluation.resolution.status === 'missing'
      && !(this.modePolicy.creation === 'fallback' && requirement.kind === 'tool')) {
      return this.record({ status: 'not-found', evaluation })
    }
    if (demand.kind === 'explicit-activation' && evaluation.decision.action === 'noop') {
      return this.record({ status: 'already-active', evaluation })
    }

    if (evaluation.decision.action === 'mount-candidate') {
      const candidate = evaluation.decision.candidate
      if (!this.modePolicy.canActivate(candidate.capability)) {
        return this.record({ status: 'evaluated', evaluation })
      }
      if (candidate.capability.provenance?.kind === 'dsh-runtime') {
        const reason = demand.kind === 'unknown-tool' ? 'unknown-tool' : 'explicit-activation'
        if (!this.surface.revealNative(candidate.capability.id, reason)) {
          return this.record({ status: 'blocked', evaluation, reason: 'native-reveal-verification-failed' })
        }
        const readiness: 'immediate' | 'next-step' = this.modePolicy.visibilityCommit === 'next-assembly'
          ? 'next-step'
          : 'immediate'
        const handoff = demand.kind === 'unknown-tool'
          ? {
            status: 'capability-ready' as const,
            capabilityId: requirement.id,
            requestedToolName: requirement.requestedName ?? requirement.id,
            originalFailure: {
              callId: demand.signal.evidence.callId,
              errorName: demand.signal.evidence.errorName,
              errorCode: demand.signal.evidence.errorCode,
            },
            owner: { agentIdentity: this.agent, agentId: this.agent.id },
            readiness,
          }
          : undefined
        return this.record({
          status: 'capability-ready',
          evaluation,
          capabilityId: requirement.id,
          requestedToolName: requirement.requestedName ?? requirement.id,
          readiness,
          ...handoff === undefined ? {} : { handoff },
        })
      }
      this.info(`matched local provider: ${candidate.capability.providerId ?? 'unknown'}`)
      let provider
      try {
        provider = await this.catalog.load(candidate)
      } catch (error: unknown) {
        return this.record({ status: 'blocked', evaluation, reason: String(error) })
      }
      const activation = await activateLocalTool({
        agentCtx: this.runtimeCtx ?? this.agentCtx,
        evaluation,
        providers: [provider],
        coordinator: this.coordinator,
        signal: cancellation,
      })
      if (activation.status === 'capability-ready') {
        this.surface.markActivated(candidate.capability)
        if (!this.surface.reveal(candidate.capability)) {
          await this.coordinator.disposeOwner(this.runtimeCtx ?? this.agentCtx)
          return this.record({ status: 'blocked', evaluation, reason: 'reveal-verification-failed' })
        }
        const readiness: 'immediate' | 'next-step' = this.modePolicy.visibilityCommit === 'next-assembly'
          ? 'next-step'
          : 'immediate'
        this.info(`activated for agent ${this.agent.id}: ${requirement.id}`)
        const handoff = demand.kind === 'unknown-tool'
          ? {
            status: 'capability-ready' as const,
            capabilityId: requirement.id,
            requestedToolName: requirement.requestedName ?? requirement.id,
            originalFailure: {
              callId: demand.signal.evidence.callId,
              errorName: demand.signal.evidence.errorName,
              errorCode: demand.signal.evidence.errorCode,
            },
            owner: activation.owner,
            readiness,
          }
          : undefined
        return this.record({
          status: 'capability-ready',
          evaluation,
          capabilityId: requirement.id,
          requestedToolName: requirement.requestedName ?? requirement.id,
          readiness,
          ...handoff === undefined ? {} : { handoff },
        })
      }
      if (activation.status === 'blocked') {
        return this.record({ status: 'blocked', evaluation, reason: activation.reason })
      }
      return this.record({ status: 'evaluated', evaluation })
    }

    if (demand.kind === 'explicit-activation') {
      if (evaluation.resolution.status === 'missing') {
        return this.creationOutcome(requirement, evaluation, cancellation)
      }
      return this.record({ status: 'evaluated', evaluation })
    }

    if (cancellation.aborted) {
      return this.record({ status: 'evaluated', evaluation })
    }
    if (this.modePolicy.remoteDiscovery === 'disabled'
      || evaluation.decision.action === 'noop'
      || evaluation.decision.action === 'observe'
      || this.finder === undefined) {
      return this.creationOutcome(requirement, evaluation, cancellation)
    }
    let candidates: readonly RankedPluginCandidate[]
    try {
      candidates = await this.finder.find(
        requirement,
        this.modePolicy.requirePtcCompatibility ? { preferPtc: true } : {},
      )
    } catch (error: unknown) {
      this.info(`discovery failed for ${requirement.id}: ${String(error)}`)
      return this.record({ status: 'blocked', evaluation, reason: 'discovery-failed' })
    }
    if (cancellation.aborted) {
      return this.record({ status: 'blocked', evaluation, reason: 'cancelled' })
    }
    this.info(`discovery: ${candidates.length} candidates for ${requirement.id}`)
    if (candidates.length > 0) {
      return this.record({ status: 'discovered', evaluation, candidates })
    }
    return this.creationOutcome(requirement, evaluation, cancellation)
  }

  recover(
    signal: CapabilityFailureSignal,
    cancellation: AbortSignal,
  ): Promise<IrisRuntimeOutcome> {
    return this.handleDemand(demandFromUnknownTool(signal, {
      id: `${signal.capability.kind}:${signal.capability.name}`,
      kind: signal.capability.kind,
      requestedName: signal.capability.name,
      evidence: [{ source: 'tools/result', detail: signal.evidence.errorCode }],
    }), cancellation)
  }

  dispose(): Promise<void> {
    return this.disposal ??= (async () => {
      this.lifetime.abort('IrisRuntime disposed')
      try {
        await this.initialization
      } catch {
        // Initialization cancellation is owned by this teardown.
      }
      await this.coordinator.disposeOwner(this.runtimeCtx ?? this.agentCtx)
      await this.runtimeFiber?.dispose()
      this.runtimeFiber = undefined
      this.surfaceValue = undefined
      this.runtimeCtx = undefined
      this.capabilityIndexValue = undefined
      this.localCapabilitiesValue = undefined
    })()
  }

  private async initialize(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    const preset = await readAgentPresetIdentity(this.agentCtx)
    signal.throwIfAborted()
    this.presetValue = preset
    this.modeValue = selectIrisModePolicy(preset, { policy: this.configuredPolicy })
    const fiber = this.agentCtx.plugin(Object.assign((ctx: Context) => {
      this.runtimeCtx = ctx
      const surface = new DshCapabilitySurface(ctx, this.modePolicy, this.catalog, {
        search: (query, kind, cancellation) => this.search(query, kind, cancellation),
        activate: (capabilityId, cancellation) => this.activate(capabilityId, cancellation),
        recommend: (query, cancellation) => this.recommend(query, cancellation),
      })
      this.surfaceValue = surface
      ctx.effect(() => {
        surface.start()
        const stopPostExecute = this.installDemandHook(ctx)
        return () => {
          stopPostExecute()
          surface.dispose()
        }
      }, 'dsh-iris.aperture()')
    }, { inject: ['tools', 'skills', 'systemPrompt'] }))
    this.runtimeFiber = fiber
    try {
      await fiber
      signal.throwIfAborted()
    } catch (error: unknown) {
      await fiber.dispose()
      throw error
    }
  }

  private installDemandHook(ctx: Context): () => void {
    return ctx.on('tools/post-execute', async (
      exec: ToolExecution,
      result: Readonly<ToolExecutionResult>,
      next: () => Promise<PostToolDecision>,
    ): Promise<PostToolDecision> => {
      const downstream = await next()
      if (downstream.kind !== 'accept') return downstream
      const signal = observeUnknownTool(exec, result)
      if (signal === undefined || exec.agent !== this.agent) return downstream
      if (exec.signal.aborted) return downstream
      try {
        const handled = await this.recover(signal, exec.signal)
        if (handled.status === 'capability-ready' && handled.handoff !== undefined) {
          const handoff = handled.handoff
          const availability = handoff.readiness === 'next-step'
            ? 'is activated and will enter the next DSH step aperture'
            : 'is now available in this Agent\'s Tool surface'
          return mergeContext(
            downstream,
            `Capability ${handoff.capabilityId} ${availability}. `
              + `The original call ${handoff.originalFailure.callId} failed with UNKNOWN_TOOL. `
              + 'Re-evaluate it through the normal Agent loop; any new Tool call must pass normal policy, guard, approval, and cancellation checks.',
          )
        }
        if (handled.status === 'discovered') {
          return mergeContext(downstream, discoveryText(this.modePolicy, handled.candidates))
        }
        if (handled.status === 'creation-brief' && !exec.signal.aborted) {
          return mergeContext(downstream, creationBriefText(handled.brief))
        }
      } catch (error: unknown) {
        this.info(`demand handling failed for ${exec.name}: ${String(error)}`)
      }
      return downstream
    })
  }

  private record<T extends IrisRuntimeOutcome>(outcome: T): T {
    this.outcome = outcome
    return outcome
  }

  private async discoverySnapshot(signal?: AbortSignal): Promise<CatalogSnapshot> {
    const tools = this.localCapabilitiesValue ??= this.catalog.list()
      .map(candidate => candidate.capability)
      .filter(capability => capability.kind === 'tool')
    const skills = await this.skillSource.list(signal)
    const mcp = this.mcpSource.list()
    const native = this.surface.nativeCapabilities()
    const capabilities = [...new Map([...native, ...tools, ...skills, ...mcp]
      .map(capability => [capability.id, capability])).values()]
    const fingerprint = capabilityCatalogFingerprint(capabilities)
    if (this.capabilityIndexValue?.fingerprint !== fingerprint) {
      this.capabilityIndexValue = buildCatalogSnapshot(capabilities)
    }
    return this.capabilityIndexValue
  }

  private async discoveryCapabilities(signal?: AbortSignal): Promise<readonly CapabilityDescriptor[]> {
    return (await this.discoverySnapshot(signal)).capabilities
  }

  private creationOutcome(
    requirement: CapabilityRequirement,
    evaluation: IrisEvaluation,
    cancellation: AbortSignal,
  ): IrisRuntimeOutcome {
    if (this.modePolicy.creation !== 'fallback' || requirement.kind !== 'tool') {
      return this.record({ status: 'evaluated', evaluation })
    }
    if (cancellation.aborted) return this.record({ status: 'blocked', evaluation, reason: 'cancelled' })
    if (!this.surface.revealPack('creator', 'creation-brief')) {
      return this.record({ status: 'blocked', evaluation, reason: 'creator-pack-reveal-failed' })
    }
    return this.record({
      status: 'creation-brief',
      evaluation,
      brief: creationBriefFor(requirement),
    })
  }

  /** Hidden native Skill/MCP routes first disclose their pack through iris_activate. */
  private projectDiscoveryRoutes(
    results: readonly CapabilitySearchResult[],
  ): readonly CapabilitySearchResult[] {
    return results.map((result) => {
      const hiddenSkill = result.capability.kind === 'skill' && !this.toolVisible('skill')
      const mcpToolName = result.capability.provenance?.reference
      const hiddenMcp = result.capability.kind === 'mcp'
        && (mcpToolName === undefined || !this.toolVisible(mcpToolName))
      if (!hiddenSkill && !hiddenMcp) return result
      return {
        ...result,
        status: 'catalogued' as const,
        route: { kind: 'iris-activate' as const, capabilityId: result.capability.id },
      }
    })
  }

  private toolVisible(name: string): boolean {
    return (this.runtimeCtx ?? this.agentCtx).tools.get(name, this.agent) !== undefined
  }

  private rememberRecommendation(fingerprint: string): void {
    this.recommendedQueries.add(fingerprint)
    if (this.recommendedQueries.size <= IrisRuntime.RECOMMENDED_QUERY_LIMIT) return
    const oldest = this.recommendedQueries.values().next().value as string | undefined
    if (oldest !== undefined) this.recommendedQueries.delete(oldest)
  }

  private info(message: string): void {
    if (this.logLevel === 'info' || this.logLevel === 'debug') {
      this.agentCtx.logger.info(`[iris] ${message}`)
    }
  }

  private debug(message: string): void {
    if (this.logLevel === 'debug') this.agentCtx.logger.debug(`[iris] ${message}`)
  }
}
