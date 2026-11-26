import { useEffect, useRef } from 'react'

type Handlers = {
  up?: () => void
  back?: () => void
  forward?: () => void
  refresh?: () => void
}

const isTyping = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement &&
  (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')

/**
 * Explorer-wide keys: Backspace (up), Alt+Left / Alt+Right (history), F5 (refresh).
 * Listens in the capture phase on window so F5 and Alt+arrows also work from the
 * address field, and so the browser's own reload and history keys never fire.
 * Backspace is ignored while typing. Pass enabled = false while a modal is open.
 */
export function useWindowShortcuts(handlers: Handlers, enabled: boolean) {
  const latest = useRef(handlers)
  useEffect(() => {
    latest.current = handlers
  })

  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      const h = latest.current
      if (e.key === 'F5') {
        e.preventDefault()
        h.refresh?.()
      } else if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault()
        h.back?.()
      } else if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault()
        h.forward?.()
      } else if (e.key === 'Backspace' && !e.altKey && !e.ctrlKey && !isTyping(e.target)) {
        e.preventDefault()
        h.up?.()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [enabled])
}
