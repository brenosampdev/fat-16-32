import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

import { cls } from '../../lib/display'
import { revealIn } from '../../lib/dom'
import { Icon } from '../common/Icon'
import type { IconName } from '../common/Icon'

/**
 * expanded / collapsed draw the -/+ box; leaf draws none.
 * The tree does not know if a folder has subfolders until it lists it, so an
 * unvisited folder is 'collapsed' (build-frontend.md, "O problema do +").
 */
export type TreeToggle = 'expanded' | 'collapsed' | 'leaf'

type Props = {
  label: string
  icon: IconName
  toggle: TreeToggle
  selected: boolean
  note?: string
  /** without a handler the box is only an indicator (the root never collapses) */
  onToggle?: () => void
  onSelect?: () => void
  /** the folder this node stands for, as a drag-to-move target */
  dropPath?: string
  children?: ReactNode
}

/** One node of the folder tree. The +/- box and the label are separate targets, as in XP. */
export function TreeItem({
  label,
  icon,
  toggle,
  selected,
  note,
  onToggle,
  onSelect,
  dropPath,
  children,
}: Props) {
  const rowRef = useRef<HTMLDivElement>(null)

  // keep the selected folder visible after a navigation made elsewhere
  useEffect(() => {
    if (selected) revealIn(rowRef.current?.closest<HTMLElement>('.tree') ?? null, rowRef.current)
  }, [selected])

  return (
    <li
      role="treeitem"
      aria-selected={selected}
      aria-expanded={toggle === 'leaf' ? undefined : toggle === 'expanded'}
    >
      <div className="tree-row" ref={rowRef} data-drop-path={dropPath}>
        {toggle !== 'leaf' && (
          <button
            type="button"
            tabIndex={-1}
            className={cls('plano', 'tree-toggle', toggle)}
            aria-label={toggle === 'expanded' ? `Recolher ${label}` : `Expandir ${label}`}
            disabled={!onToggle}
            onClick={onToggle}
          />
        )}
        <span className={cls('tree-label', selected && 'selected')} onClick={onSelect}>
          <Icon name={icon} />
          <span className="tree-text">{label}</span>
        </span>
        {note && <span className="tree-note">{note}</span>}
      </div>
      {children && <ul role="group">{children}</ul>}
    </li>
  )
}
