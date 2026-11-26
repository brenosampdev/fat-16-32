import { useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'

import { Icon } from '../common/Icon'

type Props = {
  /** path currently shown, already in display form ('A:\docs') */
  value: string
  /** visited paths in display form, most recent first */
  history: string[]
  /**
   * Called with the raw text on Enter, on "Ir" or on a history pick.
   * Resolve to false to put the previous value back in the field.
   */
  onGo: (typed: string) => boolean | Promise<boolean>
  disabled?: boolean
}

export function AddressBar({ value, history, onGo, disabled }: Props) {
  const [draft, setDraft] = useState(value)
  const [listOpen, setListOpen] = useState(false)
  const comboRef = useRef<HTMLDivElement>(null)

  // navigation from anywhere else (tree, list, history) rewrites the field
  useEffect(() => setDraft(value), [value])

  useEffect(() => {
    if (!listOpen) return
    const onDown = (e: PointerEvent) => {
      if (!comboRef.current?.contains(e.target as Node)) setListOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [listOpen])

  const go = async (typed: string) => {
    setListOpen(false)
    const ok = await onGo(typed)
    if (!ok) setDraft(value)
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    void go(draft)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // window shortcuts (Backspace = up, F5...) must not fire while typing a path
    e.stopPropagation()
    if (e.key === 'Escape') {
      setDraft(value)
      setListOpen(false)
    }
  }

  return (
    <form className="addressbar" onSubmit={submit}>
      <label className="addressbar-label" htmlFor="address-input">
        Endereço
      </label>
      <div className="addressbar-combo" ref={comboRef}>
        <Icon name="folderOpen" />
        <input
          id="address-input"
          type="text"
          value={draft}
          disabled={disabled}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <button
          type="button"
          className="plano addressbar-drop"
          aria-label="Endereços visitados"
          disabled={disabled || history.length === 0}
          onClick={() => setListOpen((o) => !o)}
        />
        {listOpen && (
          <ul className="addressbar-list" role="listbox">
            {history.map((h) => (
              <li key={h} role="option" aria-selected={h === value}>
                <button type="button" className="plano" onClick={() => void go(h)}>
                  <Icon name={h.endsWith(':\\') ? 'drive' : 'folder'} />
                  {h}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <button type="submit" className="plano addressbar-go" disabled={disabled}>
        <Icon name="go" />
        Ir
      </button>
    </form>
  )
}
