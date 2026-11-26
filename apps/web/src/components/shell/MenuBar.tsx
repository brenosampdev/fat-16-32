import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'

import { cls } from '../../lib/display'
import { keepFocus } from '../../lib/dom'

export type MenuItem =
  | { separator: true }
  | {
      label: string
      shortcut?: string
      disabled?: boolean
      /** radio-style mark, for the view mode */
      checked?: boolean
      onSelect?: () => void
    }

export type Menu = { label: string; items: MenuItem[] }

/**
 * Classic menu bar: a click opens a dropdown; while one is open, hovering
 * another title switches to it. Click outside or Escape closes it.
 *
 * Nothing on it takes the focus when clicked, as in XP: it stays in the list,
 * so a dialog opened from a menu gives it back there when it closes (a rename
 * in progress still ends first, see keepFocus). The keys then go to the list
 * too, so a key pressed outside the menu bar also closes the menu and still
 * does its job there. Keys on a title or item reached with Tab are the menu's
 * own: Enter and Space press it, Tab moves on.
 */
export function MenuBar({ menus }: { menus: Menu[] }) {
  const [open, setOpen] = useState<number | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open === null) return
    const outside = (e: Event) => !ref.current?.contains(e.target as Node)
    const onDown = (e: PointerEvent) => {
      if (outside(e)) setOpen(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || outside(e)) setOpen(null)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="menubar" role="menubar" ref={ref} onMouseDown={keepFocus}>
      {menus.map((menu, i) => (
        <div className="menubar-entry" key={menu.label}>
          <button
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={open === i}
            className={cls('plano', 'menubar-title', open === i && 'open')}
            onClick={() => setOpen(open === i ? null : i)}
            onMouseEnter={() => open !== null && setOpen(i)}
          >
            {menu.label}
          </button>

          {open === i && <MenuList items={menu.items} onPick={() => setOpen(null)} />}
        </div>
      ))}
    </div>
  )
}

/**
 * The items of one dropdown, shared by the menu bar and the context menu.
 * Items without onSelect render disabled. onPick runs before the item's own
 * action, so the menu is gone when a dialog opens. A click on an item leaves
 * the focus where it was: the item unmounts at once, and a dialog would
 * otherwise give the focus back to nothing.
 */
export function MenuList({
  items,
  onPick,
  className,
  style,
}: {
  items: MenuItem[]
  onPick: () => void
  className?: string
  style?: CSSProperties
}) {
  return (
    <ul
      className={cls('menu-dropdown', className)}
      role="menu"
      style={style}
      onMouseDown={keepFocus}
    >
      {items.map((item, j) =>
        'separator' in item ? (
          <li key={j} className="menu-separator" role="separator" />
        ) : (
          <li key={j} role="none">
            <button
              type="button"
              role={item.checked === undefined ? 'menuitem' : 'menuitemradio'}
              aria-checked={item.checked}
              className={cls('plano', 'menu-item', item.checked && 'checked')}
              disabled={item.disabled || !item.onSelect}
              onClick={() => {
                onPick()
                item.onSelect?.()
              }}
            >
              <span>{item.label}</span>
              {item.shortcut && <span className="menu-shortcut">{item.shortcut}</span>}
            </button>
          </li>
        ),
      )}
    </ul>
  )
}
