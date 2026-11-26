// Default names for new items, and path rewriting after rename or move.

import { segments } from '../api'

/**
 * 'Nova pasta', then 'Nova pasta (2)', 'Nova pasta (3)'... skipping names in
 * use. Exact comparison: the backend is case-sensitive, so 'nova pasta' does
 * not block 'Nova pasta'.
 */
export function uniqueName(stem: string, ext: string, taken: ReadonlySet<string>): string {
  if (!taken.has(stem + ext)) return stem + ext
  for (let i = 2; ; i++) {
    const name = `${stem} (${i})${ext}`
    if (!taken.has(name)) return name
  }
}

/** '/docs/a' moved to '/backup/docs': '/docs/a/b' -> '/backup/docs/a/b'. Others unchanged. */
export function remapPath(path: string, from: string, to: string): string {
  if (path === from) return to
  return from !== '/' && path.startsWith(`${from}/`) ? to + path.slice(from.length) : path
}

/** '/docs/fotos/a.png' relative to '/docs' -> 'fotos\a.png' (DOS separators, as the mockups). */
export function relativeDos(path: string, base: string): string {
  return segments(path).slice(segments(base).length).join('\\')
}
