import type { Context, Fiber } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type {
  PostToolDecision,
  ToolExecution,
  ToolExecutionResult,
} from '@deepseek-ai/dsh-tools'

import {
  capabilityRanker,
  demandFromExplicitActivation,
  demandFromUnknownTool,
  searchCapabilityCatalog,
  selectIrisModePolicy,
  type CapabilityDemand,
  type CapabilitySearchResult,
  type IrisModePolicy,
} from '../capabilities/index.js'
import type { ConfiguredPolicy, IrisLogLevel } from '../config.js'
import type { PluginFinder, RankedPluginCandidate } from '../discovery/index.js'
import {
  activateLocalTool,
  DshCapabilitySurface,
  evaluateIrisFailure,
  evaluateIrisRequirement,
  readAgentPresetIdentity,
  type IrisActivationControlResult,
  type IrisDryRunEvaluation,
  type IrisEvaluation,
  IRIS_RECOMMENDATION_LIMIT,
  type IrisRecommendationControlResult,
} from '../dsh/index.js'
import { MountCoordinator } from '../mounting/coordinator.js'
import { DirectFiberMountAdapter } from '../mounting/direct-fiber.js'
import type { LocalProviderCatalog } from '../providers/index.js'
import type { RetryHandoff } from '../retry-handoff/index.js'
import {
  observeUnknownTool,
  type CapabilityFailureSignal,
} from '../sensing/index.js'

export type IrisRuntimeOutcome =
  | { readonly status: 'not-applicable' }
  | {
    readonly status: 'searched'
    readonly demand: Extract<CapabilityDemand, { kind: 'search' }>
    readonly results: readonly CapabilitySearchResult[]
  }
  | { readonly status: 'evaluated'; readonly evaluation: IrisEvaluation }
  | { readonly status: 'already-active'; readonly evaluation: IrisEvaluation }
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
  | { readonly status: 'creator-fallback'; readonly evaluation: IrisEvaluation }
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

/** One Agent's Demand-to-Reveal control layer. */
export class IrisRuntime {
  readonly agent: Agent
  readonly configuredPolicy: ConfiguredPolicy
  readonly catalog: LocalProviderCatalog
  readonly finder: PluginFinder | undefined

  private readonly coordinator: MountCoordinator
  private readonly logLevel: IrisLogLevel
  private readonly lifetime = new AbortController()
  private runtimeFiber: Fiber | undefined
  private initialization: Promise<void> | undefined
  private disposal: Promise<void> | undefined
  private outcome: IrisRuntimeOutcome | undefined
  private modeValue: IrisModePolicy | undefined
  private surfaceValue: DshCapabilitySurface | undefined
  private runtimeCtx: Context | undefined
  private readonly recommendedQueries = new Set<string>()

  constructor(readonly agentCtx: Context, options: IrisRuntimeOptions) {
    const agent = (agentCtx as Context & { readonly agent?: Agent }).agent
    if (agent === undefined) throw new Error('dsh-iris: IrisRuntime requires agentCtx.agent')
    this.agent = agent
    this.configuredPolicy = options.policy
    this.catalog = options.catalog
    this.finder = options.finder
    this.logLevel = options.logLevel
    this.coordinator = options.coordinator ?? new MountCoordinator(new DirectFiberMountAdapter())
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

  search(query: string, kind?: 'tool' | 'skill'): readonly CapabilitySearchResult[] {
    if (!this.modePolicy.search) return []
    const demand: Extract<CapabilityDemand, { kind: 'search' }> = {
      kind: 'search',
      query,
      ...kind === undefined ? {} : { capabilityKind: kind },
    }
    return this.searchDemand(demand)
  }

  recommend(query: string): IrisRecommendationControlResult {
    if (!this.modePolicy.search) return { deduplicated: false, results: [] }
    const fingerprint = query.trim().toLowerCase().replace(/\s+/gu, ' ')
    if (this.recommendedQueries.has(fingerprint)) return { deduplicated: true, results: [] }
    this.recommendedQueries.add(fingerprint)
    return {
      deduplicated: false,
      results: capabilityRanker.rank(
        this.catalog.list().map(candidate => candidate.capability),
        {
          query,
          visible: this.surface.snapshot().visible,
          requirePtcCompatible: this.modePolicy.requirePtcCompatibility,
          limit: IRIS_RECOMMENDATION_LIMIT,
        },
      ),
    }
  }

  private searchDemand(
    demand: Extract<CapabilityDemand, { kind: 'search' }>,
  ): readonly CapabilitySearchResult[] {
    return searchCapabilityCatalog(
      this.catalog.list().map(candidate => candidate.capability),
      { query: demand.query, ...demand.capabilityKind === undefined ? {} : { kind: demand.capabilityKind } },
    )
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
      case 'creator-fallback':
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
      return this.record({ status: 'searched', demand, results: this.searchDemand(demand) })
    }
    if (demand.kind === 'unknown-tool' && demand.signal.owner.agentId !== this.agent.id) {
      return this.record({ status: 'blocked', reason: 'agent-ownership-unproven' })
    }
    const requirement = demand.requirement
    this.info(`capability demand: ${requirement.id}`)
    const evaluation = demand.kind === 'unknown-tool'
      ? await this.evaluate(demand)
      : await evaluateIrisRequirement({
        agentCtx: this.runtimeCtx ?? this.agentCtx,
        requirement,
        catalog: this.catalog.find(requirement),
        config: { policy: this.modePolicy.resolutionPolicy },
      })
    this.debug(`policy ${this.modePolicy.id}: ${evaluation.decision.action}`)

    if (demand.kind === 'explicit-activation' && evaluation.resolution.status === 'missing') {
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
      return this.record({ status: 'evaluated', evaluation })
    }

    if (this.modePolicy.remoteDiscovery === 'disabled'
      || evaluation.decision.action === 'noop'
      || evaluation.decision.action === 'observe'
      || this.finder === undefined
      || cancellation.aborted) {
      return this.record({ status: 'evaluated', evaluation })
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
    return this.record(this.modePolicy.creation === 'fallback'
      ? { status: 'creator-fallback', evaluation }
      : { status: 'evaluated', evaluation })
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
    })()
  }

  private async initialize(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    const preset = await readAgentPresetIdentity(this.agentCtx)
    signal.throwIfAborted()
    this.modeValue = selectIrisModePolicy(preset, { policy: this.configuredPolicy })
    const fiber = this.agentCtx.plugin(Object.assign((ctx: Context) => {
      this.runtimeCtx = ctx
      const surface = new DshCapabilitySurface(ctx, this.modePolicy, this.catalog, {
        search: (query, kind) => this.search(query, kind),
        activate: (capabilityId, cancellation) => this.activate(capabilityId, cancellation),
        recommend: query => this.recommend(query),
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
    }, { inject: ['tools', 'systemPrompt'] }))
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

  private info(message: string): void {
    if (this.logLevel === 'info' || this.logLevel === 'debug') {
      this.agentCtx.logger.info(`[iris] ${message}`)
    }
  }

  private debug(message: string): void {
    if (this.logLevel === 'debug') this.agentCtx.logger.debug(`[iris] ${message}`)
  }
}
