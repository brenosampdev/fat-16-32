import { useMemo, useState } from 'react'

import { cls } from '../../lib/display'
import { hex, hexLines, hexRow } from '../../lib/content'

/** Every line has the same height, so the visible window is plain arithmetic. */
const LINE = 15
/** lines drawn around the visible ones; the box shows about 18 */
const WINDOW = 48
const OVERSCAN = 12

type Props = {
  bytes: Uint8Array
  chain: readonly number[]
  clusterSize: number
}

/**
 * Classic hexdump of conteudo_base64 (tela 11b): offset, 16 bytes, ASCII with
 * '.' for anything not printable, and a marker at every cluster boundary. A
 * jump in the chain is drawn in red: the bytes run on, the clusters do not.
 * A file can reach megabytes, so only the lines near the scroll are in the DOM.
 */
export function HexView({ bytes, chain, clusterSize }: Props) {
  const lines = useMemo(
    () => hexLines(bytes.length, chain, clusterSize),
    [bytes.length, chain, clusterSize],
  )
  const width = Math.max(4, hex(bytes.length, 0).length)
  const [scrollTop, setScrollTop] = useState(0)
  const first = Math.max(0, Math.floor(scrollTop / LINE) - OVERSCAN)

  return (
    <div
      className="hexview"
      tabIndex={0}
      role="region"
      aria-label="Conteúdo em hexadecimal"
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      <div className="hexview-track" style={{ height: lines.length * LINE }}>
        <div style={{ transform: `translateY(${first * LINE}px)` }}>
          {lines.slice(first, first + WINDOW).map((line, i) => {
            const key = first + i
            if (line.kind !== 'bytes') {
              return (
                <div key={key} className={cls('hex-mark', line.kind === 'boundary' && line.jump && 'jump')}>
                  {line.text}
                </div>
              )
            }
            const row = hexRow(bytes, line.offset)
            return (
              <div key={key} className="hex-line">
                <span className="hex-offset">{hex(line.offset, width)}</span>
                <span className="hex-bytes">{row.hex}</span>
                <span className="hex-ascii">{row.ascii}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
