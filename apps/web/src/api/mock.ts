// In-memory mock of the backend (apps/api/fat_simulator.py + apps/api/api.py).
//
// This is a port of the Python simulator, not a free reimplementation: the FAT,
// the 64-byte directory entries and the data clusters follow the same layout
// and the same order of operations. That is what makes allocation (first-fit,
// one cluster at a time, extending from the last cluster of the chain), the
// order of ls (slot order), directory growth, the order of the checks and the
// error messages come out as the backend's. Any difference between the two is a
// bug in this file: compare against the Python code, not against the PDF.
//
// One backend behaviour is deliberately not reproduced: a format that fails
// validation closes the open disk on the server, and every later request
// answers 500 until a restart. Here the old disk stays usable.

import { ApiError } from './client'
import { normalizarInfo } from './normalize'
import { bytesToBase64 } from './paths'
import type {
  ChainData,
  CreateData,
  DeleteData,
  DiskCheck,
  DiskFat,
  DiskFormatBody,
  DiskInfoRaw,
  FatApi,
  LsData,
  LsEntry,
  MkdirData,
  OverwriteData,
  PathPairData,
  ReadData,
  ReplaceData,
  WriteData,
} from './types'

const LATENCY_MS = 80

// constants of fat_simulator.py
const HEADER_SIZE = 512
const ENTRY_SIZE = 64
const MAX_NAME_LEN = 31
const FAT16_ROOT_MAX = 64
const ROOT_CLUSTER = 2
const FAT16_MAX_CL = 65524
const FAT32_MAX_CL = 268435444
const DEFAULT_CLUSTER_SIZE = 512
const DEFAULT_CLUSTERS_FAT16 = 256
const DEFAULT_CLUSTERS_FAT32 = 1024

// first byte of a directory slot
const ST_FREE = 0x00 // end of the entries; the slot can be reused
const ST_DELETED = 0xe5 // deleted; the slot can be reused
const ST_VALID = 0x01
const ATTR_DIR = 0x10
const ATTR_FILE = 0x20

// FAT cells. The backend stores 0x0000 / 0xFFFF / 0xFFF7 (or the FAT32
// equivalents); only the meaning matters here. Negative values also end every
// "while cluster >= 2" walk, as EOF does in the backend.
const FREE = 0
const EOF = -1
const BAD = -2

/** Unpacked directory entry: the dict of Directory.unpack_entry. */
type Entry = {
  status: number
  attr: number
  name: string
  fileSize: number
  firstCluster: number
  ctime: number
  mtime: number
  isDir: boolean
}

/** [cluster holding the slot, slot index inside it, entry] */
type Slot = [number, number, Entry]

type Disk = {
  variant: 16 | 32
  clusterSize: number
  numClusters: number
  dataOffset: number
  /** index = cluster number; 0 and 1 are reserved */
  fat: Int32Array
  /** cluster contents, created on first write; a missing cluster reads as zeros */
  data: Map<number, Uint8Array>
}

let disk: Disk | null = null

const now = () => Math.floor(Date.now() / 1000)
const delay = () => new Promise<void>((r) => setTimeout(r, LATENCY_MS))

const encoder = new TextEncoder()
// fatal: false replaces bad sequences with U+FFFD, like errors='replace';
// ignoreBOM keeps a leading BOM in the text, as Python's 'utf-8' codec does
const decoder = new TextDecoder('utf-8', { ignoreBOM: true })

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** api.py's _http_code: the status comes from words in the message. */
function httpStatus(message: string): number {
  const low = message.toLowerCase()
  if (low.includes('não encontrado') || low.includes('not found')) return 404
  if (low.includes('já existe') || low.includes('não está vazio')) return 409
  return 400
}

/** A FATError of the simulator, as api.py turns it into an HTTP error. */
function fail(message: string): never {
  throw new ApiError(httpStatus(message), message)
}

/** FastAPI answers 422 with a list in `detail`; the HTTP client shows this text. */
const validationError = () => new ApiError(422, 'Erro HTTP 422.')

function requireDisk(): Disk {
  if (!disk) throw new ApiError(400, 'Nenhum disco aberto. Use POST /disk/format primeiro.')
  return disk
}

/**
 * base64.b64decode(s) with validate=False: only ASCII is accepted, characters
 * outside the alphabet are skipped, a complete padding ends the input, and a
 * group left incomplete is an error (port of binascii.a2b_base64).
 */
