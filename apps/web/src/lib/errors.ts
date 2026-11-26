// How an operation error is presented. The body is always the backend detail
// as it came: seven situations share HTTP 400, so the cause is never guessed
// from the text (CLAUDE.md). Only the title depends on the status.

import { ApiError, NetworkError } from '../api'
import { formatCount } from './content'
import { formatBytes, toDosPath } from './display'

export const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** Titles from build-frontend.md, "ErrorDialog". */
export function errorTitle(e: unknown): string {
  if (e instanceof NetworkError) return 'Sem conexão com o servidor'
  if (e instanceof ApiError) {
    if (e.status === 404) return 'Item não encontrado'
    if (e.status === 409) return 'Conflito de nome'
    if (e.status >= 500) return 'Erro inesperado'
    return 'Erro'
  }
  return 'Erro inesperado'
}

export const isNetworkError = (e: unknown): boolean => e instanceof NetworkError

// ------------------------------------------------------------- tela 05

/** The numbers of a write the disk had no room for. */
export type Shortage = {
  /** the file's name and the folder it was going into (API path) */
  name: string
  dir: string
  /** clusters the content needs, and those free after the attempt */
  needed: number
  free: number
  clusterSize: number
  /** the free count did not move: the attempt allocated nothing */
  untouched: boolean
}

/**
 * A refused write whose numbers show the cause: the content needs more
 * clusters than /disk/info reports free. Decided by arithmetic, never from
 * the message's text; the message is still the backend's, as it came.
 */
export class ShortageError extends Error {
  readonly shortage: Shortage
  constructor(shortage: Shortage, cause: unknown) {
    super(messageOf(cause))
    this.name = 'ShortageError'
    this.shortage = shortage
    this.cause = cause
  }
}

const clusters = (n: number, size: number) =>
  `${formatCount(n)} ${n === 1 ? 'cluster' : 'clusters'} (${formatBytes(n * size)})`

/** Tela 05's lines: 'Necessário 300 clusters (153.600 B)', 'Livre 220 clusters (112.640 B)'. */
export function describeShortage(s: Shortage) {
  return {
    lead: `Não foi possível criar "${s.name}" em ${toDosPath(s.dir)}.`,
    facts: [
      ['Necessário', clusters(s.needed, s.clusterSize)],
      ['Livre', clusters(s.free, s.clusterSize)],
    ] as [string, string][],
    note: s.untouched ? 'Nenhum cluster foi alocado.' : undefined,
  }
}
