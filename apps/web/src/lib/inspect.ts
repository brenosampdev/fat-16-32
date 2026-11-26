// Pure helpers for phase 5: the FAT[n] table of tela 07, the jumps of a
// chain, the summaries of the status bar and the counts of the map legend.
// No network: every number comes from /file/chain, /disk/fat or /ls.

import { clusterState, nextCluster } from '../api'
import type { ClusterState, FatEntry } from '../api'
import { fragments } from './chain'
import { formatCount } from './content'

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** Counts by FAT state, for the legend of the map. */
export function countStates(fat: readonly FatEntry[]): Record<ClusterState, number> {
  const out: Record<ClusterState, number> = { livre: 0, usado: 0, fim: 0, defeituoso: 0 }
  for (const c of fat) out[clusterState(c.status)]++
  return out
}

// --------------------------------------------------------------- the jumps

/** '12–14', or '12' when the range is one cluster. */
export const range = (from: number, to: number): string => (from === to ? `${from}` : `${from}–${to}`)

/**
 * What lies between a and b when FAT[a] = b and b is not a + 1, read from
 * the FAT: '12–14 em uso', '20 livre', '12–14 em uso e livres'. A chain that
 * goes back ('volta ao 5') has no gap to describe.
 */
export function describeJump(a: number, b: number, fat: readonly FatEntry[]): string {
  if (b < a) return `volta ao ${b}`
  const base = fat[0]?.cluster ?? 2
  const seen = new Set<string>()
  for (let c = a + 1; c < b; c++) {
    const s = fat[c - base] ? clusterState(fat[c - base].status) : 'usado'
    seen.add(s === 'livre' ? 'livre' : s === 'defeituoso' ? 'defeituoso' : 'uso')
  }
  const many = b - a - 1 > 1
  const words: string[] = []
  if (seen.has('uso')) words.push('em uso')
  if (seen.has('livre')) words.push(many ? 'livres' : 'livre')
  if (seen.has('defeituoso')) words.push(many ? 'defeituosos' : 'defeituoso')
  return `${range(a + 1, b - 1)} ${words.join(' e ')}`
}

/** The clusters inside the gap of a forward jump; empty for a backward one. */
export const gapOf = (a: number, b: number): number[] =>
  b > a + 1 ? Array.from({ length: b - a - 1 }, (_, i) => a + 1 + i) : []

// ------------------------------------------------------------ tela 07 rows

export type FatTableRow = {
  /** 1-based position in the chain */
  index: number
  cluster: number
  /** the value written in FAT[cluster], as the table shows it */
  value: string
  /** 1-based fragment, set on the first row of each fragment */
  fragment: number | null
  /** FAT[cluster] points to a cluster that is not the next one */
  jump: { to: number; gap: number[] } | null
  last: boolean
}

/** End-of-chain value the backend writes (fat_simulator.py, F16_EOF / F32_EOF). */
export const eofHex = (variante: 'FAT16' | 'FAT32'): string =>
  variante === 'FAT32' ? '0x0FFFFFFF' : '0xFFFF'

/** Bad-cluster value (F16_BAD / F32_BAD). */
export const badHex = (variante: 'FAT16' | 'FAT32'): string =>
  variante === 'FAT32' ? '0x0FFFFFF7' : '0xFFF7'

/** '→ 11' -> '11'; 'EOF' -> 'EOF (0xFFFF)'; 'livre' -> '0 (livre)'. */
export function fatValue(status: string | undefined, variante: 'FAT16' | 'FAT32'): string {
  if (status === undefined) return '?'
  const next = nextCluster(status)
  if (next !== null) return String(next)
  const s = clusterState(status)
  if (s === 'fim') return `EOF (${eofHex(variante)})`
  if (s === 'livre') return '0 (livre)'
  if (s === 'defeituoso') return `defeituoso (${badHex(variante)})`
  return status
}

/**
 * One row per cluster of the chain, with the value FAT[n] holds right now.
 * The chain comes from /file/chain and the values from /disk/fat: when the
 * two agree, each row's value is the next row's cluster.
 */
export function fatTableRows(
  chain: readonly number[],
  fat: readonly FatEntry[],
  variante: 'FAT16' | 'FAT32',
): FatTableRow[] {
  const base = fat[0]?.cluster ?? 2
  const starts = new Map<number, number>()
  fragments(chain).forEach((run, i) => starts.set(run[0], i + 1))
  return chain.map((cluster, i) => {
    const status = fat[cluster - base]?.status
    const next = status === undefined ? null : nextCluster(status)
    const jump = next !== null && next !== cluster + 1 ? { to: next, gap: gapOf(cluster, next) } : null
    return {
      index: i + 1,
      cluster,
      value: fatValue(status, variante),
      fragment: starts.get(cluster) ?? null,
      jump,
      last: i === chain.length - 1,
    }
  })
}

