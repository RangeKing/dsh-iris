export type IrisLocaleKey =
  | 'nav' | 'title' | 'tagline' | 'subtitle' | 'refresh' | 'loading' | 'inactive' | 'error'
  | 'mode' | 'strategy' | 'status' | 'active' | 'currentAperture' | 'ceiling'
  | 'revealedPacks' | 'visibleCapabilities' | 'readyCapabilities' | 'fourModes'
  | 'minimal' | 'minimalDescription' | 'standard' | 'standardDescription'
  | 'code' | 'codeDescription' | 'creator' | 'creatorDescription'
  | 'capabilitySurface' | 'all' | 'tool' | 'skill' | 'mcp' | 'visible' | 'staged' | 'ready'
  | 'unavailable'
  | 'recentReveals' | 'noTransitions' | 'schemaChars' | 'promptChars' | 'sdkChars'

export const en: Record<IrisLocaleKey, string> = {
  nav: 'Iris', title: 'dsh-iris', tagline: 'Minimal surface. Full capability.',
  subtitle: 'Start minimal. Reveal on demand.', refresh: 'Refresh', loading: 'Loading Iris state…',
  inactive: 'Iris is not active for this session.', error: 'Iris state could not be loaded.',
  mode: 'Current mode', strategy: 'Strategy', status: 'Status', active: 'Active',
  currentAperture: 'Current Aperture', ceiling: 'Capability ceiling', revealedPacks: 'Revealed packs',
  visibleCapabilities: 'Visible now', readyCapabilities: 'Available on demand', fourModes: 'Four modes',
  minimal: 'Minimal', minimalDescription: 'Preserved native Minimal surface and benchmark control.',
  standard: 'Standard', standardDescription: 'Core first; native and optional capabilities reveal on demand.',
  code: 'Code', codeDescription: 'Step-stable SDK generated from the current aperture.',
  creator: 'Creator', creatorDescription: 'Core first; Cordis control plane reveals for creator intent.',
  capabilitySurface: 'Capability Surface', all: 'All', tool: 'Tool', skill: 'Skill', mcp: 'MCP',
  visible: 'Visible', staged: 'Staged', ready: 'Ready', unavailable: 'Unavailable',
  recentReveals: 'Recent Reveals',
  noTransitions: 'No capability packs have been revealed in this session.', schemaChars: 'Schema chars',
  promptChars: 'Prompt chars', sdkChars: 'Code SDK chars',
}

export const zh: Record<IrisLocaleKey, string> = {
  nav: 'Iris', title: 'dsh-iris', tagline: '最小界面，完整能力。', subtitle: '从最小开始，按需显露。',
  refresh: '刷新', loading: '正在读取 Iris 状态…', inactive: '当前会话未启用 Iris。', error: '无法读取 Iris 状态。',
  mode: '当前模式', strategy: '策略', status: '状态', active: '运行中', currentAperture: '当前能力光圈',
  ceiling: '能力上限', revealedPacks: '已显露能力包', visibleCapabilities: '当前可见',
  readyCapabilities: '按需可用', fourModes: '四种模式', minimal: '极简模式',
  minimalDescription: '保持 DSH 原生极简界面，作为 benchmark control。', standard: '标准模式',
  standardDescription: '从核心能力开始，原生及可选能力按需显露。', code: 'PTC 模式',
  codeDescription: '按当前能力光圈生成 step 内稳定的 SDK。', creator: '创造模式',
  creatorDescription: '从核心能力开始，仅在创造意图出现时显露 Cordis 控制平面。',
  capabilitySurface: '能力界面', all: '全部', tool: 'Tool', skill: 'Skill', mcp: 'MCP',
  visible: '可见', staged: '待提交', ready: '就绪', unavailable: '不可用', recentReveals: '最近显露',
  noTransitions: '当前会话尚未显露新的能力包。', schemaChars: 'Schema 字符数',
  promptChars: 'Prompt 字符数', sdkChars: 'Code SDK 字符数',
}
