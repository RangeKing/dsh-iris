# dsh-iris

**Progressive capability routing for DeepSeek Harness**

dsh-iris discovers optional capabilities across DSH, loads only what needs loading, and delegates native capabilities back to the runtime that owns them. It is a lightweight adaptive capability layer on top of DSH.

```text
                   dsh-iris

             Search / Recommend
                    │
              Capability Route
          ┌─────────┼─────────┐
          │         │         │
        Tool      Skill      MCP
          │         │         │
 iris_activate   native    native MCP
          │       skill       Tool
    lazy mount      │         │
          └─────────┼─────────┘
                    │
                   DSH
```

Iris decides where a capability should go. DSH remains the execution authority.

## Unified capability routing

Iris uses kind-qualified identities, so Tool, Skill, and MCP results cannot collide:

```text
tool:text_word_count  → iris_activate → lazy Provider mount
skill:repo-review     → native skill route → DSH skill Tool
mcp:github/create_issue → native MCP route → mcp__github__create_issue
```

`iris_search` and the explicit `iris_recommend(query)` control search one ranked metadata view. Configured Tool descriptors come from Iris's local Provider Catalog. Skill descriptors are read live from the current Agent's `ctx.skills.snapshot()`. Connected MCP descriptors come from MCP Tools already present in the same Agent's `ctx.tools` view.

Search does not read `SKILL.md` bodies. When a Skill is selected, the Agent calls DSH's native `skill` Tool; DSH then validates invocation policy and loads the body through `ctx.skills.get()` with the Agent's own cwd, scope, and cancellation signal.

MCP search does not connect, reconnect, call `tools/list`, or execute a Tool. A connected MCP result has `status: available` and a `dsh-mcp-tool` route, so the Agent can call the registered DSH Tool directly. `iris_activate(mcp:...)` only validates that route and returns `already-available`; it never starts the server again.

## Capability states

- **Catalogued** — Iris knows Tool Provider metadata. The Provider has not been imported, applied, or mounted.
- **Activated** — the Provider was lazily imported and mounted under one Agent-scoped Direct Fiber.
- **Visible** — DSH's ToolRuntime exposes the capability to the current model-facing surface. In Code Mode, an activated capability remains staged until the next generated `tools:sdk` includes it.

These activation states apply to Iris-managed Tools. Native Skills keep DSH's summary-versus-body lifecycle. Connected MCP Tools keep DSH's connection, synchronization, execution, and teardown lifecycle.

## Mode policies

| DSH mode | Iris policy | Tool route | Skill route | Connected MCP route | Creation |
| --- | --- | --- | --- | --- | --- |
| Minimal | Preserve | Off | No Iris bridge | No Iris bridge | Off |
| Standard | Adaptive | Trusted local Tool activation | Native DSH `skill` | Direct native Tool | Off |
| Code | Adaptive + Stable SDK | PTC-compatible Tool only | Native `skill` SDK binding | DSH-generated SDK binding | Off |
| Creator | Adaptive + Create | Trusted local Tool activation | Native DSH `skill` | Direct native Tool before fallback | Typed fallback |

### Minimal — Preserve

Iris may index configured metadata, but it does not register `iris_search`, `iris_recommend`, or `iris_activate`; import Providers; mount extensions; call the remote Finder; or change the native Minimal Tool surface.

### Standard — Adaptive

Configured Providers remain dormant. `iris_search` performs direct metadata lookup, while `iris_recommend` ranks up to three Tool, Skill, or connected MCP capabilities for text supplied by the caller. A Tool result routes to `iris_activate`, a Skill result routes to DSH's native `skill` Tool, and an MCP result routes directly to its registered Tool name.

### Code — Adaptive + Stable SDK

Only Iris Tool capabilities declaring `ptcCompatible: true` may activate. Native Skills and connected MCP Tools are discoverable only when DSH already exposes their native routes through the Code SDK. Iris controls remain available through that SDK. Tool activation stages the reveal until the next DSH prompt assembly regenerates `tools:sdk`; Iris never patches the SDK itself.

### Creator — Adaptive + Create

The seven native `cordis_*` inspection, definition, execution, and lifecycle Tools remain pinned alongside `iris_search`, `iris_recommend`, and `iris_activate`. Ordinary Tool capabilities stay progressive. Existing native Skills and connected MCP Tools route back to DSH instead of being mistaken for creation gaps. Local Tool misses use metadata-only discovery, then retain the typed `creator-fallback` result.

## Quick start

Install the Bundle into a DSH profile. From a local checkout:

```sh
dsh plugin --profile web add .
```

Configure `$DSH_HOME/profiles/web/cordis.patch.yml`:

