import type { CapabilityDescriptor, CapabilityId, CapabilityKind } from '../domain/index.js'

export interface CapabilityRankQuery {
  readonly query: string
  readonly kind?: CapabilityKind
  readonly visible?: readonly CapabilityId[]
  readonly exclude?: readonly CapabilityId[]
  readonly requirePtcCompatible?: boolean
  readonly limit?: number
}

export interface CapabilityRankResult {
  readonly capability: CapabilityDescriptor
  readonly score: number
  readonly reasons: readonly string[]
}

/** In-memory, process-local catalog projection used by the indexed fast path. */
export interface CatalogSnapshot {
  readonly fingerprint: string
  readonly capabilities: readonly CapabilityDescriptor[]
  readonly byId: ReadonlyMap<string, CapabilityDescriptor>
  readonly exactName: ReadonlyMap<string, readonly CapabilityId[]>
  readonly exactKeyword: ReadonlyMap<string, readonly CapabilityId[]>
  readonly tokenPostings: ReadonlyMap<string, readonly CapabilityId[]>
  readonly substringPostings: ReadonlyMap<string, readonly CapabilityId[]>
}

function normalized(value: string): string {
  return value.trim().toLowerCase()
}

function tokens(value: string): readonly string[] {
  return normalized(value).split(/[^a-z0-9_]+/u).filter(Boolean)
}

function trigrams(value: string): readonly string[] {
  const text = normalized(value)
  if (text.length < 3) return []
  return [...new Set(Array.from({ length: text.length - 2 }, (_, index) => text.slice(index, index + 3)))]
}

function addPosting(
  index: Map<string, Set<CapabilityId>>,
  key: string,
  capabilityId: CapabilityId,
): void {
  const posting = index.get(key) ?? new Set<CapabilityId>()
  posting.add(capabilityId)
  index.set(key, posting)
}

function freezePostings(index: Map<string, Set<CapabilityId>>): ReadonlyMap<string, readonly CapabilityId[]> {
  return new Map([...index.entries()]
    .map(([key, ids]) => [key, [...ids].sort()] as const))
}

export function capabilityCatalogFingerprint(catalog: readonly CapabilityDescriptor[]): string {
  let hash = 2166136261
  const canonical = [...catalog]
    .map(capability => JSON.stringify({
      id: capability.id,
      kind: capability.kind,
      name: capability.name,
      description: capability.description,
      whenToUse: capability.whenToUse,
      keywords: capability.keywords,
      source: capability.source,
      trust: capability.trust,
      providerId: capability.providerId,
      version: capability.version,
      ptcCompatible: capability.ptcCompatible,
      provenance: capability.provenance,
    }))
    .sort()
    .join('\u0000')
  for (const character of canonical) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16777619)
  }
  return `${catalog.length}:${(hash >>> 0).toString(16)}`
}

/** Build all metadata indexes once for one immutable catalog view. */
export function buildCatalogSnapshot(catalog: readonly CapabilityDescriptor[]): CatalogSnapshot {
  const capabilities = [...catalog]
  const byId = new Map<string, CapabilityDescriptor>()
  const exactName = new Map<string, Set<CapabilityId>>()
  const exactKeyword = new Map<string, Set<CapabilityId>>()
  const tokenPostings = new Map<string, Set<CapabilityId>>()
  const substringPostings = new Map<string, Set<CapabilityId>>()
  for (const capability of capabilities) {
    byId.set(normalized(capability.id), capability)
    addPosting(exactName, normalized(capability.name), capability.id)
    for (const keyword of capability.keywords ?? []) {
      addPosting(exactKeyword, normalized(keyword), capability.id)
    }
    for (const token of [...tokens(capability.name), ...(capability.keywords ?? []).flatMap(tokens)]) {
      addPosting(tokenPostings, token, capability.id)
    }
    for (const text of [capability.description ?? '', capability.whenToUse ?? '']) {
      for (const trigram of trigrams(text)) addPosting(substringPostings, trigram, capability.id)
    }
  }
  return {
    fingerprint: capabilityCatalogFingerprint(capabilities),
    capabilities,
    byId,
    exactName: freezePostings(exactName),
    exactKeyword: freezePostings(exactKeyword),
    tokenPostings: freezePostings(tokenPostings),
    substringPostings: freezePostings(substringPostings),
  }
}

