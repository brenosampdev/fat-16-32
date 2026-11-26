import { Fragment } from 'react'

import { keepFocus } from '../../lib/dom'
import { Icon } from '../common/Icon'
import type { IconName } from '../common/Icon'

export type ToolbarAction = {
  label: string
  icon?: IconName
  /** hide the text and keep it only as tooltip */
  iconOnly?: boolean
  title?: string
  /** an action without handler renders disabled */
  onClick?: () => void
  disabled?: boolean
}

type Props = {
  groups: ToolbarAction[][]
  /** greys out every button, e.g. while the FAT is being read */
  disabled?: boolean
}

/**
 * Flat XP toolbar: buttons raise on hover, groups split by an etched line.
 * Nothing on it takes the focus, as in XP: it stays in the list, so a dialog
 * opened from here gives it back there, and Enter opens the file instead of
 * pressing the button again. A rename in progress still ends first (keepFocus).
 */
export function Toolbar({ groups, disabled }: Props) {
  return (
    <div className="toolbar" role="toolbar" onMouseDown={keepFocus}>
      {groups.map((group, g) => (
        <Fragment key={g}>
          {g > 0 && <span className="toolbar-separator" aria-hidden="true" />}
          {group.map((a) => (
            <button
              key={a.label}
              type="button"
              className="plano toolbar-button"
              title={a.title ?? a.label}
              aria-label={a.label}
              disabled={disabled || a.disabled || !a.onClick}
              onClick={a.onClick}
            >
              {a.icon && <Icon name={a.icon} size={20} />}
              {!a.iconOnly && <span>{a.label}</span>}
            </button>
          ))}
        </Fragment>
      ))}
    </div>
  )
}
