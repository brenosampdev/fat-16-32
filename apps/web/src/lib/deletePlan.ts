// What a deletion will touch, worked out before anything is deleted.
//
// The API has no recursive delete: DELETE on a folder with content answers
// 409 (CLAUDE.md). The client walks the folder in post-order and removes one
// item per call, the folder last. Listing and counting everything first gives
// the confirmation its real numbers and the progress bar a real total
// (build-frontend.md, "Dialogs"; telas.md, tela 10).

import { joinPath } from '../api'
import type { LsData, LsEntry } from '../api'
import { sortEntries } from './sort'

export type PlanItem = {
  path: string
  tipo: LsEntry['tipo']
  /** clusters this one call frees: the item's own chain */
  chain: number[]
}

export type PlanRoot = {
  path: string
  entry: LsEntry
  /** items inside it, at any depth (0 for files and empty folders) */
  inside: number
  /** clusters freed by it and everything inside it */
  clusters: number
}

export type DeletePlan = {
  /** what the user selected */
  roots: PlanRoot[]
  /** every call to make, in order: contents before their folder */
  items: PlanItem[]
  clusters: number
}

const BY_NAME = { column: 'name', asc: true } as const

export async function planDelete(
  roots: { path: string; entry: LsEntry }[],
  list: (path: string) => Promise<LsData>,
  chainOf: (firstCluster: number) => number[],
): Promise<DeletePlan> {
  const items: PlanItem[] = []

  const walk = async (path: string, entry: LsEntry) => {
    if (entry.tipo === 'diretorio') {
      const { entradas } = await list(path)
      for (const child of sortEntries(entradas, BY_NAME)) {
        await walk(joinPath(path, child.nome), child)
      }
    }
    items.push({ path, tipo: entry.tipo, chain: chainOf(entry.primeiro_cluster) })
  }

  const planned: PlanRoot[] = []
  for (const { path, entry } of roots) {
    const start = items.length
    await walk(path, entry)
    const mine = items.slice(start)
    planned.push({
      path,
      entry,
      inside: mine.length - 1,
      clusters: mine.reduce((n, it) => n + it.chain.length, 0),
    })
  }

  return {
    roots: planned,
    items,
    clusters: planned.reduce((n, r) => n + r.clusters, 0),
  }
}
