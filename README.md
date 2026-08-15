# dsh-iris

**Progressive capability activation for DeepSeek Harness**

dsh-iris keeps optional capabilities discoverable without loading them up front, and activates them only when the Agent actually needs them. It is designed as a lightweight adaptive capability layer on top of DSH.

```text
                    dsh-iris

             Capability Catalog
                    │
             ┌──────┴──────┐
             │             │
         iris_search   iris_recommend
             │             │
             └──────┬──────┘
                    │
               iris_activate
                    │
                 Resolve
                    │
               Mode Policy
                    │
              Lazy Activate
                    │
                  Verify
                    │
                  Reveal
                    │
             next DSH step

 UNKNOWN_TOOL ──────────→ same activation pipeline
```

Iris focuses on four things: expose less, discover on demand, load on demand, and expand each Agent's capability surface only when its Mode Policy allows it.

## Capability states

- **Catalogued** — Iris knows the capability metadata. The Provider has not been imported, applied, or mounted.
- **Activated** — the Provider was lazily imported and mounted under one Agent-scoped Direct Fiber.
- **Visible** — DSH's ToolRuntime exposes the capability to the current model-facing surface. In Code Mode, an activated capability remains staged until the next generated `tools:sdk` includes it.

Catalogued does not imply Activated. Activated does not rewrite an already-assembled model step.

## Mode policies

| DSH mode | Iris policy | Initial surface | Local activation | Remote Finder | Creation |
| --- | --- | --- | --- | --- | --- |
| Minimal | Preserve | Native Minimal surface | Off | Off | Off |
| Standard | Adaptive | Native preset + Iris controls | Trusted local Tool | Metadata only | Off |
| Code | Adaptive + Stable SDK | Native Code + Iris controls in SDK | PTC-compatible Tool only | Metadata only | Off |
| Creator | Adaptive + Create | Pinned Cordis + Iris control plane | Trusted local Tool | Metadata only | Typed fallback |

### Minimal — Preserve

Iris may index configured metadata, but it does not register `iris_search`, `iris_recommend`, or `iris_activate`; import Providers; mount extensions; call the remote Finder; or change the native Minimal Tool surface.

### Standard — Adaptive

Configured Providers remain dormant. `iris_search` performs direct metadata lookup, while `iris_recommend` ranks up to three capabilities for supplied task text. The Agent can pass a returned capability ID to `iris_activate`, which activates one matching trusted Provider for that Agent.

### Code — Adaptive + Stable SDK

Only capabilities declaring `ptcCompatible: true` may activate. Iris controls are available through the Code SDK. Activation stages the reveal until the next DSH prompt assembly regenerates `tools:sdk`; Iris never patches the SDK itself.

### Creator — Adaptive + Create

The seven native `cordis_*` inspection, definition, execution, and lifecycle Tools remain pinned alongside `iris_search`, `iris_recommend`, and `iris_activate`. Ordinary work capabilities stay progressive. Local misses use metadata-only discovery, then retain the typed `creator-fallback` result.

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
→ returns text_word_count metadata
→ Provider remains unloaded

iris_activate({ capabilityId: "tool:text_word_count" })
→ resolve → lazy import/mount → verify → reveal
→ Provider applies once
→ the next normal DSH step sees the Tool

text_word_count({ text: "Iris opens only when needed." })
→ normal Tool execution
```

`UNKNOWN_TOOL` remains a fallback Capability Demand source and enters the same activation pipeline. Iris does not replay the failed call, reuse its call ID, bypass approval or guards, or create another Agent loop.

Search and recommendation read metadata only. They never import, apply, or mount a Provider; only `iris_activate` and deterministic recovery may do that.

## Iris and DSH

DSH continues to own the Agent loop, ToolRuntime, Cordis scope and mount lifecycle, approval, guards, execution, sessions, Code Mode SDK, and Creator runtime. Iris owns configured capability metadata, deterministic search and recommendation, resolution, lazy activation, and Agent-scoped reveal.

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

GitHub discovery reads public `topic:dsh-plugin` repository metadata and never installs or executes a remote candidate. Set `GITHUB_TOKEN` when authenticated GitHub rate limits are needed. The cache is process memory only.

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

The mutation path supports Tool capabilities only. Community installation, Skill/MCP activation, Creation Bridge execution, proactive requirement parsing, profile persistence, and UI are not implemented.

Future work includes Skill and MCP capabilities, better task-aware recommendations, and evidence-guided adaptation.

## License

MIT. See [LICENSE](LICENSE).