function baseScore(
  capability: CapabilityDescriptor,
  query: CapabilityRankQuery,
): CapabilityRankResult | undefined {
  if (query.kind !== undefined && capability.kind !== query.kind) return undefined
  if (query.requirePtcCompatible === true
    && capability.kind === 'tool'
    && capability.ptcCompatible !== true) return undefined
  const needle = normalized(query.query)
  if (needle.length === 0) return undefined
  const id = normalized(capability.id)
  const name = normalized(capability.name)
  const keywords = capability.keywords?.map(normalized) ?? []
  const description = normalized(capability.description ?? '')
  const whenToUse = normalized(capability.whenToUse ?? '')
  if (id === needle || id === `${capability.kind}:${needle}`) {
    return { capability, score: 100, reasons: ['exact capability id'] }
  }
  if (name === needle) return { capability, score: 95, reasons: ['exact name'] }
  if (keywords.includes(needle)) return { capability, score: 90, reasons: ['exact keyword'] }

  const queryTokens = tokens(needle)
  const nameTokens = new Set(tokens(name))
  const keywordTokens = new Set(keywords.flatMap(tokens))
  let score = 0
  const reasons: string[] = []
  const nameMatches = queryTokens.filter(token => nameTokens.has(token)).length
  const keywordMatches = queryTokens.filter(token => keywordTokens.has(token)).length
  const descriptionMatches = queryTokens.filter(token => description.includes(token)).length
  const whenToUseMatches = queryTokens.filter(token => whenToUse.includes(token)).length
  if (nameMatches > 0) {
    score += nameMatches * 30
    reasons.push('name token match')
  }
  if (keywordMatches > 0) {
    score += keywordMatches * 20
    reasons.push('keyword token match')
  }
  if (descriptionMatches > 0) {
    score += descriptionMatches * 10
    reasons.push('description token match')
  }
  if (whenToUseMatches > 0) {
    score += whenToUseMatches * 15
    reasons.push('when-to-use token match')
  }
  return score === 0 ? undefined : { capability, score, reasons }
}

/** Shared deterministic metadata ranker for Catalog search and recommendation. */
export class CapabilityRanker {
  rank(
    catalog: readonly CapabilityDescriptor[],
    query: CapabilityRankQuery,
  ): readonly CapabilityRankResult[] {
    const visible = new Set(query.visible ?? [])
    const excluded = new Set(query.exclude ?? [])
    const ranked = catalog
      .filter(capability => !excluded.has(capability.id))
      .map(capability => baseScore(capability, query))
      .filter((result): result is CapabilityRankResult => result !== undefined)
      .map((result): CapabilityRankResult => visible.has(result.capability.id)
        ? {
          ...result,
          score: result.score - 50,
          reasons: [...result.reasons, 'already visible'],
        }
        : result)
      .filter(result => result.score > 0)
      .sort((left, right) => right.score - left.score
        || (left.capability.id < right.capability.id
          ? -1
          : left.capability.id > right.capability.id ? 1 : 0))
    return query.limit === undefined ? ranked : ranked.slice(0, query.limit)
  }

  /** Rank an immutable index without changing the legacy scoring authority. */
  rankIndexed(
    snapshot: CatalogSnapshot,
    query: CapabilityRankQuery,
  ): readonly CapabilityRankResult[] {
    const queryTokens = tokens(query.query)
    // One- and two-character substring matches cannot be proven complete by
    // the trigram index, so the old full scan remains the correctness path.
    if (queryTokens.some(token => token.length < 3)) return this.rank(snapshot.capabilities, query)

    const candidateIds = new Set<CapabilityId>()
    const needle = normalized(query.query)
    const exactId = snapshot.byId.get(needle)
      ?? (query.kind === undefined ? undefined : snapshot.byId.get(`${query.kind}:${needle}`))
    if (exactId !== undefined) candidateIds.add(exactId.id)
    for (const id of snapshot.exactName.get(needle) ?? []) candidateIds.add(id)
    for (const id of snapshot.exactKeyword.get(needle) ?? []) candidateIds.add(id)
    for (const token of queryTokens) {
      for (const id of snapshot.tokenPostings.get(token) ?? []) candidateIds.add(id)
      for (let index = 0; index <= token.length - 3; index += 1) {
        for (const id of snapshot.substringPostings.get(token.slice(index, index + 3)) ?? []) {
          candidateIds.add(id)
        }
      }
    }
    const candidates = [...candidateIds]
      .map(id => snapshot.byId.get(normalized(id)))
      .filter((capability): capability is CapabilityDescriptor => capability !== undefined)
    return this.rank(candidates, query)
  }
}

export const capabilityRanker = new CapabilityRanker()

export function rankIndexed(
  snapshot: CatalogSnapshot,
  query: CapabilityRankQuery,
): readonly CapabilityRankResult[] {
  return capabilityRanker.rankIndexed(snapshot, query)
}
