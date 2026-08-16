import { useState, useSyncExternalStore, type CSSProperties } from 'react'
import { Button, Pill, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

import type { CapabilityKind } from '../domain/index.js'
import type { IrisSessionSnapshot } from '../runtime/snapshot.js'
import type { IrisSnapshotController } from './controller.js'
import type { IrisLocaleKey } from './locales.js'

export interface IrisSectionInjected {
  readonly controller: IrisSnapshotController
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

function metric(value: number | undefined): string {
  return value === undefined ? '—' : value.toLocaleString()
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
      </div>
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
export function IrisSection({ controller, t }: IrisSectionProps) {
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
