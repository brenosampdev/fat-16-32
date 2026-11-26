import type { KeyboardEventHandler, ReactNode } from 'react'

import { joinPath, tipoLegivel } from '../../api'
import type { LsEntry } from '../../api'
import { cls, formatBytes, formatDateTime } from '../../lib/display'
import { Icon } from '../common/Icon'

export type Column = 'name' | 'size' | 'type' | 'modified' | 'cluster'
export type SortState = { column: Column; asc: boolean }

const COLUMNS: { id: Column; label: string; width?: number; right?: boolean }[] = [
  { id: 'name', label: 'Nome' },
  { id: 'size', label: 'Tamanho', width: 84, right: true },
  { id: 'type', label: 'Tipo', width: 132 },
  { id: 'modified', label: 'Modificado', width: 112 },
  { id: 'cluster', label: '1º cluster', width: 66, right: true },
]

type Props = {
  /** API path of the folder being listed */
  dir: string
  /** already sorted */
  entries: LsEntry[]
  sort: SortState
  /** API path of the selected entry */
  selected: string | null
  /** shown where the first row would be: empty folder, loading, error */
  notice?: ReactNode
  onSort?: (column: Column) => void
  onSelect?: (path: string | null) => void
  onOpen?: (entry: LsEntry, path: string) => void
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>
}

/** Details view. Only what /ls returns: no fragment column (telas.md, tela 01). */
export function FileList({
  dir,
  entries,
  sort,
  selected,
  notice,
  onSort,
  onSelect,
  onOpen,
  onKeyDown,
}: Props) {
  return (
    <div
      className="filelist"
      tabIndex={0}
      onKeyDown={onKeyDown}
      // a click on the blank area below the rows clears the selection
      onMouseDown={(e) => {
        if (!(e.target as HTMLElement).closest('tbody tr, thead')) onSelect?.(null)
      }}
    >
      <table className="filelist-table">
        <colgroup>
          {COLUMNS.map((c) => (
            <col key={c.id} style={c.width ? { width: c.width } : undefined} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {COLUMNS.map((c) => (
              <th key={c.id} aria-sort={sortAria(sort, c.id)}>
                <button
                  type="button"
                  tabIndex={-1}
                  className={cls('plano', 'filelist-header', c.right && 'right')}
                  onClick={() => onSort?.(c.id)}
                >
                  <span>{c.label}</span>
                  {sort.column === c.id && (
                    <span className={cls('sort-arrow', sort.asc ? 'asc' : 'desc')} />
                  )}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {notice ? (
            <tr className="filelist-notice">
              <td colSpan={COLUMNS.length}>{notice}</td>
            </tr>
          ) : (
            entries.map((e) => {
              const path = joinPath(dir, e.nome)
              const isDir = e.tipo === 'diretorio'
              return (
                <tr
                  key={path}
                  className={cls(path === selected && 'selected')}
                  onMouseDown={() => onSelect?.(path)}
                  onDoubleClick={() => onOpen?.(e, path)}
                >
                  <td className={cls('name', sort.column === 'name' && 'sorted')}>
                    <span className="name-cell">
                      <Icon name={isDir ? 'folder' : 'file'} />
                      <span className="name-text" title={e.nome}>
                        {e.nome}
                      </span>
                    </span>
                  </td>
                  <td className={cls('right', sort.column === 'size' && 'sorted')}>
                    {isDir ? '' : formatBytes(e.tamanho)}
                  </td>
                  <td className={cls(sort.column === 'type' && 'sorted')}>{tipoLegivel(e)}</td>
                  <td className={cls(sort.column === 'modified' && 'sorted')}>
                    {formatDateTime(e.mtime)}
                  </td>
                  <td className={cls('right', sort.column === 'cluster' && 'sorted')}>
                    {/* 0 = empty file, no cluster allocated */}
                    {e.primeiro_cluster || '—'}
                  </td>
                </tr>
              )
            })
          )}
        </tbody>
      </table>
    </div>
  )
}

const sortAria = (sort: SortState, c: Column) =>
  sort.column !== c ? undefined : sort.asc ? 'ascending' : 'descending'
