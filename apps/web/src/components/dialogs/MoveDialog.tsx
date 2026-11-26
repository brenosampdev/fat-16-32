import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { api, basename, isAncestor, parentOf } from '../../api'
import type { DiskInfo, FatEntry, LsEntry } from '../../api'
import { keys } from '../../api/queries'
import { chainFromFat } from '../../lib/chain'
import { toDosPath } from '../../lib/display'
import { messageOf } from '../../lib/errors'
import { ChainChips } from '../common/ChainChips'
import { FolderTree } from '../explorer/FolderTree'
import { Modal } from './Modal'

/**
 * Bytes per directory entry in this backend (fat_simulator.py, DIR_ENTRY_SIZE).
 * Not 32 as in a real FAT: a 512 B cluster holds 8 entries, not 16.
 * Only used to predict whether the destination folder grows a cluster.
 */
const DIR_ENTRY_SIZE = 64

type Props = {
  /** what is being moved, all from `source` */
  items: { path: string; entry: LsEntry }[]
  source: string
  fat: readonly FatEntry[] | undefined
  disk: DiskInfo | undefined
  /** moves everything to the target; a rejection is shown inside the dialog */
  onMove: (target: string) => Promise<void>
  onClose: () => void
}

/** First cluster of a folder: the root's from /disk/info, the others from the parent listing. */
function useFolderCluster(path: string, rootCluster: number | undefined) {
  const parent = parentOf(path)
  const query = useQuery({
    queryKey: keys.dir(parent),
    queryFn: () => api.ls(parent),
    enabled: path !== '/',
  })
  if (path === '/') return rootCluster
  return query.data?.entradas.find((e) => e.tipo === 'diretorio' && e.nome === basename(path))
    ?.primeiro_cluster
}

const where = (path: string, cluster: number | undefined) =>
  `${toDosPath(path)} (${path === '/' ? 'raiz, ' : ''}cluster ${cluster ?? '…'})`

/**
 * Tela 16. Nothing is copied: only the directory entry changes folders, and
 * the chain stays the same. The three checks of build-frontend.md run before
 * the request: the target exists (it was picked from the tree), no name clash
 * there, and a folder never goes inside itself.
 */
export function MoveDialog({ items, source, fat, disk, onMove, onClose }: Props) {
  const [target, setTarget] = useState(source)
  const [moving, setMoving] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const listing = useQuery({ queryKey: keys.dir(target), queryFn: () => api.ls(target) })
  const sourceCluster = useFolderCluster(source, disk?.rootCluster)
  const targetCluster = useFolderCluster(target, disk?.rootCluster)

  const single = items.length === 1 ? items[0] : null
  const sameFolder = target === source
  const intoItself = items.find((it) => it.entry.tipo === 'diretorio' && isAncestor(it.path, target))
  // exact comparison: names are case-sensitive in this backend. In the source
  // folder every item would clash with itself, and Mover is off there anyway.
  const clash = sameFolder
    ? undefined
    : listing.data?.entradas.find((e) => items.some((it) => it.entry.nome === e.nome))

  let problem: string | null = null
  if (intoItself) problem = 'Não é possível mover uma pasta para dentro dela mesma.'
  else if (clash) problem = `Já existe "${clash.nome}" em ${toDosPath(target)}.`
  else if (listing.isError) problem = messageOf(listing.error)
  else if (failure) problem = failure

  // A move only writes a directory entry, unless the target's clusters are
  // full: then the folder's chain grows by one cluster (telas.md, tela 16).
  let fatChange = 'nenhuma entrada alterada'
  if (fat && disk && targetCluster !== undefined && listing.data && !sameFolder) {
    const slots = chainFromFat(fat, targetCluster).length * (disk.clusterSize / DIR_ENTRY_SIZE)
    const after = listing.data.entradas.length + items.length
    const rootLimit = target === '/' ? disk.rootMaxEntradas : null
    if (rootLimit !== null && after > rootLimit) {
      fatChange = `a raiz em ${disk.variante} aceita no máximo ${rootLimit} entradas`
    } else if (after > slots) {
      fatChange = 'a pasta de destino está cheia e ganha um cluster novo'
    }
  }

  const canMove = !sameFolder && !problem && !!listing.data && !moving

  const submit = async () => {
    setMoving(true)
    setFailure(null)
    try {
      await onMove(target)
    } catch (e) {
      // the backend detail, as it came
      setFailure(messageOf(e))
      setMoving(false)
    }
  }

  const chain = single && fat ? chainFromFat(fat, single.entry.primeiro_cluster) : []

  return (
    <Modal
      title="Mover itens"
      onClose={onClose}
      className="move-dialog"
      buttons={
        <>
          <button type="button" onClick={submit} disabled={!canMove}>
            Mover
          </button>
          <button type="button" onClick={onClose}>
            Cancelar
          </button>
        </>
      }
    >
      <div className="window-body move-body">
        <p>{single ? `Mover "${single.entry.nome}" para:` : `Mover ${items.length} itens para:`}</p>
        <div className="move-tree">
          <FolderTree
            current={target}
            onNavigate={(p) => {
              setTarget(p)
              setFailure(null)
            }}
            note={(p) => (p === source ? '(pasta atual)' : undefined)}
            ariaLabel="Destino"
          />
        </div>
        <fieldset className="move-effect">
          <legend>O que muda</legend>
          <p className="move-lead">
            {single
              ? 'Nenhum dado é copiado. Só a entrada de diretório muda de lugar.'
              : 'Nenhum dado é copiado. Só as entradas de diretório mudam de lugar.'}
          </p>
          <dl className="facts">
            <dt>{single ? 'Entrada sai de' : 'Entradas saem de'}</dt>
            <dd>{where(source, sourceCluster)}</dd>
            <dt>{single ? 'Entrada vai para' : 'Entradas vão para'}</dt>
            <dd>{sameFolder ? '—' : where(target, targetCluster)}</dd>
            <dt>Bytes copiados</dt>
            <dd>0</dd>
            <dt>FAT[n]</dt>
            <dd>{sameFolder ? '—' : fatChange}</dd>
            <dt>{single ? 'Cadeia' : 'Cadeias'}</dt>
            <dd>
              {!single ? (
                `as ${items.length} cadeias continuam as mesmas`
              ) : chain.length === 0 ? (
                'nenhum cluster (arquivo vazio)'
              ) : (
                <>
                  <ChainChips chain={chain} eof /> <span className="muted">mesma</span>
                </>
              )}
            </dd>
          </dl>
          {problem && (
            <p className="move-problem" role="alert">
              {problem}
            </p>
          )}
        </fieldset>
      </div>
    </Modal>
  )
}
