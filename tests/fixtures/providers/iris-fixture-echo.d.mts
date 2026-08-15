import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

export const name: 'iris-fixture-echo-provider'
export const inject: readonly ['tools']
export const toolName: 'iris_fixture_echo'
export const definition: ToolDefinition
export const fixtureState: {
  applies: number
  calls: number
  disposes: number
  reset(): void
}
export interface FixtureConfig {
  readonly gate?: Promise<void>
  readonly failAfterRegister?: boolean
  readonly skipRegister?: boolean
}
export function apply(ctx: Context, config?: FixtureConfig): Promise<void>
