import type {
  RemoteResult,
  TypertRemoteContribution,
} from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'

import type { IrisWebAgentId, IrisWebSnapshot } from './runtime/snapshot.js'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespace$69726973 {
    snapshot: (agentId: IrisWebAgentId) => Promise<RemoteResult<IrisWebSnapshot>>
  }
  interface TypertRemoteMap {
    'iris/snapshot': (agentId: IrisWebAgentId) => Promise<RemoteResult<IrisWebSnapshot>>
  }
  interface TypertRemoteNamespaceMap {
    iris: TypertRemoteNamespace$69726973
  }
}

const agentIdSchema = z.union([z.string(), z.null()])
const snapshotSchema = z.unknown()

/** Browser-side descriptor paired with the package Host manifest. */
export const TYPERT_REMOTE = {
  package: 'dsh-iris',
  descriptors: [{
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
} satisfies TypertRemoteContribution

export default TYPERT_REMOTE
