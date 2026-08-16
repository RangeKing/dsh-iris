import z from '@deepseek-ai/schemastery'

import type { ConfiguredIrisModePolicy } from './capabilities/index.js'
export type ConfiguredPolicy = ConfiguredIrisModePolicy
export type IrisLogLevel = 'silent' | 'info' | 'debug'

export interface ConfiguredCapability {
  id: string
  name?: string
  description?: string
  keywords?: string[]
  kind: 'tool' | 'skill'
  ptcCompatible?: boolean
  permissions?: string[]
}

export interface ConfiguredProvider {
  id: string
  module: string
  capabilities: ConfiguredCapability[]
}

export interface DiscoveryConfig {
  enabled?: boolean
  cacheTtlMs?: number
  maxResults?: number
}

export interface IrisBundleConfig {
  enabled?: boolean
  policy?: ConfiguredPolicy
  providers?: ConfiguredProvider[]
  logLevel?: IrisLogLevel
  discovery?: DiscoveryConfig
}

export interface Config {
  iris?: IrisBundleConfig
}

export interface ResolvedDiscoveryConfig {
  readonly enabled: boolean
  readonly cacheTtlMs: number
  readonly maxResults: number
}

export interface ResolvedIrisConfig {
  readonly enabled: boolean
  readonly policy: ConfiguredPolicy
  readonly providers: readonly ConfiguredProvider[]
  readonly logLevel: IrisLogLevel
  readonly discovery: ResolvedDiscoveryConfig
}

export interface ResolvedConfig {
  readonly iris: ResolvedIrisConfig
}

const CapabilityConfig: z<ConfiguredCapability> = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  keywords: z.array(z.string().min(1)),
  kind: z.union(['tool', 'skill'] as const),
  ptcCompatible: z.boolean(),
  permissions: z.array(z.string().min(1)),
})

const ProviderConfig: z<ConfiguredProvider> = z.object({
  id: z.string().min(1),
  module: z.string().min(1),
  capabilities: z.array(CapabilityConfig),
})

const DiscoveryConfigSchema: z<DiscoveryConfig> = z.object({
  enabled: z.boolean().default(true),
  cacheTtlMs: z.number().min(0).default(900_000),
  maxResults: z.number().min(1).max(100).default(10),
}).default({} as never)

const IrisConfigSchema: z<IrisBundleConfig> = z.object({
  enabled: z.boolean().default(true),
  policy: z.union(['auto', 'preserve', 'adaptive', 'adaptive-code', 'adaptive-creator'] as const).default('auto'),
  providers: z.array(ProviderConfig).default([]),
  logLevel: z.union(['silent', 'info', 'debug'] as const).default('info'),
  discovery: DiscoveryConfigSchema,
}).default({} as never)

/** Loader-visible DSH Bundle configuration schema. */
export const Config: z<Config> = z.object({
  iris: IrisConfigSchema,
}).default({} as never)

export function resolveConfig(config: Config = {}): ResolvedConfig {
  return Config(config) as ResolvedConfig
}
