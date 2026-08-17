# dsh-iris

dsh-iris — Progressive capability routing for DeepSeek Harness

**Start with what matters. Add more when needed.**

Iris keeps optional DeepSeek Harness capabilities available without putting all of them in the model context up front.

**All four modes start minimal. Capabilities expand when needed.**

[简体中文](README.zh-CN.md)

## 👁️ Why the name Iris?

An eye's iris controls how much light reaches it. dsh-iris does the same for an Agent's capability context: DeepSeek Harness keeps its full capability ceiling, while Iris adjusts how much of that ceiling the model can see in the current step.

That is why the project is called Iris. It does not shrink the interface or remove capabilities. It controls the Agent's **capability aperture**, revealing Tools, Skills, MCP capabilities, and Plugin-provided extensions only when they are useful.

## 🎯 Why Iris exists

DeepSeek Harness can combine native Tools, Skills, connected MCP Tools, and capabilities supplied by Plugins. The problem is not that these capabilities exist. The model rarely needs every Tool schema, Skill description, MCP route, and Plugin-specific instruction on the first turn. Exposing them all at once adds irrelevant choices, lengthens the prompt, and can make capability selection less predictable.

The community often summarizes this as **“GA DeepSeek V4 is overfit to Minimal.”** A more careful statement is that V4 appears unusually sensitive to its first-turn Tool and prompt environment, while its published Code Agent evaluation used DeepSeek Harness Minimal.

Without Iris, each DSH mode exposes capabilities in its native way. With Iris, the mode still defines what the Agent *may* use. Iris only changes what the model sees *right now*: it starts with the essentials and adds more when the task calls for them.

```text
Harness mode → full capability ceiling
                       │
                    dsh-iris
                       │
          only the essentials now
                       │
       search / explicit demand / recovery
                       │
                 reveal on demand
```



## ✨ Why this is a lighter approach

Iris does not replace DeepSeek Harness. It gives less software more ownership.


| Approach                             | What it usually owns                    | Iris instead                                                                    |
| ------------------------------------ | --------------------------------------- | ------------------------------------------------------------------------------- |
| Forked preset or global prompt patch | The mode persona and prompt             | Keeps native presets and yields to an explicit prompt owner                     |
| Always-on capability bundle          | Imports and exposes every Tool up front | Catalogues metadata first; imports local Providers only on activation           |
| Second router Agent / LLM loop       | Another decision and execution loop     | Reuses the current Agent loop and deterministic DSH lifecycle hooks             |
| Parallel Skill or MCP runtime        | Loading, execution, and teardown        | Routes back to DSH's native Skill, MCP, ToolRuntime, approval, and guard owners |
| Global Tool mutation                 | Every Agent sees the same change        | Mounts and reveals capabilities in the requesting Agent's scope                 |


That is the practical difference: Iris controls capability exposure. It does not build another Harness beside DSH.

## 🧭 What changes when you enable Iris

Choose **Enable Iris — All four modes start minimal and expand capabilities when needed** beside the DSH mode selector. Choose **Disable Iris — Use DeepSeek's native behavior** to return to the unmodified DSH experience.


| Mode             | Initial experience                                                 | On demand                                                          |
| ---------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Minimal          | Preserves native DSH Minimal exactly at Iris's verified boundaries | Iris adds no controls or automatic activation                      |
| Standard         | Core capabilities and lightweight Iris controls                    | Adds native capability groups or lazily activates configured Tools |
| Code / PTC       | Native `run_code` with a small, step-stable SDK                    | Stages compatible bindings for the next normal step                |
| Creator / Cordis | Core capabilities first                                            | Adds the privileged Creator control plane only for creator intent  |


During a session Iris only adds capabilities; it does not repeatedly hide and re-add them between turns. Settings → Iris shows what the model can see now, what remains available, prompt/schema/SDK sizes, and the capabilities recently added.

## 🔀 Discover, then use the right owner

