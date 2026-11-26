// Drag-to-move rules (spec "Arrastar para mover", "Regras de destino"). No React here.

import { isAncestor } from '../api'

/**
 * Whether the dragged `paths` may be dropped on the folder `target` while
 * `current` is the folder being shown. Refused: nothing dragged, the shown
 * folder itself (the items are already there), and a target that is one of
 * the dragged items or lies inside one of them. Exact comparison: '/Docs'
 * and '/docs' are different folders. Anything else is the backend's call
 * (a name already taken, a full root).
 */
export function canDrop(paths: readonly string[], target: string, current: string): boolean {
  if (paths.length === 0 || target === current) return false
  return !paths.some((p) => isAncestor(p, target))
}

/** What the ghost says: the item's name, or '3 itens'. */
export const dragLabel = (names: readonly string[]): string =>
  names.length === 1 ? names[0] : `${names.length} itens`
