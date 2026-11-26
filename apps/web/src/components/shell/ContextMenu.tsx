import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { MenuList } from './MenuBar'
import type { MenuItem } from './MenuBar'

export type Point = { x: number; y: number }

type Props = {
  at: Point
  items: MenuItem[]
  onClose: () => void
}

/**
 * Right-click menu at the cursor (build-frontend.md, "Context menu").
 * Fixed to the viewport, kept inside it, and closed by a click outside,
 * any key, scrolling, or the browser window losing focus.
 */
export function ContextMenu({ at, items, onClose }: Props) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState(at)
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  })

  // open to the left / upwards when there is no room, as menus do
  useLayoutEffect(() => {
    const menu = boxRef.current?.firstElementChild
    if (!menu) return
    const { width, height } = menu.getBoundingClientRect()
    setPos({
      x: at.x + width > window.innerWidth ? Math.max(0, at.x - width) : at.x,
      y: at.y + height > window.innerHeight ? Math.max(0, at.y - height) : at.y,
    })
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
    document.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('blur', onBlur)
    window.addEventListener('resize', onBlur)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', onScroll, true)
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
