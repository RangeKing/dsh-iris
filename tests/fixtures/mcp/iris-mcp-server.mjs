import { appendFileSync } from 'node:fs'

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

const tracePath = process.env.IRIS_MCP_TRACE_PATH

function trace(event) {
  if (tracePath !== undefined) appendFileSync(tracePath, `${event}\n`)
}

trace('start')

const server = new Server(
  { name: 'iris-mcp-fixture', version: '1.0.0' },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, () => {
  trace('tools/list')
  return {
    tools: [{
      name: 'create_issue',
      description: 'Create a GitHub issue with a repository, title, and body.',
      inputSchema: {
        type: 'object',
        properties: {
          repository: { type: 'string' },
          title: { type: 'string' },
          body: { type: 'string' },
        },
        required: ['repository', 'title'],
      },
    }],
  }
})

server.setRequestHandler(CallToolRequestSchema, (request) => {
  trace(`tools/call:${request.params.name}`)
  return {
    content: [{
      type: 'text',
      text: `created:${String(request.params.arguments?.repository)}/${String(request.params.arguments?.title)}`,
    }],
  }
})

await server.connect(new StdioServerTransport())
