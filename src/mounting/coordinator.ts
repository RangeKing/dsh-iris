import type { Context } from '@deepseek-ai/cordis'

import { AgentScopedMountError } from './direct-fiber.js'
import type {
  AgentMountCandidate,
  CapabilityVerification,
  MountAdapter,
  MountHandle,
  MountState,
} from './index.js'

interface AgentIdentity {
  readonly id: string
}

class CoordinatedMountHandle implements MountHandle {
  private disposal: Promise<void> | undefined

  constructor(
    private readonly mounted: MountHandle,
    private readonly onDisposed: () => void,
  ) {}

  get capabilityId(): string {
    return this.mounted.capabilityId
  }

  get ownerIdentity(): string {
    return this.mounted.ownerIdentity
  }

  get state(): MountState {
    return this.mounted.state
  }

  get verification(): CapabilityVerification {
    return this.mounted.verification
  }

  dispose(): Promise<void> {
    return this.disposal ??= Promise.resolve(this.mounted.dispose()).then(() => {
      this.onDisposed()
    })
  }
}

/** Single-flight ownership keyed by exact Agent object and capability id. */
export class MountCoordinator implements MountAdapter {
  private readonly owners = new WeakMap<object, Map<string, Promise<MountHandle>>>()

  constructor(private readonly adapter: MountAdapter) {}

  mount(agentCtx: Context, candidate: AgentMountCandidate): Promise<MountHandle> {
    const owner = (agentCtx as Context & { readonly agent?: AgentIdentity }).agent
    if (owner === undefined) {
      return Promise.reject(new AgentScopedMountError(
        'dsh-iris: refusing to coordinate a mount without agentCtx.agent ownership',
      ))
    }
    let capabilities = this.owners.get(owner)
    if (capabilities === undefined) {
      capabilities = new Map()
      this.owners.set(owner, capabilities)
    }
    const existing = capabilities.get(candidate.capabilityId)
    if (existing !== undefined) return existing

    let pending!: Promise<MountHandle>
    pending = this.adapter.mount(agentCtx, candidate).then(
      mounted => new CoordinatedMountHandle(mounted, () => {
        if (capabilities.get(candidate.capabilityId) === pending) {
          capabilities.delete(candidate.capabilityId)
        }
      }),
      (error: unknown) => {
        if (capabilities.get(candidate.capabilityId) === pending) {
          capabilities.delete(candidate.capabilityId)
        }
        throw error
      },
    )
    capabilities.set(candidate.capabilityId, pending)
    return pending
  }

  /** Dispose every generation owned by one exact Agent, including mounts still settling. */
  async disposeOwner(agentCtx: Context): Promise<void> {
    const owner = (agentCtx as Context & { readonly agent?: AgentIdentity }).agent
    if (owner === undefined) return
    const capabilities = this.owners.get(owner)
    if (capabilities === undefined) return
    this.owners.delete(owner)
    const generations = [...capabilities.values()]
    capabilities.clear()
    await Promise.all(generations.map(async (generation) => {
      try {
        const handle = await generation
        await handle.dispose()
      } catch {
        // Failed generations already roll back in the mount adapter.
      }
    }))
  }
}
