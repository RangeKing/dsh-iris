import { readFile } from 'node:fs/promises'

import yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'

interface PackageManifest {
  dsh?: { bundle?: { patch?: string } }
}

describe('DSH Bundle manifest', () => {
  it('points at a patch that inserts the dsh-iris plugin', async () => {
    const manifest = JSON.parse(
      await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as PackageManifest
    const expectedEntry = JSON.parse(
      await readFile(
        new URL('../fixtures/bundle/expected-entry.json', import.meta.url),
        'utf8',
      ),
    ) as unknown
    const patchPath = manifest.dsh?.bundle?.patch

    expect(patchPath).toBe('./cordis.patch.yml')

    const patch = yaml.load(
      await readFile(new URL(`../../${patchPath}`, import.meta.url), 'utf8'),
    )

    expect(patch).toEqual([
      {
        insert: [expectedEntry],
      },
    ])
  })
})
