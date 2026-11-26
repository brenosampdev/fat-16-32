import { forwardRef } from 'react'
import { createPortal } from 'react-dom'

import { Icon } from '../common/Icon'
import type { IconName } from '../common/Icon'

type Props = { icon: IconName; label: string }

/**
 * What follows the pointer while rows are dragged: the first item's icon and
 * its name, or 'N itens'. On <body>, outside any window's zoom, so it is
 * placed in the pointer's screen px; useDragMove moves it through the ref.
 */
export const DragGhost = forwardRef<HTMLDivElement, Props>(function DragGhost({ icon, label }, ref) {
  return createPortal(
    <div ref={ref} className="drag-ghost" aria-hidden="true">
      <Icon name={icon} />
      <span>{label}</span>
    </div>,
    document.body,
  )
})
