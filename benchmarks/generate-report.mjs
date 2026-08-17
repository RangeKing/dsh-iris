#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { aggregateLive } from './lib.mjs'

const input = resolve(process.argv[2] ?? './benchmarks/results/smoke.jsonl')
const output = resolve(process.argv[3] ?? './benchmarks/REPORT.md')
const records = (await readFile(input, 'utf8'))
  .split(/\r?\n/u)
  .filter(Boolean)
  .map(line => JSON.parse(line))

const pairVariants = new Map()
for (const record of records) {
  if (typeof record.pairId !== 'string') continue
  const variants = pairVariants.get(record.pairId) ?? new Set()
  if (typeof record.variant === 'string') variants.add(record.variant)
  pairVariants.set(record.pairId, variants)
}
const repeatedPairedSamples = new Map()
for (const record of records) {
  if (typeof record.pairId !== 'string' || pairVariants.get(record.pairId)?.size < 2) continue
  const key = `${record.taskId ?? 'unknown'}:${record.mode ?? 'unknown'}`
  const pairs = repeatedPairedSamples.get(key) ?? new Set()
  pairs.add(record.pairId)
  repeatedPairedSamples.set(key, pairs)
}

function evidenceLevel(record) {
  if (record.measurementKind === 'synthetic' || record.evidenceLevel === 'synthetic') return 'synthetic'
  const checkpoint = record.modelCheckpoint ?? record.configuration?.modelCheckpoint
  const hasFixedCheckpoint = typeof checkpoint === 'string' && checkpoint.length > 0
  const hasPairMetadata = typeof record.runId === 'string'
    && typeof record.sampleId === 'string'
    && typeof record.pairId === 'string'
    && typeof record.timestamp === 'string'
  const repeatedPairs = repeatedPairedSamples.get(`${record.taskId ?? 'unknown'}:${record.mode ?? 'unknown'}`)?.size ?? 0
  return record.evidenceLevel === 'primary' && hasFixedCheckpoint && hasPairMetadata && repeatedPairs >= 2
    ? 'primary'
    : 'exploratory'
}

function formatNumber(value, digits = 0) {
  return Number.isFinite(value) ? value.toFixed(digits) : '—'
}

function percentage(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—'
}

const levels = [...new Set(records.map(evidenceLevel))]
const aggregate = aggregateLive(records)
const modes = ['minimal', 'standard', 'code', 'cordis']
const rows = modes.flatMap((mode) => ['vanilla', 'iris'].map((variant) => {
  const cell = aggregate.find(item => item.mode === mode && item.variant === variant)
  if (cell === undefined) return `| ${mode} | ${variant} | — | — | — | — | — | — | — |`
  const evidence = cell.evidenceLevels.join(', ')
  return `| ${mode} | ${variant} | ${evidence} | ${cell.n} | ${cell.modelStrings.join(', ') || '—'} | ${cell.runDates.join(', ') || '—'} | ${percentage(cell.successRate)} | ${formatNumber(cell.averageInputTokens)} | ${formatNumber(cell.averageAssistantSteps, 2)} |`
}))

const pairedRows = modes.map((mode) => {
  const vanilla = aggregate.find(cell => cell.mode === mode && cell.variant === 'vanilla')
  const iris = aggregate.find(cell => cell.mode === mode && cell.variant === 'iris')
  if (vanilla === undefined || iris === undefined) return `| ${mode} | pending | pending | — | — | — |`
  const sufficient = Math.min(vanilla.n, iris.n) >= 20
  const deltaSuccess = sufficient ? percentage(iris.successRate - vanilla.successRate) : '—'
  const inputDelta = vanilla.averageInputTokens === null || iris.averageInputTokens === null
    ? '—'
    : formatNumber(iris.averageInputTokens - vanilla.averageInputTokens)
  const turnDelta = vanilla.averageAssistantSteps === null || iris.averageAssistantSteps === null
    ? '—'
    : formatNumber(iris.averageAssistantSteps - vanilla.averageAssistantSteps, 2)
  return `| ${mode} | ${vanilla.n}/${iris.n} | ${percentage(vanilla.successRate)} / ${percentage(iris.successRate)} | ${deltaSuccess} | ${inputDelta} | ${turnDelta} |`
})

const report = `# dsh-iris benchmark report

Raw JSONL: \`${relative(process.cwd(), input)}\`<br>
Generated: ${new Date().toISOString()}<br>
Observed evidence levels: ${levels.join(', ') || 'none'}

Evidence classification is explicit: synthetic records are deterministic structural checks; exploratory records are live or low-sample observations; primary records require a fixed checkpoint and complete paired metadata. A requested primary label is downgraded to exploratory when those facts are absent. The default recommendation is 20 repeated paired samples; it is not a universal statistical threshold.

## Records

| Mode | Variant | Evidence | n | Model | Run dates | Success | Avg input tokens | Avg assistant steps |
| --- | --- | --- | ---: | --- | --- | ---: | ---: | ---: |
${rows.join('\n')}

## Paired description

| Mode | n vanilla/iris | Success vanilla / iris | Δ success | Δ input tokens | Δ assistant steps |
| --- | ---: | ---: | ---: | ---: | ---: |
${pairedRows.join('\n')}

The paired table is descriptive. Δ success is withheld until both variants have at least 20 samples, and no low-sample row is converted into a causal “improves performance by X%” conclusion. Raw JSONL remains authoritative; missing provider usage is recorded as null/unavailable rather than estimated.
`
await writeFile(output, report)
console.log(`Wrote ${output}`)
