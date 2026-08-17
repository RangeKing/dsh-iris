import type {
  RemoteResult,
  TypertRemoteContribution,
} from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'

import type { IrisWebAgentId, IrisWebSnapshot } from './runtime/snapshot.js'
import type { ResolvedIrisConfig } from './config.js'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespace$69726973 {
    snapshot: (agentId: IrisWebAgentId) => Promise<RemoteResult<IrisWebSnapshot>>
    config: () => Promise<RemoteResult<ResolvedIrisConfig>>
    updateConfig: (patch: Partial<ResolvedIrisConfig>) => Promise<RemoteResult<ResolvedIrisConfig>>
  }
  interface TypertRemoteMap {
    'iris/snapshot': (agentId: IrisWebAgentId) => Promise<RemoteResult<IrisWebSnapshot>>
    'iris/config': () => Promise<RemoteResult<ResolvedIrisConfig>>
    'iris/updateConfig': (patch: Partial<ResolvedIrisConfig>) => Promise<RemoteResult<ResolvedIrisConfig>>
  }
  interface TypertRemoteNamespaceMap {
    iris: TypertRemoteNamespace$69726973
  }
}

const agentIdSchema = z.union([z.string(), z.null()])
const snapshotSchema = z.unknown()
const configSchema = z.unknown()
const configPatchSchema = z.unknown()

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
  }, {
    id: 'dsh-iris#iris/config',
    service: 'irisRemote',
    namespace: 'iris',
    method: 'config',
    invocation: { kind: 'direct' },
    parameters: [],
    result: {
      mode: 'strict',
      typeSymbol: 'dsh-iris/config#ResolvedIrisConfig',
      schema: configSchema,
    },
    sourceLocation: { file: 'src/index.ts', line: 38, column: 3 },
  }, {
    id: 'dsh-iris#iris/updateConfig',
    service: 'irisRemote',
    namespace: 'iris',
    method: 'updateConfig',
    invocation: { kind: 'direct' },
    parameters: [{
      name: 'patch',
      wire: 'patch',
      source: 'json',
      codec: {
        mode: 'strict',
        typeSymbol: 'dsh-iris/config#PartialResolvedIrisConfig',
        schema: configPatchSchema,
      },
    }],
    result: {
      mode: 'strict',
      typeSymbol: 'dsh-iris/config#ResolvedIrisConfig',
      schema: configSchema,
    },
    sourceLocation: { file: 'src/index.ts', line: 42, column: 3 },
  }],
} satisfies TypertRemoteContribution

export default TYPERT_REMOTE
