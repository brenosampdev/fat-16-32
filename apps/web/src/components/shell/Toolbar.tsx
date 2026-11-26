import { Fragment } from 'react'

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

/** Flat XP toolbar: buttons raise on hover, groups split by an etched line. */
export function Toolbar({ groups, disabled }: Props) {
  return (
    <div className="toolbar" role="toolbar">
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