function decodeBase64(s: string): Uint8Array {
  const invalid = () => new ApiError(400, 'conteudo_base64 inválido: não é Base64 válido.')
  if (/[^\x00-\x7f]/.test(s)) throw invalid()
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const out: number[] = []
  let quad = 0
  let left = 0
  let pads = 0
  for (const ch of s) {
    if (ch === '=') {
      if (quad >= 2 && quad + ++pads >= 4) return Uint8Array.from(out)
      continue
    }
    const v = alphabet.indexOf(ch)
    if (v < 0) continue
    pads = 0
    if (quad === 0) {
      left = v
      quad = 1
    } else if (quad === 1) {
      out.push(((left << 2) | (v >> 4)) & 0xff)
      left = v & 0x0f
      quad = 2
    } else if (quad === 2) {
      out.push(((left << 4) | (v >> 2)) & 0xff)
      left = v & 0x03
      quad = 3
    } else {
      out.push(((left << 6) | v) & 0xff)
      left = 0
      quad = 0
    }
  }
  if (quad !== 0) throw invalid()
  return Uint8Array.from(out)
}

// ---------------------------------------------------------------------------
// FATDisk
// ---------------------------------------------------------------------------

/** First-fit: the lowest free cluster, marked EOF. */
function fatAlloc(d: Disk): number {
  for (let c = 2; c < d.numClusters + 2; c++) {
    if (d.fat[c] === FREE) {
      d.fat[c] = EOF
      return c
    }
  }
  return fail('Disco cheio: não há clusters livres.')
}

function fatExtendChain(d: Disk, last: number): number {
  const c = fatAlloc(d)
  d.fat[last] = c
  return c
}

function fatFreeChain(d: Disk, start: number): void {
  let current = start
  while (current >= 2) {
    const next = d.fat[current]
    d.fat[current] = FREE
    if (next < 2) break
    current = next
  }
}

function fatTraverse(d: Disk, start: number): number[] {
  if (start < 2) return []
  const chain: number[] = []
  const visited = new Set<number>()
  let current = start
  while (current >= 2) {
    if (visited.has(current)) fail(`Ciclo detectado na FAT a partir do cluster ${start}.`)
    visited.add(current)
    chain.push(current)
    current = d.fat[current]
  }
  return chain
}

function fatCountFree(d: Disk): number {
  let free = 0
  for (let c = 2; c < d.numClusters + 2; c++) if (d.fat[c] === FREE) free++
  return free
}

/** A copy, so callers can modify it and write it back (read-modify-write). */
const clusterRead = (d: Disk, c: number): Uint8Array =>
  d.data.get(c)?.slice() ?? new Uint8Array(d.clusterSize)

/** Zero-padded up to cluster_size, as the backend writes it. */
function clusterWrite(d: Disk, c: number, bytes: Uint8Array): void {
  const buf = new Uint8Array(d.clusterSize)
  buf.set(bytes)
  d.data.set(c, buf)
}

const clustersNeeded = (d: Disk, size: number) => (size === 0 ? 0 : Math.ceil(size / d.clusterSize))

function infoRaw(d: Disk): DiskInfoRaw {
  const free = fatCountFree(d)
  return {
    variante: `FAT${d.variant}`,
    cluster_size: `${d.clusterSize} bytes`,
    num_clusters: d.numClusters,
    clusters_livres: free,
    clusters_usados: d.numClusters - free,
    espaco_total: `${d.numClusters * d.clusterSize} bytes`,
    espaco_livre: `${free * d.clusterSize} bytes`,
    fat_offset: `${HEADER_SIZE} bytes`,
    data_offset: `${d.dataOffset} bytes`,
    root_cluster: ROOT_CLUSTER,
    root_max_entradas: d.variant === 16 ? FAT16_ROOT_MAX : '(ilimitado — FAT32)',
  }
}

// ---------------------------------------------------------------------------
// Directory: 64-byte slots in a cluster chain
// ---------------------------------------------------------------------------

const entriesPerCluster = (d: Disk) => Math.floor(d.clusterSize / ENTRY_SIZE)

/**
 * Layout '<BB2s32sIIII12s': status, attr, 2 reserved, name, file_size,
 * first_cluster, ctime, mtime, 12 of padding. The name is cut to 31 BYTES of
 * UTF-8, which can split a character: the backend does the same.
 */
