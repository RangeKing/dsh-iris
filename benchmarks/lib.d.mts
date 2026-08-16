export interface BenchmarkTask {
  readonly fixture?: {
    readonly files?: Readonly<Record<string, string>>
  }
  readonly syntheticSolution?: Readonly<Record<string, string>>
  readonly verifier: Readonly<{
    readonly kind: string
    readonly field?: string
    readonly path?: string
    readonly equals?: unknown
    readonly command?: string
    readonly args?: readonly string[]
    readonly timeoutMs?: number
  }>
}

export interface BenchmarkRecord {
  readonly measurementKind: string
  readonly mode?: string
  readonly variant?: string
  readonly verifier?: { readonly passed: boolean }
  readonly usage?: { readonly inputTokens?: number; readonly outputTokens?: number }
  readonly metrics?: { readonly turnCount?: number }
  readonly surface?: { readonly initialVisibleTools?: number }
}

export function verifyTask(
  task: BenchmarkTask,
  output: Record<string, unknown> | undefined,
  workspace?: string,
): Promise<{ readonly passed: boolean; readonly expected: unknown; readonly actual: unknown }>

export function createTaskWorkspace(task: BenchmarkTask, label: string): Promise<string>

export function disposeTaskWorkspace(workspace: string): Promise<void>

export function applySyntheticSolution(task: BenchmarkTask, workspace: string): Promise<void>

export function aggregateLive(records: readonly BenchmarkRecord[]): readonly unknown[]
