import { useEffect, useId, useRef } from 'react'

import { playSound } from '../../lib/sound'
import { Icon } from '../common/Icon'
import { Modal } from './Modal'

type Props = {
  title: string
  /** shown exactly as the API sent it: no rewording, no guessing the cause */
  message: string
  /** what failed, in the window's words, over the numbers (tela 05) */
  lead?: string
  /** label / value pairs, such as Necessário and Livre */
  facts?: readonly (readonly [string, string])[]
  /** a closing line under the numbers */
  note?: string
  onClose: () => void
  /** network failures only: the server may be back (build-frontend.md, "ErrorDialog") */
  onRetry?: () => void
}

/** Error box, with the error ding. Enter (on OK) and Esc close it; focus goes back where it was. */
export function ErrorDialog({ title, message, lead, facts, note, onClose, onRetry }: Props) {
  const messageId = useId()
  const detailed = !!(lead || facts || note)
  // once per box: StrictMode runs a mount effect twice, and the ref survives that
  const dinged = useRef(false)

  useEffect(() => {
    if (dinged.current) return
    dinged.current = true
    playSound('error')
  }, [])
  return (
    <Modal
      title={title}
      role="alertdialog"
      describedBy={messageId}
      onClose={onClose}
      buttons={
        <>
          <button type="button" onClick={onClose}>
            OK
          </button>
          {onRetry && (
            <button
              type="button"
              onClick={() => {
                onClose()
                onRetry()
              }}
            >
              Tentar novamente
            </button>
          )}
        </>
      }
    >
      <div className="window-body dialog-body">
        <Icon name="error" size={32} />
        {detailed ? (
          <div className="dialog-text error-detail" id={messageId}>
            {lead && <p>{lead}</p>}
            {facts && (
              <dl className="facts">
                {facts.map(([label, value]) => (
                  <div key={label} className="facts-row">
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            )}
            {note && <p>{note}</p>}
            {/* the backend's own words stay on screen, under the numbers */}
            <p className="muted">{message}</p>
          </div>
        ) : (
          <p id={messageId}>{message}</p>
        )}
      </div>
    </Modal>
  )
}
