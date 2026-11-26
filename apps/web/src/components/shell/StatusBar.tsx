import type { ReactNode } from 'react'

type Props = {
  /** selection or object count; takes the remaining width */
  main: ReactNode
  /** free space */
  space: ReactNode
  /** disk geometry */
  disk: ReactNode
}

/** Three sunken fields, as in the mockups: what is selected, free space, geometry. */
export function StatusBar({ main, space, disk }: Props) {
  return (
    <div className="status-bar">
      <p className="status-bar-field status-main">{main}</p>
      <p className="status-bar-field status-space">{space}</p>
      <p className="status-bar-field status-disk">{disk}</p>
    </div>
  )
}
