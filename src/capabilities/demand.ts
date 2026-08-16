import type { CapabilityRequirement } from '../domain/index.js'
import type { CapabilityFailureSignal } from '../sensing/index.js'

export type CapabilityDemand = UnknownToolDemand | ExplicitActivationDemand | SearchDemand

export interface UnknownToolDemand {
  readonly kind: 'unknown-tool'
  readonly requirement: CapabilityRequirement
  readonly signal: CapabilityFailureSignal
}

export interface SearchDemand {
  readonly kind: 'search'
  readonly query: string
  readonly capabilityKind?: 'tool' | 'skill' | 'mcp'
}

export interface ExplicitActivationDemand {
  readonly kind: 'explicit-activation'
  readonly requirement: CapabilityRequirement
}

export function demandFromUnknownTool(
  signal: CapabilityFailureSignal,
  requirement: CapabilityRequirement,
): UnknownToolDemand {
  return { kind: 'unknown-tool', signal, requirement }
}

/** Normalize a model-selected capability id into an explicit routed requirement. */
export function demandFromExplicitActivation(capabilityId: string): ExplicitActivationDemand {
  const normalized = capabilityId.trim()
  const separator = normalized.indexOf(':')
  const prefix = separator < 0 ? 'tool' : normalized.slice(0, separator)
  const name = separator < 0 ? normalized : normalized.slice(separator + 1)
  const kind = prefix === 'skill' || prefix === 'mcp' ? prefix : 'tool'
  const id = `${kind}:${name}`
  return {
    kind: 'explicit-activation',
    requirement: {
      id,
      kind,
      requestedName: name,
      evidence: [{ source: 'explicit-input', detail: `iris_activate:${id}` }],
    },
  }
}
