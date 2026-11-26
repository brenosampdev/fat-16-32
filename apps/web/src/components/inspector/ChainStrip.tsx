import { Fragment } from 'react'

import type { FatEntry } from '../../api'
import { fragments } from '../../lib/chain'
import { cls } from '../../lib/display'
import { describeJump } from '../../lib/inspect'

/** Runs longer than this collapse to 'first–last', as ChainChips does. */
const SPELL_OUT = 6

export type StripRow = { key: string; name: string; chain: readonly number[]; tone: 'a' | 'b' }

type Props = {
  rows: readonly StripRow[]
  fat: readonly FatEntry[]
  /** a line after the rows, for what did not fit ('… e mais 3 fragmentados') */
  more?: string
}

/**
 * The selection's chains under the map (telas 01–03), the ChainView of
 * build-frontend.md: 'dados.bin  10 11 → salto: 12–14 em uso → 15 16 17 18
 * EOF'. The gap is described by FAT state, never by who occupies it.
 */
export function ChainStrip({ rows, fat, more }: Props) {
  return (
    <div className="chain-strip">
      {rows.map((row) => {
        const runs = fragments(row.chain)
        return (
          <div key={row.key} className={cls('strip-row', `tone-${row.tone}`)}>
            <span className="strip-name">{row.name}</span>
            {runs.length === 0 && <span className="muted">nenhum cluster alocado</span>}
            {runs.map((run, i) => (
              <Fragment key={run[0]}>
                {i > 0 && (
                  <span className="strip-jump">
                    → salto: {describeJump(runs[i - 1][runs[i - 1].length - 1], run[0], fat)} →
                  </span>
                )}
                <span className="chain-chip">
                  {run.length > SPELL_OUT ? `${run[0]}–${run[run.length - 1]}` : run.join(' ')}
                </span>
              </Fragment>
            ))}
            {runs.length > 0 && <span className="chain-chip eof">EOF</span>}
          </div>
        )
      })}
      {more && <div className="strip-row muted">{more}</div>}
    </div>
  )
}
