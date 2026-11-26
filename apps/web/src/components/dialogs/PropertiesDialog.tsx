import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'

import { api, parentOf, tipoLegivel, validateName } from '../../api'
import type { DiskInfo, FatEntry, LsEntry } from '../../api'
import { keys, useChain } from '../../api/queries'
import { chainFromFat, fragments } from '../../lib/chain'
import { clustersNeeded, formatCount } from '../../lib/content'
import { cls, formatDateTimeFull, toDosPath } from '../../lib/display'
import { messageOf } from '../../lib/errors'
import {
  describeOccupants,
  fatTableRows,
  mapOwners,
  slackShare,
  usedInLast,
} from '../../lib/inspect'
import type { FatTableRow } from '../../lib/inspect'
import { Icon } from '../common/Icon'
import { Modal } from './Modal'

type Tab = 'geral' | 'fat'

type Props = {
  path: string
  entry: LsEntry
  disk: DiskInfo | undefined
  fat: FatEntry[] | undefined
  /** false while the window cannot write: the name is shown read-only */
  canRename: boolean
  /** POST /file/rename and everything that follows it; rejects with the backend error */
  onRename: (name: string) => Promise<void>
  onClose: () => void
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const bytes = (n: number) => `${formatCount(n)} bytes`

/**
 * Telas 06 and 07. Only what the API returns: the /ls entry for Geral,
 * /file/chain and /disk/fat for Detalhes FAT. No attributes, no last
 * access: neither exists in the backend. Editing the name is Renomear
 * (15a): OK confirms, Cancelar discards.
 */
export function PropertiesDialog({ path, entry, disk, fat, canRename, onRename, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('geral')
  const [name, setName] = useState(entry.nome)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const errorId = useId()
  const tabsId = useId()
  const geralRef = useRef<HTMLButtonElement>(null)
  const fatRef = useRef<HTMLButtonElement>(null)

  const isDir = entry.tipo === 'diretorio'
  const empty = entry.primeiro_cluster === 0
  const chainQuery = useChain(empty ? null : path)
  const data = chainQuery.data
  // the FAT answers at once; /file/chain replaces it when it arrives
  const chain = data?.cadeia ?? (fat && !empty ? chainFromFat(fat, entry.primeiro_cluster) : [])
  const clusterSize = disk?.clusterSize ?? 512

  const ok = async () => {
    if (busy) return
    // the backend answers 409 when a name is "renamed" to itself
    if (!canRename || name === entry.nome) return onClose()
    const invalid = validateName(name)
    if (invalid) {
      setTab('geral')
      return setError(invalid)
    }
    setBusy(true)
    try {
      await onRename(name)
      onClose()
    } catch (e) {
      // 15b: the field keeps the text, the backend message under it
      setTab('geral')
      setError(messageOf(e))
      setBusy(false)
    }
  }

  const onTabKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const next = tab === 'geral' ? 'fat' : 'geral'
    setTab(next)
    ;(next === 'geral' ? geralRef : fatRef).current?.focus()
  }

  const tabButton = (id: Tab, label: string, ref: typeof geralRef) => (
    <button
      type="button"
      role="tab"
      ref={ref}
      id={`${tabsId}-${id}`}
      aria-selected={tab === id}
      aria-controls={`${tabsId}-${id}-panel`}
      tabIndex={tab === id ? 0 : -1}
      onClick={() => setTab(id)}
      onKeyDown={onTabKey}
    >
      {label}
    </button>
  )

  // "Em disco" is derived from tamanho and cluster_size (telas.md, tela 06);
  // /file/chain's tamanho_total_clusters is the same number, from the chain
  const clusters = data?.num_clusters ?? (isDir ? chain.length : clustersNeeded(entry.tamanho, clusterSize))
  const onDisk = data?.tamanho_total_clusters ?? clusters * clusterSize

  const geral = (
    <>
      <div className="props-name">
        <Icon name={isDir ? 'folder' : 'file'} size={32} />
        <input
          type="text"
          value={name}
          readOnly={!canRename || busy}
          aria-label="Nome"
          aria-invalid={!!error}
          aria-describedby={error ? errorId : undefined}
          className={cls(error && 'invalid')}
          spellCheck={false}
          onChange={(e) => {
            setName(e.target.value)
            setError(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void ok()
            }
          }}
        />
      </div>
      {error && (
        <p className="props-error" id={errorId} role="alert">
          {error}
        </p>
      )}
      <hr />
      <dl className="facts props-facts">
        <dt>Tipo</dt>
        <dd>{tipoLegivel(entry)}</dd>
        <dt>Local</dt>
        <dd>{toDosPath(parentOf(path))}</dd>
      </dl>
      <hr />
      <dl className="facts props-facts">
        {!isDir && (
          <>
            <dt>Tamanho</dt>
            <dd>{bytes(entry.tamanho)}</dd>
          </>
        )}
        <dt>Em disco</dt>
        <dd>
          {clusters === 0 ? '0 bytes (nenhum cluster)' : `${bytes(onDisk)} (${plural(clusters, 'cluster', 'clusters')})`}
        </dd>
        <dt>1º cluster</dt>
        <dd>{empty ? '0 (nenhum cluster alocado)' : entry.primeiro_cluster}</dd>
      </dl>
      <hr />
      <dl className="facts props-facts">
        <dt>Criado</dt>
        <dd>{formatDateTimeFull(entry.ctime)}</dd>
        <dt>Modificado</dt>
        <dd>{formatDateTimeFull(entry.mtime)}</dd>
      </dl>
    </>
  )

  return (
    <Modal
      title={`Propriedades de ${entry.nome}`}
      onClose={onClose}
      className="properties-dialog"
      buttons={
        <>
          {/* never disabled: ok() ignores clicks while busy, and a disabled
              button would drop the focus (and Esc with it) */}
          <button type="button" onClick={() => void ok()} aria-disabled={busy}>
            OK
          </button>
          <button type="button" onClick={onClose}>
            Cancelar
          </button>
        </>
      }
    >
      <div className="window-body props-body">
        <section className="tabs">
          <menu role="tablist" aria-label="Propriedades">
            {tabButton('geral', 'Geral', geralRef)}
            {tabButton('fat', 'Detalhes FAT', fatRef)}
          </menu>
          <article
            role="tabpanel"
            id={`${tabsId}-${tab}-panel`}
            aria-labelledby={`${tabsId}-${tab}`}
            className="props-panel"
          >
            {tab === 'geral' ? (
              geral
            ) : (
              <FatDetails
                entry={entry}
                chain={chain}
                chainError={chainQuery.isError ? messageOf(chainQuery.error) : null}
                slack={data ? { value: data.slack_interno, onDisk: data.tamanho_total_clusters } : null}
                disk={disk}
                fat={fat}
              />
            )}
          </article>
        </section>
      </div>
    </Modal>
  )
}

// ----------------------------------------------------------- Detalhes FAT

type DetailsProps = {
  entry: LsEntry
  chain: readonly number[]
  chainError: string | null
  /** slack_interno and tamanho_total_clusters as /file/chain sent them */
  slack: { value: number; onDisk: number } | null
  disk: DiskInfo | undefined
  fat: FatEntry[] | undefined
}

/** Tela 07: FAT[n] read literally, one row per cluster, and the slack of the last one. */
function FatDetails({ entry, chain, chainError, slack, disk, fat }: DetailsProps) {
  const queryClient = useQueryClient()
  const isDir = entry.tipo === 'diretorio'
  const variante = disk?.variante ?? 'FAT16'
  const clusterSize = disk?.clusterSize ?? 512
  const runs = fragments(chain).length
  const rows = fat ? fatTableRows(chain, fat, variante) : []
  const jumps = rows.some((r) => r.jump && r.jump.gap.length > 0)

  // who sits in each gap: one /ls per folder, chains from the same FAT.
  // Asked only when there is a gap to name, and dropped when the dialog closes.
  const owners = useQuery({
    queryKey: keys.owners,
    queryFn: () =>
      mapOwners(
        (p) => queryClient.fetchQuery({ queryKey: keys.dir(p), queryFn: () => api.ls(p) }),
        (first) => chainFromFat(fat!, first),
        disk?.rootCluster ?? null,
      ),
    enabled: jumps && !!fat,
    gcTime: 0,
  })

  if (entry.primeiro_cluster === 0) {
    return (
      <dl className="facts props-facts">
        <dt>1º cluster</dt>
        <dd>0 (na entrada de diretório)</dd>
        <dd className="props-wide muted">
          Arquivo vazio: nenhum cluster alocado, nenhuma entrada da FAT em uso.
        </dd>
      </dl>
    )
  }

  const note = (r: FatTableRow): string => {
    const parts: string[] = []
    if (r.fragment !== null && runs > 1) parts.push(`fragmento ${r.fragment}`)
    if (r.jump) {
      if (r.jump.gap.length === 0) parts.push(`volta ao ${r.jump.to}`)
      else {
        const g = r.jump.gap
        const span = g.length === 1 ? `${g[0]}` : `${g[0]}–${g[g.length - 1]}`
        const who = owners.data ? describeOccupants(g, fat!, owners.data) : owners.isError ? 'em uso' : '…'
        parts.push(`salta ${span} (${who})`)
      }
    }
    if (r.last) {
      parts.push(
        isDir ? 'fim da cadeia' : `último: ${formatCount(usedInLast(entry.tamanho, chain.length, clusterSize))} B usados`,
      )
    }
    return parts.join(' · ')
  }

  const last = chain[chain.length - 1]
  const used = usedInLast(entry.tamanho, chain.length, clusterSize)

  return (
    <div className="props-fat">
      <dl className="facts props-facts">
        <dt>1º cluster</dt>
        <dd>{entry.primeiro_cluster} (na entrada de diretório)</dd>
        <dt>Fragmentos</dt>
        <dd className={cls(runs > 1 && 'props-fragmented')}>{runs}</dd>
      </dl>

      {chainError && <p className="props-error">{chainError}</p>}

      <div className="fat-table-box props-table">
        <table className="fat-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Cluster</th>
              <th>FAT[n]</th>
              <th>Observação</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.cluster}
                className={cls(r.jump && 'jump', r.fragment !== null && r.fragment > 1 && 'break')}
              >
                <td>{r.index}</td>
                <td>{r.cluster}</td>
                <td>{r.value}</td>
                <td>{note(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isDir ? (
        <p className="muted props-note">
          Pastas não têm slack calculado: a entrada de diretório de uma pasta registra tamanho 0.
        </p>
      ) : (
        slack && (
          <fieldset className="props-slack">
            <legend>Slack (último cluster: {last})</legend>
            <div
              className="slack-bar"
              role="img"
              aria-label={`${used} de ${clusterSize} bytes usados no último cluster`}
            >
              <span className="slack-used" style={{ width: `${(used / clusterSize) * 100}%` }} />
            </div>
            <dl className="facts props-facts">
              <dt>Usado</dt>
              <dd>
                {formatCount(used)} de {formatCount(clusterSize)} B
              </dd>
              <dt>Desperdiçado</dt>
              <dd>
                {formatCount(slack.value)} B ({slackShare(slack.value, slack.onDisk)} do espaço em disco)
              </dd>
            </dl>
            <p className="muted props-note">
              slack_interno = {chain.length} × {formatCount(clusterSize)} − {formatCount(entry.tamanho)} ={' '}
              {formatCount(slack.value)} B
            </p>
          </fieldset>
        )
      )}
    </div>
  )
}
