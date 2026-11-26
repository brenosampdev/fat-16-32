// Helpers de path, nome e formatacao.
// Nada aqui chama rede: sao funcoes puras usadas por componentes e pelo mock.

import type { LsEntry } from './types'

/** Limite do contrato: nomes de ate 31 caracteres, sem '/'. */
export const MAX_NAME = 31

export const joinPath = (dir: string, nome: string): string =>
  dir === '/' ? `/${nome}` : `${dir}/${nome}`

export const parentOf = (path: string): string => {
  const i = path.lastIndexOf('/')
  return i <= 0 ? '/' : path.slice(0, i)
}

export const basename = (path: string): string => {
  const i = path.lastIndexOf('/')
  return i < 0 ? path : path.slice(i + 1)
}

/** Divide '/docs/fotos' em ['docs', 'fotos']. */
export const segments = (path: string): string[] =>
  path.split('/').filter(Boolean)

/** Valida antes de enviar: o usuario ve o erro ao digitar, sem round-trip. */
export const validateName = (nome: string): string | null => {
  if (!nome.trim()) return 'O nome não pode ficar em branco.'
  if (nome.includes('/')) return 'Um nome não pode conter o caractere /.'
  if (nome.length > MAX_NAME) return `O nome deve ter no máximo ${MAX_NAME} caracteres.`
  return null
}

/** '/a' é ancestral de '/a/b/c'. Usado para barrar mover pasta para dentro de si. */
export const isAncestor = (ancestral: string, descendente: string): boolean =>
  descendente === ancestral || descendente.startsWith(ancestral === '/' ? '/' : ancestral + '/')

// ---------------------------------------------------------------------------
// Normalizacao dos campos que o back devolve formatados para humanos.
// Quando o back passar a mandar numero, estes dois helpers somem.
// ---------------------------------------------------------------------------
// Formatacao de exibicao, no estilo do Explorer do XP
// ---------------------------------------------------------------------------

/** O XP arredondava para cima em KB, e so mostrava bytes abaixo de 1 KB. */
export const formatSize = (bytes: number): string => {
  if (bytes === 0) return ''
  if (bytes < 1024) return `${bytes} bytes`
  return `${Math.ceil(bytes / 1024).toLocaleString('pt-BR')} KB`
}

/** ctime/mtime vem em SEGUNDOS unix. Esquecer o * 1000 joga tudo para 1970. */
export const formatDate = (unixSeconds: number): string =>
  new Date(unixSeconds * 1000).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

const TIPOS: Record<string, string> = {
  txt: 'Documento de texto',
  md: 'Documento de texto',
  json: 'Arquivo JSON',
  csv: 'Valores separados por vírgula',
  bin: 'Arquivo binário',
  dat: 'Arquivo de dados',
}

/** O contrato so diz 'arquivo' | 'diretorio'. O tipo legivel sai da extensao. */
export const tipoLegivel = (e: LsEntry): string => {
  if (e.tipo === 'diretorio') return 'Pasta de arquivos'
  const ext = e.nome.includes('.') ? e.nome.split('.').pop()!.toLowerCase() : ''
  return TIPOS[ext] ?? (ext ? `Arquivo ${ext.toUpperCase()}` : 'Arquivo')
}

/** Uma cadeia e fragmentada quando os clusters nao sao consecutivos. */
export const fragmentado = (cadeia: number[]): boolean =>
  cadeia.some((v, i) => i > 0 && v !== cadeia[i - 1] + 1)

// ---------------------------------------------------------------------------
// Base64 <-> bytes, sem dependencia externa
// ---------------------------------------------------------------------------

export const bytesToBase64 = (bytes: Uint8Array): string => {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

export const base64ToBytes = (b64: string): Uint8Array => {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** File -> base64 puro (sem o prefixo 'data:...;base64,'). */
export const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })

/** Heuristica documentada pelo proprio contrato: binario vem com U+FFFD. */
export const pareceBinario = (texto: string): boolean => texto.includes('�')
