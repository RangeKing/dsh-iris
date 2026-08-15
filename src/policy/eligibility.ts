import type { CapabilityCandidate, CapabilityResolution } from '../domain/index.js'
import type { PolicyDecision, PolicyInput } from './types.js'

export function satisfiedDecision(input: PolicyInput): PolicyDecision | undefined {
  if (input.resolution.status !== 'satisfied' || input.resolution.current === undefined) return undefined
  return { action: 'noop', reason: 'already-satisfied', current: input.resolution.current }
}

function availabilityRank(candidate: CapabilityCandidate): number {
  if (candidate.availability === 'local') return 0
  if (candidate.availability === 'installed') return 1
  return 2
}

function compareCandidate(left: CapabilityCandidate, right: CapabilityCandidate): number {
  const availability = availabilityRank(left) - availabilityRank(right)
  if (availability !== 0) return availability
  const leftKey = `${left.capability.id}:${left.capability.providerId ?? ''}`
  const rightKey = `${right.capability.id}:${right.capability.providerId ?? ''}`
  if (leftKey < rightKey) return -1
  if (leftKey > rightKey) return 1
  return 0
}

export function reusableCandidates(resolution: CapabilityResolution): CapabilityCandidate[] {
  return resolution.candidates
    .filter(candidate => (
      (candidate.availability === 'local' || candidate.availability === 'installed')
      && candidate.capability.source !== 'community'
      && (candidate.capability.trust === 'builtin' || candidate.capability.trust === 'trusted')
    ))
    .sort(compareCandidate)
}

export function unresolvedReason(
  resolution: CapabilityResolution,
): Extract<PolicyDecision, { action: 'unresolved' }>['reason'] {
  if (resolution.candidates.some(candidate => candidate.availability === 'discoverable')) {
    return 'candidate-requires-acquisition'
  }
  if (resolution.candidates.some(candidate => (
    candidate.capability.source === 'community'
    || candidate.capability.trust === 'known'
    || candidate.capability.trust === 'unknown'
  ))) return 'candidate-untrusted'
  return 'no-eligible-candidate'
}
