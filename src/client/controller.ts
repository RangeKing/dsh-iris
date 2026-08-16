import type { IrisWebAgentId, IrisWebSnapshot } from '../runtime/snapshot.js'

export interface IrisClientState {
  readonly phase: 'loading' | 'ready' | 'error'
  readonly snapshot?: IrisWebSnapshot
  readonly message?: string
}

export type IrisSnapshotReader = (agentId: IrisWebAgentId) => Promise<IrisWebSnapshot>

/** Small external store: Host remains authoritative; the browser only refreshes its projection. */
export class IrisSnapshotController {
  private state: IrisClientState = { phase: 'loading' }
  private readonly listeners = new Set<() => void>()
  private agentId: IrisWebAgentId = null
  private generation = 0
  private started = false

  constructor(private readonly read: IrisSnapshotReader) {}

  getSnapshot = (): IrisClientState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  setAgent(agentId: IrisWebAgentId): void {
    if (this.started && this.agentId === agentId && this.state.phase !== 'error') return
    this.started = true
    this.agentId = agentId
    void this.refresh()
  }

  async refresh(): Promise<void> {
    const generation = ++this.generation
    this.publish({ phase: 'loading', ...(this.state.snapshot === undefined ? {} : { snapshot: this.state.snapshot }) })
    try {
      const snapshot = await this.read(this.agentId)
      if (generation !== this.generation) return
      this.publish({ phase: 'ready', snapshot })
    } catch (error) {
      if (generation !== this.generation) return
      this.publish({ phase: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }

  dispose(): void {
    this.generation += 1
    this.listeners.clear()
  }

  private publish(state: IrisClientState): void {
    this.state = state
    for (const listener of this.listeners) listener()
  }
}