function packEntry(e: Entry): Uint8Array {
  const raw = new Uint8Array(ENTRY_SIZE)
  const view = new DataView(raw.buffer)
  raw[0] = e.status
  raw[1] = e.attr
  raw.set(encoder.encode(e.name).subarray(0, MAX_NAME_LEN), 4)
  view.setUint32(36, e.fileSize, true)
  view.setUint32(40, e.firstCluster, true)
  view.setUint32(44, e.ctime, true)
  view.setUint32(48, e.mtime, true)
  return raw
}

function unpackEntry(raw: Uint8Array): Entry {
  const view = new DataView(raw.buffer, raw.byteOffset, ENTRY_SIZE)
  let end = 36
  while (end > 4 && raw[end - 1] === 0) end--
  return {
    status: raw[0],
    attr: raw[1],
    name: decoder.decode(raw.subarray(4, end)),
    fileSize: view.getUint32(36, true),
    firstCluster: view.getUint32(40, true),
    ctime: view.getUint32(44, true),
    mtime: view.getUint32(48, true),
    isDir: (raw[1] & ATTR_DIR) !== 0,
  }
}

function dirChain(d: Disk, start: number): number[] {
  const chain = fatTraverse(d, start)
  return chain.length ? chain : [start]
}

/** Valid entries in slot order; a FREE slot ends the listing. */
function readAll(d: Disk, start: number, maxE?: number): Slot[] {
  const result: Slot[] = []
  const epc = entriesPerCluster(d)
  let total = 0
  for (const cl of dirChain(d, start)) {
    const data = clusterRead(d, cl)
    for (let i = 0; i < epc; i++) {
      if (maxE !== undefined && total >= maxE) return result
      const e = unpackEntry(data.subarray(i * ENTRY_SIZE, (i + 1) * ENTRY_SIZE))
      if (e.status === ST_FREE) return result
      if (e.status === ST_VALID) result.push([cl, i, e])
      total++
    }
  }
  return result
}

/** Case-sensitive, against the name as stored (possibly cut). */
function dirFind(d: Disk, start: number, name: string, maxE?: number): Slot | null {
  const epc = entriesPerCluster(d)
  let total = 0
  for (const cl of dirChain(d, start)) {
    const data = clusterRead(d, cl)
    for (let i = 0; i < epc; i++) {
      if (maxE !== undefined && total >= maxE) return null
      const e = unpackEntry(data.subarray(i * ENTRY_SIZE, (i + 1) * ENTRY_SIZE))
      if (e.status === ST_FREE) return null
      if (e.status === ST_VALID && e.name === name) return [cl, i, e]
      total++
    }
  }
  return null
}

/**
 * First FREE or DELETED slot. With none left, the FAT16 root (maxE) refuses;
 * any other directory grows by one cluster.
 */
function dirAdd(d: Disk, start: number, entry: Entry, maxE?: number): boolean {
  const chain = dirChain(d, start)
  const epc = entriesPerCluster(d)
  let total = 0
  for (const cl of chain) {
    const data = clusterRead(d, cl)
    for (let i = 0; i < epc; i++) {
      if (maxE !== undefined && total >= maxE) return false
      const off = i * ENTRY_SIZE
      if (data[off] === ST_FREE || data[off] === ST_DELETED) {
        data.set(packEntry(entry), off)
        clusterWrite(d, cl, data)
        return true
      }
      total++
    }
  }
  if (maxE !== undefined && total >= maxE) return false

  const added = fatExtendChain(d, chain[chain.length - 1])
  clusterWrite(d, added, packEntry(entry))
  return true
}

function dirUpdate(d: Disk, cl: number, index: number, entry: Entry): void {
  const data = clusterRead(d, cl)
  data.set(packEntry(entry), index * ENTRY_SIZE)
  clusterWrite(d, cl, data)
}

/** Marks the slot 0xE5; the cluster chain of the directory never shrinks. */
function dirDelete(d: Disk, cl: number, index: number): void {
  const data = clusterRead(d, cl)
  data[index * ENTRY_SIZE] = ST_DELETED
  clusterWrite(d, cl, data)
}

// ---------------------------------------------------------------------------
// FileSystem
// ---------------------------------------------------------------------------

const rootMax = (d: Disk) => (d.variant === 16 ? FAT16_ROOT_MAX : undefined)

/** path.strip('/').split('/') without the empty parts */
const parts = (path: string) => path.split('/').filter(Boolean)

/** path.rstrip('/') */
const stripEnd = (path: string) => path.replace(/\/+$/, '')

