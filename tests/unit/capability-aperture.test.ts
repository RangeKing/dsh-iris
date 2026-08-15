import { describe, expect, it } from 'vitest'

import {
  CapabilityRanker,
  CapabilitySurfaceState,
  searchCapabilityCatalog,
  selectIrisModePolicy,
  type IrisModePolicyId,
} from '../../src/capabilities/index.js'
import type { CapabilityDescriptor } from '../../src/domain/index.js'

const wordCount: CapabilityDescriptor = {
  id: 'tool:text_word_count',
  kind: 'tool',
  name: 'text_word_count',
  description: 'Count words, characters, and lines in text.',
  keywords: ['count words', 'text statistics'],
  source: 'local',
  trust: 'trusted',
  providerId: 'local-text-tools',
  ptcCompatible: true,
}

const uppercase: CapabilityDescriptor = {
  id: 'tool:text_uppercase',
  kind: 'tool',
  name: 'text_uppercase',
  description: 'Convert local text to uppercase.',
  keywords: ['uppercase text', 'capitalize'],
  source: 'local',
  trust: 'trusted',
  providerId: 'local-text-tools',
  ptcCompatible: false,
}

describe('Capability Catalog search', () => {
  it('ranks metadata without activating a provider', () => {
    const results = searchCapabilityCatalog([wordCount], { query: 'count words' })

    expect(results).toEqual([{
      capability: wordCount,
      score: 90,
      reasons: ['exact keyword'],
    }])
  })

  it.each([
    ['Count the words in this text', 'tool:text_word_count'],
    ['Convert this text to uppercase', 'tool:text_uppercase'],
  ])('recommends deterministically for %s', (query, expected) => {
    const ranker = new CapabilityRanker()

    const first = ranker.rank([uppercase, wordCount], { query, limit: 1 })
    const second = ranker.rank([wordCount, uppercase], { query, limit: 1 })

    expect(first.map(result => result.capability.id)).toEqual([expected])
    expect(second).toEqual(first)
  })

  it('penalizes visible capabilities and filters unproven Code candidates', () => {
    const ranker = new CapabilityRanker()

    expect(ranker.rank([wordCount], {
      query: 'count words',
      visible: [wordCount.id],
      limit: 3,
    })[0]).toMatchObject({
      score: 40,
      reasons: ['exact keyword', 'already visible'],
    })
    expect(ranker.rank([uppercase, wordCount], {
      query: 'uppercase text',
      requirePtcCompatible: true,
      limit: 3,
    }).map(result => result.capability.id)).toEqual([wordCount.id])
  })
})

describe('Capability Surface state', () => {
  it('distinguishes catalogued, activated, visible, pinned, and staged capabilities', () => {
    const surface = new CapabilitySurfaceState([wordCount])
    surface.pin('tool:iris_search')
    surface.activate(wordCount.id)
    surface.stage(wordCount.id)

    expect(surface.snapshot()).toEqual({
      catalogued: ['tool:text_word_count'],
      activated: ['tool:text_word_count'],
      visible: ['tool:iris_search'],
      pinned: ['tool:iris_search'],
      staged: ['tool:text_word_count'],
    })

    surface.commitStaged()
    expect(surface.snapshot().visible).toEqual(['tool:iris_search', 'tool:text_word_count'])
    expect(surface.snapshot().staged).toEqual([])
  })
})

describe('Iris aperture policies', () => {
  it.each<[string, IrisModePolicyId, boolean, boolean, string]>([
    ['minimal', 'preserve', false, false, 'disabled'],
    ['standard', 'adaptive', true, true, 'between-steps'],
    ['code', 'adaptive-code', true, true, 'between-steps'],
    ['cordis', 'adaptive-creator', true, true, 'between-steps'],
  ])('maps %s to %s', (preset, expected, search, discovery, timing) => {
    const policy = selectIrisModePolicy({
      id: preset,
      builtinKind: preset === 'code'
        ? 'ptc'
        : preset === 'cordis'
          ? 'creation'
          : preset as 'minimal' | 'standard',
    }, { policy: 'auto' })

    expect(policy.id).toBe(expected)
    expect(policy.search).toBe(search)
    expect(policy.remoteDiscovery === 'metadata-only').toBe(discovery)
    expect(policy.activationTiming).toBe(timing)
  })

  it('allows only proven PTC-compatible activation in Code Mode', () => {
    const code = selectIrisModePolicy({ id: 'code', builtinKind: 'ptc' }, { policy: 'auto' })

    expect(code.canActivate(wordCount)).toBe(true)
    expect(code.canActivate({ ...wordCount, ptcCompatible: false })).toBe(false)
    const { ptcCompatible: _compatibility, ...unproven } = wordCount
    expect(code.canActivate(unproven)).toBe(false)
  })
})
