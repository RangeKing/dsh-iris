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
