import { describe, expect, it, vi } from 'vitest'

import type { ResolvedIrisConfig } from '../../src/config.js'
import { IrisSettingsController } from '../../src/client/settings-controller.js'

const config: ResolvedIrisConfig = {
  enabled: true,
  policy: 'auto',
  providers: [],
  logLevel: 'info',
  discovery: { enabled: true, cacheTtlMs: 900_000, maxResults: 10 },
}

describe('IrisSettingsController', () => {
  it('leaves loading and exposes writable options after the Host Remote responds', async () => {
    const read = vi.fn(async () => config)
    const update = vi.fn(async () => config)
    const controller = new IrisSettingsController(read, update)

    expect(controller.getSnapshot().status).toBe('loading')
    await controller.load()

    expect(read).toHaveBeenCalledOnce()
    expect(controller.getSnapshot()).toMatchObject({ status: 'ready', value: config, writable: true })
  })

  it('writes through the Host Remote and publishes the committed value', async () => {
    const disabled = { ...config, enabled: false }
    const update = vi.fn(async () => disabled)
    const controller = new IrisSettingsController(async () => config, update)
    await controller.load()

    await controller.set('enabled', false)

    expect(update).toHaveBeenCalledWith({ enabled: false })
    expect(controller.getSnapshot().value?.enabled).toBe(false)
  })
})
