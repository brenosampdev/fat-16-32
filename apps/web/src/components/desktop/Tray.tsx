import { useEffect, useState } from 'react'

import { USANDO_MOCK } from '../../api'
import { usePref } from '../../hooks/usePref'
import { mutePref } from '../../lib/prefs'
import { Icon } from '../common/Icon'

const MOCK_HINT = 'Modo mock: os dados ficam só neste navegador.'

/** A few ms past the minute, so a timer that fires early never shows the old one. */
const MINUTE_SLACK_MS = 50

/** The current time, refreshed when the minute turns, not every second. */
function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const tick = () => setNow(new Date())
    const t = new Date()
    const toNextMinute = 60_000 - (t.getSeconds() * 1000 + t.getMilliseconds()) + MINUTE_SLACK_MS
    let every: number | undefined
    const first = window.setTimeout(() => {
      tick()
      every = window.setInterval(tick, 60_000)
    }, toNextMinute)
    return () => {
      window.clearTimeout(first)
      window.clearInterval(every)
    }
  }, [])

  return now
}

/**
 * The notification area: the speaker, the mock marker and the clock.
 * Its buttons never take the focus, as the taskbar's: it stays in the window.
 */
export function Tray() {
  const [muted, setMuted] = usePref(mutePref)
  const now = useMinuteClock()
  const speakerHint = muted ? 'Som desligado' : 'Som ligado'

  return (
    <div className="tray">
      <button
        type="button"
        className="plano tray-icon"
        title={speakerHint}
        aria-label={speakerHint}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setMuted(!muted)}
      >
        <Icon name={muted ? 'speakerOff' : 'speaker'} />
      </button>
      {USANDO_MOCK && (
        <span className="tray-icon" role="img" title={MOCK_HINT} aria-label={MOCK_HINT}>
          <Icon name="mock" />
        </span>
      )}
      <time
        className="tray-clock"
        dateTime={now.toISOString()}
        title={now.toLocaleDateString('pt-BR', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })}
      >
        {now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
      </time>
    </div>
  )
}
