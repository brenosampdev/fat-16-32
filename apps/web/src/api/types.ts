// Tipos da API do simulador FAT.
//
// IMPORTANTE: estes tipos descrevem o que o backend DEVOLVE DE VERDADE, medido
// executando api.py — nao o que o contrato em PDF documenta. Divergem em tres
// pontos que quebram codigo. Veja docs/build-frontend.md.

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

export type ApiOk<T> = { ok: true; data: T }

/** O que o contrato prometia. O backend NAO usa este formato. */
export type ApiErrContrato = { ok: false; error: string }

/** O que o FastAPI realmente emite em HTTPException. Este e o caso real. */
export type ApiErrFastAPI = { detail: string }

export type ApiRes<T> = ApiOk<T> | ApiErrContrato | ApiErrFastAPI

// ---------------------------------------------------------------------------
// Disco
// ---------------------------------------------------------------------------

export type Variante = 'fat16' | 'fat32'

export type DiskFormatBody = {
  /** minusculo no request; a resposta devolve MAIUSCULO */
  variante?: Variante
  /** default 512; potencia de 2, minimo 64 */
  cluster_size?: number
  /** default 256 (fat16) / 1024 (fat32) */
  num_clusters?: number
}

/**
 * Resposta crua de /disk/info e /disk/format.
 * Cinco campos vem como string no formato "512 bytes", e root_max_entradas
 * muda de tipo conforme a variante. Nunca use isto direto num componente:
 * passe por normalizarInfo().
 */
export type DiskInfoRaw = {
  variante: string // 'FAT16' | 'FAT32'
  cluster_size: string // '512 bytes'
  num_clusters: number
  clusters_livres: number
  clusters_usados: number
  espaco_total: string // '131072 bytes'
  espaco_livre: string // '130560 bytes'
  fat_offset: string // '512 bytes'
  data_offset: string // '1536 bytes'
  root_cluster: number
  root_max_entradas: number | string // 64  |  '(ilimitado — FAT32)'
}

/** O que os componentes consomem. Tudo numerico, nada ambiguo. */
export type DiskInfo = {
  variante: 'FAT16' | 'FAT32'
  clusterSize: number
  numClusters: number
  clustersLivres: number
  clustersUsados: number
  espacoTotal: number
  espacoLivre: number
  fatOffset: number
  dataOffset: number
  rootCluster: number
  /** null = ilimitado (FAT32) */
  rootMaxEntradas: number | null
}

/** 'livre' | 'EOF' | 'defeituoso' | '→ 5' */
export type FatStatus = string
export type FatEntry = { cluster: number; status: FatStatus }
export type DiskFat = { entradas: FatEntry[] }

export type DiskCheck = { consistente: boolean; erros: string[] }

// ---------------------------------------------------------------------------
// Entradas de diretorio
// ---------------------------------------------------------------------------

export type EntryTipo = 'arquivo' | 'diretorio'

export type LsEntry = {
  nome: string
  tipo: EntryTipo
  tamanho: number
  /** 0 = arquivo vazio, sem alocacao */
  primeiro_cluster: number
  /** unix SECONDS, nao ms */
  ctime: number
  mtime: number
}

export type LsData = { path: string; entradas: LsEntry[] }

// ---------------------------------------------------------------------------
// Operacoes
// ---------------------------------------------------------------------------

export type MkdirData = { path: string; primeiro_cluster: number }
export type CreateData = { path: string; tamanho: number; primeiro_cluster: number }

export type ReadData = {
  path: string
  tamanho: number
  conteudo_base64: string
  /** so para exibicao; binario vem com U+FFFD */
  conteudo_texto: string
}

export type WriteData = { path: string; bytes_escritos: number; tamanho_novo: number }
export type OverwriteData = { path: string; offset: number; bytes_escritos: number }
export type ReplaceData = { path: string; tamanho_novo: number }
export type DeleteData = { path: string; clusters_liberados: number }
export type PathPairData = { path_antigo: string; path_novo: string }

export type ChainData = {
  path: string
  cadeia: number[]
  num_clusters: number
  tamanho_total_clusters: number
  tamanho_arquivo: number
  /** bytes desperdicados no ultimo cluster */
  slack_interno: number
}

// ---------------------------------------------------------------------------
// Superficie
// ---------------------------------------------------------------------------

export interface FatApi {
  /** Devolve o tipo normalizado: a conversao acontece dentro do client. */
  formatDisk(body: DiskFormatBody): Promise<DiskInfo>
  diskInfo(): Promise<DiskInfo>
  diskFat(): Promise<DiskFat>
  diskCheck(): Promise<DiskCheck>

  ls(path: string): Promise<LsData>
  mkdir(path: string): Promise<MkdirData>

  createFile(path: string): Promise<CreateData>
  readFile(path: string): Promise<ReadData>
  write(path: string, conteudo_base64: string): Promise<WriteData>
  overwrite(path: string, offset: number, conteudo_base64: string): Promise<OverwriteData>
  replace(path: string, conteudo_base64: string): Promise<ReplaceData>
  remove(path: string): Promise<DeleteData>

  rename(path: string, novo_nome: string): Promise<PathPairData>
  move(origem: string, destino: string): Promise<PathPairData>

  chain(path: string): Promise<ChainData>
}
