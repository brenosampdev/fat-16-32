import { useId } from 'react'

import { Icon } from '../common/Icon'
import { Modal } from './Modal'

type Props = {
  title: string
  /** shown exactly as the API sent it: no rewording, no guessing the cause */
  message: string
  onClose: () => void
  /** network failures only: the server may be back (build-frontend.md, "ErrorDialog") */
  onRetry?: () => void
}

/** Error box. Enter (on OK) and Esc close it; focus goes back where it was. */
export function ErrorDialog({ title, message, onClose, onRetry }: Props) {
  const messageId = useId()
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
        <p id={messageId}>{message}</p>
      </div>
    </Modal>
  )
}
