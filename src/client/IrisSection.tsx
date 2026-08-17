import { useState, useSyncExternalStore, type CSSProperties } from 'react'
import { Button, Pill, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

import type { CapabilityKind } from '../domain/index.js'
import type { ConfiguredPolicy, ConfiguredProvider, ResolvedIrisConfig } from '../config.js'
import type { IrisSessionSnapshot } from '../runtime/snapshot.js'
import type { IrisSnapshotController } from './controller.js'
import type { IrisLocaleKey } from './locales.js'
import type { IrisSettingsController } from './settings-controller.js'

export interface IrisSectionInjected {
  readonly controller: IrisSnapshotController
  readonly settings: IrisSettingsController
}

export type IrisSectionProps = PropsRuntime<'settings.section'>
  & PropsLocale<'iris'>
  & InjectFace<IrisSectionInjected>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    iris: IrisLocaleKey
  }
}

const panel: CSSProperties = {
  border: '1px solid var(--dsw-color-border-subtle, rgba(127,127,127,.2))',
  borderRadius: 14,
  padding: 18,
  background: 'var(--dsw-color-bg-elevated, rgba(127,127,127,.035))',
}
const grid: CSSProperties = { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }
const muted: CSSProperties = { color: 'var(--dsw-color-text-secondary, #777)', margin: 0, lineHeight: 1.55 }
const label: CSSProperties = { ...muted, fontSize: 12, letterSpacing: '.02em' }
const control: CSSProperties = {
  width: '100%', border: '1px solid var(--dsw-color-border-subtle, rgba(127,127,127,.24))',
  borderRadius: 9, padding: '9px 10px', background: 'var(--dsw-color-bg-primary, transparent)',
  color: 'inherit', font: 'inherit', boxSizing: 'border-box',
}

function metric(value: number | undefined): string {
  return value === undefined ? '—' : value.toLocaleString()
}

