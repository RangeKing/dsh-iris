import { reusableCandidates, satisfiedDecision, unresolvedReason } from './eligibility.js'
import type { PolicyInput, PolicyDecision, IrisPolicy } from './types.js'

export class ResolvePolicy implements IrisPolicy {
  readonly id = 'resolve' as const

  decide(input: PolicyInput): PolicyDecision {
    const satisfied = satisfiedDecision(input)
    if (satisfied !== undefined) return satisfied
    const candidate = reusableCandidates(input.resolution)[0]
    if (candidate === undefined) {
      return { action: 'unresolved', reason: unresolvedReason(input.resolution) }
    }
    return {
      action: 'mount-candidate',
      candidate,
      reason: candidate.availability === 'local' ? 'trusted-local' : 'trusted-installed',
    }
  }
}
