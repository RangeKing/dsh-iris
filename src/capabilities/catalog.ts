import type { CapabilityDescriptor, CapabilityKind } from '../domain/index.js'
import {
  capabilityRanker,
  type CapabilityRankResult,
} from './rank.js'

export interface CapabilitySearchQuery {
  readonly query: string
  readonly kind?: CapabilityKind
}

export type CapabilitySearchResult = CapabilityRankResult

/** Deterministically rank catalog metadata without loading any provider. */
export function searchCapabilityCatalog(
  catalog: readonly CapabilityDescriptor[],
  query: CapabilitySearchQuery,
): readonly CapabilitySearchResult[] {
  return capabilityRanker.rank(catalog, query)
}
