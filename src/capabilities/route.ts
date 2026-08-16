import type { CapabilityDescriptor } from '../domain/index.js'

/** Runtime owner selected for a model-facing capability result. */
export type CapabilityRoute =
  | {
    readonly kind: 'iris-activate'
    readonly capabilityId: string
  }
  | {
    readonly kind: 'dsh-skill'
    readonly skillName: string
    readonly toolName: 'skill'
  }

/** Keep route selection centralized so future capability kinds add one branch. */
export function routeCapability(capability: CapabilityDescriptor): CapabilityRoute {
  switch (capability.kind) {
    case 'tool':
      return { kind: 'iris-activate', capabilityId: capability.id }
    case 'skill':
      return { kind: 'dsh-skill', skillName: capability.name, toolName: 'skill' }
  }
}
