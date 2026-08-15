import type { Context } from '@deepseek-ai/cordis'

import type {
  CapabilityCandidate,
  CapabilityRequirement,
  CapabilityResolution,
  CapabilitySnapshot,
} from '../domain/index.js'
import {
  decideWithPolicy,
  selectPolicy,
  type PolicyDecision,
  type IrisConfig,
  type IrisPolicyId,
} from '../policy/index.js'
import { resolveCapability } from '../resolution/index.js'
import {
  requirementFromFailureSignal,
  type CapabilityFailureSignal,
} from '../sensing/index.js'
import { createCapabilitySnapshot } from './capability-snapshot.js'
import {
  readAgentPresetIdentity,
  type AgentPresetIdentity,
} from './preset-identity.js'

export interface IrisDryRunEvaluation {
  readonly signal: CapabilityFailureSignal
  readonly requirement: CapabilityRequirement
  readonly snapshot: CapabilitySnapshot
  readonly resolution: CapabilityResolution
  readonly preset: AgentPresetIdentity
  readonly policyId: IrisPolicyId
  readonly decision: PolicyDecision
}

export interface IrisEvaluation {
  readonly requirement: CapabilityRequirement
  readonly snapshot: CapabilitySnapshot
  readonly resolution: CapabilityResolution
  readonly preset: AgentPresetIdentity
  readonly policyId: IrisPolicyId
  readonly decision: PolicyDecision
}

export interface EvaluateIrisRequirementInput {
  readonly agentCtx: Context
  readonly requirement: CapabilityRequirement
  readonly catalog: readonly CapabilityCandidate[]
  readonly config: IrisConfig
}

export interface EvaluateIrisFailureInput {
  readonly agentCtx: Context
  readonly signal: CapabilityFailureSignal
  readonly catalog: readonly CapabilityCandidate[]
  readonly config: IrisConfig
}

/** Evaluate one requirement through the shared Snapshot, Resolver, and Policy pipeline. */
export async function evaluateIrisRequirement(
  input: EvaluateIrisRequirementInput,
): Promise<IrisEvaluation> {
  const [snapshot, preset] = await Promise.all([
    createCapabilitySnapshot(input.agentCtx),
    readAgentPresetIdentity(input.agentCtx),
  ])
  const resolution = resolveCapability(input.requirement, snapshot, input.catalog)
  const policyId = selectPolicy(preset, input.config)
  const decision = decideWithPolicy(policyId, { resolution })
  return {
    requirement: input.requirement,
    snapshot,
    resolution,
    preset,
    policyId,
    decision,
  }
}

/**
 * Evaluate one deterministic failure through Snapshot, Resolver, and Policy.
 * This dry-run module returns data only and has no acquisition or mount seam.
 */
export async function evaluateIrisFailure(
  input: EvaluateIrisFailureInput,
): Promise<IrisDryRunEvaluation> {
  const requirement = requirementFromFailureSignal(input.signal)
  const evaluation = await evaluateIrisRequirement({
    agentCtx: input.agentCtx,
    requirement,
    catalog: input.catalog,
    config: input.config,
  })
  return {
    ...evaluation,
    signal: input.signal,
  }
}
