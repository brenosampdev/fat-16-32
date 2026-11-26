import { useMemo, useState } from 'react'

export type PickMods = { ctrl?: boolean; shift?: boolean }

type State = {
  /** folder the selection belongs to; another folder means nothing is selected */
  dir: string
  paths: ReadonlySet<string>
  /** where Shift+click ranges start (telas.md, tela 02) */
  anchor: string | null
  /** dotted outline: the last item clicked or reached by keyboard */
  focus: string | null
}

const EMPTY: ReadonlySet<string> = new Set()

/**
 * Multi-selection over the folder being listed. Kept as paths, never indices:
 * the list re-sorts and items disappear (build-frontend.md, "Seleção").
 * `ordered` is the list in its current sort, which Shift ranges walk.
 * Paths that vanish from the listing drop out on their own.
 */
export function useSelection(dir: string, ordered: readonly string[]) {
  const [s, setS] = useState<State>({ dir, paths: EMPTY, anchor: null, focus: null })
  const mine = s.dir === dir

  const selected = useMemo(() => {
    if (!mine || s.paths.size === 0) return EMPTY
    return new Set(ordered.filter((p) => s.paths.has(p)))
  }, [mine, s.paths, ordered])

  const focus = mine && s.focus !== null && ordered.includes(s.focus) ? s.focus : null
  const anchor = mine && s.anchor !== null && ordered.includes(s.anchor) ? s.anchor : null

  /** Click semantics: plain replaces, Ctrl toggles, Shift selects anchor..path. */
  const pick = (path: string, mods: PickMods = {}) => {
    if (mods.shift) {
      const from = ordered.indexOf(anchor ?? path)
      const to = ordered.indexOf(path)
      const [a, b] = from < to ? [from, to] : [to, from]
      const range = ordered.slice(a, b + 1)
      const base = mods.ctrl ? [...selected] : []
      setS({ dir, paths: new Set([...base, ...range]), anchor: anchor ?? path, focus: path })
    } else if (mods.ctrl) {
      const next = new Set(selected)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      setS({ dir, paths: next, anchor: path, focus: path })
    } else {
      setS({ dir, paths: new Set([path]), anchor: path, focus: path })
    }
  }

  /** Programmatic selection, possibly in a folder about to be shown (going up). */
  const select = (paths: readonly string[], inDir: string = dir) =>
    setS({ dir: inDir, paths: new Set(paths), anchor: paths[0] ?? null, focus: paths[0] ?? null })

  const all = () => setS({ dir, paths: new Set(ordered), anchor, focus })

  const clear = () => setS({ dir, paths: EMPTY, anchor: null, focus })

  return { selected, focus, pick, select, all, clear }
}
