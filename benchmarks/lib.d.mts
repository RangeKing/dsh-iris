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
  readonly schemaVersion?: number
  readonly measurementKind: string
  readonly evidenceLevel?: 'synthetic' | 'exploratory' | 'primary'
  readonly runId?: string
  readonly sampleId?: string
  readonly pairId?: string
  readonly order?: number
  readonly timestamp?: string
  readonly taskId?: string
  readonly mode?: string
  readonly variant?: string
  readonly model?: string
  readonly modelAlias?: string
  readonly harnessVersion?: string
  readonly irisVersion?: string | null
  readonly workspaceId?: string
  readonly verifier?: { readonly passed: boolean }
  readonly usage?: {
    readonly inputTokens?: number | null
    readonly cachedInputTokens?: number | null
    readonly outputTokens?: number | null
    readonly reasoningTokens?: number | null
  }
  readonly metrics?: {
    readonly turnCount?: number | null
    readonly assistantSteps?: number | null
    readonly toolCallCount?: number | null
    readonly toolErrorCount?: number | null
    readonly unknownToolCount?: number | null
    readonly unknownToolRecoveredCount?: number | null
    readonly wallTimeMs?: number | null
  }
  readonly surface?: {
    readonly firstRequestVisibleToolCount?: number | null
    readonly firstRequestToolSchemaChars?: number | null
    readonly firstRequestSystemPromptChars?: number | null
    readonly codeSdkChars?: number | null
    readonly packTransitions?: number | null
    readonly initialVisibleTools?: number | null
  }
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
