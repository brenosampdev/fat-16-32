// What a format will produce, computed the way FATDisk.format does it in
// fat_simulator.py, so tela 08's Resultado group shows this backend's numbers
// and not a real FAT's (build-frontend.md, "Valores de formatação corretos").

import type { Variante } from '../api'
import { formatCount } from './content'

/** The <select> options: powers of two from 64, so the backend rule cannot be broken. */
export const CLUSTER_SIZES = [64, 128, 256, 512, 1024, 2048] as const

/** DEFAULT_CLUSTERS_FAT16 and DEFAULT_CLUSTERS_FAT32 in fat_simulator.py */
export const DEFAULT_CLUSTERS: Record<Variante, number> = { fat16: 256, fat32: 1024 }

export const DEFAULT_CLUSTER_SIZE = 512

/**
 * The map draws one cell per cluster up to 1024 (telas.md, tela 19); above
 * that it would have to group 4 clusters per cell, which it does not. The
 * backend accepts up to 65524 (FAT16) and 268435444 (FAT32).
 */
export const MAX_CLUSTERS = 1024

/** HEADER_SIZE in fat_simulator.py: the FAT region starts right after it */
const HEADER_SIZE = 512

export type FormatPlan = {
  /** cluster_size × num_clusters: the data area, espaco_total in /disk/info */
  capacity: number
  /** data clusters are numbered from 2 */
  first: number
  last: number
  /** bytes per FAT entry */
  entrySize: 2 | 4
  /** num_clusters + 2: entries 0 and 1 are reserved */
  fatEntries: number
  fatBytes: number
  /** the FAT region on disk, rounded up to a whole number of clusters */
  fatRegion: number
  dataOffset: number
  /** 64 entries in FAT16; null in FAT32, where the root is a chain from cluster 2 */
  rootMax: number | null
}

export function planFormat(variante: Variante, clusterSize: number, numClusters: number): FormatPlan {
  const entrySize = variante === 'fat16' ? 2 : 4
  const fatEntries = numClusters + 2
  const fatBytes = fatEntries * entrySize
  const fatRegion = Math.ceil(fatBytes / clusterSize) * clusterSize
  return {
    capacity: clusterSize * numClusters,
    first: 2,
    last: numClusters + 1,
    entrySize,
    fatEntries,
    fatBytes,
    fatRegion,
    dataOffset: HEADER_SIZE + fatRegion,
    rootMax: variante === 'fat16' ? 64 : null,
  }
}

/**
 * The cluster count as typed. The backend has no minimum and breaks on 0 or
 * less (the root lives in cluster 2), so the client stops it here.
 */
export function parseClusterCount(text: string): { value: number } | { error: string } {
  const t = text.trim()
  if (!/^\d+$/.test(t)) return { error: 'Digite um número inteiro de clusters.' }
  const value = Number(t)
  if (value < 1) return { error: 'O disco precisa de pelo menos 1 cluster: o da raiz.' }
  if (value > MAX_CLUSTERS)
    return { error: `No máximo ${formatCount(MAX_CLUSTERS)} clusters: é o que o mapa mostra, um por célula.` }
  return { value }
}

/** '128 KB', '1,5 MB'; null under 1 KB, where the byte count says it all. */
export function shortSize(bytes: number): string | null {
  if (bytes < 1024) return null
  const [value, unit] = bytes < 1024 * 1024 ? [bytes / 1024, 'KB'] : [bytes / (1024 * 1024), 'MB']
  return `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ${unit}`
}

/** '131.072 bytes (128 KB)' */
export function describeCapacity(bytes: number, unit: 'bytes' | 'B' = 'bytes'): string {
  const short = shortSize(bytes)
  return `${formatCount(bytes)} ${unit}${short ? ` (${short})` : ''}`
}
