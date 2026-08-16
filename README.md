# dsh-iris

**Minimal surface. Full capability.**

Progressive capability disclosure for DeepSeek Harness.

**Start minimal. Reveal on demand.**

dsh-iris gives every DeepSeek Harness mode a focused initial capability surface, then reveals tools, skills, and connected MCP capabilities only when the task needs them.

```text
DeepSeek Harness

Minimal   Standard   Code   Creator
   │         │        │       │
   └─────────┴────────┴───────┘
                 │
              dsh-iris
                 │
        Minimal Initial Surface
                 │
        Progressive Disclosure
                 │
       Full Capability Ceiling
```

DeepSeek reports that its V4-Flash Code Agent evaluation used DeepSeek Harness in Minimal mode. That is an official setup fact—not proof that a smaller surface always improves performance. Iris turns the minimal-surface idea into a measurable product hypothesis across Harness modes and ships the A/B benchmark needed to test it. See the [evidence ledger](docs/evidence.md).

## How it works

```text
Harness mode → Capability ceiling → Iris aperture → Model-visible surface

Search / Recommend / UNKNOWN_TOOL
                 ↓
              Resolve
                 ↓
            Mode policy
                 ↓
       Reveal or lazy activate
                 ↓
          next normal DSH step
```

The capability ceiling remains available. Iris controls the current aperture in stable packs—`core`, `filesystem`, `search`, `coordination`, `delegation`, `creator`, and `extensions`—and expands it monotonically during an Agent session.

Registered does not mean disclosed:

- A configured Tool Provider remains unimported until `iris_activate` or deterministic recovery needs it.
- A native Skill remains owned and loaded by DSH's `skill` subsystem.
- A connected MCP Tool remains owned and executed by DSH's MCP and Tool runtimes.
- `UNKNOWN_TOOL` is a fallback demand signal; Iris never replays the failed call.

## Four modes

| DSH mode | Initial Iris aperture | On-demand behavior | Performance invariant |
| --- | --- | --- | --- |
| Minimal | Native Minimal surface | Iris controls and activation are off | Preserve the canonical benchmark control |
| Standard | Core + Iris controls | Reveal native packs or lazily activate configured Tools | Avoid presenting the full Standard schema set up front |
| Code | Native `run_code` presentation + current core SDK | Stage PTC-compatible additions for the next step | Keep `tools:sdk` stable within one model step |
| Creator | Core + Iris controls | Reveal Creator/Cordis pack only for explicit creator intent | Preserve the full Creator ceiling without front-loading it |

Mode determines the ceiling. Iris determines the current surface.

### Minimal reasoning scaffold

Standard, Code, and the initial Creator aperture use the exact DSH Minimal persona—`You are a helpful software engineer assistant.`—as an Agent-scoped prompt shadow, followed by a short static reasoning-voice section that requests `We need …` / `Need to …` instead of first-person staging. Iris does not rewrite model output or change mode-specific Tool, SDK, approval, guard, or execution protocols. Minimal itself remains untouched. When Creator reveals its privileged Cordis pack, Iris removes the persona shadow and restores DSH's complete trust-critical Creator persona while retaining the wording-only voice section.

