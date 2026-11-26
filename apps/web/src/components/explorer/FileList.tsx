import { useEffect, useRef } from 'react'
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react'

import { joinPath, tipoLegivel } from '../../api'
import type { LsEntry } from '../../api'
import type { PickMods } from '../../hooks/useSelection'
import { cls, formatBytes, formatDateTime } from '../../lib/display'
import { revealIn } from '../../lib/dom'
import type { Column, SortState } from '../../lib/sort'
import { Icon } from '../common/Icon'
import type { Point } from '../shell/ContextMenu'

const COLUMNS: { id: Column; label: string; width?: number; right?: boolean }[] = [
  { id: 'name', label: 'Nome' },
  { id: 'size', label: 'Tamanho', width: 84, right: true },
  { id: 'type', label: 'Tipo', width: 132 },
  { id: 'modified', label: 'Modificado', width: 112 },
  { id: 'cluster', label: '1º cluster', width: 66, right: true },
]

/** A second click on the only selected item renames it, unless it becomes a double-click. */
const SLOW_CLICK_MS = 550

type Props = {
  /** API path of the folder being listed */
  dir: string
  /** already sorted */
  entries: LsEntry[]
  sort: SortState
  selected: ReadonlySet<string>
  /** dotted outline; the keyboard moves from here */
  focus: string | null
  /** cut and waiting for a paste: drawn faded (telas.md, tela 16) */
  cut?: ReadonlySet<string>
  /** the row being renamed and the field to put in place of its name */
  renaming?: { path: string; field: ReactNode }
  /** shown where the first row would be: empty folder, loading, error */
  notice?: ReactNode
  onSort?: (column: Column) => void
  onPick?: (path: string, mods?: PickMods) => void
  onClear?: () => void
  onOpen?: (entry: LsEntry, path: string) => void
  onSlowClick?: (path: string) => void
  /** path is null on the blank area */
  onContextMenu?: (path: string | null, at: Point) => void
}

/** Details view. Only what /ls returns: no fragment column (telas.md, tela 01). */
export function FileList({
  dir,
  entries,
  sort,
  selected,
  focus,
  cut,
  renaming,
  notice,
  onSort,
  onPick,
  onClear,
  onOpen,
  onSlowClick,
  onContextMenu,
}: Props) {
  const boxRef = useRef<HTMLDivElement>(null)
  const headRef = useRef<HTMLTableSectionElement>(null)
  /** set on mousedown: the row was already the only selection */
  const wasAlone = useRef<string | null>(null)
  const slowTimer = useRef<number | undefined>(undefined)

  // keyboard moves and returning from a subfolder must keep the row in view
  useEffect(() => {
    const box = boxRef.current
    revealIn(box, box?.querySelector('tbody tr.focused') ?? null, headRef.current?.offsetHeight)
  }, [focus, entries])

  useEffect(() => () => window.clearTimeout(slowTimer.current), [])

  // The rename field takes the focus with it when it goes away; give it back to
  // the list so the arrows keep working, unless the user clicked somewhere else.
  const isRenaming = !!renaming
  useEffect(() => {
    if (!isRenaming && document.activeElement === document.body) boxRef.current?.focus()
  }, [isRenaming])

  const paths = entries.map((x) => joinPath(dir, x.nome))

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // keys typed in the rename field belong to it
    if (notice || entries.length === 0 || e.target !== e.currentTarget) return
    const i = focus ? paths.indexOf(focus) : -1
    const last = entries.length - 1
    let next: number
    switch (e.key) {
      case 'ArrowDown':
        next = i < 0 ? 0 : Math.min(i + 1, last)
        break
      case 'ArrowUp':
        next = i < 0 ? 0 : Math.max(i - 1, 0)
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = last
        break
      case 'Enter':
        if (i >= 0) {
          e.preventDefault()
          onOpen?.(entries[i], paths[i])
        }
        return
      default:
        return
    }
    e.preventDefault()
    onPick?.(paths[next], { shift: e.shiftKey })
  }

  const onRowDown = (e: MouseEvent, path: string) => {
    window.clearTimeout(slowTimer.current)
    if (e.button === 2) {
      // right-click on an unselected item selects it alone; on a selected one keeps the group
      if (!selected.has(path)) onPick?.(path)
      return
    }
    if (e.button !== 0) return
    const plain = !e.ctrlKey && !e.metaKey && !e.shiftKey
    wasAlone.current = plain && selected.size === 1 && selected.has(path) ? path : null
    onPick?.(path, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey })
  }

  const onNameClick = (e: MouseEvent, path: string) => {
    if (e.detail !== 1 || wasAlone.current !== path) return
    slowTimer.current = window.setTimeout(() => onSlowClick?.(path), SLOW_CLICK_MS)
  }

  const rowAt = (target: EventTarget) =>
    (target as HTMLElement).closest<HTMLElement>('tbody tr[data-path]')?.dataset.path ?? null

  return (
    <div
      ref={boxRef}
      className="filelist"
      tabIndex={0}
      onKeyDown={onKeyDown}
      // a click on the blank area below the rows clears the selection
      onMouseDown={(e) => {
        const t = e.target as HTMLElement
        if (t.closest('tbody tr, thead')) return
        window.clearTimeout(slowTimer.current)
        if (!(e.button === 0 && (e.ctrlKey || e.metaKey))) onClear?.()
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        if ((e.target as HTMLElement).closest('thead')) return
        boxRef.current?.focus()
        onContextMenu?.(rowAt(e.target), { x: e.clientX, y: e.clientY })
      }}
    >
      <table className="filelist-table">
        <colgroup>
          {COLUMNS.map((c) => (
            <col key={c.id} style={c.width ? { width: c.width } : undefined} />
          ))}
        </colgroup>
        <thead ref={headRef}>
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
            entries.map((e, i) => {
              const path = paths[i]
              const isDir = e.tipo === 'diretorio'
              const field = renaming && renaming.path === path ? renaming.field : null
              return (
                <tr
                  key={path}
                  data-path={path}
                  aria-selected={selected.has(path)}
                  className={cls(
                    selected.has(path) && 'selected',
                    path === focus && 'focused',
                    cut?.has(path) && 'cut',
                    field !== null && 'renaming',
                  )}
                  onMouseDown={(ev) => onRowDown(ev, path)}
                  onDoubleClick={() => {
                    window.clearTimeout(slowTimer.current)
                    onOpen?.(e, path)
                  }}
                >
                  <td className={cls('name', sort.column === 'name' && 'sorted')}>
                    <span className="name-cell">
                      <Icon name={isDir ? 'folder' : 'file'} />
                      {field ?? (
                        <span
                          className="name-text"
                          title={e.nome}
                          onClick={(ev) => onNameClick(ev, path)}
                        >
                          {e.nome}
                        </span>
                      )}
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
