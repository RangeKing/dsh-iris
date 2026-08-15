import { describe, expect, it } from 'vitest'

import type {
  CapabilityCandidate,
  CapabilityDescriptor,
  CapabilityResolution,
} from '../../src/domain/index.js'
import {
  decideWithPolicy,
  selectPolicy,
  type PolicyDecision,
  type IrisPolicyId,
} from '../../src/policy/index.js'

const capability: CapabilityDescriptor = {
  id: 'tool:iris_fixture_echo',
  kind: 'tool',
  name: 'iris_fixture_echo',
  source: 'local',
  trust: 'trusted',
  ptcCompatible: true,
}

function candidate(overrides: Partial<CapabilityCandidate> = {}): CapabilityCandidate {
  return {
    capability,
    availability: 'local',
    evidence: [{ source: 'catalog', detail: 'fixture catalog' }],
    ...overrides,
  }
}

function resolution(
  candidates: readonly CapabilityCandidate[] = [candidate()],
): CapabilityResolution {
  return {
    requirement: {
      id: capability.id,
      kind: 'tool',
      requestedName: capability.name,
      evidence: [{ source: 'tools/result', detail: 'UNKNOWN_TOOL' }],
    },
    status: candidates.length === 0 ? 'missing' : 'candidates',
    candidates,
    evidence: [{ source: 'tools/result', detail: 'UNKNOWN_TOOL' }],
  }
}

describe('Named Iris policies', () => {
  it.each<IrisPolicyId>(['observe', 'resolve', 'compose', 'evolve'])(
    '%s returns noop for an already satisfied requirement',
    (policyId) => {
      const satisfied: CapabilityResolution = {
        ...resolution([]),
        status: 'satisfied',
        current: capability,
      }
      expect(decideWithPolicy(policyId, { resolution: satisfied })).toMatchObject({
        action: 'noop',
        reason: 'already-satisfied',
      })
    },
  )

  it('ObservePolicy never proposes a capability-surface mutation', () => {
    const cases = [
      resolution(),
      resolution([]),
      resolution([candidate({ availability: 'installed' })]),
      resolution([candidate({
        availability: 'discoverable',
        capability: { ...capability, source: 'community', trust: 'unknown' },
      })]),
    ]
    const decisions = cases.map(item => decideWithPolicy('observe', { resolution: item }))

    expect(decisions.every(decision => decision.action === 'observe')).toBe(true)
  })

  it('ResolvePolicy selects trusted local before trusted installed', () => {
    const installed = candidate({ availability: 'installed' })
    const local = candidate({
      capability: { ...capability, providerId: 'preferred-local' },
    })

    expect(decideWithPolicy('resolve', {
      resolution: resolution([installed, local]),
    })).toMatchObject({
      action: 'mount-candidate',
      candidate: local,
      reason: 'trusted-local',
    })
  })

  it.each([
    [
      candidate({
        capability: { ...capability, source: 'community', trust: 'known' },
      }),
      'candidate-untrusted',
    ],
    [
      candidate({
        capability: { ...capability, trust: 'unknown' },
      }),
      'candidate-untrusted',
    ],
    [
      candidate({ availability: 'discoverable' }),
      'candidate-requires-acquisition',
    ],
  ] as const)('ResolvePolicy refuses non-reusable candidate %#', (item, reason) => {
    expect(decideWithPolicy('resolve', {
      resolution: resolution([item]),
    })).toEqual({ action: 'unresolved', reason })
  })

  it.each<[boolean | undefined, PolicyDecision['action'], string]>([
    [true, 'mount-candidate', 'ptc-compatible'],
    [false, 'unresolved', 'ptc-incompatible'],
    [undefined, 'unresolved', 'ptc-compatibility-unproven'],
  ])('ComposePolicy handles ptcCompatible=%s', (ptcCompatible, action, reason) => {
    const decision = decideWithPolicy('compose', {
      resolution: resolution([candidate({
        capability: {
          id: capability.id,
          kind: capability.kind,
          name: capability.name,
          source: capability.source,
          trust: capability.trust,
          ...ptcCompatible === undefined ? {} : { ptcCompatible },
        },
      })]),
    })
    expect(decision).toMatchObject({ action, reason })
  })

  it('EvolvePolicy reuses local capability before discovery', () => {
    expect(decideWithPolicy('evolve', { resolution: resolution() }))
      .toMatchObject({ action: 'mount-candidate', reason: 'reuse-local' })
    expect(decideWithPolicy('evolve', { resolution: resolution([]) }))
      .toEqual({ action: 'discover', reason: 'no-reusable-candidate' })
  })

  it('EvolvePolicy reuses trusted installed capability before discovery', () => {
    expect(decideWithPolicy('evolve', {
      resolution: resolution([candidate({ availability: 'installed' })]),
    })).toMatchObject({ action: 'mount-candidate', reason: 'reuse-installed' })
  })

  it('returns deterministic decisions for the same input', () => {
    const input = { resolution: resolution() }
    expect(decideWithPolicy('resolve', input)).toEqual(decideWithPolicy('resolve', input))
  })
})

describe('preset policy selection', () => {
  it.each([
    ['minimal', 'observe'],
    ['standard', 'resolve'],
    ['ptc', 'compose'],
    ['creation', 'evolve'],
    ['custom', 'observe'],
  ] as const)('maps %s to %s', (builtinKind, policy) => {
    expect(selectPolicy({ id: builtinKind, builtinKind }, {})).toBe(policy)
  })

  it('allows explicit named policy for a custom preset', () => {
    expect(selectPolicy(
      { id: 'research', builtinKind: 'custom' },
      { policy: 'resolve' },
    )).toBe('resolve')
  })
})
