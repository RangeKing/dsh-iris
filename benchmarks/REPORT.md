# dsh-iris benchmark report

Raw JSONL: `benchmarks/results/smoke.jsonl`<br>
Generated: 2026-08-17T08:54:47.723Z<br>
Observed evidence levels: synthetic

Evidence classification is explicit: synthetic records are deterministic structural checks; exploratory records are live or low-sample observations; primary records require a fixed checkpoint and complete paired metadata. A requested primary label is downgraded to exploratory when those facts are absent. The default recommendation is 20 repeated paired samples; it is not a universal statistical threshold.

## Records

| Mode | Variant | Evidence | n | Model | Run dates | Success | Avg input tokens | Avg assistant steps |
| --- | --- | --- | ---: | --- | --- | ---: | ---: | ---: |
| minimal | vanilla | — | — | — | — | — | — | — |
| minimal | iris | — | — | — | — | — | — | — |
| standard | vanilla | — | — | — | — | — | — | — |
| standard | iris | — | — | — | — | — | — | — |
| code | vanilla | — | — | — | — | — | — | — |
| code | iris | — | — | — | — | — | — | — |
| cordis | vanilla | — | — | — | — | — | — | — |
| cordis | iris | — | — | — | — | — | — | — |

## Paired description

| Mode | n vanilla/iris | Success vanilla / iris | Δ success | Δ input tokens | Δ assistant steps |
| --- | ---: | ---: | ---: | ---: | ---: |
| minimal | pending | pending | — | — | — |
| standard | pending | pending | — | — | — |
| code | pending | pending | — | — | — |
| cordis | pending | pending | — | — | — |

The paired table is descriptive. Δ success is withheld until both variants have at least 20 samples, and no low-sample row is converted into a causal “improves performance by X%” conclusion. Raw JSONL remains authoritative; missing provider usage is recorded as null/unavailable rather than estimated.
