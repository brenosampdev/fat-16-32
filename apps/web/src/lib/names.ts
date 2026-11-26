// Default names for new items, and path rewriting after rename or move.

import { MAX_NAME, segments } from '../api'

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

/**
 * A local file name made acceptable to the disk: '/' becomes '_', the stem is
 * cut so the whole name fits in MAX_NAME with its extension, and a clash gets
 * ' (2)', ' (3)'... Only a suggestion: the upload dialog lets the user edit it.
 */
export function fitName(local: string, taken: ReadonlySet<string>): string {
  const clean = local.replaceAll('/', '_') || 'arquivo'
  const dot = clean.lastIndexOf('.')
  // a long tail after the last dot is not an extension worth keeping
  const ext = dot > 0 && clean.length - dot <= 8 ? clean.slice(dot) : ''
  const stem = ext ? clean.slice(0, dot) : clean
  for (let i = 1; ; i++) {
    const suffix = i === 1 ? '' : ` (${i})`
    const name = stem.slice(0, MAX_NAME - ext.length - suffix.length) + suffix + ext
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
