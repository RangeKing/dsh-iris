# Reproducible paired benchmark

The matrix compares the same task, mode, model settings, timeout, and verifier under two external DSH compositions: `vanilla` and `iris`. The runner never changes model parameters between the pair.

Smoke the schema, verifiers, JSONL writer, and report generator without a model:

```sh
pnpm benchmark:smoke
```

For a live run, provide a DSH SDK JSON-RPC launch command whose argument template accepts `{mode}` and `{variant}`. The referenced compositions must differ only by the dsh-iris Bundle/restriction under test.

```sh
export DEEPSEEK_API_KEY=...
export DSH_BENCH_COMMAND=node
export DSH_BENCH_ARGS='["/absolute/path/to/dsh-jsonrpc-agent.js", "/absolute/path/to/bench-{mode}-{variant}.cordis.yml"]'

node benchmarks/run.mjs \
  --runs 5 \
  --driver ./benchmarks/drivers/dsh-sdk.mjs \
  --kind live \
  --output ./benchmarks/results/v4-pro.jsonl

node benchmarks/generate-report.mjs \
  ./benchmarks/results/v4-pro.jsonl \
  ./benchmarks/REPORT.md
```

`deepseek-v4-pro` is recorded as the public rolling alias. The report must not claim a pinned `V4-Pro-0813` checkpoint unless DeepSeek exposes and the runner records such a model string. Missing API usage fields remain empty; the runner does not estimate provider tokens.

## Evidence V2

New runner records use `schemaVersion: 2` and carry the same metadata for every sample: `runId`, `sampleId`, `pairId`, `variant`, `order`, `taskId`, `timestamp`, `model`, `modelAlias`, `harnessVersion`, `irisVersion`, `mode`, and `workspaceId`. Usage, trajectory, surface, and timing metrics use `null` when the driver cannot observe them; zero is used only when the driver knows the value is zero.

The evidence level is explicit:

- `synthetic`: deterministic structural benchmark records; excluded from live performance aggregates.
- `exploratory`: live observations with rolling aliases, low sample counts, or incomplete usage metadata.
- `primary`: reserved for a fixed checkpoint, paired samples, and complete identifying metadata. The report downgrades a requested primary label when those facts are absent.

The benchmark driver accepts `--variants=vanilla,iris` so future `iris-surface-only` and `iris-scaffold-only` ablations can be added without product configuration changes. The current runner exposes only the composition variant; it does not add benchmark controls to Iris runtime configuration.

The independent CatalogIndex scale benchmark is under `benchmarks/catalog-scale/`. It reports build time, query p50/p95, heap delta, and legacy/indexed equivalence for generated 1k/10k/50k catalogs. These are machine-specific observations, not hard CI performance gates.
