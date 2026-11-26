import { parseZoom } from './zoom'

export type Pref<T> = { get(): T; set(v: T): void; subscribe(fn: () => void): () => void }

function readStorage(key: string): string | null {
  try {
    if (typeof window === 'undefined') return null
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string): void {
  try {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(key, value)
  } catch {
    // private mode or quota: the in-memory value still works
  }
}

/** External store backed by localStorage, with an in-memory fallback. */
export function createPref<T>(key: string, parse: (s: string | null) => T, serialize: (v: T) => string): Pref<T> {
  const listeners = new Set<() => void>()
  let loaded = false
  let value: T

  return {
    get() {
      if (!loaded) {
        value = parse(readStorage(key))
        loaded = true
      }
      return value
    },
    set(v) {
      value = v
      loaded = true
      writeStorage(key, serialize(v))
      listeners.forEach((fn) => fn())
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
  }
}

export const zoomPref: Pref<number> = createPref('fatxp.zoom', parseZoom, String)

export const mutePref: Pref<boolean> = createPref('fatxp.mute', (s) => s === '1', (v) => (v ? '1' : '0'))
