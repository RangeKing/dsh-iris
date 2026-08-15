import type { CapabilityDescriptor, CapabilityId } from '../domain/index.js'

export interface CapabilitySurfaceSnapshot {
  readonly catalogued: readonly CapabilityId[]
  readonly activated: readonly CapabilityId[]
  readonly visible: readonly CapabilityId[]
  readonly pinned: readonly CapabilityId[]
  readonly staged: readonly CapabilityId[]
}

function ordered(values: ReadonlySet<CapabilityId>): readonly CapabilityId[] {
  return [...values].sort()
}

/** Agent-owned aperture state; DSH remains the authority for actual Tool visibility. */
export class CapabilitySurfaceState {
  private readonly catalogued = new Set<CapabilityId>()
  private readonly activated = new Set<CapabilityId>()
  private readonly visible = new Set<CapabilityId>()
  private readonly pinned = new Set<CapabilityId>()
  private readonly staged = new Set<CapabilityId>()

  constructor(catalog: readonly CapabilityDescriptor[]) {
    for (const capability of catalog) this.catalogued.add(capability.id)
  }

  activate(id: CapabilityId): void {
    this.activated.add(id)
  }

  reveal(id: CapabilityId): void {
    this.staged.delete(id)
    this.visible.add(id)
  }

  pin(id: CapabilityId): void {
    this.pinned.add(id)
    this.visible.add(id)
  }

  stage(id: CapabilityId): void {
    this.staged.add(id)
  }

  commitStaged(): void {
    for (const id of this.staged) this.visible.add(id)
    this.staged.clear()
  }

  commit(id: CapabilityId): void {
    if (!this.staged.delete(id)) return
    this.visible.add(id)
  }

  snapshot(): CapabilitySurfaceSnapshot {
    return {
      catalogued: ordered(this.catalogued),
      activated: ordered(this.activated),
      visible: ordered(this.visible),
      pinned: ordered(this.pinned),
      staged: ordered(this.staged),
    }
  }
}
