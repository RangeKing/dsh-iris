import { describe, expect, it, vi } from 'vitest'

import { IrisSnapshotController } from '../../src/client/controller.js'

describe('IrisSnapshotController', () => {
  it('projects an inactive Host snapshot without inventing Agent state', async () => {
    const read = vi.fn(async () => ({ enabled: false as const, reason: 'no-active-agent' as const }))
    const controller = new IrisSnapshotController(read)
    controller.setAgent(null)
    await vi.waitFor(() => { expect(controller.getSnapshot().phase).toBe('ready') })
    expect(controller.getSnapshot().snapshot).toEqual({ enabled: false, reason: 'no-active-agent' })
    expect(read).toHaveBeenCalledWith(null)
  })

  it('refreshes when the selected Agent changes and disposes subscriptions', async () => {
    const read = vi.fn(async (agentId: string | null) => ({ enabled: false as const, reason: agentId === null ? 'no-active-agent' as const : 'runtime-not-ready' as const }))
    const controller = new IrisSnapshotController(read)
    const listener = vi.fn()
    controller.subscribe(listener)
    controller.setAgent('session-a')
    await vi.waitFor(() => { expect(controller.getSnapshot().phase).toBe('ready') })
    expect(read).toHaveBeenLastCalledWith('session-a')
    controller.dispose()
    expect(listener).toHaveBeenCalled()
  })
})
