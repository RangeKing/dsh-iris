# dsh-iris architecture

## Positioning

dsh-iris is the Progressive capability routing layer for DeepSeek Harness. Routing remains one subsystem: Iris presents one discovery view across configured Tool Providers, DSH-native Skills, connected MCP Tools, and the native DSH capability ceiling, then controls how much of that ceiling reaches the current model step.

```text
Harness Mode → Capability Ceiling → Iris Aperture → Current Surface
```

The product invariant is: **mode determines the ceiling; Iris determines the current surface**. A capability may be registered and searchable without its schema, Skill guidance, Code SDK binding, or related prompt section being disclosed.

```text
Discover → Rank → Route

Tool Provider:
  → Activate → Mount → Verify → Reveal → Resume

Native Skill:
  → Delegate → DSH skill Tool → ctx.skills.get() → Resume

Connected MCP Tool:
  → Delegate → registered DSH Tool → native ToolRuntime → Resume
```

`UNKNOWN_TOOL` remains a deterministic Capability Demand source. It is no longer the architectural center, and Iris never replays the original call.

## Unified capability view

Capability IDs are kind-qualified: `tool:<name>`, `skill:<name>`, and `mcp:<server>/<tool>`. Same-name capabilities remain separate ranked results with separate routes.

The discovery view is assembled per request:

```text
ConfiguredLocalProviderCatalog metadata
                    +
current Agent ctx.skills.snapshot({ cwd, scope, signal })
                    +
current Agent ctx.tools.schemas(agent) MCP-name projection
                    ↓
          shared CapabilityRanker
```

Iris does not copy native Skills or MCP Tools into its Provider Catalog, cache Skill bodies, parse `SKILL.md`, watch Skill files, connect MCP servers, or request MCP `tools/list`. DSH retains Skill provider precedence and body loading plus MCP transport, synchronization, reconnection, Tool registration, execution, and teardown.

Only summaries with `isModelInvocable(summary) === true` enter the model-facing Iris result set. Iris also requires the native `skill` Tool to be visible for the Agent; without that route, the Skill is not advertised. An MCP descriptor exists only when the registered DSH Tool is already in the exact Agent's authoritative schema view.

## Disclosure and activation state model

| State | Meaning | Authority |
| --- | --- | --- |
| Catalogued | Metadata exists in the configured Catalog | `ConfiguredLocalProviderCatalog` |
| Activated | Provider code has been imported, applied, and mounted for one Agent | Direct Fiber handle / `MountCoordinator` |
| Visible | The capability is in the model-facing surface for a DSH step | ToolRuntime projection and prompt assembly |
| Pinned | Mode-critical capability that stays visible in the initial aperture | `IrisModePolicy` + current DSH surface |
| Staged | Activated Code Mode capability awaiting a later SDK assembly | Agent-owned `CapabilitySurfaceState` |

Catalog construction never imports a Provider. Search reads Tool descriptors and Skill summaries only. Tool activation occurs only after a deterministic demand, pure resolution, and a positive Mode Policy decision. Skill discovery never enters this state machine.

## Runtime ownership

The Bundle reads the `iris` Schemastery config once and owns a shared configured Catalog and metadata-only GitHub Finder. On `agent/created`, it creates one `IrisRuntime` per exact Agent. Real DSH Agents initialize Iris through `agent.runMaintenance()`, so queued driving cannot overtake preset classification and aperture installation. The Runtime and every mounted Fiber dispose with `agent.ctx`.

At initialization the Runtime records the native DSH ceiling, chooses a named aperture policy, installs a scoped restriction for Adaptive modes, and leaves configured Providers unimported. The aperture expands monotonically in stable packs: `core`, `filesystem`, `search`, `coordination`, `delegation`, `creator`, and `extensions`.

`IrisRuntime` is the product interface. It builds a live discovery view and dispatches the selected route:

```text
Search / Recommend
→ Tool + Skill + connected MCP metadata view
→ deterministic Rank
→ CapabilityRoute
   ├─ Tool: Demand → Resolve → Policy → Activate → Verify → Reveal
   ├─ Skill: validate native route → delegate to DSH
   └─ MCP: validate registered Tool route → delegate to DSH
```

Bundle-level resources contain metadata and import promises only. Mount ownership, visibility state, staged changes, and single-flight generations remain Agent-scoped.

## DSH Tool visibility seam

Iris uses DSH ToolRuntime rather than maintaining a parallel execution registry.

