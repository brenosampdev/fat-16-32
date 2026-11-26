// Client HTTP. Nenhum componente chama fetch direto.
//
// CUIDADO AO EDITAR: o backend NAO emite { ok: false, error } em caso de erro.
// Ele usa HTTPException do FastAPI, que serializa como { "detail": "..." }.
// Decidir sucesso por body.ok faz todo dialog de erro aparecer vazio, sem
// nenhum sintoma em tempo de compilacao. Decidimos por res.ok.

import { normalizarInfo } from './normalize'
import type {
  ApiOk,
  ChainData,
  CreateData,
  DeleteData,
  DiskCheck,
  DiskFat,
  DiskFormatBody,
  DiskInfo,
  DiskInfoRaw,
  FatApi,
  LsData,
  MkdirData,
  OverwriteData,
  PathPairData,
  ReadData,
  ReplaceData,
  WriteData,
} from './types'

const BASE =
  (import.meta.env?.VITE_API_URL as string | undefined) ?? 'http://localhost:8000'

/** Erro devolvido pela API, com a mensagem ja em portugues. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/** O backend nao respondeu. Distinto de ApiError de proposito. */
export class NetworkError extends Error {
  constructor(cause?: unknown) {
    super('Não foi possível contatar o servidor.')
    this.name = 'NetworkError'
    this.cause = cause
  }
}

/** Aceita os dois formatos: o do FastAPI (real) e o do contrato (caso mude). */
export function extrairErro(body: unknown, status: number): string {
  if (typeof body === 'object' && body !== null) {
    const b = body as Record<string, unknown>
    if (typeof b.detail === 'string') return b.detail // FastAPI — o caso real
    if (typeof b.error === 'string') return b.error // envelope do contrato
  }
  return `Erro HTTP ${status}.`
}

const SEM_DISCO = 'Nenhum disco aberto'

/**
 * Unica excecao permitida a "nao faca match em string de erro".
 * Isolada aqui porque distingue abrir o FormatDialog de mostrar uma falha.
 * No dia em que a API ganhar um campo `codigo`, so esta funcao muda.
 */
export const ehSemDisco = (e: unknown): boolean =>
  e instanceof ApiError && e.status === 400 && e.message.includes(SEM_DISCO)

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(BASE + path, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
    })
  } catch (e) {
    throw new NetworkError(e)
  }

  const body: unknown = await res.json().catch(() => null)

  // o status manda: e confiavel nos dois formatos de corpo
  if (!res.ok) throw new ApiError(res.status, extrairErro(body, res.status))

  const env = body as ApiOk<T> | null
  if (!env?.ok) throw new ApiError(res.status, extrairErro(body, res.status))
  return env.data
}

const q = (p: string) => encodeURIComponent(p)
const post = (body: unknown): RequestInit => ({
  method: 'POST',
  body: JSON.stringify(body),
})

export const httpApi: FatApi = {
  // as duas rotas de disco devolvem o tipo normalizado
  formatDisk: async (b: DiskFormatBody): Promise<DiskInfo> =>
    normalizarInfo(await request<DiskInfoRaw>('/disk/format', post(b))),
  diskInfo: async (): Promise<DiskInfo> =>
    normalizarInfo(await request<DiskInfoRaw>('/disk/info')),

  diskFat: () => request<DiskFat>('/disk/fat'),
  diskCheck: () => request<DiskCheck>('/disk/check', post({})),

  ls: (path) => request<LsData>(`/ls?path=${q(path)}`),
  mkdir: (path) => request<MkdirData>('/mkdir', post({ path })),

  createFile: (path) => request<CreateData>('/file/create', post({ path })),
  readFile: (path) => request<ReadData>(`/file/read?path=${q(path)}`),
  write: (path, conteudo_base64) =>
    request<WriteData>('/file/write', post({ path, conteudo_base64 })),
  overwrite: (path, offset, conteudo_base64) =>
    request<OverwriteData>('/file/overwrite', post({ path, offset, conteudo_base64 })),
  replace: (path, conteudo_base64) =>
    request<ReplaceData>('/file/replace', post({ path, conteudo_base64 })),
  remove: (path) => request<DeleteData>(`/file?path=${q(path)}`, { method: 'DELETE' }),

  rename: (path, novo_nome) =>
    request<PathPairData>('/file/rename', post({ path, novo_nome })),
  move: (origem, destino) =>
    request<PathPairData>('/file/move', post({ origem, destino })),

  chain: (path) => request<ChainData>(`/file/chain?path=${q(path)}`),
}
