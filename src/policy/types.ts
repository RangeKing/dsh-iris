import type {
  CapabilityCandidate,
  CapabilityDescriptor,
  CapabilityResolution,
} from '../domain/index.js'

export type IrisPolicyId = 'observe' | 'resolve' | 'compose' | 'evolve'

/** Runtime-neutral preset classification consumed by policy selection. */
export interface PolicyPresetIdentity {
  readonly id: string
  readonly source?: string
  readonly builtinKind: 'standard' | 'ptc' | 'minimal' | 'creation' | 'custom'
}

export interface IrisConfig {
  readonly policy?: IrisPolicyId
}

export interface PolicyInput {
  readonly resolution: CapabilityResolution
}

export type PolicyDecision =
  | { readonly action: 'noop'; readonly reason: 'already-satisfied'; readonly current: CapabilityDescriptor }
  | { readonly action: 'observe'; readonly reason: 'policy-observe' }
  | {
    readonly action: 'mount-candidate'
    readonly reason: 'trusted-local' | 'trusted-installed' | 'ptc-compatible' | 'reuse-local' | 'reuse-installed'
    readonly candidate: CapabilityCandidate
  }
  | {
    readonly action: 'unresolved'
    readonly reason: 'no-eligible-candidate' | 'candidate-untrusted' | 'candidate-requires-acquisition'
      | 'ptc-incompatible' | 'ptc-compatibility-unproven'
  }
  | { readonly action: 'discover'; readonly reason: 'no-reusable-candidate' }
  | { readonly action: 'creator-fallback'; readonly reason: 'discovery-exhausted' }

export interface IrisPolicy {
  readonly id: IrisPolicyId
  decide(input: PolicyInput): PolicyDecision
}