This is a scaffold fingerprint, not a capability or quality metric. The wording observation and mechanism follow the experiments documented by [dsh-routing-suite](https://github.com/yjh051108/dsh-routing-suite). In Iris's one-run-per-mode [live smoke](benchmarks/REASONING-VOICE-SMOKE.md), Standard, Code, and Creator each began with `We need`; this is validation of the integration, not a statistical guarantee.

### Minimal — Preserve

Iris adds no control Tool, restriction, Provider import, Finder call, mount, or prompt guidance. The DSH native Minimal presentation remains unchanged at the boundaries Iris can verify. Progressive Minimal is not the 0.1.0 default.

### Standard — Core first

Standard starts with the Minimal reasoning scaffold, a small native core, and `iris_search`, `iris_recommend`, and `iris_activate`. Filesystem, search, coordination, delegation, Creator, and extension packs remain ready on demand.

### Code — Stable SDK

DSH still presents `run_code` and generates `tools:sdk`; only the persona is shadowed by the Minimal reasoning scaffold. Iris restricts the bindings represented by the current aperture; a PTC-compatible capability discovered in step N is staged and appears only when DSH assembles the SDK for step N+1. Iris never generates or patches SDK code.

### Creator — Control plane on demand

The full Cordis/Creator capability ceiling is preserved. Its core aperture uses the Minimal reasoning scaffold; Creator-specific mutation, inspection, authoring Tools, and trust-critical guidance are disclosed only after high-confidence creator intent or explicit activation, at which point the native Creator persona is restored. Normal Tool, Skill, and MCP routing is tried before `creator-fallback`.

## Unified capability routes

Iris uses kind-qualified identities so names cannot collide:

```text
tool:text_word_count     → iris_activate → lazy Provider mount
skill:repo-review        → native skill route → ctx.skills.get()
mcp:github/create_issue  → registered DSH MCP Tool → direct execution
```

`iris_search` and `iris_recommend(query)` rank one metadata view across configured Tools, model-invocable DSH Skills, connected MCP Tools, and hidden native DSH capabilities. Search and recommendation never import a Provider, load a Skill body, reconnect MCP, or execute a Tool.

## Quick start

Install the Bundle into a DSH profile:

```sh
dsh plugin --profile web add dsh-iris
```

Configure the Bundle entry in `$DSH_HOME/profiles/web/cordis.patch.yml`:

```yaml
- id: dsh-iris
  config:
    iris:
      enabled: true
      policy: auto
      logLevel: info
      providers:
        - id: example.local-text-tools
          module: /absolute/path/to/provider.mjs
          capabilities:
            - id: text_word_count
              kind: tool
              description: Count words, characters, and lines in local text.
              keywords: [count words, text statistics]
              ptcCompatible: true
```

Then start DSH normally:

```sh
dsh --profile web
```

The example flow is explicit and side-effect free until activation:

```text
iris_search({ query: "count words" })
→ tool:text_word_count metadata
→ Provider imports: 0

iris_activate({ capabilityId: "tool:text_word_count" })
→ resolve → policy → lazy import/mount → verify → reveal
→ Provider applies once

text_word_count({ text: "Iris opens only when needed." })
→ normal DSH approval / guard / execution pipeline
```

See [examples/local-text-tools](examples/local-text-tools) for a local Provider.

## Web UI

The same package includes a DSH browser client. Open **Settings → Iris** to inspect the Host-owned state for the selected Agent:

- current mode, strategy, status, and capability ceiling;
- revealed and ready capability packs;
- visible, ready, and unavailable Tool / Skill / MCP capabilities;
- visible schema, prompt, and Code SDK sizes when available;
- recent aperture transitions.

The page is read-only, supports English and Simplified Chinese, and uses the existing DSH Remote and settings extension seams. It does not execute Tools or infer state in the browser. If no Iris Runtime exists for the selected Agent, it says so explicitly. Live mutation events are intentionally deferred; selection changes and manual refresh obtain a fresh authoritative snapshot.

## Performance evidence

The public claims in this README follow [docs/evidence.md](docs/evidence.md):

- **Official fact:** DeepSeek's published V4-Flash Code Agent evaluation used DSH Minimal with a deliberately small Tool environment.
- **Independent evidence:** harness and Tool-surface choices can materially change Agent results, but their effects are task- and setup-dependent.
- **Iris hypothesis:** reducing irrelevant schemas and guidance may improve efficiency or reliability while progressive disclosure preserves the full ceiling.
- **Measured Iris result:** pending a live run; no synthetic value is presented as model performance.

## Reproducible benchmark

`benchmarks/` compares Vanilla DSH and DSH + Iris across Minimal, Standard, Code, and Creator with machine-verifiable core, filesystem, search, coordination, and Creator tasks.

```sh
# Offline harness/verifier/report smoke
pnpm benchmark:smoke

# Live paired run (default: 5 repetitions)
DEEPSEEK_API_KEY=... \
DSH_BENCH_COMMAND=... \
DSH_BENCH_ARGS='["..."]' \
node benchmarks/run.mjs --driver ./benchmarks/drivers/dsh-sdk.mjs --runs 5 --kind live

node benchmarks/generate-report.mjs
```

The runner records model string, date, Harness/Iris versions, configuration, task ID, verifier result, turns, Tool calls, wall time, surface metrics, and provider usage fields when the provider exposes them. The current public model is a rolling `deepseek-v4-pro` alias; Iris does not claim a fixed `V4-Pro-0813` checkpoint unless the provider exposes one. See [benchmarks/REPORT.md](benchmarks/REPORT.md). Until a credentialed run is saved, the report says **Results pending**.

## Configuration defaults

```yaml
iris:
  enabled: true
  policy: auto
  logLevel: info
  providers: []
  discovery:
    enabled: true
    cacheTtlMs: 900000
    maxResults: 10
```

`policy: auto` maps the canonical preset IDs `minimal`, `standard`, `code`, and `cordis` to their native Iris strategies. Explicit policies remain available for controlled experiments.

## Ownership boundary

DSH owns the Agent loop, preset ceiling, ToolRuntime, prompt assembly, Code SDK, Skill loaders, MCP transport, Cordis lifecycle, approval, guards, execution, sessions, and cancellation. Iris owns the metadata catalog, ranking and routing, aperture policy, configured Tool activation, scoped visibility, retry handoff, telemetry snapshot, and read-only UI projection.

Connected MCP capabilities are discoverable and directly routable. Configured-but-disconnected MCP lazy activation remains deferred because current DSH does not expose a clean configured-server enumeration and Agent-owned namespace lifecycle seam. Iris does not create a second MCP config or runtime.

## Development

```sh
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm pack --dry-run
```

See [docs/architecture.md](docs/architecture.md), [docs/evidence.md](docs/evidence.md), [CHANGELOG.md](CHANGELOG.md), [CONTEXT.md](CONTEXT.md), and [AGENTS.md](AGENTS.md).

## Current limits

No live V4-Pro result is bundled without a real credentialed run. Configured-but-disconnected MCP activation, community installation, Creation Bridge execution, proactive task extraction, provider sandboxing, and persistent analytics are not part of 0.1.0.

Future work is evidence-led: improve the capability that the benchmark and launch usage identify as the largest real bottleneck.

## License

MIT. See [LICENSE](LICENSE).
