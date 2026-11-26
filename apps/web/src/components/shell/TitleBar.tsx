import type { PointerEventHandler } from 'react'

import { Icon } from '../common/Icon'

type Props = {
  title: string
  onPointerDown?: PointerEventHandler<HTMLDivElement>
  onPointerMove?: PointerEventHandler<HTMLDivElement>
  onPointerUp?: PointerEventHandler<HTMLDivElement>
}

/**
 * xp.css draws the bar and the three caption buttons. The buttons are
 * decorative: there is no window manager (see build-frontend.md, "O que cortar").
 */
export function TitleBar({ title, onPointerDown, onPointerMove, onPointerUp }: Props) {
  return (
    <div
      className="title-bar"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div className="title-bar-text">
        <Icon name="folderOpen" className="title-bar-icon" />
        {title}
      </div>
      <div className="title-bar-controls" aria-hidden="true">
        <button aria-label="Minimize" tabIndex={-1} />
        <button aria-label="Maximize" tabIndex={-1} />
        <button aria-label="Close" tabIndex={-1} />
      </div>
    </div>
  )
}
