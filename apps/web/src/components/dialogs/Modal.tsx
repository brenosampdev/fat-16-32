import { useEffect, useId, useRef } from 'react'
import type { KeyboardEvent, MouseEvent, ReactNode, RefObject } from 'react'

import { cls } from '../../lib/display'

type Props = {
  title: string
  children: ReactNode
  /** the row of buttons at the bottom */
  buttons: ReactNode
  /** Esc and the title bar ×. Required: every dialog here has a way out. */
  onClose: () => void
  /** focused on open; defaults to the first button */
  initialFocus?: RefObject<HTMLElement | null>
  role?: 'dialog' | 'alertdialog'
  /** id of the element that holds the message, for screen readers */
  describedBy?: string
  className?: string
}

const FOCUSABLE =
  'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])'

/**
 * One modal box over the Explorer window, without dimming it (telas.md,
 * tela 05). Keys never reach the window behind it, Tab cycles inside, and
 * focus returns where it was when the box closes.
 */
export function Modal({
  title,
  children,
  buttons,
  onClose,
  initialFocus,
  role = 'dialog',
  describedBy,
  className,
}: Props) {
  const boxRef = useRef<HTMLDivElement>(null)
  const titleId = useId()

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const first =
      initialFocus?.current ?? boxRef.current?.querySelector<HTMLElement>('.dialog-buttons button')
    first?.focus()
    return () => previous?.focus()
    // focus moves once, on open
  }, [])

  const onKeyDown = (e: KeyboardEvent) => {
    // nothing behind a modal reacts to the keyboard
    e.stopPropagation()
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'Tab') {
      const items = [...(boxRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])]
      if (items.length === 0) return e.preventDefault()
      const i = items.indexOf(document.activeElement as HTMLElement)
      const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : (i + 1) % items.length
      e.preventDefault()
      items[next].focus()
    }
  }

  // clicks outside the box are swallowed and do not steal focus from it
  const onOverlayDown = (e: MouseEvent) => {
    if (e.target === e.currentTarget) e.preventDefault()
  }

  return (
    <div className="dialog-overlay" onMouseDown={onOverlayDown} onKeyDown={onKeyDown}>
      <div
        ref={boxRef}
        className={cls('window', 'dialog', className)}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedBy}
      >
        <div className="title-bar">
          <div className="title-bar-text" id={titleId}>
            {title}
          </div>
          <div className="title-bar-controls">
            <button type="button" aria-label="Close" tabIndex={-1} onClick={onClose} />
          </div>
        </div>
        {children}
        <div className="dialog-buttons">{buttons}</div>
      </div>
    </div>
  )
}
