import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { isModelInvocable, type SkillSummary } from '@deepseek-ai/dsh-skill'

import type {
  CapabilityDescriptor,
  CapabilitySnapshot,
  CapabilitySource,
  CapabilityTrust,
} from '../domain/index.js'

interface AgentIdentity {
  readonly id: string
}

interface ToolSchemaObservation {
  readonly name: string
}

interface ToolSurface {
  schemas(scope?: object): readonly ToolSchemaObservation[]
}

interface SkillSurface {
  snapshot(options?: {
    readonly cwd?: string
    readonly scope?: object
    readonly signal?: AbortSignal
  }): Promise<{
    readonly skills: readonly SkillSummary[]
    readonly complete: boolean
  }>
}

function serviceOf<T>(ctx: Context, name: string): T | undefined {
  return (ctx as unknown as { get(name: string): unknown }).get(name) as T | undefined
}

function ownerOf(agentCtx: Context): AgentIdentity {
  const agent = (agentCtx as unknown as { readonly agent?: AgentIdentity }).agent
  if (agent === undefined) {
    throw new Error('dsh-iris: capability snapshot requires agentCtx.agent')
  }
  return agent
}

function skillProvenance(source: string): {
  source: CapabilitySource
  trust: CapabilityTrust
} {
  return source === 'bundled'
    ? { source: 'builtin', trust: 'builtin' }
    : { source: 'local', trust: 'known' }
}

function compareCapability(
  left: CapabilityDescriptor,
  right: CapabilityDescriptor,
): number {
  const leftKey = `${left.kind}:${left.id}`
  const rightKey = `${right.kind}:${right.id}`
  if (leftKey < rightKey) return -1
  if (leftKey > rightKey) return 1
  return 0
}

function canonicalDescriptor(capability: CapabilityDescriptor): object {
  return {
    id: capability.id,
    kind: capability.kind,
    name: capability.name,
    source: capability.source,
    trust: capability.trust,
    providerId: capability.providerId ?? null,
    version: capability.version ?? null,
    ptcCompatible: capability.ptcCompatible ?? null,
    permissions: capability.permissions === undefined
      ? null
      : [...capability.permissions].sort(),
  }
}

/** Stable content hash for a capability set; Agent identity is deliberately excluded. */
export function capabilitySnapshotVersion(
  tools: readonly CapabilityDescriptor[],
  skills: readonly CapabilityDescriptor[],
): string {
  const canonical = JSON.stringify({
    tools: [...tools].sort(compareCapability).map(canonicalDescriptor),
    skills: [...skills].sort(compareCapability).map(canonicalDescriptor),
  })
  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`
}

/** Read the current Agent's authoritative DSH tool and skill surfaces. */
export async function createCapabilitySnapshot(
  agentCtx: Context,
  signal?: AbortSignal,
): Promise<CapabilitySnapshot> {
  const agent = ownerOf(agentCtx)
  const toolsSurface = serviceOf<ToolSurface>(agentCtx, 'tools')
  if (toolsSurface === undefined) {
    throw new Error('dsh-iris: ctx.tools is unavailable')
  }

  const tools: CapabilityDescriptor[] = toolsSurface.schemas(agent).map(tool => ({
    id: `tool:${tool.name}`,
    kind: 'tool',
    name: tool.name,
    source: 'installed',
    trust: 'known',
  }))
  const skillsSurface = serviceOf<SkillSurface>(agentCtx, 'skills')
  const cwd = (agent as unknown as { session?: { header?: { cwd?: string } } }).session?.header?.cwd
  const skillObservation = await skillsSurface?.snapshot({
    scope: agent,
    ...cwd === undefined ? {} : { cwd },
    ...signal === undefined ? {} : { signal },
  })
  const observedSkills = skillObservation?.complete === true ? skillObservation.skills : []
  const skills: CapabilityDescriptor[] = observedSkills
    .filter(isModelInvocable)
    .map((skill) => ({
      id: `skill:${skill.name}`,
      kind: 'skill',
      name: skill.name,
      description: skill.description,
      ...skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse },
      ...skillProvenance(skill.source),
      providerId: skill.provider,
      provenance: { kind: 'dsh-native-skill', reference: skill.source },
    }))
  tools.sort(compareCapability)
  skills.sort(compareCapability)

  return {
    agentIdentity: agent,
    tools,
    skills,
    version: capabilitySnapshotVersion(tools, skills),
  }
}
