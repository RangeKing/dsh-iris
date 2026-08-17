# dsh-iris

dsh-iris：DeepSeek Harness 的渐进式能力显露

**先给必要能力，需要时再扩展。**

Iris 不会删掉 DeepSeek Harness 的能力，只是不把暂时用不到的都塞进模型上下文。

**四种模式都从极简启动，需要时扩展能力。**

[English](README.md)

## 👁️ 为什么叫 Iris？

眼睛里的虹膜负责调节进入眼睛的光。dsh-iris 做的是同一件事：DeepSeek Harness 保留完整的能力上限，Iris 根据当前任务，调节模型此刻能看到多少能力。

所以项目叫 Iris。它调节的不是界面，也不会删掉能力，而是 Agent 的**能力光圈**：Tool、Skill、MCP 和 Plugin 提供的扩展能力都可以继续存在，只在需要时进入当前上下文。

## 🎯 Iris 想解决什么问题

DeepSeek Harness 可以同时接入原生 Tool、Skill、MCP Tool，以及 Plugin 提供的扩展能力。问题不在于这些能力太多，而在于 Agent 第一轮通常不需要同时看到全部 Tool schema、Skill 说明、MCP 入口和 Plugin 指引。一次给得太多，模型会面对更多无关选项，Prompt 也更长，选择能力时更容易跑偏。

社区常把这个现象概括成：**“DeepSeek V4 正式版过拟合极简模式。”** 更严谨的说法是：V4 对首轮 Tool 与 Prompt 环境似乎格外敏感，而公开的 Code Agent 评测使用了 DeepSeek Harness 极简模式。

不开 Iris，四种 DSH 模式按原生方式工作。开启后，模式仍然决定 Agent 最终能用什么；Iris 只改变模型此刻看到什么：先给当前任务必需的能力，用到其他能力时再加入。

```text
DSH 模式 → 完整能力上限
                 │
              dsh-iris
                 │
           当前只给必要能力
                 │
       搜索 / 显式需求 / 故障恢复
                 │
             按需加入更多能力
```



## ✨ 比别的插件优雅在哪

Iris 不替换 DeepSeek Harness，而是尽量少接管东西。


| 常见做法                   | 容易接管什么                 | Iris 的做法                                          |
| ---------------------- | ---------------------- | ------------------------------------------------- |
| Fork preset、全局改 Prompt | 模式人格和完整 Prompt         | 保留 DSH 原生 preset；发现明确的 Prompt owner 时主动让位         |
| 常驻式大能力包                | 启动时加载并暴露所有 Tool        | 先登记元数据，真正激活时才加载本地 Provider                        |
| 第二个 Router Agent / LLM | 再造一轮判断和执行              | 复用当前 Agent loop 和确定性的 DSH 生命周期 hook               |
| 另造 Skill / MCP Runtime | 加载、执行、重连、清理            | 路由回 DSH 原生 Skill、MCP、ToolRuntime、approval 和 guard |
| 全局修改 Tool              | 一个 Agent 的变化影响所有 Agent | 只给提出需求的 Agent 挂载和开放能力                             |


所以 Iris 只管“现在给模型哪些能力”，不在 DSH 旁边再造一套 Harness。

## 🧭 开启后会发生什么

在模式选择器旁选择：

- **开启 Iris — 四种模式都从极简启动，需要时扩展能力**
- **关闭 Iris — DeepSeek 原生方式**


| 模式             | 启动体验                          | 需要更多能力时                   |
| -------------- | ----------------------------- | ------------------------- |
| 极简模式           | 保持 DSH 原生极简模式，不额外增加 Iris Tool | 默认不自动激活，继续作为对照组           |
| 标准模式           | 核心能力 + 轻量 Iris 控制入口           | 加入原生能力组，或惰性加载已配置 Tool     |
| PTC / Code 模式  | 原生 `run_code` + 小而稳定的 SDK     | 兼容能力先暂存，下一正常 step 才进入 SDK |
| 创造 / Cordis 模式 | 先给核心能力                        | 只有明确创造意图出现时，才加入高权限控制能力    |


