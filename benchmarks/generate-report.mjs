#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { aggregateLive } from './lib.mjs'

const input = resolve(process.argv[2] ?? './benchmarks/results/smoke.jsonl')
const output = resolve(process.argv[3] ?? './benchmarks/REPORT.md')
const text = await readFile(input, 'utf8')
const records = text.split(/\r?\n/u).filter(Boolean).map(line => JSON.parse(line))
const aggregate = aggregateLive(records)
const modes = ['minimal', 'standard', 'code', 'cordis']
const rows = modes.map((mode) => {
  const vanilla = aggregate.find(cell => cell.mode === mode && cell.variant === 'vanilla')
  const iris = aggregate.find(cell => cell.mode === mode && cell.variant === 'iris')
  if (vanilla === undefined || iris === undefined) return `| ${mode} | pending | pending | — | — | — | — |`
  const percentage = value => `${(value * 100).toFixed(1)}%`
  const reduction = vanilla.averageInitialVisibleTools === null
    || iris.averageInitialVisibleTools === null
    || vanilla.averageInitialVisibleTools === 0
    ? '—'
    : percentage(1 - iris.averageInitialVisibleTools / vanilla.averageInitialVisibleTools)
  const inputDelta = vanilla.averageInputTokens === null || iris.averageInputTokens === null
    ? '—'
    : (iris.averageInputTokens - vanilla.averageInputTokens).toFixed(0)
  const turnDelta = vanilla.averageTurns === null || iris.averageTurns === null
    ? '—'
    : (iris.averageTurns - vanilla.averageTurns).toFixed(2)
  return `| ${mode} | ${percentage(vanilla.successRate)} | ${percentage(iris.successRate)} | ${percentage(iris.successRate - vanilla.successRate)} | ${inputDelta} | ${turnDelta} | ${reduction} |`
})
const hasLive = aggregate.length > 0
const report = `# dsh-iris benchmark report

Generated from \`${relative(process.cwd(), input)}\`. Synthetic harness validation records are excluded from performance aggregates.

${hasLive ? 'Live paired results are available below.' : '**Reproducible benchmark included. Live V4-Pro results pending.**'}

| Mode | Vanilla success | Iris success | Δ success | Δ input tokens | Δ turns | Initial surface reduction |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
${rows.join('\n')}

## Configuration discipline

Both variants use the same task, model string, reasoning effort, temperature, top-p, timeout, and retry policy. The runner records whether the model string is a rolling alias; it does not infer a pinned checkpoint. Raw records remain the authority.
`
await writeFile(output, report)
console.log(`Wrote ${output}`)
