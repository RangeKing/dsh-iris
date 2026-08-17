#!/usr/bin/env node
import { performance } from 'node:perf_hooks'
import { buildCatalogSnapshot, CapabilityRanker } from '../../lib/capabilities/rank.js'
import { generateCatalog } from './generate.mjs'

const sizes = (process.argv.find(argument => argument.startsWith('--sizes='))?.slice('--sizes='.length)
  ?? '1000,10000,50000')
  .split(',')
  .map(Number)
if (sizes.some(size => !Number.isInteger(size) || size < 1)) throw new Error('--sizes must be positive integers')

const ranker = new CapabilityRanker()
const percentile = (values, quantile) => {
  const ordered = [...values].sort((left, right) => left - right)
  return ordered[Math.min(ordered.length - 1, Math.floor((ordered.length - 1) * quantile))] ?? null
}
const serialized = result => JSON.stringify(result.map(item => ({
  id: item.capability.id,
  score: item.score,
  reasons: item.reasons,
})))

function queries(size) {
  const width = Math.max(4, String(size - 1).length)
  const rare = String(7).padStart(width, '0')
  return [
    { name: 'exact id', query: `tool:synthetic_${String(0).padStart(width, '0')}` },
    { name: 'exact name', query: `exact_lookup_${rare}` },
    { name: 'exact keyword', query: `exact_keyword_${rare}` },
    { name: 'common token', query: 'common' },
    { name: 'rare token', query: 'rare' },
    { name: 'description substring', query: 'precip' },
    { name: 'visible penalty', query: 'common', visible: [`tool:synthetic_${String(0).padStart(width, '0')}`] },
    { name: 'kind filter', query: 'common', kind: 'skill' },
    { name: 'PTC filter', query: 'common', requirePtcCompatible: true },
    { name: 'no match', query: 'zzzznomatch' },
  ]
}

function compare(legacy, indexed, label) {
  const left = serialized(legacy)
  const right = serialized(indexed)
  if (left !== right) throw new Error(`legacy/indexed mismatch for ${label}\nlegacy=${left}\nindexed=${right}`)
}

const output = []
for (const size of sizes) {
  const catalog = generateCatalog(size)
  if (typeof global.gc === 'function') global.gc()
  const beforeHeap = process.memoryUsage().heapUsed
  const started = performance.now()
  const snapshot = buildCatalogSnapshot(catalog)
  const buildMs = performance.now() - started
  if (typeof global.gc === 'function') global.gc()
  const heapDeltaBytes = process.memoryUsage().heapUsed - beforeHeap
  const cases = queries(size)
  const legacyTimes = []
  const indexedTimes = []
  let checksum = 0
  for (const query of cases) {
    const legacy = ranker.rank(catalog, query)
    const indexed = ranker.rankIndexed(snapshot, query)
    compare(legacy, indexed, `${size}:${query.name}`)
    const legacyStart = performance.now()
    for (let iteration = 0; iteration < 5; iteration += 1) checksum += ranker.rank(catalog, query).length
    legacyTimes.push((performance.now() - legacyStart) / 5)
    const indexedStart = performance.now()
    for (let iteration = 0; iteration < 5; iteration += 1) checksum += ranker.rankIndexed(snapshot, query).length
    indexedTimes.push((performance.now() - indexedStart) / 5)
  }
  output.push({
    size,
    buildMs: Number(buildMs.toFixed(3)),
    legacyQueryP50Ms: Number(percentile(legacyTimes, 0.5).toFixed(3)),
    legacyQueryP95Ms: Number(percentile(legacyTimes, 0.95).toFixed(3)),
    indexedQueryP50Ms: Number(percentile(indexedTimes, 0.5).toFixed(3)),
    indexedQueryP95Ms: Number(percentile(indexedTimes, 0.95).toFixed(3)),
    heapDeltaBytes,
    equivalenceCases: cases.length,
    checksum,
  })
}
console.log(JSON.stringify({ deterministic: true, output }, null, 2))
