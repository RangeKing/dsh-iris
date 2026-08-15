export { ComposePolicy } from './compose.js'
export { EvolvePolicy } from './evolve.js'
export { ObservePolicy } from './observe.js'
export { ResolvePolicy } from './resolve.js'
export { decideWithPolicy, policyFor, selectPolicy } from './select.js'
export type {
  PolicyDecision,
  PolicyInput,
  PolicyPresetIdentity,
  IrisConfig,
  IrisPolicy,
  IrisPolicyId,
} from './types.js'
