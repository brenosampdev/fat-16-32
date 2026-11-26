import { useQueryClient } from '@tanstack/react-query'
import { useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { base64ToBytes, basename } from '../../api'
import type { DiskInfo, FatEntry, ReadData } from '../../api'
import { keys, useOverwrite, useReplace, useWrite } from '../../api/queries'
import {
  formatCount,
  growthRows,
  locateOffset,
  newClusterLabels,
  predictAppend,
  predictReplace,
  shrinkRows,
  textToBase64,
  textToBytes,
  touchedClusters,
  validateOverwrite,
} from '../../lib/content'
import type { FatRow } from '../../lib/content'
import { cls } from '../../lib/display'
import { messageOf } from '../../lib/errors'
import { ChainChips } from '../common/ChainChips'
import { Modal } from '../dialogs/Modal'
import { MiniMap } from './MiniMap'

export type ContentMode = 'append' | 'overwrite' | 'replace'

type Props = {
  mode: ContentMode
  path: string
  /** what GET /file/read returned; the size and the bytes around the offset come from it */
  file: ReadData
  /** from GET /file/chain */
  chain: readonly number[]
  disk: DiskInfo
  fat: readonly FatEntry[] | undefined
  onClose: () => void
}

/** bytes of context on each side of the overwrite preview (tela 13) */
const CONTEXT = 60
/** the excerpt of the current end of the file (tela 12) */
const TAIL = 120

const decoder = new TextDecoder()

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)
const clusters = (n: number) => `${formatCount(n)} ${plural(n, 'cluster', 'clusters')}`
/** [13] -> 'do cluster 13'; [13, 14, 15] -> 'dos clusters 13, 14 e 15' */
const ofClusters = (list: readonly number[]) =>
  list.length === 1
    ? `do cluster ${list[0]}`
    : `dos clusters ${list.slice(0, -1).join(', ')} e ${list[list.length - 1]}`
/** what a write that needs N new clusters gets: 'um cluster novo', '3 clusters novos' */
const newOnes = (n: number) => (n === 1 ? 'um cluster novo' : `${formatCount(n)} clusters novos`)

const TITLES: Record<ContentMode, string> = {
  append: 'Acrescentar a',
  overwrite: 'Sobrescrever em',
  replace: 'Substituir conteúdo de',
}

const ACTIONS: Record<ContentMode, string> = {
  append: 'Acrescentar',
  overwrite: 'Sobrescrever',
  replace: 'Substituir',
}

/**
 * Telas 12, 13 and 14: one dialog, three ways of writing bytes. The group
 * "Efeito na FAT" is recomputed on every key from the chain and the FAT on
 * screen; it is a prediction, and after the write everything is refetched.
 */
