import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'

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

interface SkillSummaryObservation {
  readonly name: string
  readonly source: string
  readonly provider: string
}

interface SkillSurface {
  snapshot(options?: { readonly scope?: object }): Promise<{
    readonly skills: readonly SkillSummaryObservation[]
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
  const skillObservation = await skillsSurface?.snapshot({ scope: agent })
  const skills: CapabilityDescriptor[] = (skillObservation?.skills ?? []).map((skill) => ({
    id: `skill:${skill.name}`,
    kind: 'skill',
    name: skill.name,
    ...skillProvenance(skill.source),
    providerId: skill.provider,
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
