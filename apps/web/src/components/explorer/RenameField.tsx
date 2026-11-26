import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ChangeEvent, KeyboardEvent } from 'react'

import { MAX_NAME } from '../../api'
import { usePref } from '../../hooks/usePref'
import { effectiveZoom } from '../../lib/dom'
import { zoomPref } from '../../lib/prefs'
import { Icon } from '../common/Icon'

type Props = {
  initial: string
  /** message under the field (tela 15b); the field stays open with the text */
  error: string | null
  /** request in flight: the text is frozen, blur does nothing */
  busy: boolean
  onCommit: (name: string) => void
  onCancel: () => void
  /** the user typed: the balloon goes away */
  onEdit: () => void
}

/** Separators are refused as they are typed, not after (telas.md, tela 15a). */
const SEPARATOR = /[\\/]/

/**
 * Inline rename inside the list row (telas.md, telas 15a and 15b).
 * Opens with the part before the extension selected; Enter or blur commits,
 * Esc cancels. maxLength stops the 32nd character before any request.
 */
export function RenameField({ initial, error, busy, onCommit, onCancel, onEdit }: Props) {
  const [value, setValue] = useState(initial)
  const inputRef = useRef<HTMLInputElement>(null)
  /** the text last sent; blurring away from its error cancels instead of resending */
  const sent = useRef<string | null>(null)
  const cancelled = useRef(false)
  const [balloonAt, setBalloonAt] = useState<{ x: number; y: number } | null>(null)
  /** Ctrl+wheel or Ctrl +/− move the field without a scroll */
  const [zoom] = usePref(zoomPref)

  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.focus()
    const dot = initial.lastIndexOf('.')
    input.setSelectionRange(0, dot > 0 ? dot : initial.length)
    // selected once, when the field opens
  }, [])

  // The balloon hangs under the field; fixed, so the list's scroll box cannot
  // clip it. The field's rect is screen px, the balloon's left/top are CSS px
  // inside the window's zoom.
  useLayoutEffect(() => {
    if (!error) return setBalloonAt(null)
    const place = () => {
      const input = inputRef.current
      if (!input) return
      const r = input.getBoundingClientRect()
      const z = effectiveZoom(input)
      setBalloonAt({ x: r.left / z, y: r.bottom / z + 3 })
    }
    place()
    inputRef.current?.focus()
    window.addEventListener('scroll', place, true)
    return () => window.removeEventListener('scroll', place, true)
  }, [error, zoom])

  const flash = () =>
    inputRef.current?.animate(
      [{ backgroundColor: '#ffd8d8' }, { backgroundColor: '#fff' }],
      { duration: 160, iterations: 2 },
    )

  // Typed, pasted or dropped text with a separator is refused before it lands,
  // so the selection the user had stays as it was. React's onBeforeInput is not
  // the native event and misses pastes, hence the listener.
  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    const refuse = (e: InputEvent) => {
      const text = e.data ?? e.dataTransfer?.getData('text/plain') ?? ''
      if (!SEPARATOR.test(text)) return
      e.preventDefault()
      flash()
    }
    input.addEventListener('beforeinput', refuse)
    return () => input.removeEventListener('beforeinput', refuse)
  }, [])

  const commit = () => {
    sent.current = value
    onCommit(value)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // the list and the window must not see arrows, Delete, F2...
    e.stopPropagation()
    if (busy) return
    if (e.key === 'Enter') {
      e.preventDefault()
      commit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancelled.current = true
      onCancel()
    }
  }

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    // last guard, for inputs that skip beforeinput (autofill)
    if (SEPARATOR.test(e.target.value)) return void flash()
    setValue(e.target.value)
    onEdit()
  }

  const onBlur = () => {
    // Chrome blurs an input as it is removed: an Esc must not turn into a commit
    if (busy || cancelled.current) return
    if (error && value === sent.current) onCancel()
    else commit()
  }

  return (
    <span className="rename" onMouseDown={(e) => e.stopPropagation()}>
      <input
        ref={inputRef}
        type="text"
        className={error ? 'rename-input invalid' : 'rename-input'}
        value={value}
        maxLength={MAX_NAME}
        readOnly={busy}
        spellCheck={false}
        aria-label="Novo nome"
        aria-invalid={!!error}
        style={{ width: `${Math.max(value.length + 2, 8)}ch` }}
        onChange={onChange}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        onDoubleClick={(e) => e.stopPropagation()}
      />
      <span className="rename-count">
        {value.length}/{MAX_NAME}
      </span>
      {error && balloonAt && (
        <span className="balloon" role="alert" style={{ left: balloonAt.x, top: balloonAt.y }}>
          <Icon name="error" size={14} />
          {error}
        </span>
      )}
    </span>
  )
}
