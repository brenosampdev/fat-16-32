import { useRef, useState } from 'react'

import { MAX_NAME, validateName } from '../../api'
import { clustersNeeded, formatCount } from '../../lib/content'
import { messageOf } from '../../lib/errors'
import { Icon } from '../common/Icon'
import { Modal } from './Modal'

type Props = {
  file: File
  /** why the local name cannot be used as it is */
  reason: string
  /** fitName's suggestion */
  suggestion: string
  /** names already in the folder; exact comparison, the backend is case-sensitive */
  taken: ReadonlySet<string>
  clusterSize: number | undefined
  /** create + write under the given name; a rejection is shown here */
  onUpload: (name: string) => Promise<void>
  onClose: () => void
}

/** Checked on every key, as the rename field does: the request only goes out with a valid name. */
const problemOf = (name: string, taken: ReadonlySet<string>) =>
  validateName(name) ?? (taken.has(name) ? `Já existe "${name}" nesta pasta.` : null)

/**
 * A local file whose name the disk refuses (more than 31 characters, a '/',
 * or one already in the folder) stops here to be renamed before anything is
 * sent (build-frontend.md, "Upload").
 */
export function UploadDialog({ file, reason, suggestion, taken, clusterSize, onUpload, onClose }: Props) {
  const [name, setName] = useState(suggestion)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const problem = problemOf(name, taken)
  const shown = problem ?? failure

  const submit = async () => {
    if (problem || busy) return
    setBusy(true)
    setFailure(null)
    try {
      await onUpload(name)
    } catch (e) {
      // the backend detail, as it came
      setFailure(messageOf(e))
      setBusy(false)
    }
  }

  const size = `${formatCount(file.size)} B`
  const count = clusterSize ? clustersNeeded(file.size, clusterSize) : null

  return (
    <Modal
      title="Enviar arquivo"
      onClose={onClose}
      initialFocus={inputRef}
      className="upload-dialog"
      buttons={
        <>
          <button type="button" onClick={() => void submit()} disabled={!!problem || busy}>
            Enviar
          </button>
          <button type="button" onClick={onClose}>
            Cancelar
          </button>
        </>
      }
    >
      <div className="window-body dialog-body">
        <Icon name="file" size={32} />
        <div className="dialog-text">
          <p className="upload-local">O nome local "{file.name}" não pode ser usado no disco.</p>
          <p>{reason}</p>
          <label htmlFor="upload-name">Nome no disco (até {MAX_NAME} caracteres):</label>
          <input
            id="upload-name"
            ref={inputRef}
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setFailure(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit()
            }}
            disabled={busy}
            spellCheck={false}
          />
          <p className="muted">
            {count === null
              ? size
              : count === 0
                ? `${size}: o arquivo fica vazio, sem clusters`
                : `${size}: ${formatCount(count)} ${count === 1 ? 'cluster será alocado' : 'clusters serão alocados'}`}
          </p>
          {shown && (
            <p className="upload-problem" role="alert">
              {shown}
            </p>
          )}
        </div>
      </div>
    </Modal>
  )
}
