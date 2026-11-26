import { useMemo } from 'react'
import type { ReactNode } from 'react'

import { clusterState } from '../../api'
import type { FatEntry } from '../../api'
import { cls } from '../../lib/display'
import { countStates } from '../../lib/inspect'

/** A chain lit on the map: 'a' is the primary tone, 'b' the second item of a pair. */
export type MapLit = { chain: readonly number[]; tone: 'a' | 'b' }

type Props = {
  /** undefined while the FAT has not arrived */
  entries?: FatEntry[]
  /** cluster count known from /disk/info, used to draw empty cells while loading */
  total?: number
  /** first data cluster, for the row labels before the FAT arrives */
  first?: number
  /** the selection's chains, drawn over the FAT state */
  lit?: readonly MapLit[]
  /** strip under the grid */
  footer: ReactNode
}

const LEGEND = [
  { state: 'livre', label: 'Livre' },
  { state: 'usado', label: 'Em uso' },
  { state: 'fim', label: 'Fim de cadeia' },
  { state: 'defeituoso', label: 'Defeituoso' },
] as const

/** 32 cells per row up to 256 clusters; 64 per row above that (telas.md, tela 19). */
const layout = (n: number) => (n <= 256 ? { cols: 32, cell: 13 } : { cols: 64, cell: 8 })

/** cluster -> 'sel-a' | 'sel-a-fim' | 'sel-b' | 'sel-b-fim'. A later chain wins a shared cluster. */
function litClasses(lit: readonly MapLit[]): Map<number, string> {
  const out = new Map<number, string>()
  for (const { chain, tone } of lit) {
    chain.forEach((c, i) => out.set(c, i === chain.length - 1 ? `sel-${tone}-fim` : `sel-${tone}`))
  }
  return out
}

/**
 * Cluster map colored by FAT state, never by owner: the FAT does not record
 * who uses a cluster, so the tooltip shows FAT[n] and nothing else. The
 * selection is lit in yellow over the state (build-frontend.md, "aceso"),
 * darker on the last cluster of each chain.
 */
export function ClusterMap({ entries, total, first = 2, lit = [], footer }: Props) {
  const count = entries?.length ?? total ?? 0
  const start = entries?.[0]?.cluster ?? first
  const { cols, cell } = layout(count)
  const rows = Math.ceil(count / cols)
  const counts = useMemo(() => (entries ? countStates(entries) : null), [entries])
  const lighted = useMemo(() => litClasses(lit), [lit])
  const pair = lit.some((l) => l.tone === 'b')

  return (
    <section className="clustermap" aria-label="Mapa de clusters">
      <header className="clustermap-head">
        <strong>
          Mapa de clusters{count > 0 && ` (${start}–${start + count - 1})`}
        </strong>
        <ul className="clustermap-legend">
          {LEGEND.map((l) => (
            <li key={l.state}>
              <span className={cls('cell', l.state)} />
              {l.label}
              {counts && <span className="legend-count">{counts[l.state]}</span>}
            </li>
          ))}
          <li>
            <span className="cell sel-a" />
            <span className="cell sel-a-fim" />
            {pair && (
              <>
                <span className="cell sel-b" />
                <span className="cell sel-b-fim" />
              </>
            )}
            Selecionado (fim)
          </li>
        </ul>
      </header>

      <div className="clustermap-body" style={{ ['--cell' as string]: `${cell}px` }}>
        <div className="clustermap-rows" aria-hidden="true">
          {Array.from({ length: rows }, (_, r) => (
            <span key={r}>{start + r * cols}</span>
          ))}
        </div>
        <div className="clustermap-grid" style={{ gridTemplateColumns: `repeat(${cols}, ${cell}px)` }}>
          {entries
            ? entries.map((c) => (
                <span
                  key={c.cluster}
                  className={cls('cell', clusterState(c.status), lighted.get(c.cluster))}
                  title={`Cluster ${c.cluster}: FAT[${c.cluster}] = ${c.status}`}
                />
              ))
            : // not read yet: transparent, so they blend with the grid gap
              // instead of looking free (telas.md, tela 04)
              Array.from({ length: count }, (_, i) => <span key={i} className="cell" />)}
        </div>
      </div>

      <footer className="clustermap-foot">{footer}</footer>
    </section>
  )
}
