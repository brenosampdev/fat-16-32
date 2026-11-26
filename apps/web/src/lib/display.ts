// Display helpers for the shell. Pure functions, no network.
//
// The API speaks '/docs/fotos'; the UI shows 'A:\docs\fotos', as in the mockups.
// Case is never touched: '/Docs' and '/docs' are different folders.

import { formatDate, segments } from '../api'

export const DRIVE = 'A:'

/** '/' -> 'A:\' ; '/docs/fotos' -> 'A:\docs\fotos' */
export const toDosPath = (apiPath: string): string =>
  `${DRIVE}\\${segments(apiPath).join('\\')}`

/**
 * Parses what the user typed in the address bar into an API path.
 * Accepts 'A:\docs', 'a:/docs', '/docs/', 'docs\fotos'. Both slashes separate
 * segments, so a name containing '\' cannot be reached by typing (it still can
 * through the tree and the list).
 */
export const parseTypedPath = (typed: string): string => {
  const noDrive = typed.trim().replace(/^a:/i, '')
  return '/' + noDrive.split(/[\\/]/).filter(Boolean).join('/')
}

/** Exact bytes with pt-BR grouping, as the mockups show: '1.300 B'. */
export const formatBytes = (n: number): string => `${n.toLocaleString('pt-BR')} B`

/** '20/11/2026 08:15'. formatDate already does the seconds -> ms conversion. */
export const formatDateTime = (unixSeconds: number): string =>
  formatDate(unixSeconds).replace(',', '')

/** Tiny classnames helper. */
export const cls = (...parts: Array<string | false | null | undefined>): string =>
  parts.filter(Boolean).join(' ')