function resolveDir(d: Disk, path: string): number {
  let cluster = ROOT_CLUSTER
  let maxE = rootMax(d)
  for (const part of parts(path)) {
    const found = dirFind(d, cluster, part, maxE)
    if (!found) fail(`Diretório não encontrado: '${part}' em '${path}'.`)
    const e = found[2]
    if (!e.isDir) fail(`'${part}' não é um diretório.`)
    cluster = e.firstCluster
    maxE = undefined // only the root has a limit
  }
  return cluster
}

function resolveParent(d: Disk, path: string): [number, string] {
  const ps = parts(stripEnd(path))
  if (!ps.length) fail('Caminho inválido.')
  return [resolveDir(d, '/' + ps.slice(0, -1).join('/')), ps[ps.length - 1]]
}

const parentMax = (d: Disk, path: string) => (parts(stripEnd(path)).length === 1 ? rootMax(d) : undefined)

function validateName(name: string): void {
  // len() in Python counts code points, as the spread does
  if (!name || [...name].length > MAX_NAME_LEN) fail(`Nome deve ter 1–${MAX_NAME_LEN} caracteres.`)
  if (name.includes('/')) fail("Nome não pode conter '/'.")
}

function lsEntries(d: Disk, path: string): Entry[] {
  const cl = resolveDir(d, path)
  const maxE = parts(path).length === 0 ? rootMax(d) : undefined
  return readAll(d, cl, maxE).map(([, , e]) => e)
}

function newEntry(name: string, isDir: boolean, firstCluster: number): Entry {
  const t = now()
  return {
    status: ST_VALID,
    attr: isDir ? ATTR_DIR : ATTR_FILE,
    name,
    fileSize: 0,
    firstCluster,
    ctime: t,
    mtime: t,
    isDir,
  }
}

function fsMkdir(d: Disk, path: string): void {
  const [parentCl, name] = resolveParent(d, path)
  validateName(name)
  const maxE = parentMax(d, path)
  if (dirFind(d, parentCl, name, maxE)) fail(`'${name}' já existe.`)

  // allocated before the parent is known to have room, as in the backend
  const cl = fatAlloc(d)
  clusterWrite(d, cl, new Uint8Array(0))
  if (!dirAdd(d, parentCl, newEntry(name, true, cl), maxE)) {
    d.fat[cl] = FREE
    fail('Diretório pai cheio (limite FAT16).')
  }
}

function fsCreate(d: Disk, path: string): void {
  const [parentCl, name] = resolveParent(d, path)
  validateName(name)
  const maxE = parentMax(d, path)
  if (dirFind(d, parentCl, name, maxE)) fail(`'${name}' já existe.`)
  if (!dirAdd(d, parentCl, newEntry(name, false, 0), maxE)) fail('Diretório pai cheio (limite FAT16).')
}

/** The file's slot, or the backend's errors for a missing file or a directory. */
function findFile(d: Disk, path: string): Slot {
  const [parentCl, name] = resolveParent(d, path)
  const found = dirFind(d, parentCl, name, parentMax(d, path))
  if (!found) fail(`Arquivo não encontrado: '${path}'.`)
  if (found[2].isDir) fail(`'${name}' é um diretório.`)
  return found
}

function fsRead(d: Disk, path: string): Uint8Array {
  const e = findFile(d, path)[2]
  if (e.fileSize === 0 || e.firstCluster === 0) return new Uint8Array(0)
  const chain = fatTraverse(d, e.firstCluster)
  const all = new Uint8Array(chain.length * d.clusterSize)
  chain.forEach((c, i) => all.set(clusterRead(d, c), i * d.clusterSize))
  return all.slice(0, e.fileSize)
}