```yaml
- id: dsh-iris
  config:
    iris:
      enabled: true
      policy: auto
      logLevel: info
      providers:
        - id: example.local-text-tools
          module: /absolute/path/to/dsh-iris/examples/local-text-tools/provider.mjs
          capabilities:
            - id: text_word_count
              kind: tool
              description: Count words, characters, and lines in local text.
              keywords:
                - count words
                - text statistics
              ptcCompatible: true
      discovery:
        enabled: true
        cacheTtlMs: 900000
        maxResults: 10
```

`policy: auto` maps the canonical DSH preset to Preserve, Adaptive, Adaptive Code, or Adaptive Creator. Explicit values are `preserve`, `adaptive`, `adaptive-code`, and `adaptive-creator`.

Start DSH:

```sh
dsh --profile web
```

The bundled example supports the explicit path:

```text
iris_recommend({ query: "Count the words in this text" })
→ returns up to three metadata-only recommendations
→ Provider remains unloaded

iris_search({ query: "count words" })
→ returns tool:text_word_count metadata and route = iris-activate
→ Provider remains unloaded

iris_activate({ capabilityId: "tool:text_word_count" })
→ resolve → lazy import/mount → verify → reveal
→ Provider applies once
→ the next normal DSH step sees the Tool

text_word_count({ text: "Iris opens only when needed." })
→ normal Tool execution
```

A Skill follows the other route:

```text
iris_search({ query: "review this repository" })
→ returns skill:repo-review metadata and route = dsh-skill
→ Skill body remains unloaded

skill({ name: "repo-review" })
→ DSH validates modelInvocable
→ DSH loads and renders the Skill body
```

Calling `iris_activate({ capabilityId: "skill:repo-review" })` is also safe: it returns the typed native route without loading the body or mounting anything. The Agent can usually follow the route returned by search directly and skip that extra control call.

An MCP Tool already connected by DSH follows a third route:

```text
iris_search({ query: "create github issue" })
→ returns mcp:github/create_issue, status = available
→ route = dsh-mcp-tool, dshToolName = mcp__github__create_issue
→ no MCP connection or tools/list occurs

mcp__github__create_issue({ repository: "org/repo", title: "..." })
→ normal DSH ToolRuntime execution
```

Iris v0.4 deliberately does not start configured-but-disconnected MCP servers. DSH currently has no public configured-server enumeration service, and its live `serverName` reservation is app-root scoped. Adding an `iris.mcpServers` block would duplicate DSH config ownership, so lazy MCP lifecycle activation remains deferred.

`UNKNOWN_TOOL` remains a fallback Capability Demand source and enters the same activation pipeline. Iris does not replay the failed call, reuse its call ID, bypass approval or guards, or create another Agent loop.

Search and recommendation read metadata only. They never import, apply, or mount a Provider; call `ctx.skills.get()`; reconnect MCP; request `tools/list`; or execute an MCP Tool. Only Tool activation and deterministic Tool recovery can mount Provider code.

## Iris and DSH

DSH continues to own the Agent loop, ToolRuntime, Skill registry and loaders, MCP transport/protocol/client, Cordis scope and mount lifecycle, approval, guards, execution, sessions, Code Mode SDK, and Creator runtime. Iris owns unified metadata discovery, deterministic ranking and routing, configured Tool resolution, lazy Tool activation, and Agent-scoped reveal.

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

The current community fallback reads public `topic:dsh-plugin` GitHub metadata and never installs or executes a remote candidate. The intended long-term order is a community registry contract first, with the GitHub topic as fallback. Set `GITHUB_TOKEN` when authenticated GitHub rate limits are needed. The cache is process memory only.

Developer logs stay at product-event level:

```text
[iris] capability demand: tool:text_word_count
[iris] matched local provider: example.local-text-tools
[iris] activated for agent <id>: tool:text_word_count
[iris] discovery: 3 candidates for tool:example_tool
```

## Development

```sh
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm pack --dry-run
```

See [docs/architecture.md](docs/architecture.md), [CONTEXT.md](CONTEXT.md), and [AGENTS.md](AGENTS.md).

## Current limits

The mutation path supports configured Tool capabilities only. Native Skills and already-connected MCP Tools support discovery and routing while their loading, connection, and execution stay with DSH. Configured-but-disconnected MCP activation, community installation, Creation Bridge execution, proactive task extraction, profile persistence, and UI are not implemented.

Future work includes an upstream MCP lifecycle seam, a community registry contract consumer, better task-aware recommendations, and evidence-guided adaptation.

## License

MIT. See [LICENSE](LICENSE).
