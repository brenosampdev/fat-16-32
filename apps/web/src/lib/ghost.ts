// The minimize and restore animation (spec, "Animação de minimizar e
// restaurar"): a rectangle in the title bar's blue flies between a window and
// its taskbar button. DOM only, no React.

/** how long the flight takes */
const GHOST_MS = 200

const box = (r: DOMRect): Keyframe => ({
  left: `${r.left}px`,
  top: `${r.top}px`,
  width: `${r.width}px`,
  height: `${r.height}px`,
})

/**
 * Flies a ghost rectangle from `from` to `to`, both in screen px
 * (getBoundingClientRect), and removes it when the flight ends or is
 * cancelled. It lives on <body>, outside any zoom, and never takes the
 * pointer. Nothing happens under prefers-reduced-motion, or when either
 * rectangle has no area (a button that is not drawn).
 */
export function flyGhost(from: DOMRect, to: DOMRect): void {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  if (!from.width || !from.height || !to.width || !to.height) return

  const ghost = document.createElement('div')
  ghost.className = 'window-ghost'
  ghost.setAttribute('aria-hidden', 'true')
  if (typeof ghost.animate !== 'function') return
  // the base style is the end: no frame shows it anywhere else once the
  // flight is over and before it is removed
  Object.assign(ghost.style, box(to))
  document.body.append(ghost)

  const flight = ghost.animate([box(from), box(to)], { duration: GHOST_MS, easing: 'ease-in-out' })
  const remove = () => ghost.remove()
  // finished rejects on cancel: gone either way
  flight.finished.then(remove, remove)
}
