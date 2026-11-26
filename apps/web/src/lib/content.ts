// What the client works out before a content write (build-frontend.md,
// "Operações de conteúdo"). Everything here is a local prediction from the
// chain and the FAT already on screen: after the request the truth is what the
// API returns, and the caller refetches it.

import { bytesToBase64 } from '../api'

const encoder = new TextEncoder()

/** UTF-8 bytes, the unit every size, offset and cluster count is measured in. */
export const textToBytes = (text: string): Uint8Array => encoder.encode(text)

export const textToBase64 = (text: string): string => bytesToBase64(encoder.encode(text))

/** pt-BR grouping without the unit: '1.300'. */
export const formatCount = (n: number): string => n.toLocaleString('pt-BR')

export const clustersNeeded = (bytes: number, clusterSize: number): number =>
  Math.ceil(bytes / clusterSize)

/** Where a byte offset lands: 600 in [12, 13, 14] at 512 B is cluster 13, position 88. */
export function locateOffset(offset: number, chain: readonly number[], clusterSize: number) {
  const index = Math.floor(offset / clusterSize)
  return {
    /** null: the offset is past the end of the chain */
    cluster: chain[index] ?? null,
    position: offset % clusterSize,
    index,
  }
}

/** The clusters whose bytes a write over [offset, offset + length) touches. */
export function touchedClusters(
  offset: number,
  length: number,
  chain: readonly number[],
  clusterSize: number,
): number[] {
  if (length <= 0) return []
  const first = Math.floor(offset / clusterSize)
  const last = Math.floor((offset + length - 1) / clusterSize)
  return chain.slice(first, last + 1)
}

/**
 * Same rule as sobrescrever() in the backend, checked while typing.
 * The advice is Acrescentar, as in tela 13 and the backend's own message
 * ("Use escrever() para expandir"); build-frontend.md says Substituir.
 */
export function validateOverwrite(offset: number, length: number, size: number): string | null {
  if (offset < 0) return 'O offset não pode ser negativo.'
  const end = offset + length
  if (end > size) {
    return `${formatCount(offset)} + ${formatCount(length)} = ${formatCount(end)} B passa do tamanho atual (${formatCount(size)} B). Use Acrescentar para crescer o arquivo.`
  }
  return null
}

/** Acrescentar: how many clusters are added and where the chain is joined. */
export function predictAppend(chain: readonly number[], size: number, added: number, clusterSize: number) {
  const needed = clustersNeeded(size + added, clusterSize)
  return {
    newClusters: Math.max(0, needed - chain.length),
    /** FAT[last] goes from EOF to the first new cluster */
    last: chain.at(-1) ?? null,
    newSize: size + added,
  }
}

/** Substituir: what stays, what is freed, what is added. */
export function predictReplace(chain: readonly number[], newSize: number, clusterSize: number) {
  const needed = clustersNeeded(newSize, clusterSize)
  return {
    /** FAT[last kept] becomes EOF */
    kept: chain.slice(0, needed),
    /** FAT[each] becomes 0 */
    freed: chain.slice(needed),
    newClusters: Math.max(0, needed - chain.length),
  }
}

// ---------------------------------------------------------------- FAT rows

/** A row of the 'Cluster | FAT[n] antes | FAT[n] depois' table (telas 12 and 14). */
export type FatRow = {
  cluster: string
  before: string
  after: string
  kind: 'changed' | 'new' | 'freed'
}

const FREE = '0 (livre)'

/**
 * Names for clusters the server has not picked yet. First-fit decides which
 * ones at the moment of the write, so the client knows how many, never which
 * (build-frontend.md: "você sabe quantos, não quais").
 */
export const newClusterLabels = (count: number): string[] =>
  count === 1 ? ['novo'] : Array.from({ length: count }, (_, i) => `${i + 1}º novo`)