/** _write_at: checks space first, extends from the last cluster, read-modify-write. */
function writeAt(d: Disk, [clE, idxE, e]: Slot, data: Uint8Array, offset: number): void {
  const cs = d.clusterSize
  const newEnd = offset + data.length
  const curCount = clustersNeeded(d, e.fileSize)
  const needCount = newEnd > 0 ? clustersNeeded(d, newEnd) : 0
  const extra = Math.max(0, needCount - curCount)
  if (extra > fatCountFree(d)) fail(`Espaço insuficiente: precisamos de ${extra} cluster(s) a mais.`)

  let chain = e.firstCluster ? fatTraverse(d, e.firstCluster) : []
  while (chain.length < needCount) {
    if (!chain.length) {
      const c = fatAlloc(d)
      e.firstCluster = c
      chain = [c]
    } else {
      chain.push(fatExtendChain(d, chain[chain.length - 1]))
    }
  }

  let pos = offset
  let written = 0
  while (written < data.length) {
    const cl = chain[Math.floor(pos / cs)]
    const at = pos % cs
    const buf = clusterRead(d, cl)
    const n = Math.min(cs - at, data.length - written)
    buf.set(data.subarray(written, written + n), at)
    clusterWrite(d, cl, buf)
    pos += n
    written += n
  }

  e.fileSize = Math.max(e.fileSize, newEnd)
  e.mtime = now()
  dirUpdate(d, clE, idxE, e)
}

function fsOverwrite(d: Disk, path: string, offset: number, data: Uint8Array): void {
  const slot = findFile(d, path)
  const size = slot[2].fileSize
  if (offset + data.length > size) {
    fail(
      `sobrescrever vai além do arquivo (tamanho=${size}, offset=${offset}, len=${data.length}). ` +
        'Use escrever() para expandir.',
    )
  }
  writeAt(d, slot, data, offset)
}

function fsReplace(d: Disk, path: string, data: Uint8Array): void {
  const [clE, idxE, e] = findFile(d, path)
  const cs = d.clusterSize
  const oldCount = clustersNeeded(d, e.fileSize)
  const newCount = clustersNeeded(d, data.length)
  const extra = Math.max(0, newCount - oldCount)
  if (extra > fatCountFree(d)) fail(`Espaço insuficiente: precisamos de ${extra} cluster(s) a mais.`)

  const oldFirst = e.firstCluster
  const oldChain = oldFirst ? fatTraverse(d, oldFirst) : []

  if (!data.length) {
    if (oldFirst) fatFreeChain(d, oldFirst)
    e.fileSize = 0
    e.firstCluster = 0
    e.mtime = now()
    dirUpdate(d, clE, idxE, e)
    return
  }

  let chain: number[]
  if (newCount < oldCount) {
    // keeps the first clusters and frees the tail
    chain = oldChain.slice(0, newCount)
    d.fat[chain[chain.length - 1]] = EOF
    if (oldChain.length > newCount) fatFreeChain(d, oldChain[newCount])
  } else {
    chain = [...oldChain]
    if (newCount > oldCount) {
      while (chain.length < newCount) {
        if (!chain.length) {
          chain = [fatAlloc(d)]
          e.firstCluster = chain[0]
        } else {
          chain.push(fatExtendChain(d, chain[chain.length - 1]))
        }
      }
    } else if (!chain.length) {
      chain = [fatAlloc(d)]
      e.firstCluster = chain[0]
    }
  }

  let written = 0
  for (const cl of chain) {
    const chunk = data.subarray(written, written + cs)
    clusterWrite(d, cl, chunk)
    written += chunk.length
  }

  e.fileSize = data.length
  e.firstCluster = chain[0]
  e.mtime = now()
  dirUpdate(d, clE, idxE, e)
}

function fsRemove(d: Disk, path: string): void {
  const [parentCl, name] = resolveParent(d, path)
  const found = dirFind(d, parentCl, name, parentMax(d, path))
  if (!found) fail(`'${path}' não encontrado.`)
  const [clE, idxE, e] = found
  if (e.isDir && readAll(d, e.firstCluster).length) fail(`Diretório '${name}' não está vazio.`)
  if (e.firstCluster) fatFreeChain(d, e.firstCluster)
  dirDelete(d, clE, idxE)
}

function fsRename(d: Disk, path: string, newName: string): void {
  validateName(newName)
  const [parentCl, name] = resolveParent(d, path)
  const maxE = parentMax(d, path)
  const found = dirFind(d, parentCl, name, maxE)
  if (!found) fail(`'${path}' não encontrado.`)
  // also when newName is the current name
  if (dirFind(d, parentCl, newName, maxE)) fail(`'${newName}' já existe no mesmo diretório.`)
  const [clE, idxE, e] = found
  e.name = newName
  e.mtime = now()
  dirUpdate(d, clE, idxE, e)
}

