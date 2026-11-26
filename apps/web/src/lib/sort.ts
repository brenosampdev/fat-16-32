// Client-side sorting of a listing. /ls returns entries in directory order,
// so every view sorts what it shows.

import { tipoLegivel } from '../api'
import type { LsEntry } from '../api'

export type Column = 'name' | 'size' | 'type' | 'modified' | 'cluster'
export type SortState = { column: Column; asc: boolean }

/**
 * 'arq2' before 'arq10'. Case is a tie-break inside the collation, never a
 * merge: 'Docs' and 'docs' stay two distinct rows, next to each other.
 */
export const byName = (a: string, b: string): number =>
  a.localeCompare(b, 'pt-BR', { numeric: true })

const COMPARE: Record<Column, (a: LsEntry, b: LsEntry) => number> = {
  name: (a, b) => byName(a.nome, b.nome),
  size: (a, b) => a.tamanho - b.tamanho,
  type: (a, b) => tipoLegivel(a).localeCompare(tipoLegivel(b), 'pt-BR'),
  modified: (a, b) => a.mtime - b.mtime,
  cluster: (a, b) => a.primeiro_cluster - b.primeiro_cluster,
}

/** Folders always come first, whatever the column, as XP did. */
export const sortEntries = (entries: LsEntry[], { column, asc }: SortState): LsEntry[] =>
  [...entries].sort((a, b) => {
    if (a.tipo !== b.tipo) return a.tipo === 'diretorio' ? -1 : 1
    const r = COMPARE[column](a, b) || byName(a.nome, b.nome)
    return asc ? r : -r
  })

/** Clicking the sorted column flips it; another column starts ascending. */
export const nextSort = (s: SortState, column: Column): SortState =>
  s.column === column ? { column, asc: !s.asc } : { column, asc: true }
