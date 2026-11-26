import { useEffect, useRef, useState } from 'react'
import type { KeyboardEventHandler, PointerEvent, ReactNode } from 'react'

import { TitleBar } from './TitleBar'

export const WINDOW_WIDTH = 860
export const WINDOW_HEIGHT = 620
const TITLE_HEIGHT = 28
/** How much of the window must stay on screen horizontally while dragging. */
const KEEP_VISIBLE = 120

type Point = { x: number; y: number }

const centered = (): Point => ({
  x: Math.max(0, Math.round((window.innerWidth - WINDOW_WIDTH) / 2)),
  y: Math.max(0, Math.round((window.innerHeight - WINDOW_HEIGHT) / 2)),
})

/** Keeps the title bar reachable: it can never leave the top or slide fully off a side. */
const clamp = (p: Point): Point => ({
  x: Math.min(Math.max(p.x, KEEP_VISIBLE - WINDOW_WIDTH), window.innerWidth - KEEP_VISIBLE),
  y: Math.min(Math.max(p.y, 0), window.innerHeight - TITLE_HEIGHT),
})

type Props = {
  title: string
  children: ReactNode
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>
}

/** Fixed-size 860x620 window, draggable by its title bar. No resize, no minimize. */
export function ExplorerWindow({ title, children, onKeyDown }: Props) {
  const [pos, setPos] = useState<Point>(centered)
  const grab = useRef<Point | null>(null)

  // a smaller browser window must not strand the title bar off screen
  useEffect(() => {
    const onResize = () => setPos((p) => clamp(p))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const start = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return
    grab.current = { x: e.clientX - pos.x, y: e.clientY - pos.y }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (!grab.current) return
    setPos(clamp({ x: e.clientX - grab.current.x, y: e.clientY - grab.current.y }))
  }

  const stop = (e: PointerEvent<HTMLDivElement>) => {
    if (!grab.current) return
    grab.current = null
    e.currentTarget.releasePointerCapture(e.pointerId)
  }

  return (
    // left/top instead of transform: a transformed ancestor would trap the
    // position:fixed overlay that modal dialogs use
    <div
      className="window explorer-window"
      style={{ left: pos.x, top: pos.y, width: WINDOW_WIDTH, height: WINDOW_HEIGHT }}
      onKeyDown={onKeyDown}
    >
      <TitleBar title={title} onPointerDown={start} onPointerMove={move} onPointerUp={stop} />
      <div className="explorer-body">{children}</div>
    </div>
  )
}
