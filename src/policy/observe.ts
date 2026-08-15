import { satisfiedDecision } from './eligibility.js'
import type { PolicyInput, PolicyDecision, IrisPolicy } from './types.js'

export class ObservePolicy implements IrisPolicy {
  readonly id = 'observe' as const

  decide(input: PolicyInput): PolicyDecision {
    return satisfiedDecision(input) ?? { action: 'observe', reason: 'policy-observe' }
  }
}
