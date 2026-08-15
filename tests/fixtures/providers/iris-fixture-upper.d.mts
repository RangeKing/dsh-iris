import type { Plugin } from '@deepseek-ai/cordis'

export const name: 'iris-fixture-upper-provider'
export const toolName: 'iris_fixture_upper'
export const fixtureState: {
  applies: number
  calls: number
  disposes: number
  reset(): void
}
export const apply: Plugin