/** The chain grows from its last cluster: FAT[last] EOF -> first new, the new ones linked to EOF. */
export function growthRows(chain: readonly number[], newClusters: number): FatRow[] {
  const labels = newClusterLabels(newClusters)
  const rows: FatRow[] = []
  const last = chain.at(-1)
  if (last !== undefined && labels.length > 0) {
    rows.push({ cluster: String(last), before: 'EOF', after: labels[0], kind: 'changed' })
  }
  labels.forEach((label, i) =>
    rows.push({ cluster: label, before: FREE, after: labels[i + 1] ?? 'EOF', kind: 'new' }),
  )
  return rows
}

/** The chain is cut: EOF on the last kept cluster, 0 on every freed one. */
export function shrinkRows(kept: readonly number[], freed: readonly number[]): FatRow[] {
  if (freed.length === 0) return []
  const rows: FatRow[] = []
  const last = kept.at(-1)
  if (last !== undefined) {
    rows.push({ cluster: String(last), before: String(freed[0]), after: 'EOF', kind: 'changed' })
  }
  freed.forEach((c, i) =>
    rows.push({ cluster: String(c), before: String(freed[i + 1] ?? 'EOF'), after: FREE, kind: 'freed' }),
  )
  return rows
}

// ---------------------------------------------------------------- hexdump

export const BYTES_PER_ROW = 16

/** A line of the hexdump: 16 bytes, or a cluster boundary, or the end of the file. */
export type HexLine =
  | { kind: 'bytes'; offset: number }
  | { kind: 'boundary'; text: string; jump: boolean }
  | { kind: 'end'; text: string }

export const hex = (n: number, width: number): string =>
  n.toString(16).toUpperCase().padStart(width, '0')

/**
 * The lines of a hexdump with a marker at every cluster boundary (tela 11b).
 * cluster_size is a power of two of at least 64, so boundaries always fall
 * on a row start.
 */
export function hexLines(size: number, chain: readonly number[], clusterSize: number): HexLine[] {
  const lines: HexLine[] = []
  if (size === 0) {
    lines.push({ kind: 'end', text: 'Arquivo vazio: nenhum cluster alocado.' })
    return lines
  }
  const width = Math.max(4, hex(size, 0).length)
  const name = (i: number) => (chain[i] === undefined ? '?' : String(chain[i]))
  const lastIndex = clustersNeeded(size, clusterSize) - 1

  for (let offset = 0; offset < size; offset += BYTES_PER_ROW) {
    if (offset % clusterSize === 0) {
      const i = offset / clusterSize
      const last = i === lastIndex ? ' (último)' : ''
      if (i === 0) {
        lines.push({ kind: 'boundary', text: `Cluster ${name(0)}${last}`, jump: false })
      } else {
        const jump = chain[i] !== undefined && chain[i] !== chain[i - 1] + 1
        const where = `offset 0x${hex(offset, width)} (${formatCount(offset)})`
        lines.push({
          kind: 'boundary',
          text: `Cluster ${name(i - 1)} → ${name(i)}${last}${jump ? ' · salto na FAT' : ''} · ${where}`,
          jump,
        })
      }
    }
    lines.push({ kind: 'bytes', offset })
  }

  const slack = (lastIndex + 1) * clusterSize - size
  const end = `EOF em 0x${hex(size, width)} (${formatCount(size)} B)`
  lines.push({
    kind: 'end',
    text:
      slack > 0
        ? `${end} · ${formatCount(slack)} B de slack no cluster ${name(lastIndex)}`
        : `${end} · sem slack: o cluster ${name(lastIndex)} está cheio`,
  })
  return lines
}

/** '44 41 44 4F 53 00 01 00  0E 6B …' and 'DADOS....k…', for one row. */
export function hexRow(bytes: Uint8Array, offset: number): { hex: string; ascii: string } {
  const row = bytes.subarray(offset, offset + BYTES_PER_ROW)
  let hexText = ''
  let ascii = ''
  row.forEach((b, i) => {
    hexText += (i === 0 ? '' : i === 8 ? '  ' : ' ') + hex(b, 2)
    ascii += b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.'
  })
  return { hex: hexText, ascii }
}