export function ContentEditor({ mode, path, file, chain, disk, fat, onClose }: Props) {
  const queryClient = useQueryClient()
  const write = useWrite()
  const overwrite = useOverwrite()
  const replace = useReplace()

  // Substituir starts from the current text: editing it and confirming is how
  // a file is edited here (the viewer itself is read-only, tela 11a)
  const [text, setText] = useState(mode === 'replace' ? file.conteudo_texto : '')
  const [offsetText, setOffsetText] = useState('0')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const firstField = useRef<HTMLTextAreaElement & HTMLInputElement>(null)

  const cs = disk.clusterSize
  const size = file.tamanho
  const bytes = useMemo(() => textToBytes(text), [text])
  const n = bytes.length
  const current = useMemo(() => base64ToBytes(file.conteudo_base64), [file.conteudo_base64])

  let effect: ReactNode
  let problem: string | null = null
  let ready = false
  let fields: ReactNode

  const edit = (value: string) => {
    setText(value)
    setFailure(null)
  }

  if (mode === 'append') {
    const p = predictAppend(chain, size, n, cs)
    const slack = chain.length * cs - size
    const last = p.last
    if (p.newClusters > disk.clustersLivres) {
      problem = `Espaço insuficiente: são precisos ${clusters(p.newClusters)} novos e há ${formatCount(disk.clustersLivres)} livres.`
    }
    ready = n > 0 && !problem

    let how: string
    if (n === 0) how = 'Digite o texto que vai para o final do arquivo.'
    else if (last === null) how = `O arquivo está vazio: os ${formatCount(n)} B vão para ${newOnes(p.newClusters)}.`
    else if (p.newClusters === 0)
      how = `Os ${formatCount(n)} B cabem na sobra do cluster ${last} (${formatCount(slack)} B livres): nenhum cluster novo.`
    else if (slack === 0)
      how = `O cluster ${last} está cheio: os ${formatCount(n)} B vão para ${newOnes(p.newClusters)}.`
    else
      how = `Os primeiros ${formatCount(slack)} B vão para a sobra do cluster ${last}; os ${formatCount(n - slack)} B restantes vão para ${newOnes(p.newClusters)}.`

    const tail = current.subarray(Math.max(0, size - TAIL))
    fields = (
      <>
        <span>Conteúdo atual (final):</span>
        <div className="content-excerpt">
          {size === 0 ? (
            <span className="muted">(arquivo vazio)</span>
          ) : (
            (size > TAIL ? '…' : '') + decoder.decode(tail)
          )}
        </div>
        <label htmlFor="content-text">Texto a acrescentar ({formatCount(n)} B):</label>
        <textarea
          id="content-text"
          ref={firstField}
          className="content-text"
          value={text}
          onChange={(e) => edit(e.target.value)}
          disabled={busy}
          spellCheck={false}
        />
      </>
    )

    const allocated = p.newClusters === 0 ? 'nenhum alocado' : `${formatCount(p.newClusters)} ${plural(p.newClusters, 'alocado', 'alocados')}`
    effect = (
      <>
        <dl className="facts content-facts">
          <dt>Tamanho</dt>
          <dd>
            {formatCount(size)} B → {formatCount(p.newSize)} B (+{formatCount(n)} B)
          </dd>
          <dt>Clusters</dt>
          <dd>
            {chain.length} → {chain.length + p.newClusters} ({allocated})
          </dd>
          {last === null && p.newClusters > 0 && (
            <>
              <dt>1º cluster</dt>
              <dd>0 → {newClusterLabels(p.newClusters)[0]} (na entrada de diretório)</dd>
            </>
          )}
        </dl>
        <GrowingChain chain={chain} newClusters={p.newClusters} />
        <FatTable rows={growthRows(chain, p.newClusters)} />
        <span className="muted">{how}</span>
      </>
    )
  } else if (mode === 'overwrite') {
    const offset = offsetText.trim() === '' ? NaN : Number(offsetText)
    const whole = Number.isInteger(offset)
    const error = whole ? validateOverwrite(offset, n, size) : 'Informe o offset em bytes, um número inteiro.'
    ready = n > 0 && !error

    let where = 'bytes'
    if (whole && offset >= 0) {
      const place = locateOffset(offset, chain, cs)
      where =
        offset < size && place.cluster !== null
          ? `bytes (cluster ${place.cluster}, posição ${formatCount(place.position)})`
          : 'bytes (além do fim do arquivo)'
    }
    const touched = whole && !error ? touchedClusters(offset, n, chain, cs) : []

    let sum: ReactNode
    if (error) sum = <span className="content-error">{error}</span>
    else if (n === 0) sum = <span className="muted">Digite o trecho que vai por cima dos bytes a partir do offset.</span>
    else sum = `${formatCount(offset)} + ${formatCount(n)} = ${formatCount(offset + n)} ≤ ${formatCount(size)} B`

    fields = (
      <>
        <div className="content-offset">
          <label htmlFor="content-offset">Offset:</label>
          <input
            id="content-offset"
            ref={firstField}
            type="number"
            min={0}
            step={1}
            value={offsetText}
            onChange={(e) => {
              setOffsetText(e.target.value)
              setFailure(null)
            }}
            disabled={busy}
          />
          <span className="muted">{where}</span>
        </div>
        <label htmlFor="content-text">Novo trecho ({formatCount(n)} B):</label>
        <textarea
          id="content-text"
          className="content-text short"
          value={text}
          onChange={(e) => edit(e.target.value)}
          disabled={busy}
          spellCheck={false}
        />
        {whole && offset >= 0 && offset <= size && (
          <div className="content-excerpt tall" aria-label="Como o trecho fica no arquivo">
            {offset > CONTEXT && '…'}
            {decoder.decode(current.subarray(Math.max(0, offset - CONTEXT), offset))}
            <mark className={cls('content-mark', error && 'over')}>{text}</mark>
            {decoder.decode(current.subarray(offset + n, offset + n + CONTEXT))}
            {offset + n + CONTEXT < size && '…'}
          </div>
        )}
        <span className="content-sum" aria-live="polite">
          {sum}
        </span>
      </>
    )

    effect = (
      <>
        <strong>A tabela de alocação não muda.</strong>
        {fat && chain.length > 0 && (
          <div className="content-maps">
            <MiniMap label="Antes" fat={fat} chain={chain} touched={touched} focus={chain} />
            <MiniMap label="Depois" fat={fat} chain={chain} touched={touched} focus={chain} />
          </div>
        )}
        <dl className="facts content-facts">
          <dt>Tamanho</dt>
          <dd>
            {formatCount(size)} B → {formatCount(size)} B
          </dd>
          <dt>Cadeia</dt>
          <dd>
            {chain.length === 0 ? 'nenhum cluster (arquivo vazio)' : <ChainChips chain={chain} eof />}
            {chain.length > 0 && <span className="muted">idêntica</span>}
          </dd>
          <dt>FAT[n]</dt>
          <dd>nenhuma entrada alterada</dd>
          <dt>Diretório</dt>
          <dd>só a data de modificação muda</dd>
        </dl>
        {touched.length > 0 && (
          <span className="muted">Só o conteúdo {ofClusters(touched)} (contorno) é reescrito.</span>
        )}
      </>
    )
  } else {
    const p = predictReplace(chain, n, cs)
    const after = p.kept.length + p.newClusters
    if (p.newClusters > disk.clustersLivres) {
      problem = `Espaço insuficiente: são precisos ${clusters(p.newClusters)} novos e há ${formatCount(disk.clustersLivres)} livres.`
    }
    ready = !problem

    let headline: string
    if (chain.length > 0 && n === 0) headline = 'A cadeia inteira é liberada: o arquivo fica vazio, sem clusters.'
    else if (chain.length === 0 && p.newClusters > 0) headline = `O arquivo vazio passa a ocupar ${clusters(p.newClusters)}.`
    else if (p.freed.length > 0) headline = `A cadeia encolhe de ${chain.length} para ${clusters(p.kept.length)}.`
    else if (p.newClusters > 0) headline = `A cadeia cresce de ${chain.length} para ${clusters(after)}.`
    else if (chain.length === 0) headline = 'O arquivo continua vazio: a FAT não muda.'
    else headline = `A cadeia continua com ${clusters(chain.length)}: a FAT não muda.`

    const rows = p.freed.length > 0 ? shrinkRows(p.kept, p.freed) : growthRows(chain, p.newClusters)
    let entry: string | null = null
    if (chain.length > 0 && after === 0) entry = 'A entrada de diretório passa a apontar para o cluster 0 (arquivo vazio).'
    else if (chain.length === 0 && after > 0) entry = 'A entrada de diretório passa a apontar para o primeiro cluster novo.'

    fields = (
      <>
        <div className="content-offset off">
          <label htmlFor="content-offset">Offset:</label>
          <input id="content-offset" type="number" value={0} disabled readOnly />
          <span>não se aplica: o arquivo inteiro é trocado</span>
        </div>
        <label htmlFor="content-text">Novo conteúdo ({formatCount(n)} B):</label>
        <textarea
          id="content-text"
          ref={firstField}
          className="content-text tall"
          value={text}
          onChange={(e) => edit(e.target.value)}
          disabled={busy}
          spellCheck={false}
        />
        <span className="content-sum">
          {formatCount(size)} B → {formatCount(n)} B
        </span>
      </>
    )

    effect = (
      <>
        <strong>{headline}</strong>
        {fat && chain.length > 0 && (
          <div className="content-maps">
            <MiniMap label="Antes" fat={fat} chain={chain} focus={chain} />
            <MiniMap label="Depois" fat={fat} chain={p.kept} freed={p.freed} focus={chain} />
          </div>
        )}
        <span className="content-chain">
          <GrowingChain chain={p.kept} newClusters={p.newClusters} />
          {p.freed.length > 0 && (
            <>
              <span className="muted">liberados:</span>
              <ChainChips chain={p.freed} variant="freed" />
            </>
          )}
        </span>
        <FatTable rows={rows} />
        {p.newClusters > 0 && (
          <span className="muted">
            {p.newClusters === 1 ? 'Um cluster será alocado' : `${formatCount(p.newClusters)} clusters serão alocados`}
            : o first-fit do servidor escolhe quais na hora da escrita.
          </span>
        )}
        {entry && <span className="muted">{entry}</span>}
      </>
    )
  }

  const submit = async () => {
    if (!ready || busy) return
    setBusy(true)
    setFailure(null)
    const base64 = textToBase64(text)
    try {
      if (mode === 'append') await write.mutateAsync({ path, base64 })
      else if (mode === 'replace') await replace.mutateAsync({ path, base64 })
      else {
        await overwrite.mutateAsync({ path, offset: Number(offsetText), base64 })
        // an overwrite never changes the FAT, so useOverwrite leaves it alone;
        // it is read again on purpose: the map on screen is then the server's
        // answer, which is the proof that nothing moved
        void queryClient.invalidateQueries({ queryKey: keys.fat })
      }
      onClose()
    } catch (e) {
      // the backend detail, as it came
      setFailure(messageOf(e))
      setBusy(false)
    }
  }

  const shown = failure ?? problem

  return (
    <Modal
      title={`${TITLES[mode]} ${basename(path)}`}
      onClose={onClose}
      initialFocus={firstField}
      className="content-dialog"
      buttons={
        <>
          <button type="button" onClick={() => void submit()} disabled={!ready || busy}>
            {ACTIONS[mode]}
          </button>
          <button type="button" onClick={onClose}>
            Cancelar
          </button>
        </>
      }
    >
      <div className="window-body content-body">
        {fields}
        <fieldset className="content-effect">
          <legend>Efeito na FAT</legend>
          {effect}
        </fieldset>
        {shown && (
          <p className="content-problem" role="alert">
            {shown}
          </p>
        )}
      </div>
    </Modal>
  )
}

