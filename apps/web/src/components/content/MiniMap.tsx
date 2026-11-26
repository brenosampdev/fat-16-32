import { clusterState } from '../../api'
import type { FatEntry } from '../../api'
import { cls } from '../../lib/display'

const COLS = 32
/** a file spread over more rows than this shows the first ones and a count */
const MAX_ROWS = 6

type Props = {
  fat: readonly FatEntry[]
  /** the file's chain as it stands on this map */
  chain: readonly number[]
  /** rewritten in place: yellow outline (tela 13) */
  touched?: readonly number[]
  /** given back to the FAT: dashed red outline (tela 14) */
  freed?: readonly number[]
  /** clusters the map must show; rows of 32 holding none of them are skipped */
  focus: readonly number[]
  label: string
}

/**
 * A strip of the cluster map around one file (telas 13 and 14). The file's
 * clusters in blue, everything else greyed by its FAT state, so the eye goes
 * to the file and still sees the free holes around it.
 */
export function MiniMap({ fat, chain, touched = [], freed = [], focus, label }: Props) {
  if (fat.length === 0) return null
  const base = fat[0].cluster
  const own = new Set(chain)
  const last = chain.at(-1)
  const outlined = new Set(touched)
  const released = new Set(freed)

  const rowOf = (c: number) => Math.floor((c - base) / COLS)
  const rows = [...new Set(focus.map(rowOf))].sort((a, b) => a - b)
  const shown = rows.slice(0, MAX_ROWS)
  const hidden = rows.length - shown.length

  const cell = (c: number) => {
    const status = fat[c - base]?.status ?? ''
    let state: string
    let title: string
    if (released.has(c)) {
      state = 'liberado'
      title = `Cluster ${c}: liberado, FAT[${c}] = 0`
    } else if (own.has(c)) {
      state = c === last ? 'proprio-fim' : 'proprio'
      title = `Cluster ${c}: deste arquivo`
    } else {
      state = `outro-${clusterState(status)}`
      title = `Cluster ${c}: FAT[${c}] = ${status}`
    }
    return (
      <span
        key={c}
        className={cls('mini-cell', state, outlined.has(c) && 'tocado')}
        title={outlined.has(c) ? `${title}, conteúdo reescrito` : title}
      />
    )
  }

  return (
    <>
      <span className="muted">{label}</span>
      <div className="minimap" role="img" aria-label={`Mapa de clusters, ${label.toLowerCase()}`}>
        {shown.length === 0 ? (
          <span className="muted">nenhum cluster</span>
        ) : (
          shown.map((r) => {
            const start = base + r * COLS
            const end = Math.min(start + COLS, base + fat.length)
            return (
              <div key={r} className="minimap-row">
                <span className="minimap-start">{start}</span>
                <span className="minimap-cells">
                  {Array.from({ length: end - start }, (_, i) => cell(start + i))}
                </span>
              </div>
            )
          })
        )}
        {hidden > 0 && <span className="muted">+{hidden} linhas com clusters do arquivo</span>}
      </div>
    </>
  )
}
