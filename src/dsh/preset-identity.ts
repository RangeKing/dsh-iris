import type { Context } from '@deepseek-ai/cordis'

export interface AgentPresetIdentity {
  readonly id: string
  readonly source?: string
  readonly builtinKind: 'standard' | 'ptc' | 'minimal' | 'creation' | 'custom'
}

interface PresetObservation {
  readonly id: string
  readonly trust: 'system' | 'user'
  readonly path?: string
}

interface AgentPresetSurface {
  composedPreset(agentCtx: Context): string | undefined
  resolve(id: string): Promise<PresetObservation>
}

interface SessionObservation {
  readonly header: { readonly agentPreset?: string }
  readonly events: readonly unknown[]
}

const BUILTIN_KINDS: Readonly<Record<string, AgentPresetIdentity['builtinKind']>> = {
  standard: 'standard',
  code: 'ptc',
  minimal: 'minimal',
  cordis: 'creation',
}

export const DSH_BUILTIN_PRESET_IDS = Object.freeze({
  standard: 'standard',
  ptc: 'code',
  minimal: 'minimal',
  creation: 'cordis',
} as const)

function serviceOf<T>(ctx: Context, name: string): T | undefined {
  return (ctx as unknown as { get(name: string): unknown }).get(name) as T | undefined
}

function sessionPreset(session: SessionObservation | undefined): string | undefined {
  if (session === undefined) return undefined
  for (let index = session.events.length - 1; index >= 0; index -= 1) {
    const event = session.events[index]
    if (event === null || typeof event !== 'object') continue
    const observation = event as {
      readonly type?: unknown
      readonly data?: { readonly agentPreset?: unknown }
    }
    if (observation.type === 'agent-preset/selected'
      && typeof observation.data?.agentPreset === 'string') {
      return observation.data.agentPreset
    }
  }
  return session.header.agentPreset
}

/**
 * Read the live joined preset first; durable session metadata is a narrow,
 * custom-only fallback when the roster seam is unavailable.
 */
export async function readAgentPresetIdentity(
  agentCtx: Context,
): Promise<AgentPresetIdentity> {
  const presets = serviceOf<AgentPresetSurface>(agentCtx, 'agentPresets')
  const liveId = presets?.composedPreset(agentCtx)
  if (liveId !== undefined && presets !== undefined) {
    try {
      const preset = await presets.resolve(liveId)
      return {
        id: liveId,
        ...preset.path === undefined ? {} : { source: preset.path },
        builtinKind: preset.trust === 'system'
          ? BUILTIN_KINDS[liveId] ?? 'custom'
          : 'custom',
      }
    } catch {
      return { id: liveId, source: 'live-scope', builtinKind: 'custom' }
    }
  }

  const agent = (agentCtx as unknown as {
    readonly agent?: { readonly session?: SessionObservation }
  }).agent
  const durableId = sessionPreset(agent?.session)
  if (durableId !== undefined) {
    return { id: durableId, source: 'session-metadata', builtinKind: 'custom' }
  }
  throw new Error('dsh-iris: current Agent has no observable preset identity')
}
