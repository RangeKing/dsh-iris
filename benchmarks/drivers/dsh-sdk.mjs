import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'

function required(name) {
  const value = process.env[name]
  if (value === undefined || value.trim() === '') throw new Error(`${name} is required`)
  return value
}

function launch(input) {
  const command = required('DSH_BENCH_COMMAND')
  const encoded = required('DSH_BENCH_ARGS')
  const values = JSON.parse(encoded)
  if (!Array.isArray(values) || values.some(value => typeof value !== 'string')) {
    throw new Error('DSH_BENCH_ARGS must be a JSON string array')
  }
  return {
    command,
    args: values.map(value => value
      .replaceAll('{mode}', input.mode)
      .replaceAll('{variant}', input.variant)
      .replaceAll('{workspace}', input.workspace)),
    cwd: input.workspace,
  }
}

function verifierPrompt(task) {
  return `${task.prompt}\n\nWork only in the current benchmark workspace. Complete the task and run the relevant local checks. The benchmark runner verifies the workspace independently; do not merely claim success.`
}

function parseFinalJson(text) {
  const blocks = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/giu)].map(match => match[1])
  const candidates = [...blocks.reverse(), text]
  for (const candidate of candidates) {
    const start = candidate.lastIndexOf('{')
    if (start < 0) continue
    try { return JSON.parse(candidate.slice(start)) } catch { /* try the next candidate */ }
  }
  return { finalResponse: text }
}

function eventMetrics(events, wallTimeMs) {
  const assistantSteps = events.filter(event => event.type === 'turn/end').length
  return {
    wallTimeMs,
    turnCount: assistantSteps,
    assistantSteps,
    toolCallCount: events.filter(event => event.type === 'tool/call').length,
    toolErrorCount: events.filter(event => event.type === 'tool/error').length,
    unknownToolCount: null,
    unknownToolRecoveredCount: null,
  }
}

/** Live paired driver. The supplied config owns Vanilla/Iris composition; SDK owns only transport. */
export async function runBenchmarkCase(input) {
  const startedAt = performance.now()
  await using harness = new DeepSeekHarness({
    launch: { ...launch(input), requestTimeoutMs: input.configuration.timeoutMs },
    cwd: input.workspace,
    provider: process.env.DSH_BENCH_PROVIDER ?? 'deepseek-official',
    model: input.configuration.model,
    maxTokens: Number(process.env.DSH_BENCH_MAX_TOKENS ?? '49152'),
  })
  const result = await harness.run(verifierPrompt(input.task), {
    sessionId: `iris-bench-${input.task.id}-${input.mode}-${input.variant}-${input.run}`,
  })
  return {
    output: { finalResponse: result.finalResponse, parsed: parseFinalJson(result.finalResponse) },
    usage: {},
    metrics: eventMetrics(result.events, Math.round(performance.now() - startedAt)),
    surface: {},
    provider: {
      model: input.configuration.model,
      provider: process.env.DSH_BENCH_PROVIDER ?? 'deepseek-official',
    },
  }
}
