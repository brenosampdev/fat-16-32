import type { Ref } from 'react'

import { cls } from '../../lib/display'
import { Icon } from '../common/Icon'
import { useDesk } from './DeskContext'
import { KIND_ICON } from './kinds'
import { Tray } from './Tray'

type Props = {
  /** opens or closes the Start menu; the button does nothing without it */
  onStart?: () => void
  /** the Start menu is open: the button stays pressed */
  startOpen?: boolean
  /** the Start button, for the menu that hangs from it */
  startRef?: Ref<HTMLButtonElement>
}

/**
 * The XP taskbar: Start, one button per open window (minimized ones too), in
 * the order they were opened, and the tray. A window's button is pressed
 * while that window is active and visible; a click minimizes it then, and
 * restores and activates it otherwise (the reducer's 'taskbar' rule).
 */
export function Taskbar({ onStart, startOpen, startRef }: Props) {
  const { desk, dispatch } = useDesk()

  return (
    <div className="taskbar">
      <button
        ref={startRef}
        type="button"
        className="plano start-button"
        aria-haspopup="menu"
        aria-expanded={startOpen}
        onClick={onStart}
      >
        <Icon name="start" size={20} />
        Iniciar
      </button>
      <div className="taskbar-tasks">
        {desk.windows.map((w) => {
          const pressed = desk.activeId === w.id && !w.minimized
          return (
            <button
              key={w.id}
              type="button"
              className={cls('plano', 'task-button', pressed && 'pressed')}
              data-task-id={w.id}
              aria-pressed={pressed}
              title={w.title}
              // the focus stays where it was, so the window gets it back
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => dispatch({ type: 'taskbar', id: w.id })}
            >
              <Icon name={KIND_ICON[w.kind]} />
              <span className="task-title">{w.title}</span>
            </button>
          )
        })}
      </div>
      <Tray />
    </div>
  )
}