- `agentCtx.tools.restrict({ allow })` freezes the inherited global Tool aperture for Adaptive modes. DSH applies this restriction to presentation, `get()`, and execution; hidden calls materialize as `UNKNOWN_TOOL`.
- DSH intentionally exempts Tools registered in the Agent's own scope from inherited restrictions. Iris therefore controls configured extensions by leaving them unmounted until demand, then registering them through the already-verified Agent-scoped Direct Fiber path.
- `ctx.tools.get(name, agent)` verifies an activated Tool.
- `ctx.tools.schemas(agent)` and `systemPrompt.assemble({ scope: agent })` are the final native presentation surfaces.
- Code Mode continues to use DSH's `tools:sdk` renderer. Iris never generates SDK source.
- Iris filters tool-owned prompt sections with the same pack aperture while preserving mode-critical sections such as `tools:sdk`, `tools:code-only`, the Code protocol, and the complete Minimal persona.

This division preserves Agent isolation: a module import promise may be shared, but every Provider apply and Tool registration happens below one Agent Fiber.

## Aperture policies

One Runtime pipeline consumes four named policies:

| Canonical preset | Product label | Initial aperture | On-demand behavior | Performance invariant |
| --- | --- | --- | --- | --- |
| `minimal` | Minimal | Native Minimal composition | None by default | Preserve the canonical control |
| `standard` | Standard | Native core + Iris controls | Reveal packs or activate trusted local Tools | Avoid the full Standard schema set up front |
| `code` | Code | DSH `run_code` presentation + core SDK aperture | Stage PTC-compatible additions | Keep one model step's SDK stable |
| `cordis` | Creator | Native core + Iris controls | Reveal Creator pack on explicit creator intent | Preserve the full Creator ceiling without front-loading it |

Unknown or custom presets default to Preserve. Explicit config may select `preserve`, `adaptive`, `adaptive-code`, or `adaptive-creator`; Iris never infers a policy from Tool counts or names.

The named policy also selects a reasoning scaffold. Preserve keeps the preset's native persona and receives no Iris reasoning guidance. Adaptive, Adaptive Code, and Adaptive Creator initially shadow `deployment:persona` in the exact Agent scope with DSH Minimal's sentence, `You are a helpful software engineer assistant.`, then add the static order-1 `iris:reasoning-voice` section. The section explicitly requests `We need …` / `Need to …` and rejects first-person staging. These contributions change prompt conditioning only: Tool presentation, Code protocol, SDK generation, approval, guards, execution, and session ownership remain native DSH responsibilities. Iris does not rewrite reasoning or treat its wording as a quality metric. A centralized compatibility guard recognizes the explicit `router-persona` owner and removes Iris's persona/voice sections from that assembly; telemetry reports `iris`, `native`, or `external:<section>` as the active reasoning guidance owner.

### Minimal preservation

Preserve installs no restriction, Iris control Tool, Provider, remote Finder call, or extension mount. Provider declarations may enter the metadata Catalog, but the DSH native Minimal composition remains the complete model-facing surface.

### Standard progressive disclosure

Standard records the complete DSH preset ceiling, then restricts the inherited model-facing surface to the native core plus `iris_search`, `iris_recommend`, and `iris_activate`. Hidden native Tools remain discoverable as catalogue entries. Explicit activation, deterministic recovery, or a high-confidence capability demand reveals a stable native pack or activates a configured extension. Search and recommendation combine Tool metadata with current model-invocable Skill summaries, connected MCP Tools, and hidden native ceiling entries.

### Code step stability

DSH assembles `tools:sdk` before a model request. That assembly is a fixed snapshot for the step. If demand occurs while the step's Tool calls execute, Iris may activate and verify a PTC-compatible Provider, but records the capability as Staged rather than Visible. A later native prompt assembly regenerates `tools:sdk`; Iris observes the final DSH assembly and commits the staged capability only when that SDK contains it. The current step's SDK is never patched or regenerated in place. Native Skill and connected MCP routes are advertised only when DSH already projects their Tools into the Agent's SDK; Iris adds no Skill or MCP Code adapter.

### Creator control plane on demand

The `cordis` preset remains the full Creator ceiling, including `cordis_inspect_list`, `cordis_inspect_query`, `cordis_inspect_self`, `cordis_define`, `cordis_run`, `cordis_stop`, and `cordis_undefine`. Iris starts with native core plus its three controls and shadows Creator-specific prompt guidance with the same Minimal persona used by Standard and Code. High-confidence creator intent or explicit activation reveals the complete Creator pack and disposes that persona shadow, restoring DSH's original trust-critical Creator guidance. The wording-only `iris:reasoning-voice` section remains active because it does not replace Creator ownership or safety instructions. Native Skills and connected MCP Tools are routed to DSH before a missing Tool becomes a creation gap. An empty local and metadata-only discovery result builds a deterministic typed `CreationBrief`, reveals the native Creator pack through the aperture, and hands the brief to the next normal DSH step.

## Search, recommendation, and explicit activation

