export type CapabilityPackId =
  | 'native-minimal'
  | 'core'
  | 'filesystem'
  | 'search'
  | 'coordination'
  | 'delegation'
  | 'creator'
  | 'extensions'

export const CAPABILITY_PACK_ORDER: readonly CapabilityPackId[] = [
  'native-minimal',
  'core',
  'filesystem',
  'search',
  'coordination',
  'delegation',
  'creator',
  'extensions',
]

const CORE = new Set([
  'bash',
  'pwsh',
  'read',
  'edit',
  'str_replace_editor',
  'ask_user_question',
  'iris_search',
  'iris_recommend',
  'iris_activate',
])

const FILESYSTEM = new Set(['write', 'grep', 'glob', 'lsp', 'pty'])
const SEARCH = new Set(['web_search', 'web_fetch'])
const COORDINATION = new Set([
  'job_output',
  'job_kill',
  'todo_write',
  'get_goal',
  'create_goal',
  'update_goal',
  'update_plan',
  'exit_plan_mode',
])
const DELEGATION = new Set([
  'list_agents',
  'report',
  'workflow',
  'orchestrate',
  'ralph',
])

/** Stable product packs avoid one-schema-at-a-time prompt oscillation. */
export function capabilityPackForTool(name: string): CapabilityPackId {
  if (CORE.has(name)) return 'core'
  if (FILESYSTEM.has(name)) return 'filesystem'
  if (SEARCH.has(name)) return 'search'
  if (COORDINATION.has(name) || name.startsWith('job_') || name.endsWith('_goal')) {
    return 'coordination'
  }
  if (DELEGATION.has(name) || name.startsWith('subagent')) return 'delegation'
  if (name.startsWith('cordis_')) return 'creator'
  return 'extensions'
}

/** Map grouped DSH guidance sections back to the pack that owns their schemas. */
export function capabilityPackForPromptSection(name: string): CapabilityPackId | undefined {
  if (!name.startsWith('tool:')) return undefined
  const tool = name.slice('tool:'.length)
  if (tool === 'jobs') return 'coordination'
  if (tool === 'cordis') return 'creator'
  if (tool === 'subagent' || tool === 'report' || tool === 'workflow' || tool === 'orchestrate') {
    return 'delegation'
  }
  return capabilityPackForTool(tool)
}

export function compareCapabilityPacks(left: CapabilityPackId, right: CapabilityPackId): number {
  return CAPABILITY_PACK_ORDER.indexOf(left) - CAPABILITY_PACK_ORDER.indexOf(right)
}
