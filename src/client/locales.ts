export type IrisLocaleKey =
  | 'nav' | 'title' | 'tagline' | 'subtitle' | 'refresh' | 'loading' | 'inactive' | 'error'
  | 'mode' | 'strategy' | 'status' | 'active' | 'currentAperture' | 'ceiling'
  | 'revealedPacks' | 'visibleCapabilities' | 'readyCapabilities' | 'fourModes'
  | 'minimal' | 'minimalDescription' | 'standard' | 'standardDescription'
  | 'code' | 'codeDescription' | 'creator' | 'creatorDescription'
  | 'capabilitySurface' | 'all' | 'tool' | 'skill' | 'mcp' | 'visible' | 'staged' | 'ready'
  | 'unavailable'
  | 'recentReveals' | 'noTransitions' | 'schemaChars' | 'promptChars' | 'sdkChars'
  | 'configuration' | 'configurationDescription' | 'settingsLoading' | 'enabled' | 'enabledOn' | 'enabledOff'
  | 'policy' | 'policyAuto' | 'policyPreserve' | 'policyAdaptive' | 'policyCode' | 'policyCreator'
  | 'discovery' | 'logLevel' | 'providers' | 'providersDescription' | 'noProviders' | 'addProvider'
  | 'cancel' | 'remove' | 'providerId' | 'modulePath' | 'capabilityId' | 'capabilityName'
  | 'description' | 'keywords' | 'ptcCompatible' | 'saveProvider' | 'reasoningOwner' | 'surfaceEvidence'
  | 'irisEnabled' | 'irisDisabled' | 'irisEnabledDescription' | 'irisDisabledDescription'
  | 'irisToggle' | 'irisToggleHint' | 'irisOn' | 'irisOff' | 'presetHint' | 'presetNoDescription'
  | 'cacheTtl' | 'maxResults' | 'settingsError' | 'retry'

export const en: Record<IrisLocaleKey, string> = {
  nav: 'Iris', title: 'dsh-iris', tagline: 'Start with what matters. Add more when needed.',
  subtitle: 'Iris keeps optional capabilities available without putting all of them in the model context up front.', refresh: 'Refresh', loading: 'Loading Iris state…',
  inactive: 'Iris is not active for this session.', error: 'Iris state could not be loaded.',
  mode: 'Current mode', strategy: 'Strategy', status: 'Status', active: 'Active',
  currentAperture: 'Capabilities in this session', ceiling: 'Capabilities available', revealedPacks: 'Enabled capability groups',
  visibleCapabilities: 'Visible to the model', readyCapabilities: 'Ready when needed', fourModes: 'How Iris works in each mode',
  minimal: 'Minimal', minimalDescription: 'Adds nothing and preserves DeepSeek\'s native Minimal mode.',
  standard: 'Standard', standardDescription: 'Starts with core capabilities, then adds files, search, or extensions when needed.',
  code: 'Code', codeDescription: 'Keeps the Tool SDK fixed during a step; new capabilities appear in the next step.',
  creator: 'Creator', creatorDescription: 'Keeps Cordis controls out of the way until the task asks to inspect or change the runtime.',
  capabilitySurface: 'Capabilities', all: 'All', tool: 'Tool', skill: 'Skill', mcp: 'MCP',
  visible: 'Visible', staged: 'Staged', ready: 'Ready', unavailable: 'Unavailable',
  recentReveals: 'Recent Reveals',
  noTransitions: 'No capability packs have been revealed in this session.', schemaChars: 'Schema chars',
  promptChars: 'Prompt chars', sdkChars: 'Code SDK chars',
  configuration: 'Iris settings', configurationDescription: 'Change Iris here. DSH saves your choices and applies them immediately.',
  settingsLoading: 'Loading Iris settings…', enabled: 'Use Iris', enabledOn: 'On', enabledOff: 'Off',
  policy: 'How capabilities are added', policyAuto: 'Automatic — match the current DSH mode', policyPreserve: 'Use native DSH behavior',
  policyAdaptive: 'Add capabilities when needed', policyCode: 'Add Code / PTC capabilities between steps', policyCreator: 'Add Creator capabilities when needed',
  discovery: 'Look for community capability metadata', logLevel: 'Diagnostic logs', providers: 'Local capability providers',
  providersDescription: 'Iris only reads these declarations at startup. Provider code loads after activation.', noProviders: 'No local providers added.',
  addProvider: 'Add provider', cancel: 'Cancel', remove: 'Remove', providerId: 'Provider ID', modulePath: 'Provider module path',
  capabilityId: 'Capability ID', capabilityName: 'Capability name', description: 'Description', keywords: 'Keywords (comma-separated)',
  ptcCompatible: 'Compatible with Code / PTC', saveProvider: 'Save provider', reasoningOwner: 'Reasoning guidance owner',
  surfaceEvidence: '{hidden} of {total} known capabilities are kept out of the model context until they are needed ({percent}%).',
  irisEnabled: 'Enable Iris', irisDisabled: 'Disable Iris',
  irisEnabledDescription: 'All four modes start minimal and expand capabilities when needed.',
  irisDisabledDescription: "Use DeepSeek's native behavior.", irisToggle: 'Iris enablement',
  irisToggleHint: 'Choose whether Iris progressively discloses capabilities for new and active sessions.', irisOn: 'Iris on', irisOff: 'Iris off',
  presetHint: 'Choose the mode for the next session.', presetNoDescription: 'No description provided.',
  cacheTtl: 'How long to cache discovery results', maxResults: 'Maximum discovery results',
  settingsError: 'Iris settings could not be loaded. Try again.', retry: 'Try again',
}

