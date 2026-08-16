#!/usr/bin/env node
import { appendFile, mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import {
  createTaskWorkspace,
  disposeTaskWorkspace,
  readTasks,
  verifyTask,
} from './lib.mjs'

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index < 0 ? fallback : process.argv[index + 1]
}

const runs = Number(option('runs', '5'))
if (!Number.isInteger(runs) || runs < 1) throw new Error('--runs must be a positive integer')
const driverPath = resolve(option('driver', './benchmarks/drivers/synthetic.mjs'))
const outputPath = resolve(option('output', './benchmarks/results/smoke.jsonl'))
const measurementKind = option('kind', driverPath.endsWith('/synthetic.mjs') ? 'synthetic' : 'live')
if (measurementKind === 'live' && process.env.DEEPSEEK_API_KEY === undefined) {
  throw new Error('DEEPSEEK_API_KEY is required for a live V4-Pro benchmark')
}
const driver = await import(pathToFileURL(driverPath).href)
if (typeof driver.runBenchmarkCase !== 'function') throw new Error('driver must export runBenchmarkCase(input)')
const tasks = await readTasks()
const modes = ['minimal', 'standard', 'code', 'cordis']
const variants = ['vanilla', 'iris']
const commit = (() => {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() } catch { return null }
})()
await mkdir(new URL('./results/', import.meta.url), { recursive: true })
await rm(outputPath, { force: true })

for (const task of tasks) {
  for (const mode of modes.filter(candidate => task.modes.includes(candidate))) {
    for (const variant of variants) {
      for (let run = 1; run <= runs; run += 1) {
        const workspace = await createTaskWorkspace(task, `${task.id}-${mode}-${variant}-${run}`)
        const configuration = {
          model: 'deepseek-v4-pro',
          modelCheckpoint: null,
          testedAt: new Date().toISOString(),
          reasoningEffort: 'max',
          temperature: 1,
          topP: 0.95,
          harnessVersion: '0.1.0-rc.6',
          irisVersion: '0.1.0',
          irisCommit: commit,
          timeoutMs: 900000,
          retryPolicy: 'no automatic benchmark retry',
        }
        try {
          const result = await driver.runBenchmarkCase({
            task,
            mode,
            variant,
            run,
            configuration,
            workspace,
          })
          const record = {
            schemaVersion: 1,
            measurementKind,
            taskId: task.id,
            mode,
            variant,
            run,
            configuration,
            verifier: await verifyTask(task, result.output, workspace),
            output: result.output ?? null,
            usage: {
              inputTokens: null,
              outputTokens: null,
              cacheReadTokens: null,
              cacheWriteTokens: null,
              cacheHit: null,
              ...result.usage,
            },
            metrics: {
              turnCount: null,
              toolCallCount: null,
              wallTimeMs: null,
              ...result.metrics,
            },
            surface: {
              initialVisibleTools: null,
              maxVisibleTools: null,
              transitions: null,
              visibleSchemaChars: null,
              promptChars: null,
              codeSdkChars: null,
              availableBindings: null,
              ...result.surface,
            },
            provider: result.provider ?? {},
          }
          await appendFile(outputPath, `${JSON.stringify(record)}\n`)
        } finally {
          await disposeTaskWorkspace(workspace)
        }
      }
    }
  }
}
console.log(`Wrote ${outputPath}`)
