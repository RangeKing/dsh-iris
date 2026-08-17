import { describe, expect, it } from 'vitest'

import {
  capabilityPackForTool,
  CapabilityRanker,
  CapabilitySurfaceState,
  buildCatalogSnapshot,
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
      route: { kind: 'iris-activate', capabilityId: 'tool:text_word_count' },
      status: 'catalogued',
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

  it('keeps indexed ranking identical to the legacy ranker across exact, token, substring, and filters', () => {
    const catalog: CapabilityDescriptor[] = [
      wordCount,
      uppercase,
      {
        id: 'tool:weather_lookup',
        kind: 'tool',
        name: 'weather_lookup',
        description: 'Look up precipitation for a city.',
        whenToUse: 'Use for a rare meteorological lookup.',
        keywords: ['forecast', 'rainfall'],
        source: 'builtin',
        trust: 'builtin',
        ptcCompatible: true,
      },
    ]
    const ranker = new CapabilityRanker()
    const snapshot = buildCatalogSnapshot(catalog)
    const queries = [
      { query: 'tool:weather_lookup' },
      { query: 'weather_lookup' },
      { query: 'rainfall' },
      { query: 'meteorological' },
      { query: 'rare meteorological lookup', visible: ['tool:weather_lookup'] },
      { query: 'uppercase text', kind: 'tool' as const, requirePtcCompatible: true },
      { query: 'nothing-matches' },
    ]
    for (const query of queries) {
      expect(ranker.rankIndexed(snapshot, query)).toEqual(ranker.rank(catalog, query))
    }
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
      revealedPacks: [],
    })

    surface.commitStaged()
    expect(surface.snapshot().visible).toEqual(['tool:iris_search', 'tool:text_word_count'])
    expect(surface.snapshot().staged).toEqual([])
  })
})

describe('Capability packs', () => {
  it.each([
    ['bash', 'core'],
    ['read', 'core'],
    ['write', 'filesystem'],
    ['grep', 'filesystem'],
    ['web_search', 'search'],
    ['job_output', 'coordination'],
    ['subagent', 'delegation'],
    ['cordis_define', 'creator'],
    ['mcp__github__create_issue', 'extensions'],
  ] as const)('maps %s to the stable %s pack', (toolName, pack) => {
    expect(capabilityPackForTool(toolName)).toBe(pack)
  })
})

describe('Iris aperture policies', () => {
  it.each<[string, IrisModePolicyId, boolean, boolean, string, string]>([
    ['minimal', 'preserve', false, false, 'disabled', 'native'],
    ['standard', 'adaptive', true, true, 'between-steps', 'minimal'],
    ['code', 'adaptive-code', true, true, 'between-steps', 'minimal'],
    ['cordis', 'adaptive-creator', true, true, 'between-steps', 'minimal'],
  ])('maps %s to %s', (preset, expected, search, discovery, timing, reasoningScaffold) => {
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
    expect(policy.reasoningScaffold).toBe(reasoningScaffold)
  })

  it('allows only proven PTC-compatible activation in Code Mode', () => {
    const code = selectIrisModePolicy({ id: 'code', builtinKind: 'ptc' }, { policy: 'auto' })

    expect(code.canActivate(wordCount)).toBe(true)
    expect(code.canActivate({ ...wordCount, ptcCompatible: false })).toBe(false)
    const { ptcCompatible: _compatibility, ...unproven } = wordCount
    expect(code.canActivate(unproven)).toBe(false)
  })
})
