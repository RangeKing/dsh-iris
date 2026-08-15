import type { Context, Plugin } from '@deepseek-ai/cordis'

import type { CapabilityCandidate, CapabilityKey } from '../domain/index.js'

/** A locally available provider represented in both experimental loading forms. */
export interface AgentMountCandidate {
  readonly capabilityId: string
  readonly plugin: Plugin
  readonly loaderSpecifier: string
  readonly config?: unknown
}

export type MountState = 'mounted' | 'disposed'

export interface CapabilityVerification {
  readonly capability?: CapabilityKey
  readonly capabilityId?: string
  readonly visible: boolean
  readonly source: string
}

/** The one owned logical mount returned to every single-flight waiter. */
export interface MountHandle {
  readonly capabilityId: string
  readonly ownerIdentity: string
  readonly state: MountState
  readonly verification: CapabilityVerification
  dispose(): Promise<void>
}

/** Experimental seam shared by Direct Fiber and Loader. */
export interface MountAdapter {
  mount(agentCtx: Context, candidate: AgentMountCandidate): Promise<MountHandle>
}

/** Owns the exact resource that must be disposed on rollback or session end. */
export interface MountedCapability {
  readonly candidateId: string
  verify(signal: AbortSignal): Promise<CapabilityVerification>
  dispose(): Promise<void>
}

/** Mounts only; orchestration, verification, and rollback stay outside the adapter. */
export interface CapabilityMounter {
  mount(
    candidate: CapabilityCandidate,
    signal: AbortSignal,
  ): Promise<MountedCapability>
}

export { DirectFiberMountAdapter } from './direct-fiber.js'
export { ExperimentalLoaderMountAdapter } from './loader.js'
export { MountCoordinator } from './coordinator.js'
