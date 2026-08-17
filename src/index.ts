import type { Context } from '@deepseek-ai/cordis'
import { settingsNamespace, type SettingsScope } from '@deepseek-ai/dsh-settings'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

import {
  Config,
  ResolvedIrisConfigSchema,
  resolveConfig,
  type Config as BundleConfig,
  type ResolvedIrisConfig,
} from './config.js'
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
    private readonly readConfig: () => ResolvedIrisConfig,
    private readonly writeConfig: (patch: Partial<ResolvedIrisConfig>) => Promise<ResolvedIrisConfig>,
  ) {
    super(ctx, 'irisRemote', { namespace: 'iris' })
  }

  snapshot(agentId: IrisWebAgentId): Promise<IrisWebSnapshot> {
    return this.readSnapshot(agentId ?? undefined)
  }

  config(): Promise<ResolvedIrisConfig> {
    return Promise.resolve(this.readConfig())
  }

  updateConfig(patch: Partial<ResolvedIrisConfig>): Promise<ResolvedIrisConfig> {
    return this.writeConfig(patch)
  }
}

export const name = 'dsh-iris'
export const inject = ['agents', 'tools', 'skills', 'systemPrompt']
export { Config }
export const IRIS_SETTINGS_NAMESPACE = settingsNamespace('iris')

/**
 * Initialize shared discovery/catalog resources and attach one runtime to each
 * Agent before its first session-start and model step.
 */
export function apply(ctx: Context, config: BundleConfig = {}): void {
  const resolved = resolveConfig(config)
  const bundle = new IrisBundle(ctx, resolved.iris)
  let settingsScope: SettingsScope<ResolvedIrisConfig> | undefined
  new IrisRemoteService(
    ctx,
    agentId => bundle.snapshot(agentId),
    () => settingsScope?.get() ?? bundle.config,
    async (patch) => {
      if (settingsScope === undefined) throw new Error('Iris settings are not ready yet.')
      await settingsScope.update(patch)
      return settingsScope.get()
    },
  )
  ctx.effect(() => {
    const stopService = ctx.provide('iris', bundle)
    ctx.inject(['settings'], (settingsCtx) => {
      const scope = settingsCtx.settings.register(IRIS_SETTINGS_NAMESPACE, ResolvedIrisConfigSchema, {
        base: resolved.iris,
        applies: 'live',
      })
      settingsScope = scope
      void bundle.reconfigure(scope.get())
      const stopWatch = scope.watch(next => bundle.reconfigure(next))
      return () => {
        if (settingsScope === scope) settingsScope = undefined
        stopWatch()
      }
    })
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
