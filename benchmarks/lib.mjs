import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export async function readTasks(url = new URL('./tasks.json', import.meta.url)) {
  const parsed = JSON.parse(await readFile(url, 'utf8'))
  if (!Array.isArray(parsed.tasks) || parsed.tasks.length === 0) {
    throw new Error('benchmark task matrix must contain tasks')
  }
  return parsed.tasks
}

export async function createTaskWorkspace(task, label) {
  const workspace = await mkdtemp(join(tmpdir(), `dsh-iris-bench-${label}-`))
  for (const [relativePath, content] of Object.entries(task.fixture?.files ?? {})) {
    const target = join(workspace, relativePath)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content)
  }
  return workspace
}

export async function disposeTaskWorkspace(workspace) {
  if (process.env.DSH_BENCH_KEEP_WORKSPACES === '1') return
  await rm(workspace, { recursive: true, force: true })
}

export async function applySyntheticSolution(task, workspace) {
  for (const [relativePath, content] of Object.entries(task.syntheticSolution ?? {})) {
    const target = join(workspace, relativePath)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content)
  }
}

export async function verifyTask(task, output, workspace) {
  if (task.verifier.kind === 'json-field') {
    return {
      passed: output?.[task.verifier.field] === task.verifier.equals,
      expected: task.verifier.equals,
      actual: output?.[task.verifier.field] ?? null,
    }
  }
  if (workspace === undefined) throw new Error(`${task.verifier.kind} verifier requires a workspace`)
  if (task.verifier.kind === 'command') {
    try {
      const { stdout, stderr } = await execFileAsync(task.verifier.command, task.verifier.args ?? [], {
        cwd: workspace,
        timeout: task.verifier.timeoutMs ?? 30_000,
      })
      return { passed: true, expected: 'exit 0', actual: 'exit 0', stdout, stderr }
    } catch (error) {
      return {
        passed: false,
        expected: 'exit 0',
        actual: error instanceof Error ? error.message : String(error),
      }
    }
  }
  if (task.verifier.kind === 'file-content') {
    const actual = await readFile(join(workspace, task.verifier.path), 'utf8').catch(() => null)
    return { passed: actual === task.verifier.equals, expected: task.verifier.equals, actual }
  }
  if (task.verifier.kind === 'json-file') {
    const actual = await readFile(join(workspace, task.verifier.path), 'utf8')
      .then(text => JSON.parse(text))
      .catch(() => null)
    const expected = task.verifier.equals
    const passed = actual !== null
      && Object.entries(expected).every(([key, value]) => actual[key] === value)
    return { passed, expected, actual }
  }
  if (task.verifier.kind === 'dsh-plugin') {
    const packageJson = await readFile(join(workspace, 'package.json'), 'utf8')
      .then(text => JSON.parse(text))
      .catch(() => null)
    const patchText = await readFile(join(workspace, 'cordis.patch.yml'), 'utf8').catch(() => '')
    const plugin = await readFile(join(workspace, 'plugin.mjs'), 'utf8').catch(() => '')
    const passed = packageJson?.name === 'dsh-benchmark-plugin'
      && packageJson?.exports?.['.'] === './plugin.mjs'
      && packageJson?.dsh?.bundle?.patch === './cordis.patch.yml'
      && patchText.includes('./plugin.mjs')
      && plugin.includes('bench_fixture_echo')
      && plugin.includes('ctx.tools.register')
    return {
      passed,
      expected: 'valid dsh-benchmark-plugin declaring bench_fixture_echo',
      actual: passed ? 'valid' : 'invalid or incomplete plugin fixture',
    }
  }
  throw new Error(`unsupported verifier ${task.verifier.kind}`)
}

export function aggregateLive(records) {
  const live = records.filter(record => record.measurementKind === 'live')
  const cells = new Map()
  for (const record of live) {
    const key = `${record.mode}:${record.variant}`
    const cell = cells.get(key) ?? {
      mode: record.mode,
      variant: record.variant,
      runs: 0,
      successes: 0,
      inputTokens: 0,
      inputTokenSamples: 0,
      outputTokens: 0,
      outputTokenSamples: 0,
      turns: 0,
      turnSamples: 0,
      initialVisibleTools: 0,
      initialVisibleToolSamples: 0,
    }
    cell.runs += 1
    cell.successes += record.verifier.passed ? 1 : 0
    if (Number.isFinite(record.usage?.inputTokens)) {
      cell.inputTokens += record.usage.inputTokens
      cell.inputTokenSamples += 1
    }
    if (Number.isFinite(record.usage?.outputTokens)) {
      cell.outputTokens += record.usage.outputTokens
      cell.outputTokenSamples += 1
    }
    if (Number.isFinite(record.metrics?.turnCount)) {
      cell.turns += record.metrics.turnCount
      cell.turnSamples += 1
    }
    if (Number.isFinite(record.surface?.initialVisibleTools)) {
      cell.initialVisibleTools += record.surface.initialVisibleTools
      cell.initialVisibleToolSamples += 1
    }
    cells.set(key, cell)
  }
  return [...cells.values()].map(cell => ({
    ...cell,
    successRate: cell.runs === 0 ? null : cell.successes / cell.runs,
    averageInputTokens: cell.inputTokenSamples === 0 ? null : cell.inputTokens / cell.inputTokenSamples,
    averageOutputTokens: cell.outputTokenSamples === 0 ? null : cell.outputTokens / cell.outputTokenSamples,
    averageTurns: cell.turnSamples === 0 ? null : cell.turns / cell.turnSamples,
    averageInitialVisibleTools: cell.initialVisibleToolSamples === 0
      ? null
      : cell.initialVisibleTools / cell.initialVisibleToolSamples,
  }))
}
