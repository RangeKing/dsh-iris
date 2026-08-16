import type { Context } from '@deepseek-ai/cordis'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'

import { searchCapabilityCatalog } from '../capabilities/index.js'
import type { CapabilitySearchResult } from '../capabilities/index.js'
import type { LocalProviderCatalog } from '../providers/index.js'

export const IRIS_SEARCH_TOOL_NAME = 'iris_search'

/** Register metadata-only capability search in the exact calling Agent scope. */
export function installIrisSearch(
  agentCtx: Context,
  catalog: LocalProviderCatalog,
  search: (
    query: string,
    kind?: 'tool' | 'skill',
    signal?: AbortSignal,
  ) => Promise<readonly CapabilitySearchResult[]> | readonly CapabilitySearchResult[] = (query, kind) => searchCapabilityCatalog(
    catalog.list().map(candidate => candidate.capability),
    { query, ...kind === undefined ? {} : { kind } },
  ),
): () => void {
  return agentCtx.tools.register(defineTool({
    name: IRIS_SEARCH_TOOL_NAME,
    description: 'Search the dsh-iris capability catalog. Search returns metadata only and never loads or activates a Provider.',
    parameters: {
      query: { type: 'string', required: true, description: 'Capability description, name, or keyword.' },
      kind: { type: 'string', enum: ['tool', 'skill'], description: 'Optional capability kind.' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec): Promise<JsonValue> {
      const results = (await search(args.query, args.kind, exec.signal)).map(result => ({
        id: result.capability.id,
        kind: result.capability.kind,
        name: result.capability.name,
        description: result.capability.description ?? null,
        providerId: result.capability.providerId ?? null,
        ptcCompatible: result.capability.ptcCompatible ?? null,
        status: 'catalogued',
        score: result.score,
        reasons: [...result.reasons],
        route: result.route,
      }))
      return { results } as JsonValue
    },
  }))
}