/** Bytes of the last cluster that hold data: 2.600 B in 512 B clusters -> 40. */
export function usedInLast(size: number, clusters: number, clusterSize: number): number {
  if (clusters === 0) return 0
  return size - (clusters - 1) * clusterSize
}

/** '15,4%': the slack over the space the chain takes on disk. */
export function slackShare(slack: number, onDisk: number): string {
  if (onDisk === 0) return '0%'
  return `${((slack / onDisk) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
}

// --------------------------------------------------------- status summaries

export type Summary = { name: string; dir: boolean; size: number; chain: readonly number[] }

const fragmentCount = (chain: readonly number[]) => fragments(chain).length

/**
 * Tela 01: 'dados.bin: 2.600 B em 6 clusters, 2 fragmentos'. A folder has
 * tamanho 0 in its entry, so it shows its clusters only.
 */
export function describeOne({ name, dir, size, chain }: Summary): string {
  const runs = fragmentCount(chain)
  const frag = runs > 1 ? `, ${runs} fragmentos` : ''
  if (dir) return `${name}: Pasta de arquivos em ${plural(chain.length, 'cluster', 'clusters')}${frag}`
  if (chain.length === 0) return `${name}: ${formatCount(size)} B, nenhum cluster alocado`
  return `${name}: ${formatCount(size)} B em ${plural(chain.length, 'cluster', 'clusters')}${frag}`
}

/** Tela 02: '2 objetos selecionados: 3.900 B em 9 clusters, 1 fragmentado'. */
export function describeMany(items: readonly Summary[]): string {
  const bytes = items.reduce((sum, it) => sum + it.size, 0)
  const clusters = items.reduce((sum, it) => sum + it.chain.length, 0)
  const broken = items.filter((it) => fragmentCount(it.chain) > 1).length
  let text = `${items.length} objetos selecionados: ${formatCount(bytes)} B em ${plural(clusters, 'cluster', 'clusters')}`
  if (broken > 0) text += `, ${broken} ${broken === 1 ? 'fragmentado' : 'fragmentados'}`
  return text
}

// ------------------------------------------------------------ owner names

/**
 * Who occupies each cluster, from walking the folders: one /ls per folder,
 * each entry's chain read from the FAT. The FAT itself records no owner;
 * this is only for the jump notes of tela 07, never for the map tooltip.
 */
export async function mapOwners(
  list: (path: string) => Promise<{ entradas: { nome: string; tipo: string; primeiro_cluster: number }[] }>,
  chainOf: (first: number) => number[],
  rootCluster: number | null,
): Promise<Map<number, string>> {
  const owners = new Map<number, string>()
  if (rootCluster) for (const c of chainOf(rootCluster)) owners.set(c, '/')
  const queue = ['/']
  while (queue.length > 0) {
    const dir = queue.shift()!
    const { entradas } = await list(dir)
    for (const e of entradas) {
      const path = dir === '/' ? `/${e.nome}` : `${dir}/${e.nome}`
      for (const c of chainOf(e.primeiro_cluster)) if (!owners.has(c)) owners.set(c, path)
      if (e.tipo === 'diretorio') queue.push(path)
    }
  }
  return owners
}

/**
 * '(relatorio.txt)', '(DOCS\notas.txt, livre)': who sits in a gap. Free and
 * bad clusters are named by state; a used cluster nobody reaches, 'sem dono'.
 */
export function describeOccupants(
  gap: readonly number[],
  fat: readonly FatEntry[],
  owners: ReadonlyMap<number, string>,
): string {
  const base = fat[0]?.cluster ?? 2
  const names: string[] = []
  const add = (n: string) => !names.includes(n) && names.push(n)
  for (const c of gap) {
    const s = fat[c - base] ? clusterState(fat[c - base].status) : 'usado'
    if (s === 'livre') add('livre')
    else if (s === 'defeituoso') add('defeituoso')
    else {
      const path = owners.get(c)
      add(path === undefined ? 'sem dono' : path === '/' ? 'raiz' : path.slice(1).split('/').join('\\'))
    }
  }
  const shown = names.slice(0, 2).join(', ')
  return names.length > 2 ? `${shown}, …` : shown
}
