import { useEffect, useId, useRef } from 'react'
import type { KeyboardEvent, MouseEvent } from 'react'

import { cls } from '../../lib/display'
import { Icon } from '../common/Icon'

type Props = {
  onStandby: () => void
  onTurnOff: () => void
  onRestart: () => void
  onCancel: () => void
}

/**
 * XP's "Desligar o computador" box: a dark blue band with the title, three
 * big buttons, Cancelar at the bottom. It sits outside the desktop, so it
 * stays in colour while the desktop goes grey behind it. Modal: clicks
 * outside are swallowed, Tab cycles inside, Esc cancels.
 */
export function ShutdownDialog({ onStandby, onTurnOff, onRestart, onCancel }: Props) {
  const boxRef = useRef<HTMLDivElement>(null)
  const turnOffRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()

  useEffect(() => {
    turnOffRef.current?.focus()
  }, [])

  const onKeyDown = (e: KeyboardEvent) => {
    // nothing behind the box reacts to the keyboard
    e.stopPropagation()
    if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    } else if (e.key === 'Tab') {
      const items = [...(boxRef.current?.querySelectorAll<HTMLElement>('button') ?? [])]
      const i = items.indexOf(document.activeElement as HTMLElement)
      const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : (i + 1) % items.length
      e.preventDefault()
      items[next]?.focus()
    }
  }

  // a click outside the box, or on its bare parts, keeps the focus where it is
  const keepFocus = (e: MouseEvent) => {
    if (!(e.target as HTMLElement).closest('button')) e.preventDefault()
  }

  const choices = [
    { id: 'standby', label: 'Em espera', onClick: onStandby },
    { id: 'turn-off', label: 'Desligar', onClick: onTurnOff },
    { id: 'restart', label: 'Reiniciar', onClick: onRestart },
  ]

  return (
    <div className="shutdown-overlay" onMouseDown={keepFocus} onKeyDown={onKeyDown}>
      <div ref={boxRef} className="shutdown-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="shutdown-head">
          <span id={titleId}>Desligar o computador</span>
          <Icon name="start" size={30} />
        </div>
        <div className="shutdown-choices">
          {choices.map((c) => (
            <button
              key={c.id}
              ref={c.id === 'turn-off' ? turnOffRef : undefined}
              type="button"
              className={cls('plano', 'shutdown-choice', `shutdown-${c.id}`)}
              onClick={c.onClick}
            >
              <Icon name="shutdown" size={32} />
              <span className="shutdown-label">{c.label}</span>
            </button>
          ))}
        </div>
        <div className="shutdown-foot">
          <button type="button" onClick={onCancel}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}
