import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CapabilityRequirement } from '../../src/domain/index.js'
import {
  clearDiscoveryCache,
  GitHubPluginFinder,
  rankPlugins,
} from '../../src/discovery/index.js'

function requirement(name = 'calendar_tool'): CapabilityRequirement {
  return {
    id: `tool:${name}`,
    kind: 'tool',
    requestedName: name,
    evidence: [],
  }
}

describe('deterministic Plugin discovery', () => {
  beforeEach(() => { clearDiscoveryCache() })

  it('ranks explicit capability, dsh-plugin, relevance, freshness, and PTC evidence deterministically', () => {
    const ranked = rankPlugins([
      {
        id: 'owner/general',
        repository: 'owner/general',
        url: 'https://github.com/owner/general',
        description: 'General utilities for agents',
        topics: ['dsh-plugin'],
        updatedAt: '2024-01-01T00:00:00Z',
        pushedAt: '2024-01-01T00:00:00Z',
        stars: 50,
      },
      {
        id: 'owner/calendar-tool',
        repository: 'owner/calendar-tool',
        url: 'https://github.com/owner/calendar-tool',
        description: 'DeepSeek Harness calendar_tool provider',
        topics: ['dsh-plugin', 'dsh-ptc'],
        updatedAt: '2026-08-01T00:00:00Z',
        pushedAt: '2026-08-01T00:00:00Z',
        stars: 3,
        ptcCompatible: true,
      },
    ], requirement(), { now: Date.parse('2026-08-15T00:00:00Z'), preferPtc: true })

    expect(ranked.map(candidate => candidate.repository)).toEqual([
      'owner/calendar-tool',
      'owner/general',
    ])
    expect(ranked[0]).toMatchObject({
      score: expect.any(Number),
      reasons: expect.arrayContaining([
        'exact capability keyword',
        'dsh-plugin topic',
        'DeepSeek Harness relevance',
        'PTC-compatible metadata',
        'recently maintained',
        'recent repository activity',
      ]),
    })
    expect(rankPlugins(ranked, requirement(), {
      now: Date.parse('2026-08-15T00:00:00Z'),
      preferPtc: true,
    })).toEqual(ranked)
  })

  it('queries GitHub metadata once per requirement during the TTL', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      items: [{
        full_name: 'owner/calendar-tool',
        html_url: 'https://github.com/owner/calendar-tool',
        description: 'DeepSeek Harness calendar_tool provider',
        topics: ['dsh-plugin'],
        updated_at: '2026-08-01T00:00:00Z',
        pushed_at: '2026-08-01T00:00:00Z',
        stargazers_count: 3,
        archived: false,
      }],
    }), { status: 200 }))
    const finder = new GitHubPluginFinder({
      fetch: request,
      cacheTtlMs: 60_000,
      maxResults: 10,
      now: () => Date.parse('2026-08-15T00:00:00Z'),
    })

    const first = await finder.find(requirement('calendar_cache_tool'))
    const second = await finder.find(requirement('calendar_cache_tool'))

    expect(first).toEqual(second)
    expect(request).toHaveBeenCalledTimes(1)
    expect(String(request.mock.calls[0]?.[0])).toContain('/search/repositories?')
    expect(String(request.mock.calls[0]?.[0])).toContain('topic%3Adsh-plugin')
  })
})
