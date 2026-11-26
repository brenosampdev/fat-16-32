/**
 * The CSS zoom `el` is drawn at, its own and its ancestors' together: how many
 * screen px (getBoundingClientRect, clientX) one of its CSS px (left, top,
 * scrollTop, clientHeight) takes.
 */
export function effectiveZoom(el: Element): number {
  // read through `in`: an older TypeScript DOM lib lacks it, and so does a
  // browser without CSS zoom
  const probe: object = el
  if ('currentCSSZoom' in probe && typeof probe.currentCSSZoom === 'number') return probe.currentCSSZoom
  const width = el instanceof HTMLElement ? el.offsetWidth : 0
  return width > 0 ? el.getBoundingClientRect().width / width : 1
}

/**
 * mousedown handler for controls that never take the focus, as on XP: the
 * toolbar and the menus. The focus stays where it was, so a dialog opened
 * from there hands it back to the list when it closes.
 *
 * A text field being edited (the inline rename, the address bar) is still
 * left, as any click elsewhere leaves it: the rename's blur commits the typed
 * name before the control acts, as it did when the control took the focus.
 */
export function keepFocus(e: { preventDefault(): void }): void {
  e.preventDefault()
  const el = document.activeElement
  if (
    el instanceof HTMLElement &&
    (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')
  ) {
    el.blur()
  }
}

/**
 * Scrolls `container` just enough to show `el`, and nothing else.
 * scrollIntoView() would also scroll the clipped desktop when the window was
 * dragged partly off screen. `topInset` covers a sticky header.
 *
 * The rects are screen px; clientTop, clientHeight, topInset and scrollTop are
 * CSS px inside the window's zoom, so they are compared in screen px and the
 * scroll moves by the screen distance over the zoom.
 */
export function revealIn(container: HTMLElement | null, el: Element | null, topInset = 0) {
  if (!container || !el) return
  const z = effectiveZoom(container)
  const c = container.getBoundingClientRect()
  const e = el.getBoundingClientRect()
  const top = c.top + (container.clientTop + topInset) * z
  const bottom = c.top + (container.clientTop + container.clientHeight) * z
  if (e.top < top) container.scrollTop -= (top - e.top) / z
  else if (e.bottom > bottom) container.scrollTop += (e.bottom - bottom) / z
}
