// Fixed data for the static shell (phase 1). Mirrors what mock.ts semear()
// produces, so the static screen and the live one look alike.
// Deleted in phase 2, when the shell starts reading the API.

import type { DiskInfo, FatEntry, LsEntry } from './api'

const at = (iso: string) => Math.floor(Date.parse(iso) / 1000)

export const FIXED_INFO: DiskInfo = {
  variante: 'FAT16',
  clusterSize: 512,
  numClusters: 256,
  clustersLivres: 238,
  clustersUsados: 18,
  espacoTotal: 131072,
  espacoLivre: 121856,
  fatOffset: 512,
  dataOffset: 2048,
  rootCluster: 2,
  rootMaxEntradas: 64,
}

export const FIXED_DOCS: LsEntry[] = [
  { nome: 'fotos', tipo: 'diretorio', tamanho: 0, primeiro_cluster: 4, ctime: at('2026-11-20T08:15:00-03:00'), mtime: at('2026-11-20T08:15:00-03:00') },
  { nome: 'dados.bin', tipo: 'arquivo', tamanho: 2600, primeiro_cluster: 10, ctime: at('2026-11-18T10:02:00-03:00'), mtime: at('2026-11-18T10:02:00-03:00') },
  { nome: 'relatorio.txt', tipo: 'arquivo', tamanho: 1300, primeiro_cluster: 7, ctime: at('2026-11-14T09:12:00-03:00'), mtime: at('2026-11-14T09:12:00-03:00') },
]

const CHAINS: Record<number, string> = {
  2: 'EOF', 3: 'EOF', 4: 'EOF', 5: 'EOF', 6: 'EOF',
  7: '→ 8', 8: '→ 9', 9: 'EOF',
  10: '→ 11', 11: '→ 15',
  12: '→ 13', 13: '→ 14', 14: 'EOF',
  15: '→ 16', 16: '→ 17', 17: '→ 18', 18: 'EOF',
  23: 'defeituoso',
}

export const FIXED_FAT: FatEntry[] = Array.from({ length: 256 }, (_, i) => ({
  cluster: i + 2,
  status: CHAINS[i + 2] ?? 'livre',
}))
