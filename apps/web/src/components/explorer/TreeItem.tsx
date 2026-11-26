import type { ReactNode } from 'react'

import { cls } from '../../lib/display'
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
  /** without a handler the box is only an indicator (the root never collapses) */
  onToggle?: () => void
  onSelect?: () => void
  children?: ReactNode
}

/** One node of the folder tree. The +/- box and the label are separate targets, as in XP. */
export function TreeItem({ label, icon, toggle, selected, onToggle, onSelect, children }: Props) {
  return (
    <li
      role="treeitem"
      aria-selected={selected}
      aria-expanded={toggle === 'leaf' ? undefined : toggle === 'expanded'}
    >
      <div className="tree-row">
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
      </div>
      {children && <ul role="group">{children}</ul>}
    </li>
  )
}
