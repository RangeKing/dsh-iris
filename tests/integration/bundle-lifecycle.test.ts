import { Context } from '@deepseek-ai/cordis'
import type AgentRegistry from '@deepseek-ai/dsh-agent'
import type SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import type SkillRegistry from '@deepseek-ai/dsh-skill'
import type ToolRuntime from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'

import * as irisPlugin from '../../src/index.js'

describe('dsh-iris plugin lifecycle', () => {
  it('waits for tools, activates, and disposes cleanly', async () => {
    const root = new Context()
    const fiber = root.plugin(irisPlugin)

    // FiberState is a public ambient const enum in Cordis 4.0.1, so it has no
    // runtime export. These values deliberately verify that published contract.
    expect(fiber.state).toBe(0) // PENDING

    root.provide('tools', Object.freeze({}) as ToolRuntime)
    root.provide('systemPrompt', Object.freeze({}) as SystemPrompt)
    root.provide('skills', Object.freeze({}) as SkillRegistry)
    root.provide('agents', Object.freeze({ list: () => [] }) as unknown as AgentRegistry)
    await fiber

    expect(fiber.state).toBe(2) // ACTIVE

    await fiber.dispose()
    expect(fiber.state).toBe(4) // DISPOSED

    await root.fiber.dispose()
  })
})
