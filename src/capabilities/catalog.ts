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
  readonly status: 'catalogued' | 'available' | 'unavailable'
}

function routeStatus(route: CapabilityRoute): CapabilitySearchResult['status'] {
  if (route.kind === 'iris-activate') return 'catalogued'
  if (route.kind === 'unavailable') return 'unavailable'
  return 'available'
}

/** Deterministically rank catalog metadata without loading any provider. */
export function searchCapabilityCatalog(
  catalog: readonly CapabilityDescriptor[],
  query: CapabilitySearchQuery,
): readonly CapabilitySearchResult[] {
  return capabilityRanker.rank(catalog, query).map((result) => {
    const route = routeCapability(result.capability)
    return {
      ...result,
      route,
      status: routeStatus(route),
    }
  })
}
