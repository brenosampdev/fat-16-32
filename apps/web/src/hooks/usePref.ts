import { useSyncExternalStore } from 'react'
import type { Pref } from '../lib/prefs'

export function usePref<T>(pref: Pref<T>): [T, (v: T) => void] {
  const value = useSyncExternalStore(pref.subscribe, pref.get)
  return [value, pref.set]
}