`iris_search` and `iris_recommend` share one deterministic `CapabilityRanker`: exact capability id, exact name, exact keyword, then name, keyword, description, Skill `whenToUse`, MCP server, and bounded top-level input-property token matches. Runtime discovery builds an in-memory `CatalogSnapshot` with exact metadata maps, token postings, and substring trigrams. Indexed candidates are passed back through the unchanged ranker; short or otherwise unproven substring cases use the legacy full scan. Recommendation accepts caller-supplied text, penalizes capabilities already Visible, filters unproven Code Tool candidates, returns at most three entries, and keeps at most 256 normalized query fingerprints per Agent. Neither control calls `catalog.load()`, imports a module, applies a Provider, mounts a Fiber, mutates the aperture, calls `ctx.skills.get()`, reconnects MCP, requests `tools/list`, or executes an MCP Tool.

DSH does not currently expose reliable current task text at a low-intrusion pre-step seam, so recommendation is an explicit `iris_recommend(query)` control Tool rather than an Agent-loop hook. Its Tool result is already model-visible through the normal DSH pipeline.

`iris_activate` accepts a kind-qualified capability ID and normalizes it into `ExplicitActivationDemand`. A `tool:` ID shares requirement evaluation, Mode Policy, Provider loading, `MountCoordinator`, Direct Fiber, authoritative verification, Surface update, and lifecycle disposal with `UnknownToolDemand`. A `skill:` ID is validated against current model-invocable DSH Skill summaries and returns a typed `dsh-skill` delegation route. An `mcp:` ID is validated against connected Tools in the current Agent view and returns `already-available` with a typed `dsh-mcp-tool` route. It never starts or reconnects an MCP server.

## DSH native Skill bridge

The bridge uses four DSH facts:

- `ctx.skills.snapshot({ cwd, scope, signal })` provides the current Agent's summary catalog and completeness bit.
- `isModelInvocable()` remains the authority for model-facing inclusion.
- The native `skill` Tool first calls `ctx.skills.list()`, validates the summary, then calls `ctx.skills.get()` and validates the loaded definition again.
- Skill provider invalidation belongs to the DSH registry. Iris performs a fresh scoped snapshot for each search or recommendation, so the next query follows DSH's latest catalog without an Iris watcher or cross-Agent Skill cache.

Skill discovery is not Skill body loading, and Iris does not own Skill execution.

## DSH connected MCP bridge

`@deepseek-ai/dsh-mcp-client` connects one server per plugin instance, obtains the initial paginated Tool list, and registers definitions with `ctx.tools.register()` under `mcp__<serverName>__<rawName>` public names. Its async `apply()` does not activate until initial synchronization settles. Later list-change notifications replace the registered generation, reconnect owns later generations, and Fiber disposal disconnects and unregisters the current generation.

`ToolDefinition` exposes no MCP owner, raw protocol name, or server metadata. Iris therefore centralizes the published-name interpretation in `src/dsh/mcp-capabilities.ts`. For an ordinary public name, `mcp__github__create_issue` becomes capability ID `mcp:github/create_issue` and route metadata retains `dshToolName: mcp__github__create_issue`. When DSH normalized or truncated a raw MCP name, Iris preserves the resulting public token; it does not claim to recover the hidden raw protocol name. No other module parses MCP names.

Search reads `ctx.tools.schemas(agent)` only. It does not call the MCP client. Execution uses the route's DSH Tool name and therefore remains subject to ToolRuntime scope resolution, approval, guards, cancellation, Code SDK projection, result normalization, and session handling.

### Lazy MCP lifecycle decision: NO-GO

The public MCP plugin is mountable through an exact Agent context, and executable tests confirm its delayed Tool registration remains Agent-scoped and disposal removes the Tools. Two DSH ownership facts prevent Iris from implementing configured-but-disconnected activation safely:

1. `@deepseek-ai/dsh-mcp-client` exports `Config`, `apply`, and reconnect types but no service that enumerates configured-but-unmounted server declarations. Enabled Loader entries connect immediately. Reading disabled Loader entry internals or adding `iris.mcpServers` would create an unstable seam or a second MCP config source of truth.
2. The MCP client reserves each live `serverName` in a `WeakMap` keyed by `ctx.root`. Two Agent-scoped client Fibers in one app cannot independently own the same server namespace; the second fails before connecting.

Iris 0.1.0 therefore supports already-connected MCP discovery and routing only. Configured-but-disconnected and unknown `mcp:` activation return the same typed not-found result because DSH exposes no authoritative declaration view that could distinguish them.

## Retry Handoff and execution ownership

