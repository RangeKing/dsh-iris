import type { Context, Fiber, Plugin } from '@deepseek-ai/cordis'

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

/** Raised when a mount cannot prove its Agent owner or authoritative capability. */
export class AgentScopedMountError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'AgentScopedMountError'
  }
}

class DirectFiberMountHandle implements MountHandle {
  private disposal: Promise<void> | undefined

  constructor(
    readonly capabilityId: string,
    readonly ownerIdentity: string,
    readonly verification: CapabilityVerification,
    private readonly fiber: Fiber,
  ) {}

  get state(): MountState {
    return this.fiber.uid === null ? 'disposed' : 'mounted'
  }

  dispose(): Promise<void> {
    return this.disposal ??= Promise.resolve(this.fiber.dispose())
  }
}

function ownerOf(agentCtx: Context): AgentIdentity {
  const owner = (agentCtx as unknown as { readonly agent?: AgentIdentity }).agent
  if (owner === undefined) {
    throw new AgentScopedMountError(
      'dsh-iris: refusing to mount without agentCtx.agent ownership',
    )
  }
  return owner
}

function startFiber(agentCtx: Context, candidate: AgentMountCandidate): Fiber {
  if (candidate.config === undefined) return agentCtx.plugin(candidate.plugin)
  return agentCtx.plugin(candidate.plugin as Plugin<unknown>, candidate.config)
}

function verifyTool(
  agentCtx: Context,
  candidate: AgentMountCandidate,
  owner: AgentIdentity,
): CapabilityVerification {
  const tools = (agentCtx as Context & {
    tools?: { get(name: string, agent?: AgentIdentity): unknown }
  }).tools
  if (tools === undefined) {
    throw new AgentScopedMountError('dsh-iris: ctx.tools is unavailable')
  }
  const verification: CapabilityVerification = {
    capabilityId: candidate.capabilityId,
    source: 'ctx.tools',
    visible: tools.get(candidate.capabilityId, owner) !== undefined,
  }
  if (!verification.visible) {
    throw new AgentScopedMountError(
      `dsh-iris: mounted provider did not publish tool "${candidate.capabilityId}" to Agent "${owner.id}"`,
    )
  }
  return verification
}

/** Mount a provider below the Agent scope Fiber and verify its tool surface. */
export class DirectFiberMountAdapter implements MountAdapter {
  async mount(agentCtx: Context, candidate: AgentMountCandidate): Promise<MountHandle> {
    const owner = ownerOf(agentCtx)
    const fiber = startFiber(agentCtx, candidate)
    try {
      await fiber.await()
      if (fiber.uid === null) {
        throw new AgentScopedMountError(
          `dsh-iris: Agent "${owner.id}" was disposed while mounting "${candidate.capabilityId}"`,
        )
      }
      const verification = verifyTool(agentCtx, candidate, owner)
      return new DirectFiberMountHandle(
        candidate.capabilityId,
        owner.id,
        verification,
        fiber,
      )
    } catch (error: unknown) {
      await fiber.dispose()
      if (error instanceof AgentScopedMountError) throw error
      throw new AgentScopedMountError(
        `dsh-iris: failed to mount "${candidate.capabilityId}" for Agent "${owner.id}"`,
        { cause: error },
      )
    }
  }
}
