import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PointerEvent, ReactNode } from 'react'

import { usePref } from '../../hooks/usePref'
import { cls } from '../../lib/display'
import { flyGhost } from '../../lib/ghost'
import { zoomPref } from '../../lib/prefs'
import { WINDOW_SIZE, clampPos } from '../../lib/windows'
import type { Point } from '../../lib/windows'
import { stepZoom } from '../../lib/zoom'
import type { IconName } from '../common/Icon'
import { deskViewport, useDesk, useWindow } from '../desktop/DeskContext'
import { TitleBar } from './TitleBar'

/** Ctrl+wheel px per zoom step: one mouse notch */
const WHEEL_STEP = 100
/** px for a wheel that reports lines or pages instead */
const WHEEL_LINE = 40
const WHEEL_PAGE = 800
/** a pause this long ends a Ctrl+wheel gesture */
const WHEEL_IDLE_MS = 200

type Props = {
  title: string
  icon: IconName
  children: ReactNode
}

/**
 * The frame every kind of window shares: fixed size per kind, dragged by its
 * title bar, with working Minimize, Maximize/Restore and Close. Its state
 * lives in the desk (useWindow); only a drag in progress is kept here.
 * Everything under the title bar is drawn at the shared zoom level.
 */
export function AppWindow({ title, icon, children }: Props) {
  const win = useWindow()
  const { dispatch } = useDesk()
  const size = WINDOW_SIZE[win.kind]

  // The desk learns the new position once, on release: a dispatch per
  // pointermove would render the whole window body on every frame.
  const [dragPos, setDragPos] = useState<Point | null>(null)
  const dragRef = useRef<Point | null>(null)
  const grab = useRef<Point | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  /** the element that last had the focus inside this window */
  const lastFocus = useRef<HTMLElement | null>(null)
  const [zoom, setZoom] = usePref(zoomPref)
  /** Ctrl+wheel px summed since the gesture began, and when the last one came */
  const wheel = useRef({ sum: 0, at: -Infinity })
  /** where the window was last drawn, in screen px: a minimized one is display: none */
  const shownRect = useRef<DOMRect | null>(null)
  const wasMinimized = useRef(win.minimized)

  // Remembers the rect while the window is drawn, so the ghost of a minimize
  // can leave from it: the commit that minimizes has already hidden it. After
  // every commit (a move, a maximize, the resize's clampAll), before paint; a
  // restore has drawn the window again by then. The ghost flies to or from
  // the window's taskbar button.
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    // display: none leaves no client rects
    const rect = root.getClientRects().length > 0 ? root.getBoundingClientRect() : null
    if (win.minimized !== wasMinimized.current) {
      wasMinimized.current = win.minimized
      const button = document.querySelector(`[data-task-id="${CSS.escape(win.id)}"]`)
      const shown = win.minimized ? shownRect.current : rect
      if (button && shown) {
        const target = button.getBoundingClientRect()
        if (win.minimized) flyGhost(shown, target)
        else flyGhost(target, shown)
      }
    }
    if (rect) shownRect.current = rect
  })

  // A window that stops taking the keys lets go of the focus: element-level
  // handlers (the list's arrows and Enter) would otherwise still answer.
  // Minimize keeps the focus where it was, since the caption buttons never take it.
  //
  // A window that starts taking them again from outside (its taskbar button,
  // a desktop icon) gets back the element it had, if that is still on the
  // page, as XP does. A click inside activates it too, on pointerdown; the
  // mousedown that follows still puts the focus where the user clicked.
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const focused = document.activeElement
    const inside = focused instanceof HTMLElement && root.contains(focused)
    if (!win.takesKeys) {
      if (inside) focused.blur()
      return
    }
    const last = lastFocus.current
    if (!inside && last?.isConnected && root.contains(last)) last.focus({ preventScroll: true })
  }, [win.takesKeys])

  // the taskbar shows the title the window shows
  useEffect(() => {
    if (title !== win.title) dispatch({ type: 'retitle', id: win.id, title })
  }, [title, win.title, win.id, dispatch])

  // Ctrl+wheel over the window zooms its body instead of the page; over the
  // wallpaper the browser still zooms. Native, since React's wheel listener
  // is passive and could not stop the browser's zoom.
  //
  // One step per 100 px of wheel, summed: a mouse notch is one step, while a
  // touchpad pinch, which arrives as many small Ctrl+wheel events, does not
  // race to the end of the scale.
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const scale = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? WHEEL_LINE
        : e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? WHEEL_PAGE : 1
      const px = e.deltaY * scale
      // a sideways tilt is no step either way
      if (px === 0) return
      const acc = wheel.current
      // a pause or a turn the other way starts a new gesture
      if (e.timeStamp - acc.at > WHEEL_IDLE_MS || Math.sign(px) !== Math.sign(acc.sum)) acc.sum = 0
      acc.at = e.timeStamp
      acc.sum += px
      const steps = Math.trunc(acc.sum / WHEEL_STEP)
      if (steps === 0) return
      acc.sum -= steps * WHEEL_STEP
      let next = zoom
      for (let i = 0; i < Math.abs(steps); i++) next = stepZoom(next, steps < 0 ? 1 : -1)
      setZoom(next)
    }
    root.addEventListener('wheel', onWheel, { passive: false })
    return () => root.removeEventListener('wheel', onWheel)
  }, [zoom, setZoom])

  // Ctrl +/=, Ctrl − and Ctrl 0 while this window takes the keys; captured
  // before the browser applies its own zoom
  useEffect(() => {
    if (!win.takesKeys) return
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.metaKey) return
      let next: number
      if (e.key === '+' || e.key === '=') next = stepZoom(zoom, 1)
      else if (e.key === '-') next = stepZoom(zoom, -1)
      else if (e.key === '0') next = 1
      else return
      e.preventDefault()
      setZoom(next)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [win.takesKeys, zoom, setZoom])

  // a smaller browser window must not strand a title bar off screen
  useEffect(() => {
    const onResize = () => dispatch({ type: 'clampAll', viewport: deskViewport() })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [dispatch])

  const start = (e: PointerEvent<HTMLDivElement>) => {
    // a caption button is a click, never a drag; a maximized window stays put
    if (e.button !== 0 || win.maximized || (e.target as HTMLElement).closest('button')) return
    grab.current = { x: e.clientX - win.pos.x, y: e.clientY - win.pos.y }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const drag = (e: PointerEvent<HTMLDivElement>) => {
    if (!grab.current) return
    const p = clampPos(
      { x: e.clientX - grab.current.x, y: e.clientY - grab.current.y },
      size,
      deskViewport(),
    )
    dragRef.current = p
    setDragPos(p)
  }

  const stop = (e: PointerEvent<HTMLDivElement>) => {
    if (!grab.current) return
    grab.current = null
    e.currentTarget.releasePointerCapture(e.pointerId)
    if (dragRef.current) win.move(dragRef.current)
    dragRef.current = null
    setDragPos(null)
  }

  const pos = dragPos ?? win.pos

  return (
    // left/top instead of transform: a transformed ancestor would trap the
    // position:fixed overlay that modal dialogs use
    <div
      ref={rootRef}
      className={cls(
        'window',
        'app-window',
        `${win.kind}-window`,
        !win.active && 'inactive',
        win.maximized && 'maximized',
        win.minimized && 'minimized',
      )}
      data-window-id={win.id}
      style={
        win.maximized
          ? { zIndex: win.z }
          : { left: pos.x, top: pos.y, width: size.width, height: size.height, zIndex: win.z }
      }
      // capture phase: a click anywhere inside activates, even where a child stops it
      onPointerDownCapture={() => win.activate()}
      // focusin, bubbling from whatever inside took the focus
      onFocus={(e) => {
        if (e.target instanceof HTMLElement) lastFocus.current = e.target
      }}
    >
      <TitleBar
        title={title}
        icon={icon}
        maximized={win.maximized}
        onMinimize={win.minimize}
        onToggleMaximize={win.toggleMaximize}
        onClose={win.close}
        onPointerDown={start}
        onPointerMove={drag}
        onPointerUp={stop}
      />
      <div className="explorer-body" style={{ zoom }}>
        {children}
      </div>
    </div>
  )
}
