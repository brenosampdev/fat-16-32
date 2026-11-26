/**
 * Scrolls `container` just enough to show `el`, and nothing else.
 * scrollIntoView() would also scroll the clipped desktop when the window was
 * dragged partly off screen. `topInset` covers a sticky header.
 */
export function revealIn(container: HTMLElement | null, el: Element | null, topInset = 0) {
  if (!container || !el) return
  const c = container.getBoundingClientRect()
  const e = el.getBoundingClientRect()
  const top = c.top + container.clientTop + topInset
  const bottom = c.top + container.clientTop + container.clientHeight
  if (e.top < top) container.scrollTop -= top - e.top
  else if (e.bottom > bottom) container.scrollTop += e.bottom - bottom
}
