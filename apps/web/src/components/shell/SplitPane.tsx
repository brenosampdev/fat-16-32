import type { ReactNode } from 'react'

type Props = {
  left: ReactNode
  right: ReactNode
  /** the folder tree has a fixed width (telas.md, tela 01) */
  leftWidth?: number
}

/** Two panes with a fixed-width left side. The splitter is not draggable. */
export function SplitPane({ left, right, leftWidth = 200 }: Props) {
  return (
    <div className="split">
      <div className="split-left" style={{ width: leftWidth }}>
        {left}
      </div>
      <div className="split-bar" aria-hidden="true" />
      <div className="split-right">{right}</div>
    </div>
  )
}
