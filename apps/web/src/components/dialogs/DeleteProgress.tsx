import { useEffect, useRef } from 'react'

import type { DeletePlan } from '../../lib/deletePlan'
import { relativeDos } from '../../lib/names'
import { cls } from '../../lib/display'
import { Icon } from '../common/Icon'
import { Modal } from './Modal'

type Props = {
  title: string
  plan: DeletePlan
  /** folder being listed: item paths are shown relative to it */
  base: string
  /** index of the call in flight; plan.items.length when finished */
  index: number
  /** sum of clusters_liberados the API returned so far */
  freed: number
  cancelling: boolean
  onCancel: () => void
}

/** Chains longer than this are cut in the 'Liberando agora' line. */
const SHOW_CLUSTERS = 8

/**
 * Tela 10. Every number is real: the total comes from listing before deleting,
 * and the bar advances one block per call. Cancelar stops between two calls,
 * so no chain is left half freed.
 */
export function DeleteProgress({ title, plan, base, index, freed, cancelling, onCancel }: Props) {
  const { items, roots } = plan
  const total = items.length
  const current = items[Math.min(index, total - 1)]
  const listRef = useRef<HTMLUListElement>(null)
  const rootPaths = new Set(roots.map((r) => r.path))

  const label = (path: string) => relativeDos(path, base)
  const now = current.chain.slice(0, SHOW_CLUSTERS).join(' → ')
  const more = current.chain.length > SHOW_CLUSTERS ? ' → …' : ''

  // keep the item being deleted in view
  useEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>('li.current')
    const box = listRef.current
    if (!row || !box) return
    if (row.offsetTop < box.scrollTop || row.offsetTop + row.offsetHeight > box.scrollTop + box.clientHeight) {
      box.scrollTop = row.offsetTop - box.clientHeight / 2
    }
  }, [index])

  return (
    <Modal
      title={title}
      onClose={onCancel}
      className="delete-progress"
      buttons={
        <button type="button" onClick={onCancel} disabled={cancelling}>
          Cancelar
        </button>
      }
    >
      <div className="window-body progress-body">
        <p>
          Excluindo {label(current.path)} (item {Math.min(index + 1, total)} de {total})
        </p>
        <div
          className="xp-blocks"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={index}
        >
          <div className="xp-blocks-fill" style={{ width: `${(index / total) * 100}%` }} />
        </div>
        <dl className="facts">
          <dt>Itens excluídos</dt>
          <dd>
            {index} de {total}
          </dd>
          <dt>Clusters liberados</dt>
          <dd>
            {freed} de {plan.clusters}
          </dd>
          <dt>Liberando agora</dt>
          <dd>{now ? now + more : 'nenhum cluster (item vazio)'}</dd>
        </dl>
        <ul className="progress-list" ref={listRef}>
          {items.map((it, i) => (
            <li
              key={it.path}
              className={cls(i < index && 'done', i === index && 'current')}
            >
              <Icon name={it.tipo === 'diretorio' ? 'folder' : 'file'} />
              <span>
                {label(it.path)}
                {rootPaths.has(it.path) && it.tipo === 'diretorio' && ' (a pasta, por último)'}
              </span>
            </li>
          ))}
        </ul>
        {cancelling && <p className="muted">Cancelando depois do item atual…</p>}
      </div>
    </Modal>
  )
}
