import type { ReactNode } from 'react'

type Props = {
  /** selection or object count; takes the remaining width */
  main: ReactNode
  /** free space; the field is left out when not given */
  space?: ReactNode
  /** disk geometry; the field is left out when not given */
  disk?: ReactNode
  /** the window's zoom; the field is left out when not given (at 100%) */
  zoom?: ReactNode
}

/**
 * Sunken fields, as in the mockups: what is selected, free space, geometry,
 * and the zoom when it is not 100%.
 * A window with nothing to say about the disk (the Lixeira) leaves those two out.
 */
export function StatusBar({ main, space, disk, zoom }: Props) {
  return (
    <div className="status-bar">
      <p className="status-bar-field status-main">{main}</p>
      {space !== undefined && <p className="status-bar-field status-space">{space}</p>}
      {disk !== undefined && <p className="status-bar-field status-disk">{disk}</p>}
      {zoom !== undefined && <p className="status-bar-field status-zoom">{zoom}</p>}
    </div>
  )
}
