import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

import type { WindowKind } from '../../lib/windows'
import { Icon } from '../common/Icon'
import type { IconName } from '../common/Icon'
import { useSession } from '../session/Session'
import { useDesk } from './DeskContext'
import { KIND_ICON } from './kinds'

type Props = {
  /** the Iniciar button: a pointerdown on it is its own toggle, and Esc gives it the focus back */
  anchor: RefObject<HTMLElement | null>
  onClose: () => void
}

type Item = { label: string; icon: IconName; onPick: () => void }

/** the menu's items in order: left column, right column, footer */
const itemsIn = (box: HTMLElement | null): HTMLElement[] => [
  ...(box?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []),
]

/**
 * XP's two-column Start menu (spec, "Menu Iniciar"), above the Iniciar
 * button. Only items that do something. It takes the keys while open:
 * the arrows (and Tab) move between items, Enter picks, Esc closes. A
 * click outside closes it too; a pick closes it before acting.
 */
export function StartMenu({ anchor, onClose }: Props) {
  const { open } = useDesk()
  const { logoff, requestShutdown } = useSession()
  const boxRef = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  })

  const opens = (kind: WindowKind) => () => open(kind)
  const programs: Item[] = [{ label: 'Simulador FAT', icon: KIND_ICON.explorer, onPick: opens('explorer') }]
  const places: Item[] = [
    { label: 'Meu computador', icon: 'computer', onPick: opens('explorer') },
    { label: 'Lixeira', icon: 'recycle', onPick: opens('recycle') },
  ]
  const session: Item[] = [
    { label: 'Fazer logoff', icon: 'logoff', onPick: logoff },
    { label: 'Desligar o computador', icon: 'shutdown', onPick: requestShutdown },
  ]

  // the first item takes the focus, so the keys come here and not to a window
  useEffect(() => {
    itemsIn(boxRef.current)[0]?.focus()
  }, [])

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (!boxRef.current?.contains(t) && !anchor.current?.contains(t)) close.current()
    }
    const onKey = (e: KeyboardEvent) => {
      const list = itemsIn(boxRef.current)
      const i = list.indexOf(document.activeElement as HTMLElement)
      let next: number
      if (e.key === 'Escape') {
        e.preventDefault()
        close.current()
        anchor.current?.focus()
        return
      } else if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) next = (i + 1) % list.length
      else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) next = i <= 0 ? list.length - 1 : i - 1
      else if (e.key === 'Home') next = 0
      else if (e.key === 'End') next = list.length - 1
      else return
      e.preventDefault()
      list[next]?.focus()
    }
    document.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [anchor])

  const render = (it: Item, big = false) => (
    <button
      key={it.label}
      type="button"
      role="menuitem"
      className="plano start-item"
      onClick={() => {
        close.current()
        it.onPick()
      }}
    >
      <Icon name={it.icon} size={big ? 32 : 24} />
      <span>{it.label}</span>
    </button>
  )

  return (
    <div
      ref={boxRef}
      className="start-menu"
      role="menu"
      aria-label="Iniciar"
      // a click on the menu's bare parts keeps the focus on its items
      onMouseDown={(e) => {
        if (!(e.target as HTMLElement).closest('button')) e.preventDefault()
      }}
    >
      <div className="start-head">
        <span className="start-picture">
          <Icon name="user" size={42} />
        </span>
        <span className="start-user">Usuário</span>
      </div>
      <div className="start-columns">
        <div className="start-programs">{programs.map((it) => render(it, true))}</div>
        <div className="start-places">{places.map((it) => render(it))}</div>
      </div>
      <div className="start-foot">{session.map((it) => render(it))}</div>
    </div>
  )
}
