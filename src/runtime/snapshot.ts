import type { CapabilityKind } from '../domain/index.js'
import type { CapabilityRoute, CapabilityPackId, IrisModePolicyId } from '../capabilities/index.js'
import type { IrisSurfaceTransition } from '../dsh/index.js'

export interface IrisCapabilityView {
  readonly id: string
  readonly name: string
  readonly kind: CapabilityKind
  readonly pack: CapabilityPackId
  readonly status: 'visible' | 'staged' | 'ready'
  readonly origin: string
  readonly description?: string
  readonly route: CapabilityRoute
}

export interface IrisPackView {
  readonly id: CapabilityPackId
  readonly status: 'revealed' | 'ready' | 'unavailable'
  readonly visibleCount: number
  readonly availableCount: number
}

/** Read-only Agent-scoped state projected to benchmarks and the DSH Web client. */
export interface IrisSessionSnapshot {
  readonly enabled: true
  readonly agentId: string
  readonly mode: string
  readonly strategy: IrisModePolicyId
  readonly ceiling: {
    readonly availableCapabilityCount: number
    readonly nativeToolCount: number
  }
  readonly revealedPacks: readonly CapabilityPackId[]
  readonly packs: readonly IrisPackView[]
  readonly capabilities: readonly IrisCapabilityView[]
  readonly visibleToolCount: number
  readonly availableCapabilityCount: number
  readonly hiddenCapabilityCount: number
  readonly visibleSchemaChars: number
  readonly promptChars?: number
  readonly codeSdkChars?: number
  readonly reasoningOwner: 'iris' | 'native' | `external:${string}`
  readonly transitions: readonly IrisSurfaceTransition[]
}

export interface IrisInactiveSnapshot {
  readonly enabled: false
  readonly reason: 'no-active-agent' | 'runtime-not-ready'
}

export type IrisWebSnapshot = IrisSessionSnapshot | IrisInactiveSnapshot

/** Nullable wire identity: null asks Host for the most recently active Agent. */
export type IrisWebAgentId = string | null