function SettingsControls({ settings, t }: { settings: IrisSettingsController; t: IrisSectionProps['t'] }) {
  const state = useSyncExternalStore(
    listener => settings.subscribe(listener),
    () => settings.getSnapshot(),
    () => settings.getSnapshot(),
  )
  const value = state.value
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ providerId: '', module: '', capabilityId: '', name: '', description: '', keywords: '', ptcCompatible: false })
  const writable = state.writable && value !== undefined
  const update = (field: keyof ResolvedIrisConfig, next: unknown) => { void settings.set(field, next) }
  const addProvider = () => {
    if (value === undefined || draft.providerId.trim() === '' || draft.module.trim() === '' || draft.capabilityId.trim() === '') return
    const provider: ConfiguredProvider = {
      id: draft.providerId.trim(),
      module: draft.module.trim(),
      capabilities: [{
        id: draft.capabilityId.trim(),
        kind: 'tool',
        ...draft.name.trim() === '' ? {} : { name: draft.name.trim() },
        ...draft.description.trim() === '' ? {} : { description: draft.description.trim() },
        keywords: draft.keywords.split(',').map(entry => entry.trim()).filter(Boolean),
        ptcCompatible: draft.ptcCompatible,
      }],
    }
    update('providers', [...value.providers, provider])
    setAdding(false)
    setDraft({ providerId: '', module: '', capabilityId: '', name: '', description: '', keywords: '', ptcCompatible: false })
  }

  return (
    <section style={panel} data-testid="iris-settings-controls">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'flex-start' }}>
        <div><h3 style={{ margin: 0 }}>{t('configuration')}</h3><p style={{ ...muted, marginTop: 6, fontSize: 13 }}>{t('configurationDescription')}</p></div>
        <StateDot state={value?.enabled === true ? 'done' : 'warning'} />
      </div>
      {state.status === 'loading' && <p style={{ ...muted, marginTop: 14 }}>{t('settingsLoading')}</p>}
      {state.status === 'error' && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 14 }}>
          <p style={muted} title={state.message}>{t('settingsError')}</p>
          <Button size="sm" variant="outline" onClick={() => { void settings.load() }}>{t('retry')}</Button>
        </div>
      )}
      {value !== undefined && (
        <>
          <div style={{ ...grid, marginTop: 18 }}>
            <label><span style={label}>{t('enabled')}</span><select style={control} value={value.enabled ? 'on' : 'off'} disabled={!writable} onChange={event => { update('enabled', event.target.value === 'on') }}><option value="on">{t('enabledOn')}</option><option value="off">{t('enabledOff')}</option></select></label>
            <label><span style={label}>{t('policy')}</span><select style={control} value={value.policy} disabled={!writable} onChange={event => { update('policy', event.target.value as ConfiguredPolicy) }}><option value="auto">{t('policyAuto')}</option><option value="preserve">{t('policyPreserve')}</option><option value="adaptive">{t('policyAdaptive')}</option><option value="adaptive-code">{t('policyCode')}</option><option value="adaptive-creator">{t('policyCreator')}</option></select></label>
            <label><span style={label}>{t('discovery')}</span><select style={control} value={value.discovery.enabled ? 'on' : 'off'} disabled={!writable} onChange={event => { update('discovery', { ...value.discovery, enabled: event.target.value === 'on' }) }}><option value="on">{t('enabledOn')}</option><option value="off">{t('enabledOff')}</option></select></label>
            <label><span style={label}>{t('logLevel')}</span><select style={control} value={value.logLevel} disabled={!writable} onChange={event => { update('logLevel', event.target.value) }}><option value="silent">silent</option><option value="info">info</option><option value="debug">debug</option></select></label>
            <label><span style={label}>{t('cacheTtl')}</span><select style={control} value={String(value.discovery.cacheTtlMs)} disabled={!writable} onChange={event => { update('discovery', { ...value.discovery, cacheTtlMs: Number(event.target.value) }) }}><option value="300000">5 min</option><option value="900000">15 min</option><option value="3600000">60 min</option></select></label>
            <label><span style={label}>{t('maxResults')}</span><select style={control} value={String(value.discovery.maxResults)} disabled={!writable} onChange={event => { update('discovery', { ...value.discovery, maxResults: Number(event.target.value) }) }}>{[5, 10, 20, 50].map(count => <option key={count} value={String(count)}>{count}</option>)}</select></label>
          </div>
          <div style={{ marginTop: 22 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}><div><strong>{t('providers')}</strong><p style={{ ...muted, marginTop: 4, fontSize: 12 }}>{t('providersDescription')}</p></div><Button size="sm" variant="outline" disabled={!writable} onClick={() => { setAdding(value => !value) }}>{adding ? t('cancel') : t('addProvider')}</Button></div>
            <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
              {value.providers.length === 0 && <p style={muted}>{t('noProviders')}</p>}
              {value.providers.map(provider => (
                <div key={provider.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', padding: '10px 12px', borderRadius: 9, background: 'rgba(127,127,127,.06)' }}>
                  <span><strong>{provider.id}</strong><span style={{ ...muted, display: 'block', fontSize: 12 }}>{provider.module} · {provider.capabilities.map(capability => capability.id).join(', ')}</span></span>
                  <Button size="sm" variant="outline" disabled={!writable} onClick={() => { update('providers', value.providers.filter(candidate => candidate.id !== provider.id)) }}>{t('remove')}</Button>
                </div>
              ))}
            </div>
            {adding && (
              <div style={{ ...grid, marginTop: 14 }}>
                <label><span style={label}>{t('providerId')}</span><input style={control} value={draft.providerId} onChange={event => { setDraft({ ...draft, providerId: event.target.value }) }} /></label>
                <label><span style={label}>{t('modulePath')}</span><input style={control} value={draft.module} onChange={event => { setDraft({ ...draft, module: event.target.value }) }} /></label>
                <label><span style={label}>{t('capabilityId')}</span><input style={control} value={draft.capabilityId} onChange={event => { setDraft({ ...draft, capabilityId: event.target.value }) }} /></label>
                <label><span style={label}>{t('capabilityName')}</span><input style={control} value={draft.name} onChange={event => { setDraft({ ...draft, name: event.target.value }) }} /></label>
                <label><span style={label}>{t('description')}</span><input style={control} value={draft.description} onChange={event => { setDraft({ ...draft, description: event.target.value }) }} /></label>
                <label><span style={label}>{t('keywords')}</span><input style={control} value={draft.keywords} onChange={event => { setDraft({ ...draft, keywords: event.target.value }) }} /></label>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={draft.ptcCompatible} onChange={event => { setDraft({ ...draft, ptcCompatible: event.target.checked }) }} />{t('ptcCompatible')}</label>
                <div><Button size="sm" disabled={!writable} onClick={addProvider}>{t('saveProvider')}</Button></div>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  )
}

function ModeCards({ snapshot, t }: { snapshot: IrisSessionSnapshot; t: IrisSectionProps['t'] }) {
  const modes = [
    ['minimal', 'minimal', 'minimalDescription'],
    ['standard', 'standard', 'standardDescription'],
    ['code', 'code', 'codeDescription'],
    ['cordis', 'creator', 'creatorDescription'],
  ] as const
  return (
    <section>
      <h3>{t('fourModes')}</h3>
      <div style={grid}>
        {modes.map(([id, title, description]) => {
          const active = snapshot.mode === id
          return (
            <article key={id} style={{ ...panel, borderColor: active ? 'var(--dsw-color-accent, #6d5dfc)' : undefined }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <StateDot state={active ? 'ongoing' : 'done'} />
                <strong>{t(title)}</strong>
                {active && <Pill active>{t('active')}</Pill>}
              </div>
              <p style={{ ...muted, marginTop: 10, fontSize: 13 }}>{t(description)}</p>
            </article>
          )
        })}
      </div>
    </section>
  )
}

function Aperture({ snapshot, t }: { snapshot: IrisSessionSnapshot; t: IrisSectionProps['t'] }) {
  const keptReady = snapshot.availableCapabilityCount === 0
    ? 0
    : Math.round(snapshot.hiddenCapabilityCount / snapshot.availableCapabilityCount * 100)
  return (
    <section style={panel}>
      <h3 style={{ marginTop: 0 }}>{t('currentAperture')}</h3>
      <div style={grid}>
        <div><p style={label}>{t('mode')}</p><strong>{snapshot.mode}</strong></div>
        <div><p style={label}>{t('strategy')}</p><strong>{snapshot.strategy}</strong></div>
        <div><p style={label}>{t('status')}</p><strong>{t('active')}</strong></div>
        <div><p style={label}>{t('ceiling')}</p><strong>{snapshot.availableCapabilityCount}</strong></div>
        <div><p style={label}>{t('visibleCapabilities')}</p><strong>{snapshot.visibleToolCount}</strong></div>
        <div><p style={label}>{t('readyCapabilities')}</p><strong>{snapshot.hiddenCapabilityCount}</strong></div>
        <div><p style={label}>{t('reasoningOwner')}</p><strong>{snapshot.reasoningOwner}</strong></div>
      </div>
      <p style={{ ...muted, marginTop: 16, fontSize: 13 }}>{t('surfaceEvidence').replace('{percent}', String(keptReady)).replace('{hidden}', String(snapshot.hiddenCapabilityCount)).replace('{total}', String(snapshot.availableCapabilityCount))}</p>
      <div style={{ marginTop: 18, display: 'grid', gap: 9 }}>
        {snapshot.packs.map(pack => (
          <div key={pack.id} style={{ display: 'grid', gridTemplateColumns: '16px minmax(120px,1fr) auto', gap: 9, alignItems: 'center' }}>
            <StateDot state={pack.status === 'revealed' ? 'done' : pack.status === 'ready' ? 'ongoing' : 'warning'} />
            <span>{pack.id}</span>
            <span style={label}>{pack.status === 'revealed' ? t('visible') : t(pack.status)}</span>
          </div>
        ))}
      </div>
      <div style={{ ...grid, marginTop: 18 }}>
        <div><p style={label}>{t('schemaChars')}</p><strong>{metric(snapshot.visibleSchemaChars)}</strong></div>
        <div><p style={label}>{t('promptChars')}</p><strong>{metric(snapshot.promptChars)}</strong></div>
        <div><p style={label}>{t('sdkChars')}</p><strong>{metric(snapshot.codeSdkChars)}</strong></div>
      </div>
    </section>
  )
}

function CapabilityList({ snapshot, t }: { snapshot: IrisSessionSnapshot; t: IrisSectionProps['t'] }) {
  const [kind, setKind] = useState<'all' | CapabilityKind>('all')
  const capabilities = snapshot.capabilities.filter(capability => kind === 'all' || capability.kind === kind)
  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <h3>{t('capabilitySurface')}</h3>
        <div style={{ display: 'flex', gap: 7 }}>
          {(['all', 'tool', 'skill', 'mcp'] as const).map(value => (
            <Pill key={value} active={kind === value} onClick={() => { setKind(value) }}>{t(value)}</Pill>
          ))}
        </div>
      </div>
      <div style={{ ...panel, padding: 0, overflow: 'hidden' }}>
        {capabilities.map((capability, index) => (
          <div key={capability.id} style={{ padding: '13px 16px', borderTop: index === 0 ? undefined : '1px solid var(--dsw-color-border-subtle, rgba(127,127,127,.16))' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
              <StateDot state={capability.status === 'visible' ? 'done' : capability.status === 'staged' ? 'ongoing' : 'warning'} />
              <strong style={{ fontFamily: 'var(--dsw-font-mono, ui-monospace)', fontSize: 13 }}>{capability.id}</strong>
              <Pill>{t(capability.kind)}</Pill><Pill active={capability.status === 'visible'}>{t(capability.status)}</Pill>
            </div>
            {capability.description !== undefined && (
              <p style={{ ...muted, marginTop: 7, fontSize: 12 }}>{capability.description}</p>
            )}
            <p style={{ ...muted, marginTop: 5, fontSize: 11 }}>
              {`${capability.origin} · ${capability.pack} · ${capability.route.kind}`}
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}

function RecentReveals({ snapshot, t }: { snapshot: IrisSessionSnapshot; t: IrisSectionProps['t'] }) {
  return (
    <section>
      <h3>{t('recentReveals')}</h3>
      {snapshot.transitions.length === 0 ? <p style={muted}>{t('noTransitions')}</p> : (
        <div style={panel}>
          {[...snapshot.transitions].reverse().map(transition => (
            <div key={transition.sequence} style={{ display: 'flex', gap: 10, padding: '7px 0', alignItems: 'center' }}>
              <StateDot state="done" /><strong>{transition.pack}</strong><span style={muted}>{transition.reason}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

/** DSH Settings section backed only by the Host snapshot controller. */
export function IrisSection({ controller, settings, t }: IrisSectionProps) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const snapshot = state.snapshot
  return (
    <div style={{ display: 'grid', gap: 28, maxWidth: 980, paddingBottom: 40 }} data-testid="iris-settings">
      <header style={{ padding: '12px 0 2px' }}>
        <p style={{ ...label, marginBottom: 8 }}>◉ {t('title')}</p>
        <h2 style={{ fontSize: 31, margin: 0, letterSpacing: '-.035em' }}>{t('tagline')}</h2>
        <p style={{ ...muted, marginTop: 8, fontSize: 16 }}>{t('subtitle')}</p>
        <div style={{ marginTop: 16 }}><Button variant="outline" size="sm" onClick={() => { void controller.refresh() }}>{t('refresh')}</Button></div>
      </header>
      <SettingsControls settings={settings} t={t} />
      {state.phase === 'loading' && snapshot === undefined && <p style={muted}>{t('loading')}</p>}
      {state.phase === 'error' && snapshot === undefined && (
        <p role="alert" title={state.message} style={muted}>{t('error')}</p>
      )}
      {snapshot?.enabled === false && <section style={panel}><p style={muted}>{t('inactive')}</p></section>}
      {snapshot?.enabled === true && (
        <>
          <Aperture snapshot={snapshot} t={t} />
          <ModeCards snapshot={snapshot} t={t} />
          <CapabilityList snapshot={snapshot} t={t} />
          <RecentReveals snapshot={snapshot} t={t} />
        </>
      )}
    </div>
  )
}
