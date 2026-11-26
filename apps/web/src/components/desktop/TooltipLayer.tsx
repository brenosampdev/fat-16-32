// The yellow XP tips (spec, "Dicas amarelas"). One layer for the whole page
// takes over every element with a title: while the pointer is on one, its
// title waits in data-tip, so the browser's own tip never shows, and comes
// back when the pointer leaves.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'

/** how long the pointer stays on an element before its tip shows */
const DELAY_MS = 500
/** the tip's top below the pointer, clear of the arrow */
const BELOW = 20
/** the gap above the pointer when there is no room below (the taskbar) */
const ABOVE = 4

type Tip = { text: string; x: number; y: number }

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(v, max))

/**
 * Document-level listeners and one tip at a time, drawn outside any zoom in
 * screen px. It hides on mousedown, keydown and wheel, and stays hidden until
 * the pointer moves to another element. Nothing here stops or prevents an
 * event: shortcuts and focus work as before.
 */
export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    /** the element under the pointer whose title is held in data-tip */
    let owner: Element | null = null
    let timer: number | undefined
    const pointer = { x: 0, y: 0 }

    // null over null is a bail-out in React: no render when nothing shows
    const hide = () => {
      window.clearTimeout(timer)
      timer = undefined
      setTip(null)
    }

    /** the owner's text, read when it is needed: React may have changed it */
    const text = () => owner?.getAttribute('data-tip') ?? ''

    const stash = (el: Element) => {
      el.setAttribute('data-tip', el.getAttribute('title') ?? '')
      el.removeAttribute('title')
    }

    // While there is an owner: a render that gives it a new title sets the
    // attribute again, which goes straight back into data-tip (before the
    // browser's tip could show it); an owner taken off the page (a dialog
    // that closed, the balloon that timed out) lets go and hides.
    const watch = new MutationObserver(() => {
      if (!owner) return
      if (!owner.isConnected) {
        release()
        hide()
        return
      }
      if (!owner.hasAttribute('title')) return
      stash(owner)
      // a tip on screen shows the new text, and goes for an empty one; a tip
      // still waiting reads it when the delay ends
      const t = text()
      if (t.trim()) setTip((cur) => cur && { ...cur, text: t })
      else setTip(null)
    })

    const take = (el: Element) => {
      owner = el
      stash(el)
      watch.observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['title'],
      })
      timer = window.setTimeout(show, DELAY_MS)
    }

    /** gives the owner its title back, unless a render already set a newer one */
    const release = () => {
      watch.disconnect()
      const el = owner
      owner = null
      if (!el) return
      const held = el.getAttribute('data-tip')
      el.removeAttribute('data-tip')
      if (held !== null && !el.hasAttribute('title')) el.setAttribute('title', held)
    }

    const show = () => {
      timer = undefined
      const t = text()
      if (!owner?.isConnected || !t.trim()) return
      setTip({ text: t, x: pointer.x, y: pointer.y })
    }

    /**
     * The element whose tip `node` shows: the nearest with a title, or the
     * owner itself, whose title is in data-tip, when nothing nearer has one.
     * Moving between the owner and its children keeps the same tip.
     */
    const resolve = (node: EventTarget | null): Element | null => {
      const el = node instanceof Element ? node : node instanceof Node ? node.parentElement : null
      if (!el) return null
      const titled = el.closest('[title]')
      if (owner?.contains(el) && (!titled || titled.contains(owner))) return owner
      return titled
    }

    const onOver = (e: MouseEvent) => {
      pointer.x = e.clientX
      pointer.y = e.clientY
      const next = resolve(e.target)
      if (next === owner) return
      release()
      hide()
      if (next) take(next)
    }

    const onOut = (e: MouseEvent) => {
      if (!owner) return
      // into a child of the owner, or back to it from one: the same element
      if (e.relatedTarget && resolve(e.relatedTarget) === owner) return
      release()
      hide()
    }

    // where the tip goes is where the pointer is when the delay ends
    const onMove = (e: MouseEvent) => {
      pointer.x = e.clientX
      pointer.y = e.clientY
    }

    // capture: seen even where a handler stops the event
    const capture = { capture: true, passive: true }
    document.addEventListener('mouseover', onOver, capture)
    document.addEventListener('mouseout', onOut, capture)
    document.addEventListener('mousemove', onMove, capture)
    window.addEventListener('mousedown', hide, capture)
    window.addEventListener('keydown', hide, capture)
    window.addEventListener('wheel', hide, capture)
    return () => {
      document.removeEventListener('mouseover', onOver, capture)
      document.removeEventListener('mouseout', onOut, capture)
      document.removeEventListener('mousemove', onMove, capture)
      window.removeEventListener('mousedown', hide, capture)
      window.removeEventListener('keydown', hide, capture)
      window.removeEventListener('wheel', hide, capture)
      window.clearTimeout(timer)
      release()
    }
  }, [])

  // Below and right of the pointer; above it when there is no room below,
  // and inside the viewport either way. Before paint, so it never shows
  // anywhere else first.
  useLayoutEffect(() => {
    const box = boxRef.current
    if (!tip || !box) return
    const { clientWidth: vw, clientHeight: vh } = document.documentElement
    // the rect, not offsetWidth: a fractional width rounded down would hang
    // past the right edge; outside any zoom, its px are CSS px
    const { width: w, height: h } = box.getBoundingClientRect()
    let top = tip.y + BELOW
    if (top + h > vh) top = tip.y - ABOVE - h
    box.style.left = `${clamp(tip.x, 0, vw - w)}px`
    box.style.top = `${clamp(top, 0, vh - h)}px`
  }, [tip])

  if (!tip) return null
  return (
    <div ref={boxRef} className="xp-tooltip" role="tooltip">
      {tip.text}
    </div>
  )
}
