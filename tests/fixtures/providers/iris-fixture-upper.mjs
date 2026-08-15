export const name = 'iris-fixture-upper-provider'
export const toolName = 'iris_fixture_upper'

export const fixtureState = {
  applies: 0,
  calls: 0,
  disposes: 0,
  reset() {
    this.applies = 0
    this.calls = 0
    this.disposes = 0
  },
}

export function apply(ctx) {
  fixtureState.applies += 1
  ctx.effect(() => () => { fixtureState.disposes += 1 })
  ctx.tools.register({
    name: toolName,
    description: 'Uppercase local text.',
    parameters: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute: ({ text }) => {
      fixtureState.calls += 1
      return Promise.resolve(text.toUpperCase())
    },
  })
}
