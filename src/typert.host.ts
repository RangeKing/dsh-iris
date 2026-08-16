import { z } from 'zod'

const agentIdSchema = z.union([z.string(), z.null()])
const snapshotSchema = z.unknown()

/** Public DSH Host Remote manifest for the read-only Iris snapshot. */
export const TYPERT = {
  package: 'dsh-iris',
  face: 'host',
  schemas: [],
  invocations: [{
    id: 'dsh-iris#iris/snapshot',
    service: 'irisRemote',
    namespace: 'iris',
    method: 'snapshot',
    invocation: { kind: 'direct' },
    parameters: [{
      name: 'agentId',
      wire: 'agentId',
      source: 'json',
      codec: {
        mode: 'strict',
        typeSymbol: 'dsh-iris/snapshot#IrisWebAgentId',
        schema: agentIdSchema,
      },
    }],
    result: {
      mode: 'strict',
      typeSymbol: 'dsh-iris/snapshot#IrisWebSnapshot',
      schema: snapshotSchema,
    },
    sourceLocation: { file: 'src/index.ts', line: 24, column: 3 },
  }],
  model: {
    services: [],
    events: [],
    objects: [],
  },
}

export default TYPERT
