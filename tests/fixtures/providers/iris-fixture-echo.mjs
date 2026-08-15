export const name = 'iris-fixture-echo-provider'
export const inject = ['tools']
export const toolName = 'iris_fixture_echo'

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

export const definition = {
  name: toolName,
  description: 'Echo a string in the dsh-iris lifecycle fixture.',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string' },
    },
    required: ['text'],
    additionalProperties: false,
  },
  output: {
    schema: { type: 'string' },
    render: (_args, value) => [{ type: 'text', text: value }],
  },
  execute: ({ text }) => {
    fixtureState.calls += 1
    return Promise.resolve(`echo:${text}`)
  },
}

export async function apply(ctx, config = {}) {
  fixtureState.applies += 1
  ctx.effect(() => () => {
    fixtureState.disposes += 1
  }, 'iris-fixture-echo.lifecycle')
  if (!config.skipRegister) ctx.tools.register(definition)
  if (config.gate !== undefined) await config.gate
  if (config.failAfterRegister) throw new Error('iris fixture apply failure')
}
