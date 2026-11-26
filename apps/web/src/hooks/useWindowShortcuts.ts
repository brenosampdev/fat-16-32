import { useEffect, useRef } from 'react'

type Handlers = {
  up?: () => void
  back?: () => void
  forward?: () => void
  refresh?: () => void
  remove?: () => void
  rename?: () => void
  selectAll?: () => void
  cut?: () => void
  paste?: () => void
}

const isTyping = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement &&
  (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')

/**
 * Explorer-wide keys (build-frontend.md, "Atalhos"). Listens in the capture
 * phase on window so F5 and Alt+arrows also work from the address field, and
 * so the browser's own reload and history keys never fire.
 *
 * Every other key is ignored while typing: Backspace, Delete, Ctrl+A/X/V in
 * the address bar or the rename field edit text, as they should.
 * Pass enabled = false while a modal is open.
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
      const run = (fn?: () => void) => {
        e.preventDefault()
        fn?.()
      }
      const ctrl = e.ctrlKey || e.metaKey
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key

      if (key === 'F5') run(h.refresh)
      else if (e.altKey && key === 'ArrowLeft') run(h.back)
      else if (e.altKey && key === 'ArrowRight') run(h.forward)
      else if (isTyping(e.target) || e.altKey) return
      else if (key === 'Backspace' && !ctrl) run(h.up)
      else if (key === 'Delete' && !ctrl) run(h.remove)
      else if (key === 'F2') run(h.rename)
      // Ctrl+A would select the page text; Ctrl+X/V have nothing else to do here
      else if (ctrl && key === 'a') run(h.selectAll)
      else if (ctrl && key === 'x') run(h.cut)
      else if (ctrl && key === 'v') run(h.paste)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [enabled])
}
