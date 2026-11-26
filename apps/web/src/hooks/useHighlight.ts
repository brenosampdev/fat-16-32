import type { FatEntry } from '../api'
import { useChains } from '../api/queries'
import { chainFromFat } from '../lib/chain'

/** Something to light on the map: a selected item, or the folder being shown. */
export type Target = {
  path: string
  name: string
  dir: boolean
  /** tamanho from /ls; 0 for folders */
  size: number
  /** primeiro_cluster when known, for the answer before /file/chain arrives */
  first: number | null
}

export type Lit = Target & { chain: number[] }

/**
 * Up to this many items, each chain is GET /file/chain: "uma chamada por
 * seleção" (telas.md, tela 01). Above it, Ctrl+A on a folder would fire one
 * request per file, so the chains are read from the FAT in the cache, the
 * same table the backend walks (lib/chain.ts).
 */
const ASK_API = 2

/**
 * The chains of the selection. primeiro_cluster lights the map at once
 * (build-frontend.md, FileList); /file/chain replaces it when it arrives.
 * The root is not accepted by /file/chain, so its chain is always the FAT's.
 */
export function useHighlight(targets: Target[], fat: readonly FatEntry[] | undefined): Lit[] {
  const results = useChains(targets.length <= ASK_API ? targets.map((t) => t.path) : [])
  return targets.map((t, i) => {
    const data = results[i]?.data
    if (data) return { ...t, chain: data.cadeia }
    return { ...t, chain: fat && t.first ? chainFromFat(fat, t.first) : [] }
  })
}
