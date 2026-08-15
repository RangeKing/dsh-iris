import { reusableCandidates, satisfiedDecision } from './eligibility.js'
import type { PolicyInput, PolicyDecision, IrisPolicy } from './types.js'

export class EvolvePolicy implements IrisPolicy {
  readonly id = 'evolve' as const

  decide(input: PolicyInput): PolicyDecision {
    const satisfied = satisfiedDecision(input)
    if (satisfied !== undefined) return satisfied
    const candidate = reusableCandidates(input.resolution)[0]
    if (candidate !== undefined) {
      return {
        action: 'mount-candidate',
        candidate,
        reason: candidate.availability === 'local' ? 'reuse-local' : 'reuse-installed',
      }
    }
    return { action: 'discover', reason: 'no-reusable-candidate' }
  }
}
