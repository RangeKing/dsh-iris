import type { CapabilityDescriptor } from '../domain/index.js'
import type { PolicyPresetIdentity } from '../policy/index.js'
import type { IrisPolicyId } from '../policy/index.js'

export type IrisModePolicyId = 'preserve' | 'adaptive' | 'adaptive-code' | 'adaptive-creator'
export type ConfiguredIrisModePolicy = 'auto' | IrisModePolicyId

export interface IrisModePolicy {
  readonly id: IrisModePolicyId
  readonly resolutionPolicy: IrisPolicyId
  readonly reasoningScaffold: 'native' | 'minimal'
  readonly initialSurface: 'preserve-native' | 'core-plus-iris-controls'
  readonly search: boolean
  readonly activationTiming: 'disabled' | 'between-steps'
  readonly visibilityCommit: 'immediate' | 'next-assembly'
  readonly remoteDiscovery: 'disabled' | 'metadata-only'
  readonly creation: 'disabled' | 'fallback'
  readonly requirePtcCompatibility: boolean
  canActivate(capability: CapabilityDescriptor): boolean
  canReveal(capability: CapabilityDescriptor): boolean
  isPinned(capability: CapabilityDescriptor): boolean
}

function trustedLocalTool(capability: CapabilityDescriptor): boolean {
  return capability.kind === 'tool' && (
    (capability.source === 'local' && capability.trust === 'trusted')
    || (capability.source === 'builtin' && capability.trust === 'builtin')
  )
}

function irisControl(capability: CapabilityDescriptor): boolean {
  return capability.name === 'iris_search'
    || capability.name === 'iris_recommend'
    || capability.name === 'iris_activate'
}

const POLICIES: Readonly<Record<IrisModePolicyId, IrisModePolicy>> = {
  preserve: {
    id: 'preserve',
    resolutionPolicy: 'observe',
    reasoningScaffold: 'native',
    initialSurface: 'preserve-native',
    search: false,
    activationTiming: 'disabled',
    visibilityCommit: 'immediate',
    remoteDiscovery: 'disabled',
    creation: 'disabled',
    requirePtcCompatibility: false,
    canActivate: () => false,
    canReveal: () => false,
    isPinned: () => false,
  },
  adaptive: {
    id: 'adaptive',
    resolutionPolicy: 'resolve',
    reasoningScaffold: 'minimal',
    initialSurface: 'core-plus-iris-controls',
    search: true,
    activationTiming: 'between-steps',
    visibilityCommit: 'immediate',
    remoteDiscovery: 'metadata-only',
    creation: 'disabled',
    requirePtcCompatibility: false,
    canActivate: trustedLocalTool,
    canReveal: trustedLocalTool,
    isPinned: irisControl,
  },
  'adaptive-code': {
    id: 'adaptive-code',
    resolutionPolicy: 'compose',
    reasoningScaffold: 'minimal',
    initialSurface: 'core-plus-iris-controls',
    search: true,
    activationTiming: 'between-steps',
    visibilityCommit: 'next-assembly',
    remoteDiscovery: 'metadata-only',
    creation: 'disabled',
    requirePtcCompatibility: true,
    canActivate: capability => trustedLocalTool(capability) && capability.ptcCompatible === true,
    canReveal: capability => trustedLocalTool(capability) && capability.ptcCompatible === true,
    isPinned: irisControl,
  },
  'adaptive-creator': {
    id: 'adaptive-creator',
    resolutionPolicy: 'evolve',
    reasoningScaffold: 'minimal',
    initialSurface: 'core-plus-iris-controls',
    search: true,
    activationTiming: 'between-steps',
    visibilityCommit: 'immediate',
    remoteDiscovery: 'metadata-only',
    creation: 'fallback',
    requirePtcCompatibility: false,
    canActivate: trustedLocalTool,
    canReveal: trustedLocalTool,
    isPinned: irisControl,
  },
}

export function irisModePolicyFor(id: IrisModePolicyId): IrisModePolicy {
  return POLICIES[id]
}

export function selectIrisModePolicy(
  preset: PolicyPresetIdentity,
  config: { readonly policy: ConfiguredIrisModePolicy },
): IrisModePolicy {
  if (config.policy !== 'auto') return irisModePolicyFor(config.policy)
  switch (preset.builtinKind) {
    case 'minimal': return POLICIES.preserve
    case 'standard': return POLICIES.adaptive
    case 'ptc': return POLICIES['adaptive-code']
    case 'creation': return POLICIES['adaptive-creator']
    case 'custom': return POLICIES.preserve
  }
}