The Tool pipeline remains owned by DSH. Approval and guards run before Tool dispatch. Iris observes accepted `UNKNOWN_TOOL` results in `tools/post-execute`, prepares the next surface, and appends a concise `additionalContexts` message. Explicit activation uses the control Tool's native `ToolRunContext.deferContext()` seam, which places readiness or a CreationBrief on that call's own successful result. A CreationBrief only says that the capability is missing, gives a minimal deterministic scaffold, and points to the native `dsh-cordis` route; it is not a Tool result. The original failure path remains unchanged. A later capability call uses a new ID and passes the normal approval, guard, scheduling, execution, and cancellation path.

The native ceiling listens to DSH's public `tools/change` event and refreshes lazily. DSH Skills are snapshotted through `ctx.skills.snapshot()` for a fresh scoped view, connected MCP metadata is read from registered DSH Tools, and configured local metadata is immutable for the Runtime. Iris does not maintain a second dynamic Tool registry. After DSH's `cordis_define` / `cordis_run` lifecycle registers a Tool, the next ceiling or Catalog snapshot observes it through DSH ToolRuntime and the same index.

Cancellation before activation prevents it. Cancellation while mounting suppresses handoff and disposes the generation. Agent teardown aborts Runtime initialization, removes search/restriction listeners, and disposes all Agent-owned mounts.

## Surface telemetry

Each Agent Runtime projects a bounded, read-only snapshot:

```text
mode / strategy / ceiling
revealed and ready packs
visible / available / hidden capability counts
visible schema chars
assembled prompt chars
Code SDK chars
recent aperture transitions (max 20)
```

Measurement never enters the model prompt. Counts and sizes are populated only from DSH authority surfaces that were actually observed; unavailable provider usage or token data remains absent rather than estimated.

## Host to Web state

The package exports one Host and one browser half. The Host `IrisRuntime` remains source of truth and exposes `IrisSessionSnapshot` through DSH's typed Remote extension. The Web client mounts that contribution through the public client loader, follows the selected Agent, and injects **Settings → Iris** plus a composite new-session hero seat.

```text
IrisRuntime.snapshot()
        ↓
DSH Remote: iris/snapshot
        ↓
Iris client controller
        ↓
Settings → Iris
```

Configuration takes the separate public DSH Settings path:

```text
Settings UI / hero Iris dropdown
        ↓
ctx.settingsScope (browser)
        ↓
DSH settings RPC + persisted iris namespace
        ↓
ctx.settings scope watch (Host)
        ↓
IrisBundle.reconfigure()
```

The browser does not infer capability state or execute Tools. It can enable/disable Iris, choose policy/discovery/logging options, and manage Provider declarations through DSH settings; no parallel configuration store exists. Agent selection triggers a telemetry refresh and the page offers manual refresh. A live telemetry event channel is deferred until DSH exposes a need that justifies the extra lifecycle surface. English and Simplified Chinese copy uses DSH's locale registry.

## Benchmark ownership

`benchmarks/run.mjs` creates paired Vanilla/Iris cases with identical model and sampling configuration. Task fixtures have machine-verifiable outputs. The DSH SDK driver owns only transport; the caller supplies the Vanilla and Iris compositions. Raw JSONL is the source of truth and `benchmarks/generate-report.mjs` derives `benchmarks/REPORT.md`.

Synthetic runs validate the runner, verifier, schema, and report generator only. They are excluded from performance aggregates. A live result is publishable only when the raw artifact records the provider model string, run date, Harness/Iris revisions, and any usage metrics actually returned by the provider.

## Implemented and deferred

Implemented: Bundle config, DSH-owned live Iris settings, per-Agent Iris Runtime, native ceiling capture, stable capability packs, minimal-first Standard/Code/Creator apertures, Agent-scoped Minimal reasoning scaffolds with explicit prompt-owner coexistence, prompt-pack filtering, Minimal Preserve, kind-qualified Tool/Skill/MCP identities, live Agent-scoped DSH Skill source, connected MCP Tool source, shared Tool/Skill/MCP ranking, typed capability routes, native Skill and MCP delegation, Tool Catalogued/Activated/Visible/Pinned/Staged state, explicit Tool and native-pack activation, lazy local Tool activation, `UNKNOWN_TOOL` demand, authoritative verification, Code SDK staging, Retry Handoff, metadata-only GitHub discovery, cache, single-flight, rollback, teardown, bounded surface telemetry, DSH Remote snapshot, writable Settings client, explained hero enablement control, two locales, and a reproducible paired benchmark harness.

Deferred: live benchmark data without credentials, configured-but-disconnected MCP lifecycle activation, community installation, approval/install flow, automatic task extraction, profile persistence, cross-Agent activation reuse, push-based Web updates, persistent analytics, and provider sandboxing. Future community discovery should consume a registry contract before falling back to the GitHub topic convention.
