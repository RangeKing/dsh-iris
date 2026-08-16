import { applySyntheticSolution } from '../lib.mjs'

/** Contract-only driver. Its records are never included in launch performance claims. */
export async function runBenchmarkCase(input) {
  await applySyntheticSolution(input.task, input.workspace)
  return {
    measurementKind: 'synthetic',
    output: {
      testsPassed: true,
      todoFileListCorrect: true,
      sourceMatched: true,
      bothRepairsPassed: true,
      pluginVerified: true,
    },
    usage: {},
    metrics: {
      turnCount: 1,
      toolCallCount: 0,
      wallTimeMs: 0,
    },
    surface: {
      initialVisibleTools: input.variant === 'iris' ? 2 : 8,
      maxVisibleTools: input.variant === 'iris' ? 2 : 8,
      transitions: [],
    },
  }
}
