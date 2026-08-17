import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const React = await import('react')
  return {
    Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => React.createElement('button', props, children),
    Pill: ({ children }: { children?: React.ReactNode }) => React.createElement('span', null, children),
    StateDot: ({ state }: { state: string }) => React.createElement('i', { 'data-state': state }),
    Menu: ({ anchor, items }: { anchor: React.ReactNode; items: Array<{ id: string; label: React.ReactNode }> }) => React.createElement('span', null, anchor, ...items.map(item => React.createElement('span', { key: item.id }, item.label))),
    IconAgentPresetOutline16: () => React.createElement('i'),
    IconChevronDownOutline14: () => React.createElement('i'),
    IconSparkle16: () => React.createElement('i'),
  }
})

import { IrisSnapshotController } from '../../src/client/controller.js'
import { IrisHeroControls, type IrisHeroControlsProps } from '../../src/client/IrisHeroControls.js'
import { IrisSection, type IrisSectionProps } from '../../src/client/IrisSection.js'
import { en, zh, type IrisLocaleKey } from '../../src/client/locales.js'
import type { IrisSessionSnapshot } from '../../src/runtime/snapshot.js'
import type { ResolvedIrisConfig } from '../../src/config.js'

const config: ResolvedIrisConfig = {
  enabled: true,
  policy: 'auto',
  providers: [],
  logLevel: 'info',
  discovery: { enabled: true, cacheTtlMs: 900_000, maxResults: 10 },
}

function settings(value = config) {
  const scope = {
    snapshot: { status: 'ready' as const, value, base: undefined, user: undefined, revision: 1, writable: true, mode: 'host' as const },
    getSnapshot() { return this.snapshot },
    subscribe() { void this.snapshot; return () => undefined },
    set: vi.fn(async () => undefined),
    unset: vi.fn(async () => undefined),
  }
  return scope
}

const snapshot: IrisSessionSnapshot = {
  enabled: true,
  agentId: 'session-1',
  mode: 'standard',
  strategy: 'adaptive',
  ceiling: { availableCapabilityCount: 8, nativeToolCount: 5 },
  revealedPacks: ['core'],
  packs: [
    { id: 'core', status: 'revealed', visibleCount: 3, availableCount: 3 },
    { id: 'search', status: 'ready', visibleCount: 0, availableCount: 2 },
  ],
  capabilities: [
    { id: 'tool:bash', name: 'bash', kind: 'tool', pack: 'core', status: 'visible', origin: 'dsh-runtime', route: { kind: 'iris-activate', capabilityId: 'tool:bash' } },
    { id: 'skill:review', name: 'review', kind: 'skill', pack: 'extensions', status: 'ready', origin: 'dsh-native-skill', route: { kind: 'dsh-skill', skillName: 'review', toolName: 'skill' } },
    { id: 'mcp:github/create_issue', name: 'create_issue', kind: 'mcp', pack: 'extensions', status: 'ready', origin: 'dsh-mcp', route: { kind: 'dsh-mcp-tool', serverName: 'github', toolName: 'create_issue', dshToolName: 'mcp__github__create_issue' } },
  ],
  visibleToolCount: 3,
  availableCapabilityCount: 8,
  hiddenCapabilityCount: 5,
  visibleSchemaChars: 1240,
  promptChars: 4200,
  reasoningOwner: 'iris',
  transitions: [{ sequence: 1, pack: 'core', reason: 'provider-activation' }],
}

async function html(dictionary: Record<IrisLocaleKey, string>, value = snapshot): Promise<string> {
  const controller = new IrisSnapshotController(async () => value)
  await controller.refresh()
  const props = { controller, settings: settings(), close: () => undefined, t: (key: IrisLocaleKey) => dictionary[key] } as unknown as IrisSectionProps
  return renderToStaticMarkup(<IrisSection {...props} />)
}

describe('Iris Settings UI', () => {
  it('renders aperture, four modes, capability kinds, and recent reveals', async () => {
    const output = await html(en)
    expect(output).toContain('Start with what matters. Add more when needed.')
    expect(output).toContain('Standard')
    expect(output).toContain('Code')
    expect(output).toContain('Creator')
    expect(output).toContain('tool:bash')
    expect(output).toContain('skill:review')
    expect(output).toContain('mcp:github/create_issue')
    expect(output).toContain('provider-activation')
  })

  it('renders Simplified Chinese through the DSH locale dictionary', async () => {
    const output = await html(zh)
    expect(output).toContain('先给必要能力，需要时再扩展。')
    expect(output).toContain('本会话的能力')
    expect(output).toContain('创造模式')
  })

  it('renders the authoritative inactive state', async () => {
    const controller = new IrisSnapshotController(async () => ({ enabled: false as const, reason: 'no-active-agent' as const }))
    await controller.refresh()
    const props = { controller, settings: settings(), close: () => undefined, t: (key: IrisLocaleKey) => en[key] } as unknown as IrisSectionProps
    const output = renderToStaticMarkup(<IrisSection {...props} />)
    expect(output).toContain('Iris is not active for this session.')
    expect(output).not.toContain('Capability Surface')
  })

  it('renders writable controls without directing the user to a config file', async () => {
    const output = await html(en)
    expect(output).toContain('DSH saves your choices and applies them immediately.')
    expect(output).toContain('How capabilities are added')
    expect(output).toContain('Add provider')
    expect(output).not.toContain('settings.yaml')
  })

  it('renders the mode selector and explained Iris enablement dropdown together', () => {
    const settingsScope = settings()
    const output = renderToStaticMarkup(<IrisHeroControls {...({
      useIrisPreset: (select: (value: unknown) => unknown) => select({ options: [{ id: 'standard', name: 'Standard', description: 'General agent mode.' }], current: 'standard', busy: false, error: null }),
      useIrisSettings: (select: (value: unknown) => unknown) => select(settingsScope.getSnapshot()),
      loadPreset: async () => undefined,
      selectPreset: async () => undefined,
      setEnabled: async () => undefined,
      t: (key: IrisLocaleKey) => en[key],
    } as unknown as IrisHeroControlsProps)} />)
    expect(output).toContain('Standard')
    expect(output).toContain('Iris on')
    expect(output).toContain('All four modes start minimal and expand capabilities when needed.')
    expect(output).toContain('Use DeepSeek&#x27;s native behavior.')

    const zhOutput = renderToStaticMarkup(<IrisHeroControls {...({
      useIrisPreset: (select: (value: unknown) => unknown) => select({ options: [{ id: 'standard', name: '标准模式', description: '通用 Agent 模式。' }], current: 'standard', busy: false, error: null }),
      useIrisSettings: (select: (value: unknown) => unknown) => select(settingsScope.getSnapshot()),
      loadPreset: async () => undefined,
      selectPreset: async () => undefined,
      setEnabled: async () => undefined,
      t: (key: IrisLocaleKey) => zh[key],
    } as unknown as IrisHeroControlsProps)} />)
    expect(zhOutput).toContain('四种模式都从极简启动，需要时扩展能力。')
    expect(zhOutput).toContain('DeepSeek 原生方式。')
  })
})
