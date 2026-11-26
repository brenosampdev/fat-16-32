import { createElement, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react'

import type { IconName } from '../components/common/Icon'
import { DragGhost } from '../components/explorer/DragGhost'
import { canDrop, dragLabel } from '../lib/dragMove'

export type DragItem = { path: string; name: string; isDir: boolean }

type Options = {
  /** off while edits are locked or a rename is open; turning off ends a drag */
  enabled: boolean
  /** the folder being shown: never a target */
  current: string
  onDrop: (paths: string[], target: string) => void
}

/** screen px the pointer travels with the button held before a press becomes a drag */
const DRAG_THRESHOLD = 4
/** the ghost's top-left, right of and below the pointer */
const GHOST_OFFSET = 8

/**
 * Drag to move (spec "Arrastar para mover", approach 1): mouse events of our
 * own, measured in screen px, so the same code works at any zoom. A press only
 * records where it was; a click, a double-click and the slow click stay what
 * they were until the pointer has moved DRAG_THRESHOLD with the left button
 * held. Targets are the elements under the pointer carrying data-drop-path.
 *
 * Only a release over a target the rules accept calls onDrop. Esc, a release
 * anywhere else, the browser window losing focus, `enabled` turning off and
 * unmounting all end the drag without moving anything.
 */
export function useDragMove({ enabled, current, onDrop }: Options): {
  begin: (e: ReactMouseEvent, items: DragItem[]) => void
  ghost: ReactNode
} {
  // set once when a drag starts, cleared when it ends; the moves go through the ref
  const [ghost, setGhost] = useState<{ icon: IconName; label: string } | null>(null)
  const ghostRef = useRef<HTMLDivElement>(null)
  /** the pointer in screen px, read when the ghost first renders */
  const pointer = useRef({ x: 0, y: 0 })
  /** ends the press or drag in progress; null when there is none */
  const end = useRef<(() => void) | null>(null)
  // the window listeners outlive the render that added them
  const latest = useRef({ current, onDrop })
  useEffect(() => {
    latest.current = { current, onDrop }
  })

  const place = () => {
    const el = ghostRef.current
    if (!el) return
    el.style.left = `${pointer.current.x + GHOST_OFFSET}px`
    el.style.top = `${pointer.current.y + GHOST_OFFSET}px`
  }

  // before paint: the ghost never shows anywhere but next to the pointer
  useLayoutEffect(() => {
    if (ghost) place()
  }, [ghost])

  useEffect(() => {
    if (!enabled) end.current?.()
  }, [enabled])

  useEffect(() => () => end.current?.(), [])

  const begin = (e: ReactMouseEvent, items: DragItem[]) => {
    if (!enabled || e.button !== 0 || items.length === 0) return
    end.current?.()
    const body = document.body
    const from = { x: e.clientX, y: e.clientY }
    const paths = items.map((it) => it.path)
    // the items' own folder; `current` may change mid-drag (Backspace, Alt+Left)
    const source = latest.current.current
    let started = false
    /** the highlighted element and its folder, while the pointer is on one that accepts */
    let target: { el: Element; path: string } | null = null

    const aim = (x: number, y: number) => {
      const el = document.elementFromPoint(x, y)?.closest('[data-drop-path]') ?? null
      const path = el?.getAttribute('data-drop-path') ?? null
      const next =
        el && path !== null && canDrop(paths, path, source) ? { el, path } : null
      if (target && target.el !== next?.el) target.el.classList.remove('drop-target')
      target = next
      // added on every move: a render that rewrote the row's className took it away
      next?.el.classList.add('drop-target')
      body.classList.toggle('drag-no-drop', !next)
    }

    const onMove = (ev: MouseEvent) => {
      // the button went up where no mouseup reached the page
      if ((ev.buttons & 1) === 0) return finish(true)
      pointer.current = { x: ev.clientX, y: ev.clientY }
      if (!started) {
        if (Math.hypot(ev.clientX - from.x, ev.clientY - from.y) < DRAG_THRESHOLD) return
        started = true
        body.classList.add('drag-moving')
        window.getSelection()?.removeAllRanges()
        window.addEventListener('keydown', onKey, true)
        setGhost({
          icon: items[0].isDir ? 'folder' : 'file',
          label: dragLabel(items.map((it) => it.name)),
        })
      }
      place()
      aim(ev.clientX, ev.clientY)
    }

    const onUp = (ev: MouseEvent) => {
      if (ev.button !== 0) return
      if (!started) return finish(true)
      aim(ev.clientX, ev.clientY)
      const dropOn = target?.path ?? null
      swallowClick()
      finish(true)
      if (dropOn !== null) latest.current.onDrop(paths, dropOn)
    }

    // Registered on window in the capture phase, before any element sees the
    // key. The window-level capture listeners added earlier (AppWindow's zoom
    // keys, useWindowShortcuts, TooltipLayer) do nothing with Escape.
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return
      ev.preventDefault()
      ev.stopImmediatePropagation()
      finish(false)
    }

    const onBlur = () => finish(false)

    /** `released`: the button is up; otherwise its release is still to come */
    function finish(released: boolean) {
      window.removeEventListener('mousemove', onMove, true)
      window.removeEventListener('mouseup', onUp, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', onBlur)
      target?.el.classList.remove('drop-target')
      target = null
      body.classList.remove('drag-moving', 'drag-no-drop')
      if (started) setGhost(null)
      if (started && !released) swallowNextRelease()
      end.current = null
    }

    window.addEventListener('mousemove', onMove, true)
    window.addEventListener('mouseup', onUp, true)
    window.addEventListener('blur', onBlur)
    end.current = () => finish(false)
  }

  return {
    begin,
    ghost: ghost && createElement(DragGhost, { ref: ghostRef, icon: ghost.icon, label: ghost.label }),
  }
}

/**
 * The release that ends a drag also makes a click (and the second of a
 * double-click): it must not pick, rename or open the row it lands on. Both
 * come before the next task.
 */
function swallowClick() {
  const stop = (ev: Event) => {
    ev.stopPropagation()
    ev.preventDefault()
  }
  window.addEventListener('click', stop, true)
  window.addEventListener('dblclick', stop, true)
  window.setTimeout(() => {
    window.removeEventListener('click', stop, true)
    window.removeEventListener('dblclick', stop, true)
  }, 0)
}

/**
 * A drag cut short (Esc, the window losing focus, edits locked) leaves the
 * button down, and its release must not click either. The next press drops
 * the wait, so a release that never reached the page cannot eat a later click.
 */
function swallowNextRelease() {
  const off = () => {
    window.removeEventListener('mouseup', onUp, true)
    window.removeEventListener('mousedown', off, true)
  }
  const onUp = (ev: MouseEvent) => {
    if (ev.button !== 0) return
    off()
    swallowClick()
  }
  window.addEventListener('mouseup', onUp, true)
  window.addEventListener('mousedown', off, true)
}
