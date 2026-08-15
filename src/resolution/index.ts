import type {
  CapabilityCandidate,
  CapabilityDescriptor,
  CapabilityRequirement,
  CapabilityResolution,
  CapabilitySnapshot,
} from '../domain/index.js'

function compareText(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function matchRank(
  requirement: CapabilityRequirement,
  capability: CapabilityDescriptor,
): number | undefined {
  if (capability.kind !== requirement.kind) return undefined
  if (capability.id === requirement.id) return 0
  if (requirement.requestedName !== undefined
    && capability.name === requirement.requestedName) return 1
  return undefined
}

function compareCandidates(
  requirement: CapabilityRequirement,
  left: CapabilityCandidate,
  right: CapabilityCandidate,
): number {
  const rank = (matchRank(requirement, left.capability) ?? 2)
    - (matchRank(requirement, right.capability) ?? 2)
  if (rank !== 0) return rank
  return compareText(left.capability.id, right.capability.id)
    || compareText(left.capability.providerId ?? '', right.capability.providerId ?? '')
    || compareText(left.availability, right.availability)
}

/**
 * Resolve a requirement against one authoritative snapshot and caller-owned
 * catalog. This pure module knows no preset, policy, runtime, or acquisition.
 */
export function resolveCapability(
  requirement: CapabilityRequirement,
  snapshot: CapabilitySnapshot,
  catalog: readonly CapabilityCandidate[],
): CapabilityResolution {
  const current = [...snapshot.tools, ...snapshot.skills]
    .map(capability => ({ capability, rank: matchRank(requirement, capability) }))
    .filter((entry): entry is { capability: CapabilityDescriptor; rank: number } => (
      entry.rank !== undefined
    ))
    .sort((left, right) => left.rank - right.rank
      || compareText(left.capability.id, right.capability.id))[0]?.capability

  if (current !== undefined) {
    return {
      requirement,
      status: 'satisfied',
      current,
      candidates: [],
      evidence: [{ source: 'snapshot', detail: current.id }],
    }
  }

  const candidates = catalog
    .filter(candidate => matchRank(requirement, candidate.capability) !== undefined)
    .sort((left, right) => compareCandidates(requirement, left, right))

  return {
    requirement,
    status: candidates.length === 0 ? 'missing' : 'candidates',
    candidates,
    evidence: requirement.evidence,
  }
}
