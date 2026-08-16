import type { ClientContext, ISessions } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import irisRemote from 'dsh-iris/remote'

import { IrisSnapshotController } from './controller.js'
import { IrisSection } from './IrisSection.js'
import { en, zh } from './locales.js'

export { IrisSnapshotController } from './controller.js'
export { IrisSection } from './IrisSection.js'
export { en, zh } from './locales.js'

const NS = 'iris'

export const inject = ['remote']

const UI_INJECT = ['slots', 'sessions', 'remote.iris', 'locale']

function startUi(ctx: ClientContext): () => void {
  const controller = new IrisSnapshotController(async (agentId) => {
    const result = await ctx.remote.iris.snapshot(agentId)
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  })
  const sessions = ctx.sessions as unknown as ISessions
  const syncAgent = () => {
    controller.setAgent(sessions.list.getSnapshot().current ?? null)
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
    inject: () => ({ controller }),
  }, IrisSection))
  syncAgent()
  return () => {
    stopSessions()
    controller.dispose()
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
