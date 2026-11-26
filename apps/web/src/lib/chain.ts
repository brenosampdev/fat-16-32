// Cluster chains read straight from the FAT the window already holds.
//
// GET /file/chain answers one path per request; deleting a folder with 30
// items would cost 30 extra calls just to count clusters. The FAT from
// GET /disk/fat is the same source the backend walks, and it is in the cache.

import { clusterState, nextCluster } from '../api'
import type { FatEntry } from '../api'

/** Follows FAT[first] -> ... -> EOF. 0 (empty file) gives []. Stops on a cycle. */
export function chainFromFat(fat: readonly FatEntry[], first: number): number[] {
  if (!first || fat.length === 0) return []
  const base = fat[0].cluster
  const out: number[] = []
  const seen = new Set<number>()
  let c: number | null = first
  while (c !== null && !seen.has(c)) {
    const e: FatEntry | undefined = fat[c - base]
    if (!e || e.cluster !== c) break
    seen.add(c)
    out.push(c)
    // only '→ N' continues; EOF ends it, and free or bad would be corruption
    if (clusterState(e.status) !== 'usado') break
    c = nextCluster(e.status)
  }
  return out
}

/** [10, 11, 15, 16, 17] -> [[10, 11], [15, 16, 17]]: the fragments of a chain. */
export function fragments(chain: readonly number[]): number[][] {
  const out: number[][] = []
  for (const c of chain) {
    const run = out[out.length - 1]
    if (run && run[run.length - 1] + 1 === c) run.push(c)
    else out.push([c])
  }
  return out
}
