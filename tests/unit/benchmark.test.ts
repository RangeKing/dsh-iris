import { describe, expect, it } from 'vitest'

import {
  aggregateLive,
  createTaskWorkspace,
  disposeTaskWorkspace,
  verifyTask,
} from '../../benchmarks/lib.mjs'

describe('launch benchmark harness', () => {
  it('machine-verifies task output', async () => {
    const task = { verifier: { kind: 'json-field', field: 'passed', equals: true } }
    await expect(verifyTask(task, { passed: true })).resolves.toEqual({
      passed: true,
      expected: true,
      actual: true,
    })
    expect((await verifyTask(task, { passed: false })).passed).toBe(false)
  })

  it('verifies the isolated workspace instead of trusting model text', async () => {
    const task = {
      fixture: { files: { 'answer.txt': 'wrong\n' } },
      verifier: { kind: 'file-content', path: 'answer.txt', equals: 'right\n' },
    }
    const workspace = await createTaskWorkspace(task, 'verifier-test')
    try {
      expect((await verifyTask(task, { claimedSuccess: true }, workspace)).passed).toBe(false)
    } finally {
      await disposeTaskWorkspace(workspace)
    }
  })

  it('excludes synthetic smoke data from launch aggregates', () => {
    expect(aggregateLive([{ measurementKind: 'synthetic' }])).toEqual([])
  })
})
