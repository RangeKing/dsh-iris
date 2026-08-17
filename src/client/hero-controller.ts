import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionId, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

function snapshotStore<T>(initial: T): SnapshotStore<T> {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => value,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    set: (next) => { value = next; for (const listener of listeners) listener() },
    update: (mutator) => {
      const next = structuredClone(value)
      mutator(next)
      value = next
      for (const listener of listeners) listener()
    },
  }
}

export interface IrisPresetOption {
  readonly id: string
  readonly name?: string
  readonly description?: string
}

export interface IrisHeroPresetState {
  readonly options: readonly IrisPresetOption[]
  readonly current: string
  readonly busy: boolean
  readonly error: string | null
}

export interface IrisHeroSession {
  readonly id: SessionId
  readonly blank: boolean
  readonly agentPreset?: string
}

/** Minimal public-API controller used by Iris's composite hero seat. */
export class IrisHeroPresetController {
  readonly store: SnapshotStore<IrisHeroPresetState> = snapshotStore({
    options: [], current: '', busy: false, error: null,
  })

  private fallback = ''
  private staged: string | undefined

  constructor(
    private readonly api: Pick<IApiClient, 'agentPresets'>,
    private readonly currentSession: () => IrisHeroSession | undefined,
    private readonly onApplied: (sessionId: string, preset: string) => void,
  ) {}

  async load(): Promise<void> {
    try {
      const response = await this.api.agentPresets.list({})
      if (!response.result.ok) {
        this.patch({ error: response.result.error.message })
        return
      }
      const presets = response.result.value.presets.filter(preset => preset.broken === undefined)
      this.fallback = presets.find(preset => preset.isDefault)?.id ?? presets[0]?.id ?? ''
      this.patch({
        options: presets.map(preset => ({
          id: preset.id,
          ...preset.name === undefined ? {} : { name: preset.name },
          ...preset.description === undefined ? {} : { description: preset.description },
        })),
        current: this.staged ?? this.currentSession()?.agentPreset ?? this.fallback,
        error: null,
      })
    } catch (error) {
      this.patch({ error: error instanceof Error ? error.message : String(error) })
    }
  }

  async select(id: string): Promise<void> {
    if (this.store.getSnapshot().busy) return
    this.staged = id
    this.patch({ current: id, error: null })
    await this.apply()
  }

  async apply(): Promise<void> {
    const staged = this.staged
    const session = this.currentSession()
    if (staged === undefined || session === undefined) return
    if (!session.blank || session.agentPreset === staged) {
      this.staged = undefined
      return
    }
    this.patch({ busy: true, error: null })
    try {
      const response = await this.api.agentPresets.select({ sessionId: session.id, agentPreset: staged })
      this.staged = undefined
      if (!response.result.ok) {
        this.patch({ busy: false, current: this.fallback, error: response.result.error.message })
        return
      }
      this.patch({ busy: false, current: response.result.value.agentPreset })
      this.onApplied(session.id, response.result.value.agentPreset)
    } catch (error) {
      this.staged = undefined
      this.patch({
        busy: false,
        current: this.fallback,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  private patch(patch: Partial<IrisHeroPresetState>): void {
    const current = this.store.getSnapshot()
    this.store.set({ ...current, ...patch })
  }
}
