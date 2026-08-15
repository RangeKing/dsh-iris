import { reusableCandidates, satisfiedDecision, unresolvedReason } from './eligibility.js'
import type { PolicyInput, PolicyDecision, IrisPolicy } from './types.js'

export class ComposePolicy implements IrisPolicy {
  readonly id = 'compose' as const

  decide(input: PolicyInput): PolicyDecision {
    const satisfied = satisfiedDecision(input)
    if (satisfied !== undefined) return satisfied
    const reusable = reusableCandidates(input.resolution)
    const candidate = reusable.find(item => item.capability.ptcCompatible === true)
    if (candidate !== undefined) {
      return { action: 'mount-candidate', candidate, reason: 'ptc-compatible' }
    }
    if (reusable.some(item => item.capability.ptcCompatible === undefined)) {
      return { action: 'unresolved', reason: 'ptc-compatibility-unproven' }
    }
    if (reusable.length > 0) return { action: 'unresolved', reason: 'ptc-incompatible' }
    return { action: 'unresolved', reason: unresolvedReason(input.resolution) }
  }
}
