// The window list in React: DeskProvider runs the pure reducer from
// lib/windows, and each window reads its own slice through useWindow().

import { createContext, memo, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { ComponentType, Dispatch, ReactNode } from 'react'

import type { BalloonInput } from '../../lib/balloons'
import { playSound } from '../../lib/sound'
import { EMPTY_DESK, TASKBAR_HEIGHT, deskReducer, fits, initialPos } from '../../lib/windows'
import type { Desk, DeskAction, Point, Size, Win, WindowKind } from '../../lib/windows'

/** Where windows live: the screen above the taskbar, in CSS px. */
export const deskViewport = (): Size => ({
  width: window.innerWidth,
  height: window.innerHeight - TASKBAR_HEIGHT,
})

export type DeskApi = {
  desk: Desk
  dispatch(a: DeskAction): void
  open(kind: WindowKind, data?: string): void
  notify(b: BalloonInput): void
  balloon: BalloonInput | null
  dismissBalloon(): void
}

export type WindowApi = Win & {
  active: boolean
  takesKeys: boolean
  minimize(): void
  toggleMaximize(): void
  close(): void
  /** brings the window to the top; a no-op when it is already active and on top */
  activate(): void
  move(p: Point): void
}

/** How long a tray balloon stays up on its own (spec, "Balões na bandeja"). */
const BALLOON_MS = 6000

const DeskContext = createContext<DeskApi | null>(null)
/** notify alone, which never changes: reading it does not render on every desk change */
const NotifyContext = createContext<((b: BalloonInput) => void) | null>(null)
export const WindowContext = createContext<WindowApi | null>(null)

/**
 * Opens a window centred above the taskbar, or maximized when its fixed size
 * does not fit there (a 1366×768 browser window, a 1080p screen at 150%).
 */
const openAction = (kind: WindowKind, openCount: number, data?: string): DeskAction => {
  const viewport = deskViewport()
  return {
    type: 'open',
    kind,
    data,
    pos: initialPos(kind, viewport, openCount),
    maximized: !fits(kind, viewport),
  }
}

/** The desktop starts with the Explorer open. */
const withExplorer = (desk: Desk): Desk => deskReducer(desk, openAction('explorer', 0))

export function DeskProvider({ children }: { children: ReactNode }) {
  const [desk, dispatch] = useReducer(deskReducer, EMPTY_DESK, withExplorer)
  // one balloon at a time: a new one replaces it and starts the clock again
  const [balloon, setBalloon] = useState<BalloonInput | null>(null)
  const balloonTimer = useRef<number | undefined>(undefined)

  // stable, so an effect that depends on them does not run again on every window move
  const dismissBalloon = useCallback(() => {
    window.clearTimeout(balloonTimer.current)
    balloonTimer.current = undefined
    setBalloon(null)
  }, [])

  const notify = useCallback(
    (b: BalloonInput) => {
      window.clearTimeout(balloonTimer.current)
      setBalloon(b)
      playSound('balloon')
      balloonTimer.current = window.setTimeout(dismissBalloon, BALLOON_MS)
    },
    [dismissBalloon],
  )

  // logoff unmounts the desk: no timer outlives it
  useEffect(() => () => window.clearTimeout(balloonTimer.current), [])

  const api = useMemo<DeskApi>(
    () => ({
      desk,
      dispatch,
      open: (kind, data) => dispatch(openAction(kind, desk.windows.length, data)),
      notify,
      balloon,
      dismissBalloon,
    }),
    [desk, balloon, notify, dismissBalloon],
  )

  return (
    <NotifyContext.Provider value={notify}>
      <DeskContext.Provider value={api}>{children}</DeskContext.Provider>
    </NotifyContext.Provider>
  )
}

export function useDesk(): DeskApi {
  const api = useContext(DeskContext)
  if (!api) throw new Error('useDesk() outside DeskProvider')
  return api
}

/**
 * The tray balloon, for a window's body. The same function as useDesk().notify,
 * without subscribing to the desk: the window does not render again when
 * another one moves.
 */
export function useNotify(): (b: BalloonInput) => void {
  const notify = useContext(NotifyContext)
  if (!notify) throw new Error('useNotify() outside DeskProvider')
  return notify
}

export function useWindow(): WindowApi {
  const api = useContext(WindowContext)
  if (!api) throw new Error('useWindow() outside a window')
  return api
}

type ScopeProps = {
  win: Win
  active: boolean
  takesKeys: boolean
  /** the highest z among the visible windows */
  onTop: boolean
  dispatch: Dispatch<DeskAction>
  /** what the window shows; it renders its own AppWindow */
  view: ComponentType
}

/**
 * Hands one window its WindowApi. Memoized on its own props, so a change to
 * another window (a drag, a new title) does not render this one again.
 */
export const WindowScope = memo(function WindowScope({
  win,
  active,
  takesKeys,
  onTop,
  dispatch,
  view: View,
}: ScopeProps) {
  const api = useMemo<WindowApi>(() => {
    const { id } = win
    return {
      ...win,
      active,
      takesKeys,
      minimize: () => dispatch({ type: 'minimize', id }),
      toggleMaximize: () => dispatch({ type: 'toggleMaximize', id }),
      close: () => dispatch({ type: 'close', id }),
      // every pointerdown inside the window calls this: when nothing would
      // change, no render runs in the middle of a selection or a drag
      activate: () => {
        if (!active || !onTop) dispatch({ type: 'activate', id })
      },
      move: (pos) => dispatch({ type: 'move', id, pos }),
    }
  }, [win, active, takesKeys, onTop, dispatch])

  return (
    <WindowContext.Provider value={api}>
      <View />
    </WindowContext.Provider>
  )
})
