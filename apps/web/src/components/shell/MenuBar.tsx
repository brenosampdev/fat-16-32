import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'

import { cls } from '../../lib/display'

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
 * another title switches to it. Click outside or Escape closes.
 */
export function MenuBar({ menus }: { menus: Menu[] }) {
  const [open, setOpen] = useState<number | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open === null) return
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="menubar" role="menubar" ref={ref}>
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
 * action, so the menu is gone when a dialog opens.
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
    <ul className={cls('menu-dropdown', className)} role="menu" style={style}>
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
