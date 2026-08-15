import { ComposePolicy } from './compose.js'
import { EvolvePolicy } from './evolve.js'
import { ObservePolicy } from './observe.js'
import { ResolvePolicy } from './resolve.js'
import type {
  PolicyDecision,
  PolicyInput,
  PolicyPresetIdentity,
  IrisConfig,
  IrisPolicy,
  IrisPolicyId,
} from './types.js'

const POLICIES: Readonly<Record<IrisPolicyId, IrisPolicy>> = {
  observe: new ObservePolicy(),
  resolve: new ResolvePolicy(),
  compose: new ComposePolicy(),
  evolve: new EvolvePolicy(),
}

export function selectPolicy(preset: PolicyPresetIdentity, config: IrisConfig): IrisPolicyId {
  if (config.policy !== undefined) return config.policy
  switch (preset.builtinKind) {
    case 'minimal': return 'observe'
    case 'standard': return 'resolve'
    case 'ptc': return 'compose'
    case 'creation': return 'evolve'
    case 'custom': return 'observe'
  }
}

export function policyFor(id: IrisPolicyId): IrisPolicy {
  return POLICIES[id]
}

export function decideWithPolicy(id: IrisPolicyId, input: PolicyInput): PolicyDecision {
  return policyFor(id).decide(input)
}
