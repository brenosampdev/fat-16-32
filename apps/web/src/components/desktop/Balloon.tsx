import { useId } from 'react'

import type { BalloonInput } from '../../lib/balloons'
import { Icon } from '../common/Icon'

type Props = {
  balloon: BalloonInput
  /** the ×, or a click anywhere on it, as on XP */
  onDismiss: () => void
}

/**
 * The yellow balloon over the tray (spec, "Balões na bandeja"): its icon and
 * bold title, the text, a × and a tail pointing down at the tray. It never
 * takes the focus: the active window keeps it, and its keys.
 */
export function Balloon({ balloon, onDismiss }: Props) {
  const titleId = useId()
  return (
    <div
      className="tray-balloon"
      role="group"
      aria-labelledby={titleId}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onDismiss}
    >
      <div className="tray-balloon-head">
        <Icon name={balloon.icon} />
        <strong id={titleId}>{balloon.title}</strong>
        <button
          type="button"
          className="plano tray-balloon-close"
          title="Fechar"
          aria-label="Fechar"
          onClick={(e) => {
            e.stopPropagation()
            onDismiss()
          }}
        >
          ×
        </button>
      </div>
      <p>{balloon.text}</p>
    </div>
  )
}
