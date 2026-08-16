# Minimal reasoning voice smoke

Run on 2026-08-16 against the locally configured rolling `deepseek-v4-pro` alias and DeepSeek Harness `0.1.0-rc.6`. Each cell is one stochastic run of the same machine-verified `answer.txt` task.

| Mode | Minimal persona only | Persona + explicit voice section | Verifier |
| --- | --- | --- | --- |
| Standard | `Let me` at offset 114 | `We need` at offset 0 | pass / pass |
| Code / PTC | `Let me` at offset 114 | `We need` at offset 0 | pass / pass |
| Creator / Cordis | `I need` at offset 0 | `We need` at offset 0 | pass / pass |

The explicit section adds 180 system-prompt characters in these assemblies. It does not replace model output, the Code protocol, Tool schemas, approval, guards, or execution. Creator retains the voice section when its native trust-critical persona is restored.

This is a linguistic-conditioning smoke, not evidence of higher capability, quality, or performance. The result is `n=1` per cell and the public model name is a rolling alias rather than a fixed checkpoint.

Raw summaries: [`results/reasoning-voice-smoke.jsonl`](results/reasoning-voice-smoke.jsonl).
