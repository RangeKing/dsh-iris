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

function normalized(value: string): string {
  return value.trim().toLowerCase()
}

function tokens(value: string): readonly string[] {
  return normalized(value).split(/[^a-z0-9_]+/u).filter(Boolean)
}

function baseScore(
  capability: CapabilityDescriptor,
  query: CapabilityRankQuery,
): CapabilityRankResult | undefined {
  if (query.kind !== undefined && capability.kind !== query.kind) return undefined
  if (query.requirePtcCompatible === true && capability.ptcCompatible !== true) return undefined
  const needle = normalized(query.query)
  if (needle.length === 0) return undefined
  const id = normalized(capability.id)
  const name = normalized(capability.name)
  const keywords = capability.keywords?.map(normalized) ?? []
  const description = normalized(capability.description ?? '')
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
}

export const capabilityRanker = new CapabilityRanker()
