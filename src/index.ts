import type { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

import { Config, resolveConfig, type Config as BundleConfig } from './config.js'
import { IrisBundle } from './runtime/index.js'
import type { IrisWebAgentId, IrisWebSnapshot } from './runtime/index.js'
export { IrisBundle } from './runtime/bundle.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    irisRemote: IrisRemoteService
  }
}

/** Narrow read-only Host projection consumed by the DSH Web client. */
export class IrisRemoteService extends TypertRemoteService {
  constructor(
    ctx: Context,
    private readonly readSnapshot: (agentId?: string) => Promise<IrisWebSnapshot>,
  ) {
    super(ctx, 'irisRemote', { namespace: 'iris' })
  }

  snapshot(agentId: IrisWebAgentId): Promise<IrisWebSnapshot> {
    return this.readSnapshot(agentId ?? undefined)
  }
}

export const name = 'dsh-iris'
export const inject = ['agents', 'tools', 'skills', 'systemPrompt']
export { Config }

/**
 * Initialize shared discovery/catalog resources and attach one runtime to each
 * Agent before its first session-start and model step.
 */
export function apply(ctx: Context, config: BundleConfig = {}): void {
  const resolved = resolveConfig(config)
  const bundle = new IrisBundle(ctx, resolved.iris)
  new IrisRemoteService(ctx, agentId => bundle.snapshot(agentId))
  ctx.effect(() => {
    const stopService = ctx.provide('iris', bundle)
    bundle.start()
    return async () => {
      await bundle.dispose()
      stopService()
    }
  }, 'dsh-iris.bundle()')
}

export type * from './config.js'
export * from './capabilities/index.js'
export * from './discovery/index.js'
export type * from './domain/index.js'
export * from './dsh/index.js'
export * from './mounting/index.js'
export * from './policy/index.js'
export * from './providers/index.js'
export * from './resolution/index.js'
export type * from './retry-handoff/index.js'
export * from './runtime/index.js'
export * from './sensing/index.js'