/** '12 13 14 → [novo] [EOF]': the chain as it will be, without naming clusters not yet picked. */
function GrowingChain({ chain, newClusters }: { chain: readonly number[]; newClusters: number }) {
  if (chain.length === 0 && newClusters === 0) return <span className="muted">nenhum cluster</span>
  return (
    <span className="chain-chips">
      {chain.length > 0 && <ChainChips chain={chain} />}
      {chain.length > 0 && newClusters > 0 && <span className="muted">→</span>}
      {newClusters > 0 && (
        <span className="chain-chip novo">
          {newClusters === 1 ? 'novo' : `+${formatCount(newClusters)} novos`}
        </span>
      )}
      <span className="chain-chip eof">EOF</span>
    </span>
  )
}

/** 'Cluster | FAT[n] antes | FAT[n] depois' (telas 12 and 14), the vocabulary of tela 07. */
function FatTable({ rows }: { rows: FatRow[] }) {
  if (rows.length === 0) {
    return (
      <dl className="facts content-facts">
        <dt>FAT[n]</dt>
        <dd>nenhuma entrada alterada</dd>
      </dl>
    )
  }
  return (
    <div className="fat-table-box">
      <table className="fat-table">
        <thead>
          <tr>
            <th>Cluster</th>
            <th>FAT[n] antes</th>
            <th>FAT[n] depois</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.cluster} className={r.kind}>
              <td>{r.cluster}</td>
              <td>{r.before}</td>
              <td>{r.after}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
