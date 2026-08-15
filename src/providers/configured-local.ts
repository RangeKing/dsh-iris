import type { Plugin } from '@deepseek-ai/cordis'
import { isAbsolute, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import type { ConfiguredProvider } from '../config.js'
import type {
  CapabilityCandidate,
  CapabilityId,
  CapabilityRequirement,
} from '../domain/index.js'
import type { LocalToolProvider } from '../dsh/local-tool-recovery.js'

type ImportedProvider = Plugin | { readonly default?: Plugin }

export interface LocalProviderCatalog {
  list(): readonly CapabilityCandidate[]
  find(requirement: CapabilityRequirement): readonly CapabilityCandidate[]
  load(candidate: CapabilityCandidate): Promise<LocalToolProvider>
}

export interface ConfiguredLocalProviderCatalogOptions {
  readonly cwd?: string
  readonly importModule?: (specifier: string) => Promise<ImportedProvider>
}

interface CatalogEntry {
  readonly declaration: ConfiguredProvider
  readonly candidate: CapabilityCandidate
  readonly specifier: string
}

function capabilityId(kind: 'tool' | 'skill', id: string): CapabilityId {
  return id.startsWith(`${kind}:`) ? id : `${kind}:${id}`
}

function capabilityName(kind: 'tool' | 'skill', id: string, name?: string): string {
  if (name !== undefined) return name
  return id.startsWith(`${kind}:`) ? id.slice(kind.length + 1) : id
}

function moduleSpecifier(location: string, cwd: string): string {
  if (location.startsWith('file:')) return location
  if (isAbsolute(location)) return pathToFileURL(location).href
  if (location.startsWith('./') || location.startsWith('../')) {
    return pathToFileURL(resolve(cwd, location)).href
  }
  return location
}

function pluginFrom(module: ImportedProvider): Plugin {
  if ('default' in module && module.default !== undefined) return module.default
  return module as Plugin
}

/** Indexes trusted config declarations and imports provider code only after Policy selects it. */
export class ConfiguredLocalProviderCatalog implements LocalProviderCatalog {
  private readonly entries: readonly CatalogEntry[]
  private readonly imports = new Map<string, Promise<Plugin>>()
  private readonly importModule: (specifier: string) => Promise<ImportedProvider>

  constructor(
    declarations: readonly ConfiguredProvider[],
    options: ConfiguredLocalProviderCatalogOptions = {},
  ) {
    const cwd = options.cwd ?? process.cwd()
    this.importModule = options.importModule ?? (specifier => import(specifier))
    const providerIds = new Set<string>()
    const capabilityOwners = new Set<string>()
    const entries: CatalogEntry[] = []
    for (const declaration of declarations) {
      if (providerIds.has(declaration.id)) {
        throw new Error(`dsh-iris: duplicate configured provider id "${declaration.id}"`)
      }
      providerIds.add(declaration.id)
      const specifier = moduleSpecifier(declaration.module, cwd)
      for (const capability of declaration.capabilities) {
        const id = capabilityId(capability.kind, capability.id)
        const ownershipKey = `${declaration.id}:${id}`
        if (capabilityOwners.has(ownershipKey)) {
          throw new Error(`dsh-iris: provider "${declaration.id}" declares "${id}" more than once`)
        }
        capabilityOwners.add(ownershipKey)
        entries.push({
          declaration,
          specifier,
          candidate: {
            availability: 'local',
            capability: {
              id,
              kind: capability.kind,
              name: capabilityName(capability.kind, capability.id, capability.name),
              ...capability.description === undefined ? {} : { description: capability.description },
              ...capability.keywords === undefined ? {} : { keywords: capability.keywords },
              source: 'local',
              trust: 'trusted',
              providerId: declaration.id,
              provenance: { kind: 'configured-local', reference: specifier },
              ...capability.ptcCompatible === undefined
                ? {}
                : { ptcCompatible: capability.ptcCompatible },
              ...capability.permissions === undefined
                ? {}
                : { permissions: capability.permissions },
            },
            evidence: [{ source: 'catalog', detail: `configured provider:${declaration.id}` }],
          },
        })
      }
    }
    this.entries = entries
  }

  list(): readonly CapabilityCandidate[] {
    return this.entries.map(entry => entry.candidate)
  }

  find(requirement: CapabilityRequirement): readonly CapabilityCandidate[] {
    return this.entries
      .filter(({ candidate }) => candidate.capability.kind === requirement.kind
        && (candidate.capability.id === requirement.id
          || candidate.capability.name === requirement.requestedName))
      .map(entry => entry.candidate)
  }

  async load(candidate: CapabilityCandidate): Promise<LocalToolProvider> {
    if (candidate.capability.kind !== 'tool') {
      throw new Error('dsh-iris: live provider loading currently supports Tool capabilities only')
    }
    const entry = this.entries.find(item => item.candidate.capability.id === candidate.capability.id
      && item.candidate.capability.providerId === candidate.capability.providerId)
    if (entry === undefined) {
      throw new Error(`dsh-iris: candidate "${candidate.capability.id}" is not owned by this catalog`)
    }
    let loading = this.imports.get(entry.specifier)
    if (loading === undefined) {
      loading = this.importModule(entry.specifier).then(pluginFrom)
      this.imports.set(entry.specifier, loading)
      void loading.catch(() => { this.imports.delete(entry.specifier) })
    }
    const plugin = await loading
    return {
      candidate: entry.candidate,
      mount: {
        capabilityId: entry.candidate.capability.name,
        plugin,
        loaderSpecifier: entry.specifier,
      },
    }
  }
}
