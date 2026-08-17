import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { resolveConfig } from '../../src/config.js'
import * as irisPlugin from '../../src/index.js'

const root = resolve(import.meta.dirname, '../..')

describe('dsh-iris public identity', () => {
  it('uses the Iris package, Bundle, and config names', async () => {
    const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as {
      name: string
      version: string
      description: string
    }
    const patch = await readFile(resolve(root, 'cordis.patch.yml'), 'utf8')

    expect(pkg).toMatchObject({
      name: 'dsh-iris',
      version: '0.1.0',
      description: 'Progressive capability routing for DeepSeek Harness.',
    })
    expect(irisPlugin.name).toBe('dsh-iris')
    expect(resolveConfig()).toMatchObject({
      iris: { enabled: true, policy: 'auto', providers: [] },
    })
    expect(patch).toContain('id: dsh-iris')
    expect(patch).toContain('iris:')
  })
})
