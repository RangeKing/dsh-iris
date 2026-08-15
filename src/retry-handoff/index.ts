import type { CapabilityId } from '../domain/index.js'

export type RetryHandoffStatus = 'not-applicable' | 'capability-ready' | 'blocked'

export interface OriginalToolFailureIdentity {
  readonly callId: string
  readonly errorName: 'ToolNotFoundError'
  readonly errorCode: 'UNKNOWN_TOOL'
}

export interface RetryHandoffOwner {
  readonly agentIdentity: object
  readonly agentId: string
}

interface RetryHandoffBase {
  readonly status: RetryHandoffStatus
  readonly capabilityId: CapabilityId
  readonly requestedToolName: string
  readonly originalFailure: OriginalToolFailureIdentity
}

export interface CapabilityReadyHandoff extends RetryHandoffBase {
  readonly status: 'capability-ready'
  readonly owner: RetryHandoffOwner
  readonly readiness: 'immediate' | 'next-step'
}

export interface RetryHandoffNotApplicable extends RetryHandoffBase {
  readonly status: 'not-applicable'
  readonly reason:
    | 'policy-declined'
    | 'unsupported-for-live-recovery'
    | 'candidate-not-already-local'
}

export interface RetryHandoffBlocked extends RetryHandoffBase {
  readonly status: 'blocked'
  readonly reason:
    | 'agent-ownership-unproven'
    | 'cancelled'
    | 'local-provider-unavailable'
    | 'mount-failed'
    | 'verification-failed'
}

/** A fact for the original Agent loop; it never executes or replays a Tool call. */
export type RetryHandoff =
  | CapabilityReadyHandoff
  | RetryHandoffNotApplicable
  | RetryHandoffBlocked
