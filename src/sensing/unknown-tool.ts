interface ToolExecutionIdentity {
  readonly name: string
  readonly callId: string
  readonly agent?: { readonly id: string }
}

interface ToolFailureResult {
  readonly isError: boolean
  readonly error?: {
    readonly message: string
    readonly info?: {
      readonly name?: string
      readonly code?: string
    }
  }
}

/** Deterministic internal fact emitted only for DSH's structured unknown-tool identity. */
export interface CapabilityFailureSignal {
  readonly kind: 'capability-failure'
  readonly capability: {
    readonly kind: 'tool'
    readonly name: string
  }
  readonly owner: {
    readonly agentId?: string
  }
  readonly evidence: {
    readonly source: 'tools/result'
    readonly callId: string
    readonly errorName: 'ToolNotFoundError'
    readonly errorCode: 'UNKNOWN_TOOL'
  }
}

/**
 * Translate one final tool outcome without mounting, replaying, or modifying it.
 * @param execution - requested tool and owner identity.
 * @param result - authoritative DSH tool result.
 * @returns a typed signal only for the exact structured unknown-tool error.
 */
export function observeUnknownTool(
  execution: ToolExecutionIdentity,
  result: ToolFailureResult,
): CapabilityFailureSignal | undefined {
  if (!result.isError
    || result.error?.info?.name !== 'ToolNotFoundError'
    || result.error.info.code !== 'UNKNOWN_TOOL') return undefined
  return {
    capability: { kind: 'tool', name: execution.name },
    evidence: {
      callId: execution.callId,
      errorCode: 'UNKNOWN_TOOL',
      errorName: 'ToolNotFoundError',
      source: 'tools/result',
    },
    kind: 'capability-failure',
    owner: execution.agent === undefined ? {} : { agentId: execution.agent.id },
  }
}
