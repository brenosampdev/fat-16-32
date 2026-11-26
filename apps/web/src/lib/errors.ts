// How an operation error is presented. The body is always the backend detail
// as it came: seven situations share HTTP 400, so the cause is never guessed
// from the text (CLAUDE.md). Only the title depends on the status.

import { ApiError, NetworkError } from '../api'

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
