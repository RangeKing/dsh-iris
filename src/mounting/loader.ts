import type { Context, Fiber } from '@deepseek-ai/cordis'
import type Loader from '@deepseek-ai/cordis-plugin-loader'

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

class LoaderMountHandle implements MountHandle {
  private disposal: Promise<void> | undefined

  constructor(
    readonly capabilityId: string,
    readonly verification: CapabilityVerification,
    private readonly loader: Loader,
    private readonly entryId: string,
    private readonly fiber: Fiber,
  ) {}

  readonly ownerIdentity = 'loader-root'

  get state(): MountState {
    return this.fiber.uid === null ? 'disposed' : 'mounted'
  }

  dispose(): Promise<void> {
    return this.disposal ??= this.loader.remove(this.entryId)
  }
}

function ownerOf(agentCtx: Context): AgentIdentity {
  const owner = (agentCtx as Context & { readonly agent?: AgentIdentity }).agent
  if (owner === undefined) {
    throw new AgentScopedMountError(
      'dsh-iris: refusing to mount without agentCtx.agent ownership',
    )
  }
  return owner
}

function loaderOf(agentCtx: Context): Loader {
  const loader = agentCtx.get('loader')
  if (loader === undefined) {
    throw new AgentScopedMountError('dsh-iris: ctx.loader is unavailable')
  }
  return loader
}

function verifyTool(
  agentCtx: Context,
  candidate: AgentMountCandidate,
  owner: AgentIdentity,
): CapabilityVerification {
  const tools = (agentCtx as Context & {
    tools?: { get(name: string, agent?: AgentIdentity): unknown }
  }).tools
  const verification: CapabilityVerification = {
    capabilityId: candidate.capabilityId,
    source: 'ctx.tools',
    visible: tools?.get(candidate.capabilityId, owner) !== undefined,
  }
  if (!verification.visible) {
    throw new AgentScopedMountError(
      `dsh-iris: Loader entry did not publish tool "${candidate.capabilityId}"`,
    )
  }
  return verification
}

/**
 * Experimental control adapter. Loader's root EntryTree, not the caller's
 * Agent scope, owns every entry created through this interface.
 */
export class ExperimentalLoaderMountAdapter implements MountAdapter {
  async mount(agentCtx: Context, candidate: AgentMountCandidate): Promise<MountHandle> {
    const owner = ownerOf(agentCtx)
    const loader = loaderOf(agentCtx)
    let entryId: string | undefined
    try {
      entryId = await loader.create({
        name: candidate.loaderSpecifier,
        ...candidate.config === undefined ? {} : { config: candidate.config },
      })
      const fiber = loader.resolve(entryId).fiber
      if (fiber === undefined || fiber.uid === null) {
        throw new AgentScopedMountError(
          `dsh-iris: Loader entry for "${candidate.capabilityId}" has no live Fiber`,
        )
      }
      const verification = verifyTool(agentCtx, candidate, owner)
      return new LoaderMountHandle(
        candidate.capabilityId,
        verification,
        loader,
        entryId,
        fiber,
      )
    } catch (error: unknown) {
      if (entryId !== undefined) {
        try {
          await loader.remove(entryId)
        } catch (rollbackError: unknown) {
          throw new AgentScopedMountError(
            `dsh-iris: Loader mount and rollback both failed for "${candidate.capabilityId}"`,
            { cause: new AggregateError([error, rollbackError]) },
          )
        }
      }
      if (error instanceof AgentScopedMountError) throw error
      throw new AgentScopedMountError(
        `dsh-iris: Loader failed to mount "${candidate.capabilityId}"`,
        { cause: error },
      )
    }
  }
}
