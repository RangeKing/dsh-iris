import type { CapabilityDescriptor, CapabilityKind } from '../domain/index.js'
import {
  capabilityRanker,
  type CapabilityRankQuery,
  type CapabilityRankResult,
} from './rank.js'
import { routeCapability, type CapabilityRoute } from './route.js'

export interface CapabilitySearchQuery extends CapabilityRankQuery {
  readonly kind?: CapabilityKind
}

export type CapabilitySearchResult = CapabilityRankResult & {
  readonly route: CapabilityRoute
}

/** Deterministically rank catalog metadata without loading any provider. */
export function searchCapabilityCatalog(
  catalog: readonly CapabilityDescriptor[],
  query: CapabilitySearchQuery,
): readonly CapabilitySearchResult[] {
  return capabilityRanker.rank(catalog, query).map(result => ({
    ...result,
    route: routeCapability(result.capability),
  }))
}
