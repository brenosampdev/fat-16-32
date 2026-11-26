import { useMemo, useRef, useState } from 'react'

import { base64ToBytes, basename, pareceBinario } from '../../api'
import type { DiskInfo, FatEntry } from '../../api'
import { useChain, useFile } from '../../api/queries'
import { fragments } from '../../lib/chain'
import { formatCount } from '../../lib/content'
import { cls } from '../../lib/display'
import { messageOf } from '../../lib/errors'
import { Icon } from '../common/Icon'
import { Modal } from '../dialogs/Modal'
import { ContentEditor } from './ContentEditor'
import type { ContentMode } from './ContentEditor'
import { HexView } from './HexView'

/** chains up to this length are spelled out in the status bar, as in tela 11a */
const SPELL_OUT = 4

type Props = {
  path: string
  disk: DiskInfo | undefined
  fat: readonly FatEntry[] | undefined
  onClose: () => void
}

/** '1.300 B em 3 clusters: 12 → 13 → 14 → EOF' or '2.600 B em 6 clusters, 2 fragmentos' */
function describeChain(size: number, chain: readonly number[]): string {
  if (chain.length === 0) return `${formatCount(size)} B, nenhum cluster alocado`
  const count = `${formatCount(size)} B em ${chain.length} ${chain.length === 1 ? 'cluster' : 'clusters'}`
  if (chain.length <= SPELL_OUT) return `${count}: ${chain.join(' → ')} → EOF`
  const runs = fragments(chain).length
  return `${count}, ${runs} ${runs === 1 ? 'fragmento' : 'fragmentos'}`
}

/**
 * Telas 11a and 11b. Read-only: the content arrives in Base64 and is decoded
 * here. The three write buttons open telas 12, 13 and 14 on the same file.
 * Text or hexadecimal is a guess (U+FFFD in conteudo_texto means the backend
 * could not decode it as UTF-8), so both stay one click away.
 */
export function FileViewer({ path, disk, fat, onClose }: Props) {
  const file = useFile(path)
  const chain = useChain(path)
  const [view, setView] = useState<'text' | 'hex' | null>(null)
  const [editing, setEditing] = useState<ContentMode | null>(null)
  const firstTab = useRef<HTMLButtonElement>(null)

  const data = file.data
  const binary = !!data && pareceBinario(data.conteudo_texto)
  const shown = view ?? (binary ? 'hex' : 'text')
  const bytes = useMemo(() => (data ? base64ToBytes(data.conteudo_base64) : new Uint8Array()), [data])
  const cadeia = chain.data?.cadeia

  // tela 11b shows no write buttons: the dialogs work on text, and their
  // excerpts of a binary file would be replacement characters
  const canWrite = !!data && !!cadeia && !!disk && !binary

  let body
  if (file.isPending) body = <div className="viewer-notice">Lendo {basename(path)}…</div>
  else if (file.isError) body = <div className="viewer-notice">{messageOf(file.error)}</div>
  else if (shown === 'text')
    body = (
      <textarea
        className="viewer-text"
        readOnly
        value={data!.conteudo_texto}
        aria-label={`Conteúdo de ${basename(path)}`}
        spellCheck={false}
      />
    )
  else body = <HexView bytes={bytes} chain={cadeia ?? []} clusterSize={disk?.clusterSize ?? 512} />

  let chainField = '…'
  if (chain.isError) chainField = messageOf(chain.error)
  else if (data && cadeia) chainField = describeChain(data.tamanho, cadeia)

  const tab = (id: 'text' | 'hex', label: string) => (
    <button
      type="button"
      ref={id === 'text' ? firstTab : undefined}
      className={cls('plano', 'viewer-tab')}
      aria-pressed={shown === id}
      // never disabled: it takes the focus on open, before the content arrives
      onClick={() => setView(id)}
    >
      {label}
    </button>
  )

  const action = (mode: ContentMode, label: string, disabled = false) => (
    <button
      type="button"
      className="plano viewer-action"
      onClick={() => setEditing(mode)}
      disabled={!canWrite || disabled}
    >
      {label}
    </button>
  )

  return (
    <Modal
      title={`${basename(path)} (somente leitura)`}
      onClose={onClose}
      initialFocus={firstTab}
      className="file-viewer"
    >
      <div className="viewer-toolbar" role="toolbar" aria-label="Exibição e escrita">
        {tab('text', 'Texto')}
        {tab('hex', 'Hexadecimal')}
        {!binary && (
          <>
            <span className="toolbar-separator" aria-hidden="true" />
            {action('append', 'Acrescentar…')}
            {/* nothing fits inside an empty file: offset + n > 0 for any n */}
            {action('overwrite', 'Sobrescrever…', data?.tamanho === 0)}
            {action('replace', 'Substituir…')}
          </>
        )}
      </div>

      {binary && shown === 'hex' && (
        <div className="viewer-warning" role="status">
          <Icon name="warning" size={14} />
          <span>
            O conteúdo não é texto: a API devolveu caracteres de substituição (U+FFFD). A exibição
            passou para hexadecimal automaticamente.
          </span>
        </div>
      )}

      <div className="viewer-body">{body}</div>

      <div className="status-bar viewer-status">
        <p className="status-bar-field" title={cadeia && cadeia.length > SPELL_OUT ? cadeia.join(' → ') : undefined}>
          {chainField}
        </p>
        <p className="status-bar-field viewer-status-aux">
          Base64: {data ? formatCount(data.conteudo_base64.length) : '…'} caracteres
        </p>
        {shown === 'text' && <p className="status-bar-field viewer-status-aux">UTF-8</p>}
      </div>

      {editing && data && cadeia && disk && (
        <ContentEditor
          mode={editing}
          path={path}
          file={data}
          chain={cadeia}
          disk={disk}
          fat={fat}
          onClose={() => setEditing(null)}
        />
      )}
    </Modal>
  )
}
