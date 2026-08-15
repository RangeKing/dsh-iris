import type { CapabilityRequirement } from '../domain/index.js'
import { rankPlugins } from './rank.js'
import type {
  PluginCandidate,
  PluginFinder,
  PluginFinderOptions,
  RankedPluginCandidate,
} from './types.js'

interface CacheEntry {
  readonly expiresAt: number
  readonly value: Promise<readonly PluginCandidate[]>
}

const discoveryCache = new Map<string, CacheEntry>()

export function clearDiscoveryCache(): void {
  discoveryCache.clear()
}

interface GitHubRepository {
  readonly full_name?: unknown
  readonly html_url?: unknown
  readonly description?: unknown
  readonly topics?: unknown
  readonly updated_at?: unknown
  readonly pushed_at?: unknown
  readonly stargazers_count?: unknown
  readonly archived?: unknown
}

export interface GitHubPluginFinderConfig {
  readonly fetch?: typeof fetch
  readonly cacheTtlMs?: number
  readonly maxResults?: number
  readonly now?: () => number
  readonly token?: string
}

function fingerprint(requirement: CapabilityRequirement): string {
  return JSON.stringify({
    id: requirement.id,
    kind: requirement.kind,
    requestedName: requirement.requestedName ?? null,
  })
}

function pluginCandidate(value: GitHubRepository): PluginCandidate | undefined {
  if (value.archived === true
    || typeof value.full_name !== 'string'
    || typeof value.html_url !== 'string'
    || typeof value.updated_at !== 'string'
    || typeof value.pushed_at !== 'string') return undefined
  const topics = Array.isArray(value.topics)
    ? value.topics.filter((topic): topic is string => typeof topic === 'string')
    : []
  const normalizedTopics = topics.map(topic => topic.toLowerCase())
  return {
    id: value.full_name,
    repository: value.full_name,
    url: value.html_url,
    ...typeof value.description === 'string' ? { description: value.description } : {},
    topics,
    updatedAt: value.updated_at,
    pushedAt: value.pushed_at,
    stars: typeof value.stargazers_count === 'number' ? value.stargazers_count : 0,
    ...normalizedTopics.includes('dsh-ptc') || normalizedTopics.includes('ptc-compatible')
      ? { ptcCompatible: true }
      : {},
  }
}

/** Public-metadata-only GitHub repository discovery for the dsh-plugin topic. */
export class GitHubPluginFinder implements PluginFinder {
  private readonly request: typeof fetch
  private readonly cacheTtlMs: number
  private readonly maxResults: number
  private readonly now: () => number
  private readonly token: string | undefined

  constructor(config: GitHubPluginFinderConfig = {}) {
    this.request = config.fetch ?? fetch
    this.cacheTtlMs = config.cacheTtlMs ?? 900_000
    this.maxResults = config.maxResults ?? 10
    this.now = config.now ?? Date.now
    this.token = config.token ?? process.env.GITHUB_TOKEN
  }

  async find(
    requirement: CapabilityRequirement,
    options: PluginFinderOptions = {},
  ): Promise<readonly RankedPluginCandidate[]> {
    const key = fingerprint(requirement)
    const now = this.now()
    let cached = discoveryCache.get(key)
    if (cached === undefined || cached.expiresAt <= now) {
      const value = this.search(requirement)
      cached = { expiresAt: now + this.cacheTtlMs, value }
      discoveryCache.set(key, cached)
      void value.catch(() => {
        if (discoveryCache.get(key)?.value === value) discoveryCache.delete(key)
      })
    }
    const candidates = await cached.value
    return rankPlugins(candidates, requirement, {
      now,
      ...options.preferPtc === undefined ? {} : { preferPtc: options.preferPtc },
    })
  }

  private async search(requirement: CapabilityRequirement): Promise<readonly PluginCandidate[]> {
    const keyword = (requirement.requestedName ?? requirement.id.replace(/^[^:]+:/, ''))
      .replace(/[^a-zA-Z0-9_.-]+/g, ' ')
      .trim()
      .slice(0, 100)
    const query = `topic:dsh-plugin ${keyword} in:name,description,readme`
    const url = new URL('https://api.github.com/search/repositories')
    url.searchParams.set('q', query)
    url.searchParams.set('sort', 'updated')
    url.searchParams.set('order', 'desc')
    url.searchParams.set('per_page', String(this.maxResults))
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'dsh-iris',
      'X-GitHub-Api-Version': '2022-11-28',
    }
    if (this.token !== undefined && this.token.length > 0) {
      headers.Authorization = `Bearer ${this.token}`
    }
    const response = await this.request(url, { headers })
    if (!response.ok) {
      throw new Error(`dsh-iris: GitHub discovery failed with HTTP ${response.status}`)
    }
    const body = await response.json() as { readonly items?: unknown }
    if (!Array.isArray(body.items)) {
      throw new Error('dsh-iris: GitHub discovery returned an invalid repository list')
    }
    return body.items
      .map(item => pluginCandidate(item as GitHubRepository))
      .filter((item): item is PluginCandidate => item !== undefined)
      .slice(0, this.maxResults)
  }
}
