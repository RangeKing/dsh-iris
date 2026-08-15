import { describe, expect, it } from 'vitest'

import type {
  CapabilityCandidate,
  CapabilityDescriptor,
  CapabilityRequirement,
  CapabilitySnapshot,
} from '../../src/domain/index.js'
import { resolveCapability } from '../../src/resolution/index.js'

const requirement: CapabilityRequirement = {
  id: 'tool:iris_fixture_echo',
  kind: 'tool',
  requestedName: 'iris_fixture_echo',
  evidence: [{ source: 'tools/result', detail: 'UNKNOWN_TOOL' }],
}

const descriptor: CapabilityDescriptor = {
  id: requirement.id,
  kind: 'tool',
  name: 'iris_fixture_echo',
  source: 'local',
  trust: 'trusted',
  providerId: 'fixture.echo',
  ptcCompatible: true,
}

function snapshot(tools: readonly CapabilityDescriptor[] = []): CapabilitySnapshot {
  return {
    agentIdentity: 'agent-a',
    tools,
    skills: [],
    version: 'fixture-version',
  }
}

function candidate(capability: CapabilityDescriptor = descriptor): CapabilityCandidate {
  return {
    capability,
    availability: 'local',
    evidence: [{ source: 'catalog', detail: 'fixture catalog' }],
  }
}

describe('resolveCapability', () => {
  it('returns satisfied when the authoritative snapshot contains the capability', () => {
    expect(resolveCapability(requirement, snapshot([descriptor]), [candidate()]))
      .toEqual({
        requirement,
        status: 'satisfied',
        current: descriptor,
        candidates: [],
        evidence: [{ source: 'snapshot', detail: 'tool:iris_fixture_echo' }],
      })
  })

  it('returns only deterministic exact-id or exact-name candidates', () => {
    const wrong: CapabilityCandidate = candidate({
      ...descriptor,
      id: 'tool:iris_fixture_ec',
      name: 'iris_fixture_ec',
    })
    const requestedNameMatch = candidate({
      ...descriptor,
      id: 'tool:fixture-alias-id',
    })

    const first = resolveCapability(
      requirement,
      snapshot(),
      [wrong, requestedNameMatch, candidate()],
    )
    const second = resolveCapability(
      requirement,
      snapshot(),
      [wrong, requestedNameMatch, candidate()],
    )

    expect(first).toEqual(second)
    expect(first.status).toBe('candidates')
    expect(first.candidates.map(item => item.capability.id)).toEqual([
      'tool:iris_fixture_echo',
      'tool:fixture-alias-id',
    ])
  })

  it('fails closed when no exact match exists', () => {
    expect(resolveCapability(requirement, snapshot(), [candidate({
      ...descriptor,
      id: 'tool:echo-ish',
      name: 'echo-ish',
    })]).status).toBe('missing')
  })
})
