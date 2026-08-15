import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const IRIS_ACTIVATE_TOOL_NAME = 'iris_activate'

export type IrisActivationControlResult =
  | {
    readonly status: 'capability-ready'
    readonly capabilityId: string
    readonly readiness: 'immediate' | 'next-step'
  }
  | { readonly status: 'already-active'; readonly capabilityId: string }
  | { readonly status: 'not-found'; readonly capabilityId: string; readonly reason: 'not-catalogued' }
  | { readonly status: 'denied'; readonly capabilityId: string; readonly reason: string }
  | { readonly status: 'blocked'; readonly capabilityId: string; readonly reason: string }

export interface InstallIrisActivateOptions {
  activate(capabilityId: string, signal: AbortSignal): Promise<IrisActivationControlResult>
}

function readinessContext(result: Extract<IrisActivationControlResult, { status: 'capability-ready' }>) {
  const timing = result.readiness === 'next-step'
    ? 'has been activated and is staged for the next DSH step'
    : 'is active in this Agent scope'
  return createUserMessage({
    content: [{
      type: 'text',
      text: `Iris capability ${result.capabilityId} ${timing}. Continue through the normal Agent loop; any Tool call still passes DSH policy, guard, approval, execution, and cancellation handling.`,
    }],
    source: { kind: 'plugin', plugin: 'dsh-iris' },
  })
}

/** Register explicit Catalog activation in the exact calling Agent scope. */
export function installIrisActivate(
  agentCtx: Context,
  options: InstallIrisActivateOptions,
): () => void {
  return agentCtx.tools.register(defineTool({
    name: IRIS_ACTIVATE_TOOL_NAME,
    description: 'Activate one catalogued dsh-iris capability for this Agent. Use the capability id returned by iris_search or iris_recommend.',
    parameters: {
      capabilityId: { type: 'string', required: true, description: 'Catalog capability id, for example tool:text_word_count.' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec): Promise<JsonValue> {
      const result = await options.activate(args.capabilityId, exec.signal)
      if (result.status === 'capability-ready') exec.deferContext(readinessContext(result))
      return result as JsonValue
    },
  }))
}
