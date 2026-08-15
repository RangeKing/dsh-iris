import type { CapabilityRequirement } from '../domain/index.js'
import type { PluginCandidate, RankedPluginCandidate } from './types.js'

export interface RankOptions {
  readonly now?: number
  readonly preferPtc?: boolean
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function requestedKeyword(requirement: CapabilityRequirement): string {
  return normalize(requirement.requestedName ?? requirement.id.replace(/^[^:]+:/, ''))
}

export function scorePlugin(
  candidate: PluginCandidate,
  requirement: CapabilityRequirement,
  options: RankOptions = {},
): RankedPluginCandidate {
  const now = options.now ?? Date.now()
  const keyword = requestedKeyword(requirement)
  const repository = normalize(candidate.repository)
  const description = normalize(candidate.description ?? '')
  const topics = candidate.topics.map(normalize)
  const searchable = [repository, description, ...topics].join(' ')
  let score = 0
  const reasons: string[] = []

  if (keyword.length > 0 && searchable.includes(keyword)) {
    score += 40
    reasons.push('exact capability keyword')
  } else {
    const matchedTokens = keyword.split(' ').filter(token => token.length > 1 && searchable.includes(token))
    if (matchedTokens.length > 0) {
      score += Math.min(20, matchedTokens.length * 5)
      reasons.push('capability keyword match')
    }
  }
  if (topics.includes('dsh plugin')) {
    score += 25
    reasons.push('dsh-plugin topic')
  }
  if (/deepseek harness|\bdsh\b/.test(`${repository} ${description} ${topics.join(' ')}`)) {
    score += 15
    reasons.push('DeepSeek Harness relevance')
  }
  if (candidate.ptcCompatible === true) {
    score += options.preferPtc === true ? 20 : 8
    reasons.push('PTC-compatible metadata')
  }

  const maintainedAt = Math.max(Date.parse(candidate.updatedAt), Date.parse(candidate.pushedAt))
  const ageDays = Number.isFinite(maintainedAt) ? (now - maintainedAt) / 86_400_000 : Infinity
  if (ageDays <= 180) {
    score += 10
    reasons.push('recently maintained')
  } else if (ageDays <= 730) {
    score += 5
    reasons.push('maintained within two years')
  }
  const pushedAt = Date.parse(candidate.pushedAt)
  const pushAgeDays = Number.isFinite(pushedAt) ? (now - pushedAt) / 86_400_000 : Infinity
  if (pushAgeDays <= 90) {
    score += 5
    reasons.push('recent repository activity')
  }
  if (candidate.stars > 0) {
    score += Math.min(5, Math.floor(Math.log10(candidate.stars + 1) * 2))
    reasons.push('community adoption')
  }

  return { ...candidate, score, reasons }
}

/** Deterministic scoring followed by a stable repository-identity tie-break. */
export function rankPlugins(
  candidates: readonly PluginCandidate[],
  requirement: CapabilityRequirement,
  options: RankOptions = {},
): readonly RankedPluginCandidate[] {
  return candidates
    .map(candidate => scorePlugin(candidate, requirement, options))
    .sort((left, right) => (options.preferPtc === true
      ? Number(right.ptcCompatible === true) - Number(left.ptcCompatible === true)
      : 0)
      || right.score - left.score
      || left.repository.localeCompare(right.repository))
}
