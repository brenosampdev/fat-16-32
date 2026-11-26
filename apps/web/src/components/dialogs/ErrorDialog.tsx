import { useEffect, useId, useRef } from 'react'
import type { KeyboardEvent, MouseEvent } from 'react'

import { Icon } from '../common/Icon'

type Props = {
  title: string
  /** shown exactly as the API sent it: no rewording, no guessing the cause */
  message: string
  onClose: () => void
}

/**
 * Modal error box over the window, without dimming it (telas.md, tela 05).
 * Enter and Esc close it; focus goes back where it was.
 */
export function ErrorDialog({ title, message, onClose }: Props) {
  const okRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const messageId = useId()

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    okRef.current?.focus()
    return () => previous?.focus()
  }, [])

  const onKeyDown = (e: KeyboardEvent) => {
    // nothing behind a modal reacts to the keyboard
    e.stopPropagation()
    if (e.key === 'Enter' || e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'Tab') {
      // a single button: focus has nowhere else to go
      e.preventDefault()
    }
  }

  // clicks outside the box are swallowed and do not steal focus from OK
  const onOverlayDown = (e: MouseEvent) => {
    if (e.target === e.currentTarget) e.preventDefault()
  }

  return (
    <div className="dialog-overlay" onMouseDown={onOverlayDown} onKeyDown={onKeyDown}>
      <div
        className="window dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
      >
        <div className="title-bar">
          <div className="title-bar-text" id={titleId}>
            {title}
          </div>
          <div className="title-bar-controls">
            <button type="button" aria-label="Close" tabIndex={-1} onClick={onClose} />
          </div>
        </div>
        <div className="window-body dialog-body">
          <Icon name="error" size={32} />
          <p id={messageId}>{message}</p>
        </div>
        <div className="dialog-buttons">
          <button type="button" ref={okRef} onClick={onClose}>
            OK
          </button>
        </div>
      </div>
    </div>
  )
}
