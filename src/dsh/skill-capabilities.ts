import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  isModelInvocable,
  type SkillSummary,
} from '@deepseek-ai/dsh-skill'

import type {
  CapabilityDescriptor,
  CapabilitySource,
  CapabilityTrust,
} from '../domain/index.js'

const DSH_SKILL_TOOL_NAME = 'skill'

function ownership(source: string): { source: CapabilitySource; trust: CapabilityTrust } {
  return source === 'bundled'
    ? { source: 'builtin', trust: 'builtin' }
    : { source: 'local', trust: 'known' }
}

/** Map DSH-owned Skill metadata without reading or retaining the Skill body. */
export function skillSummaryCapability(skill: SkillSummary): CapabilityDescriptor {
  return {
    id: `skill:${skill.name}`,
    kind: 'skill',
    name: skill.name,
    description: skill.description,
    ...skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse },
    ...ownership(skill.source),
    providerId: skill.provider,
    provenance: { kind: 'dsh-native-skill', reference: skill.source },
  }
}

/**
 * A live, Agent-scoped metadata view over DSH's native Skill registry.
 * It deliberately exposes no body-loading method: invocation remains owned by
 * the native `skill` Tool and `ctx.skills.get()`.
 */
export class DshSkillCapabilitySource {
  private readonly agent: Agent

  constructor(private readonly agentCtx: Context) {
    const agent = (agentCtx as Context & { readonly agent?: Agent }).agent
    if (agent === undefined) throw new Error('dsh-iris: DSH Skill source requires agentCtx.agent')
    this.agent = agent
  }

  async list(signal?: AbortSignal): Promise<readonly CapabilityDescriptor[]> {
    if (this.agentCtx.tools.get(DSH_SKILL_TOOL_NAME, this.agent) === undefined) return []
    const snapshot = await this.agentCtx.skills.snapshot({
      cwd: this.agent.session.header.cwd,
      scope: this.agent,
      ...signal === undefined ? {} : { signal },
    })
    if (!snapshot.complete) return []
    return snapshot.skills
      .filter(isModelInvocable)
      .map(skillSummaryCapability)
  }

  async find(capabilityId: string, signal?: AbortSignal): Promise<CapabilityDescriptor | undefined> {
    return (await this.list(signal)).find(capability => capability.id === capabilityId)
  }
}
