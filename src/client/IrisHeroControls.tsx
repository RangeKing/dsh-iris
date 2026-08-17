import { useEffect, useState } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import {
  IconAgentPresetOutline16,
  IconChevronDownOutline14,
  IconSparkle16,
  Menu,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'

import type { IrisHeroPresetState } from './hero-controller.js'
import type { IrisSettingsController } from './settings-controller.js'

export interface IrisHeroInjected {
  readonly hooks: {
    readonly irisPreset: SnapshotStore<IrisHeroPresetState>
    readonly irisSettings: IrisSettingsController
  }
  readonly loadPreset: () => Promise<void>
  readonly selectPreset: (id: string) => Promise<void>
  readonly setEnabled: (enabled: boolean) => Promise<void>
}

export type IrisHeroControlsProps = PropsRuntime<'conversation.hero.agentPreset'>
  & PropsLocale<'iris'>
  & InjectFace<IrisHeroInjected>

const row = { display: 'inline-flex', alignItems: 'center', gap: 4 } as const
const chip = {
  display: 'inline-flex', alignItems: 'center', gap: 7, border: 0, borderRadius: 8,
  padding: '7px 9px', background: 'transparent', color: 'inherit', cursor: 'pointer',
  font: 'inherit', lineHeight: 1.2,
} as const
const menuText = { display: 'grid', gap: 3, minWidth: 210 } as const
const description = { color: 'var(--dsw-color-text-secondary, #8b8b91)', fontSize: 12, lineHeight: 1.35 } as const

/** Composite public hero seat: preserves DSH mode selection and adds Iris enablement beside it. */
export function IrisHeroControls({
  useIrisPreset,
  useIrisSettings,
  loadPreset,
  selectPreset,
  setEnabled,
  t,
}: IrisHeroControlsProps) {
  const preset = useIrisPreset(value => value)
  const settings = useIrisSettings(value => value)
  const [presetOpen, setPresetOpen] = useState(false)
  const [irisOpen, setIrisOpen] = useState(false)

  useEffect(() => { void loadPreset() }, [loadPreset])

  const selected = preset.options.find(option => option.id === preset.current)
  const enabled = settings.value?.enabled ?? true
  return (
    <span style={row} data-testid="iris-hero-controls">
      {preset.options.length > 0 && (
        <Menu
          open={presetOpen}
          onClose={() => { setPresetOpen(false) }}
          items={preset.options.map(option => ({
            id: option.id,
            label: (
              <span style={menuText}>
                <strong>{option.name ?? option.id}</strong>
                <span style={description}>{option.description ?? t('presetNoDescription')}</span>
              </span>
            ),
          }))}
          selectedId={preset.current}
          onSelect={(id) => { setPresetOpen(false); void selectPreset(id) }}
          portal
          anchor={(
            <button type="button" style={chip} disabled={preset.busy} title={preset.error ?? t('presetHint')} onClick={() => { setPresetOpen(value => !value) }}>
              <IconAgentPresetOutline16 />
              <span>{selected?.name ?? preset.current}</span>
              <IconChevronDownOutline14 />
            </button>
          )}
        />
      )}
      <Menu
        open={irisOpen}
        onClose={() => { setIrisOpen(false) }}
        items={[
          {
            id: 'enabled',
            label: <span style={menuText}><strong>{t('irisEnabled')}</strong><span style={description}>{t('irisEnabledDescription')}</span></span>,
          },
          {
            id: 'disabled',
            label: <span style={menuText}><strong>{t('irisDisabled')}</strong><span style={description}>{t('irisDisabledDescription')}</span></span>,
          },
        ]}
        selectedId={enabled ? 'enabled' : 'disabled'}
        onSelect={(id) => { setIrisOpen(false); void setEnabled(id === 'enabled') }}
        portal
        anchor={(
          <button type="button" style={chip} aria-label={t('irisToggle')} title={t('irisToggleHint')} disabled={!settings.writable} onClick={() => { setIrisOpen(value => !value) }}>
            <IconSparkle16 />
            <span>{enabled ? t('irisOn') : t('irisOff')}</span>
            <IconChevronDownOutline14 />
          </button>
        )}
      />
    </span>
  )
}
