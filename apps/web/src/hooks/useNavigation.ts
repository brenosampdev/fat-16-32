import { useCallback, useReducer } from 'react'

import { remapPath } from '../lib/names'

// Navigation is UI state, not server state: it never goes into the query cache
// (build-frontend.md, "Estado").

type State = {
  back: string[]
  current: string
  forward: string[]
  /** every folder shown this session, most recent first, for the address dropdown */
  visited: string[]
}

type Action =
  | { type: 'go'; path: string }
  | { type: 'back' }
  | { type: 'forward' }
  | { type: 'remap'; from: string; to: string }

const remember = (visited: string[], path: string) => [path, ...visited.filter((p) => p !== path)]

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case 'go':
      // going to the folder already shown is not a history step
      if (a.path === s.current) return s
      return {
        back: [...s.back, s.current],
        current: a.path,
        forward: [],
        visited: remember(s.visited, a.path),
      }
    case 'back': {
      if (s.back.length === 0) return s
      const target = s.back[s.back.length - 1]
      return {
        back: s.back.slice(0, -1),
        current: target,
        forward: [s.current, ...s.forward],
        visited: remember(s.visited, target),
      }
    }
    case 'forward': {
      if (s.forward.length === 0) return s
      const [target, ...rest] = s.forward
      return {
        back: [...s.back, s.current],
        current: target,
        forward: rest,
        visited: remember(s.visited, target),
      }
    }
    case 'remap': {
      // a renamed or moved folder keeps its place in the history under its new path
      const fix = (p: string) => remapPath(p, a.from, a.to)
      return {
        back: s.back.map(fix),
        current: fix(s.current),
        forward: s.forward.map(fix),
        visited: [...new Set(s.visited.map(fix))],
      }
    }
  }
}

/** Back/forward stacks around the current folder (API path, case preserved). */
export function useNavigation(initial = '/') {
  const [state, dispatch] = useReducer(reducer, {
    back: [],
    current: initial,
    forward: [],
    visited: [initial],
  })

  const navigate = useCallback((path: string) => dispatch({ type: 'go', path }), [])
  const goBack = useCallback(() => dispatch({ type: 'back' }), [])
  const goForward = useCallback(() => dispatch({ type: 'forward' }), [])
  const remap = useCallback(
    (from: string, to: string) => dispatch({ type: 'remap', from, to }),
    [],
  )

  return {
    current: state.current,
    visited: state.visited,
    canGoBack: state.back.length > 0,
    canGoForward: state.forward.length > 0,
    navigate,
    goBack,
    goForward,
    remap,
  }
}
