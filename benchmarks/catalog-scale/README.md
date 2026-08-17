# Catalog scale benchmark

This benchmark generates deterministic in-memory metadata and compares the legacy full scan with `CatalogSnapshot` indexed ranking. It checks IDs, scores, reasons, ordering, filters, substring cases, and no-match behavior before recording timings. It does not create or require a large JSON fixture, disk index, embedding runtime, or CI hard performance gate.

Run after building the package:

```sh
pnpm build
node --expose-gc benchmarks/catalog-scale/run.mjs
```

Use `--sizes=1000,10000,50000` to select sizes. `buildMs`, query p50/p95, and `heapDeltaBytes` are evidence for the current machine; they are not universal budgets.
