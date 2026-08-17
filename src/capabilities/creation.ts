import type { CreationBrief, CapabilityRequirement } from '../domain/index.js'

/** Build the smallest deterministic scaffold for DSH Cordis Creator tools. */
export function creationBriefFor(requirement: CapabilityRequirement): CreationBrief {
  const suggestedName = requirement.requestedName?.trim() || requirement.id.split(':').slice(1).join(':')
  return {
    capabilityId: requirement.id,
    suggestedName,
    purpose: `Create the missing ${requirement.kind} capability requested as ${requirement.id}.`,
    contract: {
      name: suggestedName,
      inputHint: 'Define only the input fields required by the user request; no schema is inferred here.',
      outputHint: 'Return the capability result through the normal DSH Tool pipeline.',
    },
    route: 'dsh-cordis',
  }
}
