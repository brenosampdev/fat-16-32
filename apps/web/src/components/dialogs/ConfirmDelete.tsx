import { useId, useRef } from 'react'

import type { DeletePlan } from '../../lib/deletePlan'
import { relativeDos } from '../../lib/names'
import { ChainChips } from '../common/ChainChips'
import { Icon } from '../common/Icon'
import { Modal } from './Modal'

type Props = {
  plan: DeletePlan
  /** folder being listed: item lines are shown relative to it */
  base: string
  onConfirm: () => void
  onCancel: () => void
}

/** Beyond this, the per-item lines end in '… e mais N'. */
const MAX_LINES = 8

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

/**
 * Tela 09. Texts differ per case, as in XP; the default button is Não, so an
 * Enter never deletes anything by accident.
 */
export function ConfirmDelete({ plan, base, onConfirm, onCancel }: Props) {
  const noRef = useRef<HTMLButtonElement>(null)
  const textId = useId()
  const { roots, items, clusters } = plan
  const single = roots.length === 1 ? roots[0] : null

  let title: string
  let question: string
  if (single?.entry.tipo === 'arquivo') {
    title = 'Confirmar exclusão de arquivo'
    question = `Excluir "${single.entry.nome}" definitivamente?`
  } else if (single) {
    title = 'Confirmar exclusão de pasta'
    question =
      single.inside === 0
        ? `Excluir a pasta "${single.entry.nome}" definitivamente?`
        : `Excluir "${single.entry.nome}" e ${plural(single.inside, 'seu 1 item', `seus ${single.inside} itens`)}?`
  } else {
    title = 'Confirmar exclusão de vários itens'
    const inside = items.length - roots.length
    question =
      `Excluir ${roots.length} itens?` +
      (inside > 0 ? ` As pastas levam junto ${inside} ${plural(inside, 'item', 'itens')}.` : '')
  }

  const freed =
    clusters === 0
      ? 'Nenhum cluster é liberado: não há dados alocados.'
      : `${clusters} ${plural(clusters, 'cluster voltará a ficar livre', 'clusters voltarão a ficar livres')}:`

  // one item: its chain. Several: one line each, with its own fragments (tela 09)
  const lines = single && single.inside === 0 ? null : items.filter((it) => it.chain.length > 0)

  return (
    <Modal
      title={title}
      role="alertdialog"
      describedBy={textId}
      initialFocus={noRef}
      onClose={onCancel}
      className="confirm-delete"
      buttons={
        <>
          <button type="button" onClick={onConfirm}>
            Sim
          </button>
          <button type="button" ref={noRef} onClick={onCancel}>
            Não
          </button>
        </>
      }
    >
      <div className="window-body dialog-body">
        <Icon name="warning" size={32} />
        <div className="dialog-text" id={textId}>
          <p>{question}</p>
          <p className="muted">{freed}</p>
          {lines === null ? (
            clusters > 0 && <ChainChips chain={items[0].chain} />
          ) : (
            <ul className="chain-lines">
              {lines.slice(0, MAX_LINES).map((it) => (
                <li key={it.path}>
                  <span className="chain-line-name">{relativeDos(it.path, base)}</span>
                  <ChainChips chain={it.chain} />
                </li>
              ))}
              {lines.length > MAX_LINES && (
                <li className="muted">… e mais {lines.length - MAX_LINES}</li>
              )}
            </ul>
          )}
          <p className="muted">
            A FAT marca os clusters como 0 e a entrada de diretório recebe 0xE5. Os dados não são
            apagados.
          </p>
        </div>
      </div>
    </Modal>
  )
}
