import { useEffect, useRef } from 'react'

import { BOOT_MS } from '../../lib/session'
import { Icon } from '../common/Icon'

type Props = {
  /** the boot ran its course, or the user skipped it */
  onDone: () => void
}

/**
 * The boot: a black screen with our own logo (no Microsoft logo) and the XP
 * bar of blue blocks running for about 3 s. Any key or a click skips it.
 * The click is taken on `click`, not on pointerdown, so the Bem-vindo screen
 * that replaces this one never gets the rest of it.
 */
export function BootScreen({ onDone }: Props) {
  const done = useRef(onDone)
  useEffect(() => {
    done.current = onDone
  })

  useEffect(() => {
    const finish = () => done.current()
    const t = window.setTimeout(finish, BOOT_MS)
    window.addEventListener('keydown', finish)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('keydown', finish)
    }
  }, [])

  return (
    <div className="session-screen boot-screen" onClick={onDone}>
      <div className="boot-logo">
        <Icon name="start" size={56} />
        <span className="session-logo-text">
          Simulador <span className="session-logo-accent">FAT</span>
        </span>
      </div>
      <div className="boot-bar" aria-hidden="true">
        <span className="boot-blocks" />
      </div>
    </div>
  )
}
