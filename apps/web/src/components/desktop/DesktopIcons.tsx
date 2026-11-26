import type { KeyboardEvent } from 'react'

import { cls } from '../../lib/display'
import type { WindowKind } from '../../lib/windows'
import { Icon } from '../common/Icon'
import type { IconName } from '../common/Icon'
import { useDesk } from './DeskContext'

export type DeskIconId = 'computer' | 'recycle'

const ICONS: { id: DeskIconId; label: string; icon: IconName; opens: WindowKind }[] = [
  { id: 'computer', label: 'Meu computador', icon: 'computer', opens: 'explorer' },
  { id: 'recycle', label: 'Lixeira', icon: 'recycle', opens: 'recycle' },
]

type Props = {
  selected: DeskIconId | null
  onSelect: (id: DeskIconId) => void
}

/**
 * The desktop's icons: Meu computador at the top left, the Lixeira at the
 * bottom right. A click selects (and, as on XP, takes the focus off the
 * windows, as reaching one with Tab does); a double-click or Enter opens. They render before the windows,
 * so any window covers them. The Desktop clears the selection on a click
 * on the empty desk.
 */
export function DesktopIcons({ selected, onSelect }: Props) {
  const { desk, dispatch, open } = useDesk()

  const deactivate = () => {
    if (desk.activeId !== null) dispatch({ type: 'deactivate' })
  }

  const onDown = (id: DeskIconId) => {
    onSelect(id)
    deactivate()
  }

  // The window that opens takes the keys, as on XP: with the focus back on
  // body, a new Explorer's list takes it on mount, and a window already open
  // gets back the element it had (AppWindow).
  const launch = (icon: HTMLButtonElement, kind: WindowKind) => {
    icon.blur()
    open(kind)
  }

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, kind: WindowKind) => {
    if (e.key !== 'Enter' || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
    // keeps the button's own Enter from turning into a click
    e.preventDefault()
    launch(e.currentTarget, kind)
  }

  return (
    <>
      {ICONS.map((it) => (
        <button
          key={it.id}
          type="button"
          className={cls('plano', 'desk-icon', `desk-icon-${it.id}`, selected === it.id && 'selected')}
          onPointerDown={(e) => e.button === 0 && onDown(it.id)}
          // reached with Tab, too: the windows let go of the keys
          onFocus={deactivate}
          onDoubleClick={(e) => launch(e.currentTarget, it.opens)}
          onKeyDown={(e) => onKey(e, it.opens)}
        >
          <span className="desk-icon-image">
            <Icon name={it.icon} size={32} />
            {/* XP washes a selected picture with blue: a blue copy on top */}
            {selected === it.id && <Icon name={it.icon} size={32} className="desk-icon-tint" />}
          </span>
          <span className="desk-icon-label">{it.label}</span>
        </button>
      ))}
    </>
  )
}
