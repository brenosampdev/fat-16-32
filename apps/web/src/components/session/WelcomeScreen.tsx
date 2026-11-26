import { useEffect, useRef, useState } from 'react'

import { WELCOME_MS } from '../../lib/session'
import { Icon } from '../common/Icon'

type Props = {
  /** the user tile was clicked: the logon sound and the stored flag, while it is still a click */
  onSignIn: () => void
  /** "Bem-vindo" has been shown: on to the desktop */
  onDone: () => void
}

/**
 * XP's blue Bem-vindo screen: the logo and the hint on the left, one user
 * tile on the right. A click on the tile shows "Bem-vindo" for a moment,
 * then the desktop opens.
 */
export function WelcomeScreen({ onSignIn, onDone }: Props) {
  const [greeting, setGreeting] = useState(false)
  const done = useRef(onDone)
  useEffect(() => {
    done.current = onDone
  })

  useEffect(() => {
    if (!greeting) return
    const t = window.setTimeout(() => done.current(), WELCOME_MS)
    return () => window.clearTimeout(t)
  }, [greeting])

  const pick = () => {
    if (greeting) return
    onSignIn()
    setGreeting(true)
  }

  return (
    <div className="session-screen welcome-screen">
      <div className="welcome-band welcome-top" />
      <div className="welcome-main">
        <div className="welcome-left">
          {greeting ? (
            <p className="welcome-greeting" role="status">
              Bem-vindo
            </p>
          ) : (
            <>
              <div className="welcome-logo">
                <Icon name="start" size={48} />
                <span className="session-logo-text">
                  Simulador <span className="session-logo-accent">FAT</span>
                </span>
              </div>
              <p className="welcome-hint">Para começar, clique no seu nome de usuário</p>
            </>
          )}
        </div>
        <div className="welcome-divider" />
        <div className="welcome-right">
          {!greeting && (
            <button type="button" className="plano user-tile" onClick={pick}>
              <span className="user-tile-picture">
                <Icon name="user" size={48} />
              </span>
              <span className="user-tile-name">Usuário</span>
            </button>
          )}
        </div>
      </div>
      <div className="welcome-band welcome-bottom" />
    </div>
  )
}
