import type { MouseEvent, PointerEventHandler } from 'react'

import { Icon } from '../common/Icon'
import type { IconName } from '../common/Icon'

type Props = {
  title: string
  icon: IconName
  maximized: boolean
  onMinimize: () => void
  onToggleMaximize: () => void
  onClose: () => void
  onPointerDown?: PointerEventHandler<HTMLDivElement>
  onPointerMove?: PointerEventHandler<HTMLDivElement>
  onPointerUp?: PointerEventHandler<HTMLDivElement>
}

/**
 * xp.css draws the bar and the three caption buttons from their aria-label;
 * "Restore" swaps the Maximize glyph. A double-click on the bar itself, not
 * on a button, toggles maximize, as in XP.
 */
export function TitleBar({
  title,
  icon,
  maximized,
  onMinimize,
  onToggleMaximize,
  onClose,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: Props) {
  const onDoubleClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!(e.target as HTMLElement).closest('button')) onToggleMaximize()
  }

  return (
    <div
      className="title-bar"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      // Nothing on the bar takes the focus, as in XP. On the bar itself, the
      // mousedown would drop to body the focus the window has just got back
      // (AppWindow, on activation), and a drag would select text. The caption
      // buttons keep the focus in the window, and Enter or Space cannot press
      // Maximize a second time.
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="title-bar-text">
        <Icon name={icon} className="title-bar-icon" />
        {title}
      </div>
      {/* the English aria-labels pick xp.css' glyphs; the pt-BR titles are the tips */}
      <div className="title-bar-controls">
        <button type="button" aria-label="Minimize" title="Minimizar" tabIndex={-1} onClick={onMinimize} />
        <button
          type="button"
          aria-label={maximized ? 'Restore' : 'Maximize'}
          title={maximized ? 'Restaurar' : 'Maximizar'}
          tabIndex={-1}
          onClick={onToggleMaximize}
        />
        <button type="button" aria-label="Close" title="Fechar" tabIndex={-1} onClick={onClose} />
      </div>
    </div>
  )
}
