import type { CapabilityRequirement } from '../domain/index.js'
import type { CapabilityFailureSignal } from './unknown-tool.js'

/** Translate one typed capability failure into a runtime-neutral requirement. */
export function requirementFromFailureSignal(
  signal: CapabilityFailureSignal,
): CapabilityRequirement {
  return {
    id: `${signal.capability.kind}:${signal.capability.name}`,
    kind: signal.capability.kind,
    requestedName: signal.capability.name,
    evidence: [{
      source: 'tools/result',
      detail: `${signal.evidence.errorName}:${signal.evidence.errorCode}:${signal.evidence.callId}`,
    }],
  }
}
