export const name = 'dsh-iris-example-local-text-tools'
export const inject = ['tools']

const definition = {
  name: 'text_word_count',
  description: 'Count words, characters, and lines in local text.',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Text to count.' },
    },
    required: ['text'],
    additionalProperties: false,
  },
  output: {
    schema: {
      type: 'object',
      properties: {
        words: { type: 'integer' },
        characters: { type: 'integer' },
        lines: { type: 'integer' },
      },
      required: ['words', 'characters', 'lines'],
      additionalProperties: false,
    },
    render: (_args, value) => [{
      type: 'text',
      text: `${value.words} words, ${value.characters} characters, ${value.lines} lines`,
    }],
  },
  execute: ({ text }) => Promise.resolve({
    words: text.trim().length === 0 ? 0 : text.trim().split(/\s+/u).length,
    characters: [...text].length,
    lines: text.length === 0 ? 0 : text.split(/\r?\n/u).length,
  }),
}

export function apply(ctx) {
  ctx.tools.register(definition)
}