同一会话中，Iris 只增加能力，不在相邻 step 里反复隐藏和恢复 Tool。打开 **设置 → Iris**，可以看到模型当前能用什么、还有什么可以按需加入，以及 Prompt、Schema、SDK 大小和最近的变化。

## 🔀 找到能力以后，交还给正确的 Runtime

Iris 提供统一发现入口，但不会强迫 Tool、Skill、MCP 走同一条生命周期：

```text
tool:text_word_count     → iris_activate → Agent-scoped 惰性挂载
skill:repo-review        → 原生 skill 路由 → DSH 加载 Skill 正文
mcp:github/create_issue  → 已连接 MCP Tool → DSH 直接执行
```

- `iris_search`、`iris_recommend(query)` 只查询元数据。
- `iris_activate(tool:...)` 才会加载、挂载并验证本地 Provider，而且同一 Agent 只 apply 一次。
- `iris_activate(skill:...)` 只返回 DSH 原生 Skill 路由，Iris 不加载或缓存正文。
- 已连接的 MCP Tool 直接标为可用，Iris 不重复连接 server。
- `UNKNOWN_TOOL` 是确定性的兜底需求信号；Iris 不在 hook 里偷偷重放失败调用。

Agent loop、ToolRuntime、Skill、MCP transport、Code SDK、approval、guard、执行、取消、session 和 Cordis 生命周期仍然归 DSH 管。

## 🚀 快速开始：普通用户不用改配置文件

把 Iris 安装到 Web profile：

```sh
dsh plugin --profile web add dsh-iris
dsh --profile web
```

然后直接在界面里操作：

1. 在 DSH 模式选择器旁选择 **开启 Iris**。
2. 打开 **设置 → Iris**，选择自动、保持原生、自适应、自适应 PTC 或自适应创造策略。
3. 用按钮和下拉菜单设置元数据发现、日志和本地 Provider。
4. 开始会话；只有真的需要某项能力时才搜索或激活。

Provider 配置只是进入能力目录。Bundle 启动、搜索和推荐都不会 import 或 apply 它。

```text
iris_search({ query: "统计字数" })
→ 返回 tool:text_word_count 元数据
→ Provider apply 次数：0

iris_activate({ capabilityId: "tool:text_word_count" })
→ 解析 → 策略 → import → mount → verify → reveal
→ Provider apply 次数：1

text_word_count({ text: "Iris 只在需要时打开。" })
→ 继续走 DSH 原生执行链
```

无外部依赖的示例见 [examples/local-text-tools](examples/local-text-tools)。

## ✅ 目前已经能做到

- 标准、PTC / Code、创造 / Cordis 模式先只给必要能力；极简模式保持原生对照体验。
- Agent-scoped Tool 激活、权威验证、single-flight、失败回滚和 teardown 清理。
- Tool、可由模型调用的 DSH Skill、已连接 MCP Tool 的统一元数据发现与路由。
- PTC / Code 模式只在 step 边界更新 SDK，step 内保持稳定。
- 故障恢复后通过 `additionalContexts` 交还下一正常 step，不透明重放 Tool。
- 中英文 DSH Web 设置页、可写配置控件和实时能力数据。
- 可复现的 Vanilla DSH vs Iris benchmark；没有真实凭证运行时，[报告](benchmarks/REPORT.md)会写“结果待测”，不会填造数字。



## 🛣️ 后续能实现什么

后续功能继续遵守“谁拥有 Runtime，谁负责执行”的边界：

- 用 benchmark 数据调优能力包，而不是先假定“越小越好”；
- 真实检索遗漏出现后，再增强任务感知的能力推荐；
- 消费统一的社区 registry，并在明确 approval 后安装；
- 只在 DSH 提供安全、公开、Agent-scoped seam 时扩展 Skill / MCP 生命周期；
- 基于跨 session 证据做轻量适应，但不建立第二套 Agent loop。

“已配置但尚未连接的 MCP 惰性激活”仍然明确延期：当前 DSH 没有提供 Iris 所需的 server 枚举与 Agent-owned 生命周期 seam。

## 🛠️ 开发验证

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm pack --dry-run
```



## 📄 License

MIT，见 [LICENSE](LICENSE)。