Iris gives the Agent one place to search without forcing every capability through one lifecycle:

```text
tool:text_word_count     → iris_activate → lazy Agent-scoped Provider mount
skill:repo-review        → native skill route → DSH loads the Skill body
mcp:github/create_issue  → connected MCP Tool → direct DSH execution
```

- `iris_search` and `iris_recommend(query)` read metadata only.
- `iris_activate(tool:...)` loads and verifies a configured local Provider once.
- `iris_activate(skill:...)` delegates to the native DSH Skill route without loading the body itself.
- An already-connected MCP Tool is returned as directly available; Iris does not reconnect it.
- `UNKNOWN_TOOL` enters the same deterministic routing pipeline as a fallback. If Adaptive Creator has no local or discoverable candidate, Iris prepares a typed CreationBrief and reveals DSH's native Creator pack; Iris never replays the failed call.

DSH remains responsible for the Agent loop, ToolRuntime, Skills, MCP transport, Code SDK, approval, guards, execution, cancellation, sessions, and Cordis lifecycle.

## 🚀 Quick start — no config-file editing required

Install Iris into the Web profile:

```sh
dsh plugin --profile web add dsh-iris
dsh --profile web
```

Then use the UI:

1. Select **Enable Iris** beside the DSH mode selector.
2. Open **Settings → Iris** to choose Auto, Preserve, Adaptive, Adaptive Code, or Adaptive Creator behavior.
3. Configure metadata discovery, logging, and local Providers with controls in the page.
4. Start a session. Search or activate a capability only when it is useful.

A configured Provider is only a catalogue declaration. Bundle startup, search, and recommendation do **not** import or apply it.

```text
iris_search({ query: "count words" })
→ tool:text_word_count metadata
→ Provider apply count: 0

iris_activate({ capabilityId: "tool:text_word_count" })
→ resolve → policy → import → mount → verify → reveal
→ Provider apply count: 1

text_word_count({ text: "Iris opens only when needed." })
→ normal DSH execution pipeline
```

See [examples/local-text-tools](examples/local-text-tools) for a dependency-free example.

## ✅ What works today

- Minimal-first disclosure for Standard, Code / PTC, and Creator / Cordis.
- Canonical Minimal preservation as the control experience.
- Agent-scoped Tool activation, authoritative verification, single-flight, rollback, and teardown.
- Unified metadata discovery and routing across configured Tools, model-invocable DSH Skills, and connected MCP Tools.
- Step-stable Code SDK updates between normal model steps.
- `additionalContexts` handoff after recovery; no transparent Tool replay.
- Complete capability lifecycle: Search → Reveal / Mount / Delegate → Discover → Create → Resume.
- CreationBrief handoff through DSH `cordis_define` / `cordis_run`; Iris does not generate schemas or execute the created Tool.
- In-memory CatalogIndex V1 with legacy-ranker equivalence fallback and deterministic scale evidence.
- English and Simplified Chinese DSH Web UI with writable settings and live capability telemetry.
- Reproducible Vanilla-vs-Iris benchmark harness. Until a credentialed run is saved, [the report](benchmarks/REPORT.md) says results pending rather than inventing numbers.



## 🛣️ What Iris can grow into

The next features stay behind the same ownership rule:

- benchmark-guided capability-pack tuning rather than hand-wavy “smaller is better” claims;
- better task-aware recommendations when measured retrieval misses justify them;
- multilingual retrieval evaluation before any semantic embedding runtime;
- a community registry contract followed by explicit approval and installation;
- broader Skill and MCP lifecycle support only where DSH exposes safe public, Agent-scoped seams;
- evidence-guided adaptation across sessions without creating a second Agent loop.

Configured-but-disconnected MCP lazy activation remains intentionally deferred: current DSH does not expose the clean configured-server enumeration and Agent-owned lifecycle seam Iris would need.

## 🛠️ Development

```sh
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm pack --dry-run
```


## 📄 License

MIT. See [LICENSE](LICENSE).
