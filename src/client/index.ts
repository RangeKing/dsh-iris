import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import type { ClientContext, ISessions } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import irisRemote from 'dsh-iris/remote'

import { IrisSnapshotController } from './controller.js'
import { IrisHeroPresetController } from './hero-controller.js'
import { IrisHeroControls } from './IrisHeroControls.js'
import { IrisSection } from './IrisSection.js'
import { en, zh } from './locales.js'
import { IrisSettingsController } from './settings-controller.js'

export { IrisSnapshotController } from './controller.js'
export { IrisSettingsController } from './settings-controller.js'
export { IrisSection } from './IrisSection.js'
export { en, zh } from './locales.js'

const NS = 'iris'

export const inject = ['remote']

const UI_INJECT = ['slots', 'sessions', 'remote.iris', 'locale', 'connection']

function startUi(ctx: ClientContext): () => void {
  const controller = new IrisSnapshotController(async (agentId) => {
    const result = await ctx.remote.iris.snapshot(agentId)
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  })
  const sessions = ctx.sessions as unknown as ISessions
  const connection = ctx.get('connection') as ConnectionHandle
  const settings = new IrisSettingsController(
    async () => {
      const result = await ctx.remote.iris.config()
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    },
    async (patch) => {
      const result = await ctx.remote.iris.updateConfig(patch)
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    },
  )
  const preset = new IrisHeroPresetController(connection.api, () => {
    const state = sessions.list.getSnapshot()
    const summary = state.current === undefined ? undefined : state.byId[state.current]
    return summary === undefined ? undefined : {
      id: summary.id,
      blank: summary.blank,
      ...summary.agentPreset === undefined ? {} : { agentPreset: summary.agentPreset },
    }
  }, (sessionId, agentPreset) => {
    sessions.noteAgentPreset(sessionId as never, agentPreset)
  })
  const syncAgent = () => {
    controller.setAgent(sessions.list.getSnapshot().current ?? null)
    void preset.apply()
  }
  const stopSessions = sessions.list.subscribe(syncAgent)
  ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'dsh-iris.client.locale')
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'iris',
    order: 25,
    label: () => t('nav'),
    locale: NS,
    inject: () => ({ controller, settings }),
  }, IrisSection))
  ctx.slots.inject('conversation.hero.agentPreset', () => ctx.slots.register({
    name: 'conversation.hero.agentPreset',
    priority: -10,
    locale: NS,
    inject: () => ({
      hooks: { irisPreset: preset.store, irisSettings: settings },
      loadPreset: () => preset.load(),
      selectPreset: (id: string) => preset.select(id),
      setEnabled: (enabled: boolean) => settings.set('enabled', enabled),
    }),
  }, IrisHeroControls))
  syncAgent()
  void settings.load()
  return () => {
    stopSessions()
    controller.dispose()
    void settings.dispose()
  }
}

/** Mount the package-owned Remote contribution and register Settings → Iris. */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(irisRemote)
  const ui = ctx.plugin(Object.assign(startUi, { inject: UI_INJECT }))
  try {
    await ui
  } catch (error) {
    await ui.dispose()
    await disposeRemote()
    throw error
  }
  return async () => {
    await ui.dispose()
    await disposeRemote()
  }
}
