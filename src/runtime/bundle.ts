import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'

import type { ResolvedIrisConfig } from '../config.js'
import { GitHubPluginFinder } from '../discovery/index.js'
import { ConfiguredLocalProviderCatalog } from '../providers/index.js'
import { IrisRuntime } from './iris-runtime.js'

type OwnerCleanup = () => void | Promise<void>

declare module '@deepseek-ai/cordis' {
  interface Context {
    iris: IrisBundle
  }
}

/** Shared Bundle resources plus one owned IrisRuntime per live Agent. */
export class IrisBundle {
  readonly catalog: ConfiguredLocalProviderCatalog
  readonly finder: GitHubPluginFinder | undefined

  private readonly runtimes = new Map<Agent, IrisRuntime>()
  private readonly cleanups = new Map<Agent, OwnerCleanup>()
  private stopCreated: (() => void) | undefined
  private stopping = false

  constructor(private readonly ctx: Context, private readonly config: ResolvedIrisConfig) {
    this.catalog = new ConfiguredLocalProviderCatalog(config.providers)
    this.finder = config.discovery.enabled
      ? new GitHubPluginFinder({
        cacheTtlMs: config.discovery.cacheTtlMs,
        maxResults: config.discovery.maxResults,
      })
      : undefined
  }

  start(): void {
    if (!this.config.enabled || this.stopCreated !== undefined) return
    this.stopCreated = this.ctx.on('agent/created', ({ agent }) => { this.install(agent) })
    for (const agent of this.ctx.agents.list()) this.install(agent)
  }

  runtimeFor(agent: Agent): IrisRuntime | undefined {
    return this.runtimes.get(agent)
  }

  async dispose(): Promise<void> {
    if (this.stopping) return
    this.stopping = true
    this.stopCreated?.()
    this.stopCreated = undefined
    const cleanups = [...this.cleanups.values()]
    this.cleanups.clear()
    this.runtimes.clear()
    await Promise.allSettled(cleanups.map(cleanup => Promise.resolve(cleanup())))
  }

  private install(agent: Agent): void {
    if (this.stopping || this.runtimes.has(agent)) return
    const runtime = new IrisRuntime(agent.ctx, {
      policy: this.config.policy,
      catalog: this.catalog,
      ...this.finder === undefined ? {} : { finder: this.finder },
      logLevel: this.config.logLevel,
    })
    const maybeMaintenance = (agent as Agent & {
      runMaintenance?: <T>(task: (signal: AbortSignal) => Promise<T>) => Promise<T>
    }).runMaintenance
    const starting = maybeMaintenance === undefined
      ? runtime.start()
      : maybeMaintenance.call(agent, signal => runtime.start(signal))
    void starting.catch((error: unknown) => {
      if (!this.stopping) this.ctx.logger.error(`[iris] runtime initialization failed for agent ${agent.id}: ${String(error)}`)
    })
    let cleanup!: OwnerCleanup
    cleanup = agent.ctx.effect(() => {
      return async () => {
        try {
          await runtime.dispose()
        } finally {
          if (this.cleanups.get(agent) === cleanup) this.cleanups.delete(agent)
          if (this.runtimes.get(agent) === runtime) this.runtimes.delete(agent)
        }
      }
    }, 'dsh-iris.runtime()')
    this.runtimes.set(agent, runtime)
    this.cleanups.set(agent, cleanup)
  }
}
