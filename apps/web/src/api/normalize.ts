// Normalizacao na borda. Nenhum componente ve DiskInfoRaw.
//
// Existe porque o backend devolve cinco campos como string ("512 bytes") e um
// campo que muda de tipo conforme a variante. Se um dia ele passar a mandar
// numero, este arquivo continua funcionando sem alteracao.

import type { DiskInfo, DiskInfoRaw } from './types'

/** '512 bytes' -> 512 ; 512 -> 512 ; qualquer outra coisa -> fallback */
export function numerico(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Number.parseInt(v, 10)
    return Number.isNaN(n) ? fallback : n
  }
  return fallback
}

export function normalizarInfo(raw: DiskInfoRaw): DiskInfo {
  const clusterSize = numerico(raw.cluster_size, 512)
  return {
    variante: raw.variante === 'FAT32' ? 'FAT32' : 'FAT16',
    clusterSize,
    numClusters: raw.num_clusters,
    clustersLivres: raw.clusters_livres,
    clustersUsados: raw.clusters_usados,
    // o fallback usa os campos que SAO confiavelmente numericos
    espacoTotal: numerico(raw.espaco_total, raw.num_clusters * clusterSize),
    espacoLivre: numerico(raw.espaco_livre, raw.clusters_livres * clusterSize),
    fatOffset: numerico(raw.fat_offset),
    dataOffset: numerico(raw.data_offset),
    rootCluster: raw.root_cluster,
    // string = '(ilimitado — FAT32)'
    rootMaxEntradas:
      typeof raw.root_max_entradas === 'number' ? raw.root_max_entradas : null,
  }
}

// ---------------------------------------------------------------------------
// Estados da FAT
// ---------------------------------------------------------------------------

export type ClusterState = 'livre' | 'usado' | 'fim' | 'defeituoso'

export function clusterState(status: string): ClusterState {
  if (status === 'livre') return 'livre'
  if (status === 'EOF') return 'fim'
  if (status === 'defeituoso') return 'defeituoso'
  return 'usado' // '→ N'
}

/** '→ 5' -> 5 ; os demais -> null */
export function nextCluster(status: string): number | null {
  const m = /^→\s*(\d+)$/.exec(status)
  return m ? Number(m[1]) : null
}
