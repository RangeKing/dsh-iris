import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const React = await import('react')
  return {
    Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => React.createElement('button', props, children),
    Pill: ({ children }: { children?: React.ReactNode }) => React.createElement('span', null, children),
    StateDot: ({ state }: { state: string }) => React.createElement('i', { 'data-state': state }),
    Menu: () => React.createElement('span'),
    IconAgentPresetOutline16: () => React.createElement('i'),
    IconChevronDownOutline14: () => React.createElement('i'),
    IconSparkle16: () => React.createElement('i'),
  }
})

import { apply } from '../../src/client/index.js'

describe('DSH Web client plugin', () => {
  it('mounts its Remote contribution and registers Settings → Iris', async () => {
    const registrations: Record<string, unknown>[] = []
    let childInject: readonly string[] | undefined
    let disposeChild: (() => void) | undefined
    const disposeRemote = vi.fn(async () => undefined)
    const stopSessions = vi.fn()
    const ctx: Record<string, any> = {
      remote: {
        $mount: vi.fn(async () => disposeRemote),
        iris: {
          snapshot: vi.fn(async () => ({ ok: true, value: { enabled: false, reason: 'no-active-agent' } })),
          config: vi.fn(async () => ({ ok: true, value: { enabled: true, policy: 'auto', providers: [], logLevel: 'info', discovery: { enabled: true, cacheTtlMs: 900000, maxResults: 10 } } })),
          updateConfig: vi.fn(async (patch: Record<string, unknown>) => ({ ok: true, value: { enabled: true, policy: 'auto', providers: [], logLevel: 'info', discovery: { enabled: true, cacheTtlMs: 900000, maxResults: 10 }, ...patch } })),
        },
      },
      sessions: {
        list: {
          getSnapshot: () => ({ current: undefined }),
          subscribe: () => stopSessions,
        },
      },
      connection: { api: { agentPresets: {} } },
      get: (name: string) => ctx[name],
      locale: {
        register: () => () => undefined,
        bind: () => (key: string) => key === 'nav' ? 'Iris' : key,
      },
      effect: (callback: () => unknown) => callback(),
      plugin: (plugin: ((inner: unknown) => unknown) & { inject?: readonly string[] }) => {
        childInject = plugin.inject
        const fiber = Promise.resolve(plugin(ctx)).then((dispose) => { disposeChild = dispose as () => void }) as Promise<void> & { dispose(): Promise<void> }
        fiber.dispose = async () => { disposeChild?.() }
        return fiber
      },
      slots: {
        inject: (_name: string, callback: () => unknown) => callback(),
        register: (options: Record<string, unknown>) => { registrations.push(options); return () => undefined },
      },
    }
    const dispose = await apply(ctx as never)
    expect(ctx.remote.$mount).toHaveBeenCalledOnce()
    expect(childInject).toContain('remote.iris')
    expect(registrations).toContainEqual(expect.objectContaining({ name: 'settings.section', id: 'iris', order: 25, locale: 'iris' }))
    expect(registrations).toContainEqual(expect.objectContaining({ name: 'conversation.hero.agentPreset', priority: -10, locale: 'iris' }))
    expect(childInject).not.toContain('settingsScope')
    await vi.waitFor(() => { expect(ctx.remote.iris.config).toHaveBeenCalledOnce() })
    await dispose()
    expect(stopSessions).toHaveBeenCalledOnce()
    expect(disposeRemote).toHaveBeenCalledOnce()
  })

  it('ships a loadable DSH client-module wrapper', async () => {
    const source = await readFile(new URL('../../lib/client.js', import.meta.url), 'utf8')
    expect(source).toMatch(/window\.__ModuleLoader__\.load\(\{\s*id:\s*"dsh-iris"/)
    expect(source).toContain('settings.section')
  })
})
