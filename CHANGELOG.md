# Changelog

## 0.1.0 — 2026-08-16

First public launch candidate.

### Added

- Minimal-first progressive capability disclosure for DSH Standard, Code, Minimal, and Creator modes.
- Agent-scoped Minimal reasoning scaffold for Standard, Code, and Creator core apertures, with native Creator persona restoration when its privileged pack is revealed.
- Stable capability packs with monotonic Agent-scoped reveal.
- Metadata search and deterministic recommendation across configured Tools, DSH-native Skills, connected MCP Tools, and the hidden native DSH ceiling.
- Explicit `iris_activate` plus deterministic `UNKNOWN_TOOL` recovery through the same demand, resolution, policy, verification, reveal, and retry-handoff pipeline.
- Lazy Agent-scoped Direct Fiber mounting for configured local Tool Providers with single-flight, rollback, cancellation, isolation, and teardown.
- Step-stable Code aperture using DSH-generated `tools:sdk`; Iris never generates a parallel SDK.
- Minimal Preserve and Creator control-plane-on-demand strategies.
- Read-only Agent surface telemetry and a bilingual **Settings → Iris** page in the default DSH Web client.
- Reproducible paired Vanilla/Iris benchmark runner, machine-verifiable task matrix, raw JSONL schema, and generated report.
- Evidence ledger separating official facts, independent results, community hypotheses, Iris hypotheses, and measured Iris results.

### Ownership boundaries

- DSH continues to own the Agent loop, ToolRuntime, prompt assembly, Code SDK, native Skill loading, MCP transport and execution, Cordis lifecycle, approval, guards, sessions, and cancellation.
- Iris discovers and routes already-connected MCP Tools but does not start configured-but-disconnected MCP servers.
- Search and recommendation are metadata-only. They do not import Providers, load Skill bodies, reconnect MCP, or execute Tools.

### Release evidence

- Package name `dsh-iris` was unclaimed on the npm registry when checked on 2026-08-16.
- No live V4-Pro benchmark result is included without a credentialed run; synthetic smoke data is excluded from performance claims.
