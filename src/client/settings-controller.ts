import type { ResolvedIrisConfig } from '../config.js'

export interface IrisSettingsState {
  readonly status: 'loading' | 'ready' | 'error'
  readonly value?: ResolvedIrisConfig
  readonly writable: boolean
  readonly message?: string
}

export type IrisSettingsReader = () => Promise<ResolvedIrisConfig>
export type IrisSettingsWriter = (patch: Partial<ResolvedIrisConfig>) => Promise<ResolvedIrisConfig>

/** Browser store backed by the Iris Host Remote; DSH settings remain the only persisted source. */
export class IrisSettingsController {
  private state: IrisSettingsState = { status: 'loading', writable: false }
  private readonly listeners = new Set<() => void>()
  private tail: Promise<void> = Promise.resolve()
  private generation = 0
  private disposed = false

  constructor(
    private readonly read: IrisSettingsReader,
    private readonly write: IrisSettingsWriter,
  ) {}

  getSnapshot = (): IrisSettingsState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  async load(): Promise<void> {
    const generation = ++this.generation
    this.publish({ status: 'loading', writable: false, ...this.state.value === undefined ? {} : { value: this.state.value } })
    try {
      const value = await this.read()
      if (this.disposed || generation !== this.generation) return
      this.publish({ status: 'ready', value, writable: true })
    } catch (error) {
      if (this.disposed || generation !== this.generation) return
      this.publish({
        status: 'error',
        writable: false,
        ...this.state.value === undefined ? {} : { value: this.state.value },
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  set(field: keyof ResolvedIrisConfig, value: unknown): Promise<void> {
    const patch = { [field]: value } as Partial<ResolvedIrisConfig>
    const task = this.tail.then(async () => {
      if (this.disposed) return
      try {
        const committed = await this.write(patch)
        if (!this.disposed) this.publish({ status: 'ready', value: committed, writable: true })
      } catch (error) {
        if (!this.disposed) {
          this.publish({
            status: 'error',
            writable: false,
            ...this.state.value === undefined ? {} : { value: this.state.value },
            message: error instanceof Error ? error.message : String(error),
          })
        }
      }
    })
    this.tail = task.catch(() => {})
    return task
  }

  async dispose(): Promise<void> {
    this.disposed = true
    this.generation += 1
    await this.tail
    this.listeners.clear()
  }

  private publish(state: IrisSettingsState): void {
    this.state = state
    for (const listener of this.listeners) listener()
  }
}