export const zh: Record<IrisLocaleKey, string> = {
  nav: 'Iris', title: 'dsh-iris', tagline: '先给必要能力，需要时再扩展。', subtitle: 'Iris 不会删掉能力，只是不把暂时用不到的都塞进模型上下文。',
  refresh: '刷新', loading: '正在读取 Iris 状态…', inactive: '当前会话未启用 Iris。', error: '无法读取 Iris 状态。',
  mode: '当前模式', strategy: '扩展方式', status: '状态', active: '运行中', currentAperture: '本会话的能力',
  ceiling: '可用能力总数', revealedPacks: '已加入的能力组', visibleCapabilities: '模型当前可见',
  readyCapabilities: '需要时可加入', fourModes: '四种模式怎么工作', minimal: '极简模式',
  minimalDescription: 'Iris 不额外添加能力，保持 DeepSeek 原生极简模式。', standard: '标准模式',
  standardDescription: '先给核心能力，需要文件、搜索或扩展工具时再加入。', code: 'PTC 模式',
  codeDescription: '当前 step 的 Tool SDK 保持不变，新能力从下一 step 开始可用。', creator: '创造模式',
  creatorDescription: '先处理普通任务；明确要检查或修改运行时，再加入 Cordis 控制能力。',
  capabilitySurface: '能力列表', all: '全部', tool: 'Tool', skill: 'Skill', mcp: 'MCP',
  visible: '可见', staged: '待提交', ready: '就绪', unavailable: '不可用', recentReveals: '最近显露',
  noTransitions: '当前会话尚未显露新的能力包。', schemaChars: 'Schema 字符数',
  promptChars: 'Prompt 字符数', sdkChars: 'Code SDK 字符数',
  configuration: 'Iris 设置', configurationDescription: '直接在这里修改。DSH 会保存设置并立即生效。',
  settingsLoading: '正在读取 Iris 设置…', enabled: '使用 Iris', enabledOn: '开启', enabledOff: '关闭',
  policy: '如何扩展能力', policyAuto: '自动（按当前 DSH 模式选择）', policyPreserve: '使用 DSH 原生方式', policyAdaptive: '需要时加入能力',
  policyCode: '在 step 之间加入 PTC 能力', policyCreator: '需要时加入创造能力', discovery: '查找社区能力信息', logLevel: '诊断日志',
  providers: '本地能力 Provider', providersDescription: '启动时只读取声明；激活能力后才加载 Provider 代码。', noProviders: '还没有添加本地 Provider。',
  addProvider: '添加 Provider', cancel: '取消', remove: '移除', providerId: 'Provider ID', modulePath: 'Provider 模块路径',
  capabilityId: 'Capability ID', capabilityName: 'Capability 名称', description: '说明', keywords: '关键词（逗号分隔）',
  ptcCompatible: '兼容 Code / PTC', saveProvider: '保存 Provider', reasoningOwner: '推理引导所有者',
  surfaceEvidence: '目前有 {hidden}/{total} 个已知能力没有直接放进模型上下文，需要时再加入（{percent}%）。',
  irisEnabled: '开启 Iris', irisDisabled: '关闭 Iris', irisEnabledDescription: '四种模式都从极简启动，需要时扩展能力。',
  irisDisabledDescription: 'DeepSeek 原生方式。', irisToggle: 'Iris 开关',
  irisToggleHint: '选择 Iris 是否为新会话和当前会话渐进显露能力。', irisOn: 'Iris 已开启', irisOff: 'Iris 已关闭',
  presetHint: '选择下一个会话使用的模式。', presetNoDescription: '暂无说明。',
  cacheTtl: '发现结果缓存多久', maxResults: '最多返回多少条结果',
  settingsError: 'Iris 设置没有加载成功，请重试。', retry: '重试',
}
