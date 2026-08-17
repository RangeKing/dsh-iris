import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'

import type { ResolvedIrisConfig } from '../config.js'
import { GitHubPluginFinder } from '../discovery/index.js'
import { ConfiguredLocalProviderCatalog } from '../providers/index.js'
import { IrisRuntime } from './iris-runtime.js'
import type { IrisWebSnapshot } from './snapshot.js'

type OwnerCleanup = () => void | Promise<void>

declare module '@deepseek-ai/cordis' {
  interface Context {
    iris: IrisBundle
  }
}

/** Shared Bundle resources plus one owned IrisRuntime per live Agent. */
export class IrisBundle {
  private readonly runtimes = new Map<Agent, IrisRuntime>()
  private readonly cleanups = new Map<Agent, OwnerCleanup>()
  private stopCreated: (() => void) | undefined
  private stopping = false
  private readonly ctx: Context
  private configValue: ResolvedIrisConfig
  private catalogValue: ConfiguredLocalProviderCatalog
  private finderValue: GitHubPluginFinder | undefined
  private reconfigureTail: Promise<void> = Promise.resolve()

  constructor(ctx: Context, config: ResolvedIrisConfig) {
    this.ctx = ctx
    this.configValue = config
    this.catalogValue = new ConfiguredLocalProviderCatalog(config.providers)
    this.finderValue = config.discovery.enabled
      ? new GitHubPluginFinder({
        cacheTtlMs: config.discovery.cacheTtlMs,
        maxResults: config.discovery.maxResults,
      })
      : undefined
  }

  get catalog(): ConfiguredLocalProviderCatalog { return this.catalogValue }
  get finder(): GitHubPluginFinder | undefined { return this.finderValue }
  get config(): ResolvedIrisConfig { return this.configValue }

  start(): void {
    if (this.stopCreated !== undefined) return
    this.stopCreated = this.ctx.on('agent/created', ({ agent }) => { this.scheduleInstall(agent) })
    for (const agent of this.ctx.agents.list()) this.scheduleInstall(agent)
  }

  /** Apply a committed DSH settings change to every Agent without restarting DSH. */
  reconfigure(config: ResolvedIrisConfig): Promise<void> {
    const task = this.reconfigureTail.then(async () => {
      if (this.stopping || JSON.stringify(config) === JSON.stringify(this.configValue)) return
      await this.disposeRuntimes()
      this.configValue = config
      this.catalogValue = new ConfiguredLocalProviderCatalog(config.providers)
      this.finderValue = config.discovery.enabled
        ? new GitHubPluginFinder({
          cacheTtlMs: config.discovery.cacheTtlMs,
          maxResults: config.discovery.maxResults,
        })
        : undefined
      if (config.enabled) {
        for (const agent of this.ctx.agents.list()) this.install(agent)
      }
    })
    this.reconfigureTail = task.catch(() => {})
    return task
  }

  runtimeFor(agent: Agent): IrisRuntime | undefined {
    return this.runtimes.get(agent)
  }

  async snapshot(agentId?: string, signal?: AbortSignal): Promise<IrisWebSnapshot> {
    const runtime = agentId === undefined
      ? [...this.runtimes.values()].at(-1)
      : [...this.runtimes.entries()].find(([agent]) => agent.id === agentId)?.[1]
    if (runtime === undefined) return { enabled: false, reason: 'no-active-agent' }
    try {
      return await runtime.snapshot(signal)
    } catch {
      return { enabled: false, reason: 'runtime-not-ready' }
    }
  }

  async dispose(): Promise<void> {
    if (this.stopping) return
    this.stopping = true
    this.stopCreated?.()
    this.stopCreated = undefined
    await this.reconfigureTail
    await this.disposeRuntimes()
  }

  private scheduleInstall(agent: Agent): void {
    void this.reconfigureTail.then(() => { this.install(agent) })
  }

  private async disposeRuntimes(): Promise<void> {
    const cleanups = [...this.cleanups.values()]
    this.cleanups.clear()
    this.runtimes.clear()
    await Promise.allSettled(cleanups.map(cleanup => Promise.resolve(cleanup())))
  }

  private install(agent: Agent): void {
    if (this.stopping || !this.configValue.enabled || this.runtimes.has(agent)) return
    const runtime = new IrisRuntime(agent.ctx, {
      policy: this.configValue.policy,
      catalog: this.catalogValue,
      ...this.finderValue === undefined ? {} : { finder: this.finderValue },
      logLevel: this.configValue.logLevel,
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