/** Whether dstCl is movingCl or below it. */
function checkCycle(d: Disk, movingCl: number, dstCl: number): void {
  const visited = new Set([movingCl])
  const stack = [movingCl]
  while (stack.length) {
    const current = stack.pop()!
    if (current === dstCl) fail('Não é possível mover um diretório para dentro de si mesmo.')
    for (const [, , sub] of readAll(d, current)) {
      if (sub.isDir && !visited.has(sub.firstCluster)) {
        visited.add(sub.firstCluster)
        stack.push(sub.firstCluster)
      }
    }
  }
}

/** Only directory entries move; the moved entry keeps its mtime. */
function fsMove(d: Disk, src: string, dst: string): void {
  const [srcParentCl, srcName] = resolveParent(d, src)
  const found = dirFind(d, srcParentCl, srcName, parentMax(d, src))
  if (!found) fail(`'${src}' não encontrado.`)
  const [srcCl, srcIdx, e] = found

  const dstCl = resolveDir(d, dst)
  const dstMax = parts(dst).length === 0 ? rootMax(d) : undefined
  if (dirFind(d, dstCl, srcName, dstMax)) fail(`'${srcName}' já existe no destino '${dst}'.`)
  if (e.isDir) checkCycle(d, e.firstCluster, dstCl)

  // added to the destination before leaving the source
  if (!dirAdd(d, dstCl, e, dstMax)) fail('Destino cheio (limite FAT16).')
  dirDelete(d, srcCl, srcIdx)
}

/** Works for directories too. */
function fsChain(d: Disk, path: string): number[] {
  const [parentCl, name] = resolveParent(d, path)
  const found = dirFind(d, parentCl, name, parentMax(d, path))
  if (!found) fail(`'${path}' não encontrado.`)
  const first = found[2].firstCluster
  return first ? fatTraverse(d, first) : []
}

function fsCheck(d: Disk): string[] {
  const errors: string[] = []
  const seen = new Map<number, string>()
  const message = (ex: unknown) => (ex instanceof Error ? ex.message : String(ex))

  const register = (c: number, path: string) => {
    if (c < 2 || c >= d.numClusters + 2) errors.push(`${path}: referência a cluster inválido ${c}.`)
    else if (seen.has(c)) errors.push(`Cluster ${c} compartilhado (cross-linked) por '${path}' e '${seen.get(c)}'.`)
    else seen.set(c, path)
  }

  const walk = (cl: number, path: string, isRoot = false) => {
    let chain: number[]
    try {
      chain = fatTraverse(d, cl)
    } catch (ex) {
      errors.push(`${path}: ${message(ex)}`)
      return
    }
    for (const c of chain) register(c, path)

    for (const [, , e] of readAll(d, cl, isRoot ? rootMax(d) : undefined)) {
      const ep = `${stripEnd(path)}/${e.name}`
      if (e.isDir) {
        walk(e.firstCluster, ep)
      } else if (e.firstCluster === 0) {
        if (e.fileSize !== 0) errors.push(`${ep}: first_cluster=0 mas file_size=${e.fileSize}.`)
      } else {
        let fc: number[]
        try {
          fc = fatTraverse(d, e.firstCluster)
        } catch (ex) {
          errors.push(`${ep}: ${message(ex)}`)
          continue
        }
        for (const c of fc) register(c, ep)
        const expected = clustersNeeded(d, e.fileSize)
        if (fc.length !== expected) {
          errors.push(`${ep}: cadeia tem ${fc.length} cluster(s), mas file_size=${e.fileSize} exige ${expected}.`)
        }
      }
    }
  }

  walk(ROOT_CLUSTER, '/', true)

  // orphans: anything not free that no entry reaches, bad clusters included
  for (let c = 2; c < d.numClusters + 2; c++) {
    if (d.fat[c] !== FREE && !seen.has(c)) {
      errors.push(`Cluster ${c} está ocupado na FAT mas não referenciado por nenhum arquivo.`)
    }
  }
  return errors
}

