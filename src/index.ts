import type { Context } from '@deepseek-ai/cordis'

import { Config, resolveConfig, type Config as BundleConfig } from './config.js'
import { IrisBundle } from './runtime/index.js'

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
