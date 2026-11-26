import { useRef, useState } from 'react'
import type { ComponentType, PointerEvent } from 'react'

import { cls } from '../../lib/display'
import { takesKeys, topVisible } from '../../lib/windows'
import type { WindowKind } from '../../lib/windows'
import { Balloon } from '../desktop/Balloon'
import { WindowScope, useDesk } from '../desktop/DeskContext'
import { DesktopIcons } from '../desktop/DesktopIcons'
import type { DeskIconId } from '../desktop/DesktopIcons'
import { RecycleBin } from '../desktop/RecycleBin'
import { StartMenu } from '../desktop/StartMenu'
import { Taskbar } from '../desktop/Taskbar'
import { Explorer } from '../explorer/Explorer'

/** What each kind of window shows. */
const VIEWS: Record<WindowKind, ComponentType | null> = {
  explorer: Explorer,
  recycle: RecycleBin,
}

type Props = {
  /** going grey while the session asks how to shut down, sleeps or shuts down */
  fading?: boolean
}

/**
 * The XP desktop: the wallpaper (CSS on .desktop), the icons and windows in
 * .desk-area, the taskbar, the tray balloon and the Start menu. .desk-area is
 * a stacking context of its own under the taskbar layer, so window z values
 * never reach the taskbar; the balloon and the Start menu go over both.
 */
export function Desktop({ fading = false }: Props) {
  const { desk, dispatch, balloon, dismissBalloon } = useDesk()
  const [picked, setPicked] = useState<DeskIconId | null>(null)
  const [startOpen, setStartOpen] = useState(false)
  const startRef = useRef<HTMLButtonElement>(null)
  const top = topVisible(desk)?.id

  // As on XP, the active window goes inactive while the menu is open, so its
  // shortcuts (Delete, F2...) stop answering; it stays inactive until clicked.
  const toggleStart = () => {
    if (startOpen) return setStartOpen(false)
    if (desk.activeId !== null) dispatch({ type: 'deactivate' })
    setStartOpen(true)
  }

  // only the empty desktop deactivates and drops the icon selection: a
  // pointerdown inside a window or on an icon arrives here too, by
  // bubbling, with that element as its target
  const onDeskDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return
    setPicked(null)
    if (desk.activeId !== null) dispatch({ type: 'deactivate' })
  }

  return (
    <div className={cls('desktop', fading && 'fading')}>
      <div className="desk-area" onPointerDown={onDeskDown}>
        <DesktopIcons selected={picked} onSelect={setPicked} />
        {desk.windows.map((w) => {
          const view = VIEWS[w.kind]
          return (
            view && (
              <WindowScope
                key={w.id}
                win={w}
                active={desk.activeId === w.id}
                takesKeys={takesKeys(desk, w.id)}
                onTop={w.id === top}
                dispatch={dispatch}
                view={view}
              />
            )
          )
        })}
      </div>
      <Taskbar onStart={toggleStart} startOpen={startOpen} startRef={startRef} />
      {/* always there, so a screen reader hears each new balloon; before the
          Start menu, which covers it where they meet */}
      <div className="tray-balloon-slot" role="status">
        {balloon && <Balloon balloon={balloon} onDismiss={dismissBalloon} />}
      </div>
      {startOpen && <StartMenu anchor={startRef} onClose={() => setStartOpen(false)} />}
    </div>
  )
}
