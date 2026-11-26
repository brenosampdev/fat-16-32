// The computer around the desktop: boot, Bem-vindo, logoff and the ways to
// turn it off (spec, "Sessão"). None of it talks to the API.

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'

import { SHUTTING_MS, SIGNED_IN_KEY, startPhase } from '../../lib/session'
import type { Phase } from '../../lib/session'
import { playSound } from '../../lib/sound'
import { Icon } from '../common/Icon'
import { DeskProvider } from '../desktop/DeskContext'
import { Desktop } from '../shell/Desktop'
import { BootScreen } from './BootScreen'
import { ShutdownDialog } from './ShutdownDialog'
import { WelcomeScreen } from './WelcomeScreen'

export type SessionApi = {
  /** back to Bem-vindo; the windows close */
  logoff(): void
  /** greys the desktop and asks how to turn it off */
  requestShutdown(): void
}

const SessionContext = createContext<SessionApi | null>(null)

export function useSession(): SessionApi {
  const api = useContext(SessionContext)
  if (!api) throw new Error('useSession() outside Session')
  return api
}

// Storage may be off (private mode, blocked site data): then the tab counts
// as not logged on, and the boot runs again on reload.
function readSignedIn(): boolean {
  try {
    return window.sessionStorage.getItem(SIGNED_IN_KEY) === '1'
  } catch {
    return false
  }
}

function writeSignedIn(on: boolean): void {
  try {
    if (on) window.sessionStorage.setItem(SIGNED_IN_KEY, '1')
    else window.sessionStorage.removeItem(SIGNED_IN_KEY)
  } catch {
    // nothing to remember it in: the next reload boots again
  }
}

/**
 * Owns the phase. The desktop (DeskProvider and Desktop) stays mounted in
 * desktop, standby and shutting; logoff, Desligar and Reiniciar unmount it,
 * so the next logon starts fresh with the Explorer in A:\.
 */
export function Session() {
  const [phase, setPhase] = useState<Phase>(() => startPhase(window.location.search, readSignedIn()))
  /** the Desligar o computador dialog is open */
  const [asking, setAsking] = useState(false)

  const api = useMemo<SessionApi>(
    () => ({
      logoff: () => {
        playSound('logoff')
        writeSignedIn(false)
        setPhase('welcome')
      },
      requestShutdown: () => setAsking(true),
    }),
    [],
  )

  useEffect(() => {
    if (phase !== 'shutting') return
    const t = window.setTimeout(() => setPhase('off'), SHUTTING_MS)
    return () => window.clearTimeout(t)
  }, [phase])

  const onDesk = phase === 'desktop' || phase === 'standby' || phase === 'shutting'

  return (
    <SessionContext.Provider value={api}>
      {onDesk && (
        <DeskProvider>
          {/* grey while asked, asleep or shutting down; the colour comes back on Cancelar or on waking */}
          <Desktop fading={asking || phase !== 'desktop'} />
        </DeskProvider>
      )}

      {asking && (
        <ShutdownDialog
          onStandby={() => {
            setAsking(false)
            setPhase('standby')
          }}
          onTurnOff={() => {
            playSound('logoff')
            writeSignedIn(false)
            setAsking(false)
            setPhase('shutting')
          }}
          onRestart={() => {
            writeSignedIn(false)
            setAsking(false)
            setPhase('boot')
          }}
          onCancel={() => setAsking(false)}
        />
      )}

      {phase === 'standby' && <StandbyScreen onWake={() => setPhase('desktop')} />}

      {phase === 'shutting' && (
        // over the grey desktop, which no longer takes clicks
        <div className="session-screen shutting-screen">
          <div className="shutting-box" role="status">
            <Icon name="shutdown" size={32} />
            Desligando…
          </div>
        </div>
      )}

      {phase === 'off' && (
        <div className="session-screen off-screen" onClick={() => setPhase('boot')}>
          <p>Clique para ligar o computador</p>
        </div>
      )}

      {phase === 'boot' && <BootScreen onDone={() => setPhase('welcome')} />}

      {phase === 'welcome' && (
        <WelcomeScreen
          onSignIn={() => {
            playSound('logon')
            writeSignedIn(true)
          }}
          onDone={() => setPhase('desktop')}
        />
      )}
    </SessionContext.Provider>
  )
}

/**
 * Em espera: a black screen over the desktop, which stays as it was. A click
 * or any key wakes it. The click is taken on `click`, not on pointerdown, so
 * nothing under the screen gets the rest of it.
 */
function StandbyScreen({ onWake }: { onWake: () => void }) {
  const wake = useRef(onWake)
  useEffect(() => {
    wake.current = onWake
  })

  useEffect(() => {
    const onKey = () => wake.current()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return <div className="session-screen standby-screen" onClick={onWake} />
}
