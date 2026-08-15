import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type {
  PostToolDecision,
  ToolExecution,
  ToolExecutionResult,
} from '@deepseek-ai/dsh-tools'

import { MountCoordinator } from '../mounting/coordinator.js'
import { DirectFiberMountAdapter } from '../mounting/direct-fiber.js'
import type { IrisConfig } from '../policy/index.js'
import type {
  CapabilityReadyHandoff,
  OriginalToolFailureIdentity,
  RetryHandoff,
} from '../retry-handoff/index.js'
import { observeUnknownTool } from '../sensing/index.js'
import { evaluateIrisFailure, type IrisDryRunEvaluation } from './evaluate-iris-failure.js'
import {
  activateLocalTool,
  type LocalToolProvider,
} from './local-tool-activation.js'

export type { LocalToolProvider } from './local-tool-activation.js'

interface AgentIdentity {
  readonly id: string
}

export interface LocalToolRecoveryOptions {
  readonly providers: readonly LocalToolProvider[]
  readonly config: IrisConfig
  readonly coordinator?: MountCoordinator
}

export interface ApplyLocalToolDecisionInput {
  readonly agentCtx: Context
  readonly evaluation: IrisDryRunEvaluation
  readonly providers: readonly LocalToolProvider[]
  readonly coordinator: MountCoordinator
  readonly signal: AbortSignal
}

function ownerOf(agentCtx: Context): AgentIdentity | undefined {
  return (agentCtx as unknown as { readonly agent?: AgentIdentity }).agent
}

function failureOf(evaluation: IrisDryRunEvaluation): OriginalToolFailureIdentity {
  return {
    callId: evaluation.signal.evidence.callId,
    errorName: evaluation.signal.evidence.errorName,
    errorCode: evaluation.signal.evidence.errorCode,
  }
}

function baseOf(evaluation: IrisDryRunEvaluation) {
  return {
    capabilityId: evaluation.requirement.id,
    requestedToolName: evaluation.requirement.requestedName ?? evaluation.requirement.id,
    originalFailure: failureOf(evaluation),
  }
}

/** Apply one already-computed decision through the existing Agent-scoped mount generation. */
export async function applyLocalToolDecision(
  input: ApplyLocalToolDecisionInput,
): Promise<RetryHandoff> {
  const base = baseOf(input.evaluation)
  const owner = ownerOf(input.agentCtx)
  if (owner === undefined || input.evaluation.signal.owner.agentId !== owner.id) {
    return { ...base, status: 'blocked', reason: 'agent-ownership-unproven' }
  }
  const activation = await activateLocalTool(input)
  if (activation.status === 'not-applicable') {
    const reason = activation.reason === 'unsupported-capability-kind'
      ? 'unsupported-for-live-recovery'
      : activation.reason
    return { ...base, status: 'not-applicable', reason }
  }
  if (activation.status === 'blocked') return { ...base, ...activation }
  const handoff: CapabilityReadyHandoff = {
    ...base,
    status: 'capability-ready',
    owner: activation.owner,
    readiness: 'immediate',
  }
  return handoff
}

function handoffContext(handoff: CapabilityReadyHandoff) {
  return createUserMessage({
    content: [{
      type: 'text',
      text: `Capability ${handoff.capabilityId} is now available in this Agent's Tool surface. `
        + `The original call ${handoff.originalFailure.callId} failed with UNKNOWN_TOOL. `
        + 'Re-evaluate it through the normal Agent loop; any new Tool call must pass normal policy, guard, approval, and cancellation checks.',
    }],
    source: { kind: 'plugin', plugin: 'dsh-iris' },
  })
}

function mergeHandoff(
  decision: Extract<PostToolDecision, { kind: 'accept' }>,
  handoff: CapabilityReadyHandoff,
): PostToolDecision {
  return {
    ...decision,
    additionalContexts: [
      ...decision.additionalContexts ?? [],
      handoffContext(handoff),
    ],
  }
}

/** Install the production Agent-scoped post-execute adapter; returned disposer removes only this hook. */
export function installLocalToolRecovery(
  agentCtx: Context,
  options: LocalToolRecoveryOptions,
): () => void {
  const coordinator = options.coordinator ?? new MountCoordinator(new DirectFiberMountAdapter())
  return agentCtx.on('tools/post-execute', async (
    exec: ToolExecution,
    result: Readonly<ToolExecutionResult>,
    next: () => Promise<PostToolDecision>,
  ): Promise<PostToolDecision> => {
    const downstream = await next()
    if (downstream.kind !== 'accept') return downstream
    const signal = observeUnknownTool(exec, result)
    if (signal === undefined || exec.agent !== ownerOf(agentCtx)) return downstream
    try {
      const evaluation = await evaluateIrisFailure({
        agentCtx,
        signal,
        catalog: options.providers.map(provider => provider.candidate),
        config: options.config,
      })
      const handoff = await applyLocalToolDecision({
        agentCtx,
        evaluation,
        providers: options.providers,
        coordinator,
        signal: exec.signal,
      })
      return handoff.status === 'capability-ready'
        ? mergeHandoff(downstream, handoff)
        : downstream
    } catch {
      return downstream
    }
  })
}
