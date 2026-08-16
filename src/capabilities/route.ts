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
  | {
    readonly kind: 'dsh-mcp-tool'
    readonly serverName: string
    readonly toolName: string
    readonly dshToolName: string
  }
  | {
    readonly kind: 'unavailable'
    readonly capabilityId: string
    readonly reason: 'missing-dsh-mcp-provenance'
  }

/** Keep route selection centralized so future capability kinds add one branch. */
export function routeCapability(capability: CapabilityDescriptor): CapabilityRoute {
  switch (capability.kind) {
    case 'tool':
      return { kind: 'iris-activate', capabilityId: capability.id }
    case 'skill':
      return { kind: 'dsh-skill', skillName: capability.name, toolName: 'skill' }
    case 'mcp': {
      const provenance = capability.provenance
      if (provenance?.kind !== 'dsh-mcp-tool'
        || provenance.reference === undefined
        || provenance.serverName === undefined
        || provenance.toolName === undefined) {
        return {
          kind: 'unavailable',
          capabilityId: capability.id,
          reason: 'missing-dsh-mcp-provenance',
        }
      }
      return {
        kind: 'dsh-mcp-tool',
        serverName: provenance.serverName,
        toolName: provenance.toolName,
        dshToolName: provenance.reference,
      }
    }
  }
}
