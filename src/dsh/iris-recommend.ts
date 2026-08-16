import type { Context } from '@deepseek-ai/cordis'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'

import type { CapabilitySearchResult } from '../capabilities/index.js'

export const IRIS_RECOMMEND_TOOL_NAME = 'iris_recommend'
export const IRIS_RECOMMENDATION_LIMIT = 3

export interface IrisRecommendationControlResult {
  readonly deduplicated: boolean
  readonly results: readonly CapabilitySearchResult[]
}

export interface InstallIrisRecommendOptions {
  recommend(
    query: string,
    signal?: AbortSignal,
  ): Promise<IrisRecommendationControlResult> | IrisRecommendationControlResult
}

/** Register side-effect-free task-text recommendation in the exact calling Agent scope. */
export function installIrisRecommend(
  agentCtx: Context,
  options: InstallIrisRecommendOptions,
): () => void {
  return agentCtx.tools.register(defineTool({
    name: IRIS_RECOMMEND_TOOL_NAME,
    description: 'Recommend up to three Tool, native Skill, or connected MCP capabilities for supplied text. Recommendation is metadata-only; follow each result route.',
    parameters: {
      query: { type: 'string', required: true, description: 'Current task text or a concise description of the needed capability.' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec): Promise<JsonValue> {
      const recommendation = await options.recommend(args.query, exec.signal)
      return {
        deduplicated: recommendation.deduplicated,
        results: recommendation.results.map(result => ({
          id: result.capability.id,
          kind: result.capability.kind,
          name: result.capability.name,
          description: result.capability.description ?? null,
          providerId: result.capability.providerId ?? null,
          ptcCompatible: result.capability.ptcCompatible ?? null,
          status: result.status,
          score: result.score,
          reasons: [...result.reasons],
          route: result.route,
        })),
      } as JsonValue
    },
  }))
}
