export type CapabilityId = string
export type CapabilityKind = 'tool' | 'skill'

/** One deterministic fact supporting a requirement, snapshot, or candidate. */
export interface CapabilityEvidence {
  readonly source:
    | 'tools/result'
    | 'explicit-input'
    | 'ctx.tools'
    | 'ctx.skills'
    | 'snapshot'
    | 'catalog'
    | 'preset'
    | 'policy'
  readonly detail: string
}

/** A stable capability identity supplied by a deterministic runtime or input fact. */
export interface CapabilityKey {
  readonly kind: CapabilityKind
  readonly name: string
}

export interface CapabilityRequirement {
  readonly id: CapabilityId
  readonly kind: CapabilityKind
  readonly requestedName?: string
  readonly evidence: readonly CapabilityEvidence[]
}

export type CapabilitySource = 'builtin' | 'local' | 'installed' | 'community'
export type CapabilityTrust = 'builtin' | 'trusted' | 'known' | 'unknown'

/** Metadata origin retained without loading or executing provider code. */
export interface CapabilityProvenance {
  readonly kind: 'configured-local' | 'dsh-runtime' | 'community-metadata'
  readonly reference?: string
}

/** Runtime-neutral description of one capability surface. */
export interface CapabilityDescriptor {
  readonly id: CapabilityId
  readonly kind: CapabilityKind
  readonly name: string
  readonly description?: string
  readonly keywords?: readonly string[]
  readonly source: CapabilitySource
  readonly trust: CapabilityTrust
  readonly providerId?: string
  readonly version?: string
  readonly ptcCompatible?: boolean
  readonly permissions?: readonly string[]
  readonly provenance?: CapabilityProvenance
}

/** The authoritative capability view for one Agent scope. */
export interface CapabilitySnapshot {
  readonly agentIdentity: object | symbol | string
  readonly tools: readonly CapabilityDescriptor[]
  readonly skills: readonly CapabilityDescriptor[]
  readonly version: string
}

export type CapabilityAvailability = 'active' | 'local' | 'installed' | 'discoverable'

/** A capability provider already known to the caller-owned catalog. */
export interface CapabilityCandidate {
  readonly capability: CapabilityDescriptor
  readonly availability: CapabilityAvailability
  readonly evidence: readonly CapabilityEvidence[]
}

export interface CapabilityResolution {
  readonly requirement: CapabilityRequirement
  readonly status: 'satisfied' | 'missing' | 'candidates'
  readonly current?: CapabilityDescriptor
  readonly candidates: readonly CapabilityCandidate[]
  readonly evidence: readonly CapabilityEvidence[]
}

/** Evidence that a capability is actually missing; it is not a semantic guess. */
export type CapabilityFault = ToolFailureFact | ExplicitRequirementFact

export interface ToolFailureFact {
  readonly kind: 'tool-failure'
  readonly capability: CapabilityKey
  readonly callId: string
  readonly error: {
    readonly name?: string
    readonly code?: string
    readonly message: string
  }
}

export interface ExplicitRequirementFact {
  readonly kind: 'explicit-requirement'
  readonly capability: CapabilityKey
  readonly source: 'configuration' | 'invocation' | 'fixture'
}
