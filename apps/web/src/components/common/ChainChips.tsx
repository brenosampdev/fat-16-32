import { fragments } from '../../lib/chain'
import { cls } from '../../lib/display'

/** Runs longer than this collapse to 'first–last', so a big file stays on one line. */
const SPELL_OUT = 6

type Props = {
  chain: readonly number[]
  /** appends the end marker */
  eof?: boolean
  /** 'freed': dashed red outline, for clusters a write gives back (tela 14) */
  variant?: 'freed'
}

/**
 * A cluster chain drawn as its fragments, one blue chip per contiguous run
 * (telas.md, tela 09: '10 11 | 15 16 17 18').
 */
export function ChainChips({ chain, eof, variant }: Props) {
  return (
    <span className={cls('chain-chips', variant)}>
      {fragments(chain).map((run) => (
        <span key={run[0]} className="chain-chip">
          {run.length > SPELL_OUT ? `${run[0]}–${run[run.length - 1]}` : run.join(' ')}
        </span>
      ))}
      {eof && chain.length > 0 && <span className="chain-chip eof">EOF</span>}
    </span>
  )
}
