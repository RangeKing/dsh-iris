import type { CapabilityRequirement } from '../domain/index.js'

export interface PluginCandidate {
  readonly id: string
  readonly repository: string
  readonly url: string
  readonly description?: string
  readonly topics: readonly string[]
  readonly updatedAt: string
  readonly pushedAt: string
  readonly stars: number
  readonly ptcCompatible?: boolean
}

export interface RankedPluginCandidate extends PluginCandidate {
  readonly score: number
  readonly reasons: readonly string[]
}

export interface PluginFinderOptions {
  readonly preferPtc?: boolean
}

export interface PluginFinder {
  find(
    requirement: CapabilityRequirement,
    options?: PluginFinderOptions,
  ): Promise<readonly RankedPluginCandidate[]>
}