function format(body: DiskFormatBody): Disk {
  const variante = body.variante ?? 'fat16'
  const clusterSize = body.cluster_size ?? DEFAULT_CLUSTER_SIZE
  // Pydantic types cluster_size and num_clusters as int
  if (!Number.isInteger(clusterSize) || (body.num_clusters != null && !Number.isInteger(body.num_clusters))) {
    throw validationError()
  }
  const lower = String(variante).toLowerCase()
  if (lower !== 'fat16' && lower !== 'fat32') throw new ApiError(400, "variante deve ser 'fat16' ou 'fat32'.")
  const variant = lower === 'fat16' ? 16 : 32

  if (clusterSize < 64 || !Number.isInteger(Math.log2(clusterSize))) {
    fail('cluster_size deve ser potência de 2 e ≥ 64.')
  }
  const numClusters = body.num_clusters ?? (variant === 16 ? DEFAULT_CLUSTERS_FAT16 : DEFAULT_CLUSTERS_FAT32)
  if (variant === 16 && numClusters > FAT16_MAX_CL) fail(`FAT16 suporta no máximo ${FAT16_MAX_CL} clusters.`)
  if (variant === 32 && numClusters > FAT32_MAX_CL) fail(`FAT32 suporta no máximo ${FAT32_MAX_CL} clusters.`)

  const fatBytes = (numClusters + 2) * (variant === 16 ? 2 : 4)
  const fatRegion = Math.ceil(fatBytes / clusterSize) * clusterSize
  const fat = new Int32Array(Math.max(numClusters, 0) + 2)
  fat[ROOT_CLUSTER] = EOF // the root: a chain of one cluster

  return {
    variant,
    clusterSize,
    numClusters,
    dataOffset: HEADER_SIZE + fatRegion,
    fat,
    data: new Map(),
  }
}

const toLsEntry = (e: Entry): LsEntry => ({
  nome: e.name,
  tipo: e.isDir ? 'diretorio' : 'arquivo',
  tamanho: e.fileSize,
  primeiro_cluster: e.firstCluster,
  ctime: e.ctime,
  mtime: e.mtime,
})

/** api.py's _parent_path */
function apiParentPath(path: string): string {
  const ps = parts(path)
  return ps.length > 1 ? '/' + ps.slice(0, -1).join('/') : '/'
}

/** path.rstrip('/').split('/')[-1] */
const lastPart = (path: string) => stripEnd(path).split('/').pop() ?? ''

// ---------------------------------------------------------------------------
// Endpoints (api.py), in the same order of checks
// ---------------------------------------------------------------------------

export const mockApi: FatApi = {
  async formatDisk(body) {
    await delay()
    disk = format(body)
    return normalizarInfo(infoRaw(disk))
  },

  async diskInfo() {
    await delay()
    return normalizarInfo(infoRaw(requireDisk()))
  },

  async diskFat() {
    await delay()
    const d = requireDisk()
    const entradas: DiskFat['entradas'] = []
    for (let c = 2; c < d.numClusters + 2; c++) {
      const v = d.fat[c]
      const status = v === FREE ? 'livre' : v === EOF ? 'EOF' : v === BAD ? 'defeituoso' : `→ ${v}`
      entradas.push({ cluster: c, status })
    }
    return { entradas }
  },

  async diskCheck() {
    await delay()
    const erros = fsCheck(requireDisk())
    return { consistente: erros.length === 0, erros } satisfies DiskCheck
  },

  async ls(path) {
    await delay()
    const d = requireDisk()
    return { path, entradas: lsEntries(d, path).map(toLsEntry) } satisfies LsData
  },

  async mkdir(path) {
    await delay()
    const d = requireDisk()
    fsMkdir(d, path)
    // looked up by name: a name cut to 31 bytes is not found, and the answer is 0
    const name = lastPart(path)
    const entry = lsEntries(d, apiParentPath(path)).find((e) => e.name === name)
    return { path, primeiro_cluster: entry ? entry.firstCluster : 0 } satisfies MkdirData
  },

  async createFile(path) {
    await delay()
    fsCreate(requireDisk(), path)
    return { path, tamanho: 0, primeiro_cluster: 0 } satisfies CreateData
  },

  async readFile(path) {
    await delay()
    const data = fsRead(requireDisk(), path)
    return {
      path,
      tamanho: data.length,
      conteudo_base64: bytesToBase64(data),
      conteudo_texto: decoder.decode(data),
    } satisfies ReadData
  },

  async write(path, conteudo_base64) {
    await delay()
    const d = requireDisk()
    const data = decodeBase64(conteudo_base64)
    // escrever() appends: it writes at the current size
    const slot = findFile(d, path)
    writeAt(d, slot, data, slot[2].fileSize)
    return {
      path,
      bytes_escritos: data.length,
      tamanho_novo: fsRead(d, path).length,
    } satisfies WriteData
  },

  async overwrite(path, offset, conteudo_base64) {
    // Pydantic validates the body (offset: int >= 0) before anything else
    if (!Number.isInteger(offset) || offset < 0) throw validationError()
    await delay()
    const d = requireDisk()
    const data = decodeBase64(conteudo_base64)
    fsOverwrite(d, path, offset, data)
    return { path, offset, bytes_escritos: data.length } satisfies OverwriteData
  },

  async replace(path, conteudo_base64) {
    await delay()
    const d = requireDisk()
    const data = decodeBase64(conteudo_base64)
    fsReplace(d, path, data)
    return { path, tamanho_novo: data.length } satisfies ReplaceData
  },

  async remove(path) {
    await delay()
    const d = requireDisk()
    // directories count too; errors here are left for the removal to report
    let chain: number[]
    try {
      chain = fsChain(d, path)
    } catch (ex) {
      if (!(ex instanceof ApiError)) throw ex
      chain = []
    }
    fsRemove(d, path)
    return { path, clusters_liberados: chain.length } satisfies DeleteData
  },

  async rename(path, novo_nome) {
    await delay()
    fsRename(requireDisk(), path, novo_nome)
    return {
      path_antigo: path,
      path_novo: `${stripEnd(apiParentPath(path))}/${novo_nome}`,
    } satisfies PathPairData
  },

  async move(origem, destino) {
    await delay()
    const d = requireDisk()
    const pathNovo = `${stripEnd(destino)}/${lastPart(origem)}`
    fsMove(d, origem, destino)
    return { path_antigo: origem, path_novo: pathNovo } satisfies PathPairData
  },

  async chain(path) {
    await delay()
    const d = requireDisk()
    const cadeia = fsChain(d, path)
    const name = lastPart(path)
    const entry = lsEntries(d, apiParentPath(path)).find((e) => e.name === name)
    const tamanho = entry ? entry.fileSize : 0
    const total = cadeia.length * d.clusterSize
    return {
      path,
      cadeia,
      num_clusters: cadeia.length,
      tamanho_total_clusters: total,
      tamanho_arquivo: tamanho,
      slack_interno: cadeia.length ? total - tamanho : 0,
    } satisfies ChainData
  },
}

