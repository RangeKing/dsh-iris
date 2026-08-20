import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'

import type { CapabilityDescriptor } from '../domain/index.js'

const MCP_TOOL_PREFIX = 'mcp__'
const MCP_NAMESPACE_SEPARATOR = '__'
const MCP_SERVER_TOKEN = /^[A-Za-z0-9_-]{1,32}$/u

interface ToolSchemaObservation {
  readonly name: string
  readonly description: string
  readonly parameters: unknown
}

/** Public-name facts recoverable without reaching into MCP client internals. */
export interface DshMcpToolIdentity {
  readonly serverName: string
  readonly toolName: string
  readonly dshToolName: string
}

/**
 * Recognize DSH's published MCP Tool naming contract in one centralized adapter.
 * The MCP client does not retain raw protocol names in ToolDefinition metadata,
 * so normalized or ambiguous names remain represented by their DSH public token.
 */
export function parseDshMcpToolName(name: string): DshMcpToolIdentity | undefined {
  if (!name.startsWith(MCP_TOOL_PREFIX)) return undefined
  const qualified = name.slice(MCP_TOOL_PREFIX.length)
  const separator = qualified.indexOf(MCP_NAMESPACE_SEPARATOR)
  if (separator <= 0) return undefined
  const serverName = qualified.slice(0, separator)
  const toolName = qualified.slice(separator + MCP_NAMESPACE_SEPARATOR.length)
  if (!MCP_SERVER_TOKEN.test(serverName) || toolName.length === 0) return undefined
  return { serverName, toolName, dshToolName: name }
}

function parameterKeywords(parameters: unknown): readonly string[] {
  if (typeof parameters !== 'object' || parameters === null || Array.isArray(parameters)) return []
  const properties = (parameters as { readonly properties?: unknown }).properties
  if (typeof properties !== 'object' || properties === null || Array.isArray(properties)) return []
  return Object.keys(properties).sort().slice(0, 16)
}

/**
 * Map one already-registered DSH MCP Tool into metadata-only Iris discovery.
 *
 * `name` is the full DSH-registered Tool token (`mcp__<server>__<tool>`), the
 * same token `tools.get`/`tools.restrict` address it by; the abbreviated name
 * stays available in `provenance.toolName` (and the `id`).
 */
export function mcpToolCapability(tool: ToolSchemaObservation): CapabilityDescriptor | undefined {
  const identity = parseDshMcpToolName(tool.name)
  if (identity === undefined) return undefined
  return {
    id: `mcp:${identity.serverName}/${identity.toolName}`,
    kind: 'mcp',
    name: identity.dshToolName,
    description: tool.description,
    keywords: [identity.serverName, ...parameterKeywords(tool.parameters)],
    source: 'installed',
    trust: 'known',
    providerId: identity.serverName,
    provenance: {
      kind: 'dsh-mcp-tool',
      reference: identity.dshToolName,
      serverName: identity.serverName,
      toolName: identity.toolName,
    },
  }
}

/** Live Agent-scoped view over MCP Tools already registered in DSH ToolRuntime. */
export class DshMcpCapabilitySource {
  private readonly agent: Agent

  constructor(private readonly agentCtx: Context) {
    const agent = (agentCtx as Context & { readonly agent?: Agent }).agent
    if (agent === undefined) throw new Error('dsh-iris: DSH MCP source requires agentCtx.agent')
    this.agent = agent
  }

  list(): readonly CapabilityDescriptor[] {
    return this.agentCtx.tools.schemas(this.agent)
      .map(mcpToolCapability)
      .filter((capability): capability is CapabilityDescriptor => capability !== undefined)
  }

  find(capabilityId: string): CapabilityDescriptor | undefined {
    return this.list().find(capability => capability.id === capabilityId)
  }
}
