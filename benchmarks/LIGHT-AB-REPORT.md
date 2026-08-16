# V4 Pro lightweight A/B sanity check

Run on 2026-08-16 against the locally configured rolling `deepseek-v4-pro` alias and DeepSeek Harness `0.1.0-rc.6`.

This is one paired run per mode, not a statistically meaningful benchmark. Every variant used a fresh session, an isolated temporary workspace, and the same task: replace the contents of an existing `answer.txt` with exactly `42` plus an optional trailing newline.

## Standard

| Metric | Vanilla | Iris 0.1.0 | Change |
| --- | ---: | ---: | ---: |
| Verifier success | yes | yes | — |
| Visible Tools at first request | 25 | 7 | -72.0% |
| System prompt chars | 6,068 | 2,490 | -59.0% |
| Tool-schema chars | 25,487 | 7,285 | -71.4% |
| Initial input tokens | 11,317 | 2,806 | -75.2% |
| Total non-cached input tokens | 11,971 | 3,379 | -71.8% |
| Output tokens | 602 | 609 | +1.2% |
| Reasoning tokens | 48 | 88 | +83.3% |
| Assistant steps | 7 | 5 | -28.6% |
| Tool calls | 6 | 4 | -33.3% |
| Tool errors | 1 | 0 | -1 |
| Wall time | 22.547 s | 12.345 s | -45.2% |

## Reasoning-opening observation

Neither first reasoning segment literally began with `I will`, `I'll`, `我会`, `Let me`, or `让我`.

- Vanilla began with `The task ...`; its first self-directive was `Let me first check ...`.
- Iris began with `The user wants me ...`; its first self-directive was also `Let me first check ...`.

For the requested binary classification, both samples are therefore **Let me / 让我**, not **I will / 我会**.

## Minimal

| Metric | Vanilla | Iris 0.1.0 | Change |
| --- | ---: | ---: | ---: |
| Verifier success | yes | yes | — |
| Visible Tools at first request | 2 | 2 | unchanged |
| System prompt chars | 46 | 46 | unchanged |
| Tool-schema chars | 3,232 | 3,232 | unchanged |
| Non-cached input tokens | 1,516 | 311 | -79.5% |
| Output tokens | 396 | 207 | -47.7% |
| Assistant steps | 4 | 3 | -25.0% |
| Tool calls | 3 | 2 | -33.3% |
| Tool errors | 0 | 0 | unchanged |
| Event wall time | 24.949 s | 17.411 s | -30.2% |

Minimal preservation held at the first model request: both variants exposed exactly `bash` and `str_replace_editor`, with byte-count-equivalent system and Tool-schema surfaces. The first reasoning segments began with `We need ...` (Vanilla) and `Need to ...` (Iris). Neither contained `I will`, `I'll`, `I need`, or `Let me`, so both are classified as **neither** under the requested categories.

## Code / PTC

| Metric | Vanilla | Iris 0.1.0 | Change |
| --- | ---: | ---: | ---: |
| Verifier success | yes | yes | — |
| Direct visible Tools | 1 (`run_code`) | 1 (`run_code`) | unchanged |
| System prompt chars | 35,618 | 11,518 | -67.7% |
| Direct Tool-schema chars | 877 | 877 | unchanged |
| Non-cached input tokens | 12,090 | 3,100 | -74.4% |
| Output tokens | 233 | 304 | +30.5% |
| Assistant steps | 2 | 3 | +50.0% |
| Tool calls | 1 | 2 | +100.0% |
| Tool errors | 0 | 0 | unchanged |
| Event wall time | 5.538 s | 7.056 s | +27.4% |

Both Code/PTC samples began with `The task is simple ...`; the first matching self-directive was `Let me` (offset 124 Vanilla, 132 Iris). Both are therefore **Let me / 让我**, not **I will / I need / 我会 / 我需要**. Iris substantially reduced the generated Code-mode system surface in this sample, but the single Iris trajectory took one extra model step and one extra `run_code` call, so latency was higher here.

## Interpretation boundary

The surface measurements are directly observed from each first `request/header`. The trajectory, token, and latency differences are observations from one stochastic pair per mode and must not be presented as an expected performance improvement. In particular, the Minimal token difference occurred despite an identical initial surface, so it is trajectory/cache variation rather than evidence of an Iris surface effect. Repeated paired runs are required before drawing a model-behavior conclusion.

Raw records: [`results/v4-pro-light-ab.jsonl`](results/v4-pro-light-ab.jsonl).