// ---------------------------------------------------------------------------
// Mock-only helpers (no backend counterpart)
// ---------------------------------------------------------------------------

/** Fills the disk so the app opens with something on screen during development. */
export async function semear(): Promise<void> {
  await mockApi.formatDisk({ variante: 'fat16', cluster_size: 512, num_clusters: 256 })
  await mockApi.mkdir('/docs')
  await mockApi.mkdir('/docs/fotos')
  await mockApi.mkdir('/backup')

  const text = (s: string) => bytesToBase64(encoder.encode(s))

  await mockApi.createFile('/leiame.txt')
  await mockApi.write('/leiame.txt', text('Disco de testes do simulador FAT.\n'))

  await mockApi.createFile('/docs/relatorio.txt')
  await mockApi.write('/docs/relatorio.txt', text('x'.repeat(1300)))

  // this one becomes the hole: it needs something AFTER it, or the freed
  // space sits at the end and the next allocation comes out contiguous
  await mockApi.createFile('/docs/notas.txt')
  await mockApi.write('/docs/notas.txt', text('y'.repeat(700)))

  await mockApi.createFile('/backup/copia.txt')
  await mockApi.write('/backup/copia.txt', text('w'.repeat(1500)))

  // opens the hole in the MIDDLE and writes a file bigger than it: first-fit
  // fills the hole and carries on after copia.txt, so the chain comes out
  // fragmented. Binary content, so the viewer opens it in hexadecimal.
  await mockApi.remove('/docs/notas.txt')
  await mockApi.createFile('/docs/dados.bin')
  const binary = Uint8Array.from({ length: 2600 }, (_, i) => (i * 31 + 7) & 0xff)
  await mockApi.write('/docs/dados.bin', bytesToBase64(binary))
}

/**
 * Marks a free cluster as bad. The API has no way to do this, so a real disk
 * never shows one; the check reports it as an orphan, as the backend would.
 */
export function marcarDefeituoso(cluster: number): void {
  const d = requireDisk()
  if (d.fat[cluster] === FREE) d.fat[cluster] = BAD
}

/** Creates an inconsistency on purpose: an occupied cluster no entry reaches. */
export function corromper(): void {
  const d = requireDisk()
  for (let c = 2; c < d.numClusters + 2; c++) {
    if (d.fat[c] === FREE) {
      d.fat[c] = EOF
      return
    }
  }
}

export function resetar(): void {
  disk = null
}
