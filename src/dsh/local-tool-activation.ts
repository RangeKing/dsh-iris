import type { Context } from '@deepseek-ai/cordis'

import type { CapabilityCandidate } from '../domain/index.js'
import { MountCoordinator } from '../mounting/coordinator.js'
import type { AgentMountCandidate, MountHandle } from '../mounting/index.js'
import type { IrisEvaluation } from './evaluate-iris-failure.js'

interface AgentIdentity {
  readonly id: string
}

export interface LocalToolProvider {
  readonly candidate: CapabilityCandidate
  readonly mount: AgentMountCandidate
}

interface LocalToolActivationBase {
  readonly capabilityId: string
  readonly requestedToolName: string
}

export type LocalToolActivationResult =
  | LocalToolActivationBase & {
    readonly status: 'capability-ready'
    readonly owner: { readonly agentIdentity: object; readonly agentId: string }
  }
  | LocalToolActivationBase & {
    readonly status: 'not-applicable'
    readonly reason:
      | 'policy-declined'
      | 'unsupported-capability-kind'
      | 'candidate-not-already-local'
  }
  | LocalToolActivationBase & {
    readonly status: 'blocked'
    readonly reason:
      | 'agent-ownership-unproven'
      | 'cancelled'
      | 'local-provider-unavailable'
      | 'mount-failed'
      | 'verification-failed'
  }

export interface ActivateLocalToolInput {
  readonly agentCtx: Context
  readonly evaluation: IrisEvaluation
  readonly providers: readonly LocalToolProvider[]
  readonly coordinator: MountCoordinator
  readonly signal: AbortSignal
}

function ownerOf(agentCtx: Context): AgentIdentity | undefined {
  return (agentCtx as unknown as { readonly agent?: AgentIdentity }).agent
}

function baseOf(evaluation: IrisEvaluation): LocalToolActivationBase {
  return {
    capabilityId: evaluation.requirement.id,
    requestedToolName: evaluation.requirement.requestedName ?? evaluation.requirement.id,
  }
}

function matchingProvider(
  candidate: CapabilityCandidate,
  providers: readonly LocalToolProvider[],
): LocalToolProvider | undefined {
  return providers.find(provider => (
    provider.candidate.capability.id === candidate.capability.id
    && provider.candidate.capability.providerId === candidate.capability.providerId
    && provider.mount.capabilityId === candidate.capability.name
  ))
}

async function mountUnlessCancelled(
  input: ActivateLocalToolInput,
  provider: LocalToolProvider,
): Promise<MountHandle | 'aborted'> {
  if (input.signal.aborted) return 'aborted'
  const mounting = input.coordinator.mount(input.agentCtx, provider.mount)
  let resolveAbort!: (value: 'aborted') => void
  const aborted = new Promise<'aborted'>((resolve) => { resolveAbort = resolve })
  const onAbort = (): void => { resolveAbort('aborted') }
  input.signal.addEventListener('abort', onAbort, { once: true })
  try {
    const outcome = await Promise.race([mounting, aborted])
    if (outcome !== 'aborted') return outcome
    void mounting.then(async (handle) => {
      try {
        await handle.dispose()
      } catch {
        // The cancelled waiter cannot surface teardown failure through its Tool result.
      }
    }, () => undefined)
    return 'aborted'
  } finally {
    input.signal.removeEventListener('abort', onAbort)
  }
}

/** Activate one already-selected local Tool through the shared Agent-scoped mount generation. */
export async function activateLocalTool(
  input: ActivateLocalToolInput,
): Promise<LocalToolActivationResult> {
  const base = baseOf(input.evaluation)
  if (input.evaluation.requirement.kind !== 'tool') {
    return { ...base, status: 'not-applicable', reason: 'unsupported-capability-kind' }
  }
  const owner = ownerOf(input.agentCtx)
  if (owner === undefined || input.evaluation.snapshot.agentIdentity !== owner) {
    return { ...base, status: 'blocked', reason: 'agent-ownership-unproven' }
  }
  if (input.signal.aborted) return { ...base, status: 'blocked', reason: 'cancelled' }
  if (input.evaluation.decision.action === 'noop') {
    const tools = (input.agentCtx as Context & {
      tools?: { get(name: string, agent?: AgentIdentity): unknown }
    }).tools
    if (tools?.get(base.requestedToolName, owner) === undefined) {
      return { ...base, status: 'blocked', reason: 'verification-failed' }
    }
    return {
      ...base,
      status: 'capability-ready',
      owner: { agentIdentity: owner, agentId: owner.id },
    }
  }
  if (input.evaluation.decision.action !== 'mount-candidate') {
    return { ...base, status: 'not-applicable', reason: 'policy-declined' }
  }
  const candidate = input.evaluation.decision.candidate
  if (candidate.capability.kind !== 'tool') {
    return { ...base, status: 'not-applicable', reason: 'unsupported-capability-kind' }
  }
  if (candidate.availability !== 'local'
    || candidate.capability.source !== 'local'
    || (candidate.capability.trust !== 'trusted' && candidate.capability.trust !== 'builtin')) {
    return { ...base, status: 'not-applicable', reason: 'candidate-not-already-local' }
  }
  const provider = matchingProvider(candidate, input.providers)
  if (provider === undefined) {
    return { ...base, status: 'blocked', reason: 'local-provider-unavailable' }
  }

  let handle: MountHandle | 'aborted'
  try {
    handle = await mountUnlessCancelled(input, provider)
  } catch {
    return { ...base, status: 'blocked', reason: 'mount-failed' }
  }
  if (handle === 'aborted') return { ...base, status: 'blocked', reason: 'cancelled' }
  if (input.signal.aborted) {
    await handle.dispose()
    return { ...base, status: 'blocked', reason: 'cancelled' }
  }
  if (handle.state !== 'mounted' || !handle.verification.visible) {
    await handle.dispose()
    return { ...base, status: 'blocked', reason: 'verification-failed' }
  }
  return {
    ...base,
    status: 'capability-ready',
    owner: { agentIdentity: owner, agentId: owner.id },
  }
}
