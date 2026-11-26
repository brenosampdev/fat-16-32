import { mutePref } from './prefs'

export type SoundName = 'logon' | 'logoff' | 'error' | 'balloon'

type Note = { freq: number; start: number; dur: number; type?: OscillatorType; gain?: number }

const SOUNDS: Record<SoundName, Note[]> = {
  // rising chord
  logon: [
    { freq: 523.25, start: 0, dur: 0.5 },
    { freq: 659.25, start: 0.12, dur: 0.5 },
    { freq: 783.99, start: 0.24, dur: 0.6 },
    { freq: 1046.5, start: 0.36, dur: 0.8 },
  ],
  // falling chord
  logoff: [
    { freq: 1046.5, start: 0, dur: 0.5 },
    { freq: 783.99, start: 0.12, dur: 0.5 },
    { freq: 659.25, start: 0.24, dur: 0.6 },
    { freq: 523.25, start: 0.36, dur: 0.8 },
  ],
  // single ding
  error: [{ freq: 880, start: 0, dur: 0.45, gain: 0.25 }],
  // short pop
  balloon: [{ freq: 1200, start: 0, dur: 0.07, type: 'triangle', gain: 0.2 }],
}

let ctx: AudioContext | null = null

function getContext(): AudioContext | null {
  if (ctx) return ctx
  if (typeof AudioContext === 'undefined') return null
  ctx = new AudioContext()
  return ctx
}

export function playSound(name: SoundName): void {
  try {
    if (mutePref.get()) return
    const ac = getContext()
    if (!ac) return
    if (ac.state === 'suspended') void ac.resume().catch(() => {})
    const t0 = ac.currentTime
    for (const n of SOUNDS[name]) {
      const osc = ac.createOscillator()
      const g = ac.createGain()
      const peak = n.gain ?? 0.15
      const start = t0 + n.start
      osc.type = n.type ?? 'sine'
      osc.frequency.value = n.freq
      g.gain.setValueAtTime(0.0001, start)
      g.gain.exponentialRampToValueAtTime(peak, start + 0.01)
      g.gain.exponentialRampToValueAtTime(0.0001, start + n.dur)
      osc.connect(g).connect(ac.destination)
      osc.start(start)
      osc.stop(start + n.dur + 0.02)
    }
  } catch {
    // audio is optional; never break the UI
  }
}
