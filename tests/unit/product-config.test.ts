import { describe, expect, it } from 'vitest'

import { Config } from '../../src/config.js'

describe('v0.1 Bundle config', () => {
  it('starts enabled with automatic mode selection and an empty local catalog', () => {
    expect(Config({})).toEqual({
      iris: {
        enabled: true,
        policy: 'auto',
        providers: [],
        logLevel: 'info',
        discovery: {
          enabled: true,
          cacheTtlMs: 900_000,
          maxResults: 10,
        },
      },
    })
  })

  it('accepts one configured local Tool provider and an explicit policy', () => {
    expect(Config({
      iris: {
        policy: 'adaptive',
        providers: [{
          id: 'example',
          module: '/opt/dsh/providers/example.mjs',
          capabilities: [{ id: 'example_tool', kind: 'tool', ptcCompatible: true }],
        }],
      },
    })).toMatchObject({
      iris: {
        enabled: true,
        policy: 'adaptive',
        providers: [{
          id: 'example',
          capabilities: [{ id: 'example_tool', kind: 'tool', ptcCompatible: true }],
        }],
      },
    })
  })
})
