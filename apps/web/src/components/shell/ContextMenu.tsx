import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { effectiveZoom } from '../../lib/dom'
import type { Point } from '../../lib/windows'
import { clampMenu } from '../../lib/zoom'
import { MenuList } from './MenuBar'
import type { MenuItem } from './MenuBar'

export type { Point } from '../../lib/windows'

type Props = {
  at: Point
  items: MenuItem[]
  onClose: () => void
}

/**
 * Right-click menu at the cursor (build-frontend.md, "Context menu").
 * Fixed to the viewport, kept inside it, and closed by a click outside,
 * any key, scrolling, Ctrl+wheel, or the browser window losing focus.
 */
export function ContextMenu({ at, items, onClose }: Props) {
  const boxRef = useRef<HTMLDivElement>(null)
  // First laid out at the corner, where nothing squeezes it, and measured
  // there; it moves to the pointer before the first paint.
  const [pos, setPos] = useState<Point>({ x: 0, y: 0 })
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  })

  // open to the left / upwards when there is no room, as menus do; the
  // pointer and the menu's size are screen px, left/top are CSS px inside
  // the window's zoom
  useLayoutEffect(() => {
    const menu = boxRef.current?.firstElementChild
    if (!menu) return
    const { width, height } = menu.getBoundingClientRect()
    const viewport = { width: window.innerWidth, height: window.innerHeight }
    setPos(clampMenu(at, { width, height }, viewport, effectiveZoom(menu)))
  }, [at])

  useEffect(() => {
    const box = boxRef.current
    const outside = (e: Event) => !box?.contains(e.target as Node)
    const onDown = (e: PointerEvent) => outside(e) && close.current()
    const onScroll = (e: Event) => outside(e) && close.current()
    const onKey = (e: KeyboardEvent) => {
      // Escape only closes the menu; other keys close it and still do their job
      if (e.key === 'Escape') e.stopPropagation()
      close.current()
    }
    const onBlur = () => close.current()
    // Ctrl+wheel zooms the window without scrolling it, and would leave the
    // menu at a spot measured for the old zoom
    const onWheel = (e: WheelEvent) => e.ctrlKey && close.current()
    document.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('wheel', onWheel, true)
    window.addEventListener('blur', onBlur)
    window.addEventListener('resize', onBlur)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('wheel', onWheel, true)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('resize', onBlur)
    }
  }, [])

  return (
    <div ref={boxRef} onContextMenu={(e) => e.preventDefault()}>
      <MenuList
        items={items}
        onPick={onClose}
        className="context-menu"
        style={{ left: pos.x, top: pos.y }}
      />
    </div>
  )
}
