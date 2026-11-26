// Mock do contrato "FAT Simulator".
//
// Implementa um FAT logico em memoria que respeita o contrato byte a byte na
// forma das respostas e nos codigos de erro. Serve para construir a UI inteira
// com o back desligado: quando ele entregar, troque a flag em index.ts.
//
// A alocacao e first-fit, entao apagar um arquivo do meio e subir outro maior
// produz fragmentacao de verdade — que e exatamente o que o ClusterMap mostra.

import { ApiError } from './client'
import { normalizarInfo } from './normalize'
import { base64ToBytes, bytesToBase64, basename, parentOf, segments } from './paths'
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

const LATENCIA_MS = 80
const ROOT_MAX_ENTRADAS = 64
const ROOT_CLUSTER = 2

type Celula = 'livre' | 'EOF' | 'defeituoso' | number

type No = {
  nome: string
  tipo: 'arquivo' | 'diretorio'
  ctime: number
  mtime: number
  dados: Uint8Array
  filhos: Map<string, No> | null
  cadeia: number[]
}

type Disco = {
  variante: 'FAT16' | 'FAT32'
  cluster_size: number
  num_clusters: number
  /** indice = numero do cluster; validos vao de 2 a num_clusters + 1 */
  fat: Map<number, Celula>
  root: No
}

let disco: Disco | null = null

const agora = () => Math.floor(Date.now() / 1000)
const espera = () => new Promise<void>((r) => setTimeout(r, LATENCIA_MS))

const novoDir = (nome: string): No => ({
  nome,
  tipo: 'diretorio',
  ctime: agora(),
  mtime: agora(),
  dados: new Uint8Array(0),
  filhos: new Map(),
  cadeia: [],
})

const novoArquivo = (nome: string): No => ({
  nome,
  tipo: 'arquivo',
  ctime: agora(),
  mtime: agora(),
  dados: new Uint8Array(0),
  filhos: null,
  cadeia: [],
})

// ---------------------------------------------------------------------------
// Disco e FAT
// ---------------------------------------------------------------------------

function exigirDisco(): Disco {
  if (!disco) throw new ApiError(400, 'Nenhum disco aberto. Use POST /disk/format primeiro.')
  return disco
}

function formatar(body: DiskFormatBody): Disco {
  const variante = body.variante ?? 'fat16'
  const cluster_size = body.cluster_size ?? 512
  const num_clusters = body.num_clusters ?? (variante === 'fat32' ? 1024 : 256)

  if (cluster_size < 64 || (cluster_size & (cluster_size - 1)) !== 0) {
    throw new ApiError(400, 'cluster_size deve ser potência de 2 e no mínimo 64.')
  }
  if (num_clusters < 4) {
    throw new ApiError(400, 'num_clusters deve ser pelo menos 4.')
  }

  const fat = new Map<number, Celula>()
  for (let c = ROOT_CLUSTER; c <= num_clusters + 1; c++) fat.set(c, 'livre')
  fat.set(ROOT_CLUSTER, 'EOF') // o root ocupa o primeiro cluster

  const root = novoDir('')
  root.cadeia = [ROOT_CLUSTER]

  disco = {
    variante: variante === 'fat32' ? 'FAT32' : 'FAT16',
    cluster_size,
    num_clusters,
    fat,
    root,
  }
  return disco
}

const clustersLivres = (d: Disco): number[] => {
  const out: number[] = []
  for (const [c, v] of d.fat) if (v === 'livre') out.push(c)
  return out.sort((a, b) => a - b)
}

/** First-fit: aloca n clusters e encadeia. Lanca 400 se nao couber. */
function alocar(d: Disco, n: number): number[] {
  if (n <= 0) return []
  const livres = clustersLivres(d)
  if (livres.length < n) {
    throw new ApiError(400, 'Não há espaço suficiente no disco.')
  }
  const cadeia = livres.slice(0, n)
  cadeia.forEach((c, i) => {
    d.fat.set(c, i === cadeia.length - 1 ? 'EOF' : cadeia[i + 1])
  })
  return cadeia
}

function liberar(d: Disco, cadeia: number[]): number {
  for (const c of cadeia) d.fat.set(c, 'livre')
  return cadeia.length
}

/** Realoca a cadeia de um no para caber `bytes`. Nao preserva dados: quem chama grava depois. */
function redimensionar(d: Disco, no: No, bytes: number): void {
  const precisa = Math.ceil(bytes / d.cluster_size)
  if (precisa === no.cadeia.length) return

  const antiga = no.cadeia
  liberar(d, antiga)
  try {
    no.cadeia = alocar(d, precisa)
  } catch (e) {
    // devolve a alocacao antiga para nao deixar o no inconsistente
    antiga.forEach((c, i) => {
      d.fat.set(c, i === antiga.length - 1 ? 'EOF' : antiga[i + 1])
    })
    no.cadeia = antiga
    throw e
  }
}

// ---------------------------------------------------------------------------
// Resolucao de path
// ---------------------------------------------------------------------------

function resolver(d: Disco, path: string): No | null {
  if (path === '/' || path === '') return d.root
  let atual: No = d.root
  for (const seg of segments(path)) {
    if (!atual.filhos) return null
    const prox = atual.filhos.get(seg)
    if (!prox) return null
    atual = prox
  }
  return atual
}

function exigirNo(d: Disco, path: string): No {
  const no = resolver(d, path)
  if (!no) throw new ApiError(404, `O caminho '${path}' não foi encontrado.`)
  return no
}

function exigirDir(d: Disco, path: string): No {
  const no = exigirNo(d, path)
  if (no.tipo !== 'diretorio') throw new ApiError(400, `'${path}' não é um diretório.`)
  return no
}

function exigirArquivo(d: Disco, path: string): No {
  const no = exigirNo(d, path)
  if (no.tipo !== 'arquivo') throw new ApiError(400, `'${path}' é um diretório, não um arquivo.`)
  return no
}

/** Valida o pai antes de criar algo dentro dele. */
function paiPara(d: Disco, path: string, nome: string): No {
  if (!nome || nome.length > 31) throw new ApiError(400, 'Nome deve ter 1–31 caracteres.')
  const pai = resolver(d, parentOf(path))
  if (!pai) throw new ApiError(404, `O diretório '${parentOf(path)}' não existe.`)
  if (pai.tipo !== 'diretorio') throw new ApiError(400, `'${parentOf(path)}' não é um diretório.`)
  if (pai.filhos!.has(nome)) {
    throw new ApiError(409, `Já existe um item chamado '${nome}' nesse diretório.`)
  }
  if (pai === d.root && pai.filhos!.size >= ROOT_MAX_ENTRADAS) {
    throw new ApiError(400, `O diretório raiz atingiu o limite de ${ROOT_MAX_ENTRADAS} entradas.`)
  }
  return pai
}

const paraEntry = (no: No): LsEntry => ({
  nome: no.nome,
  tipo: no.tipo,
  tamanho: no.tipo === 'arquivo' ? no.dados.length : 0,
  primeiro_cluster: no.cadeia[0] ?? 0,
  ctime: no.ctime,
  mtime: no.mtime,
})

const infoRaw = (d: Disco): DiskInfoRaw => {
  const livres = clustersLivres(d).length
  const total = d.num_clusters * d.cluster_size
  return {
    variante: d.variante,
    cluster_size: `${d.cluster_size} bytes`,
    num_clusters: d.num_clusters,
    clusters_livres: livres,
    clusters_usados: d.num_clusters - livres,
    espaco_total: `${total} bytes`,
    espaco_livre: `${livres * d.cluster_size} bytes`,
    fat_offset: `${d.cluster_size} bytes`,
    data_offset: `${d.cluster_size * 4} bytes`,
    root_cluster: ROOT_CLUSTER,
    root_max_entradas: d.variante === 'FAT32' ? '(ilimitado — FAT32)' : ROOT_MAX_ENTRADAS,
  }
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export const mockApi: FatApi = {
  async formatDisk(body) {
    await espera()
    return normalizarInfo(infoRaw(formatar(body)))
  },

  async diskInfo() {
    await espera()
    return normalizarInfo(infoRaw(exigirDisco()))
  },

  async diskFat() {
    await espera()
    const d = exigirDisco()
    const entradas: DiskFat['entradas'] = []
    for (let c = ROOT_CLUSTER; c <= d.num_clusters + 1; c++) {
      const v = d.fat.get(c)!
      entradas.push({
        cluster: c,
        status: typeof v === 'number' ? `→ ${v}` : v,
      })
    }
    return { entradas }
  },

  async diskCheck() {
    await espera()
    const d = exigirDisco()
    const erros: string[] = []

    // clusters referenciados por algum no
    const donos = new Map<number, string>()
    const visitar = (no: No, path: string) => {
      for (const c of no.cadeia) {
        const anterior = donos.get(c)
        if (anterior) {
          erros.push(`Cluster ${c} compartilhado (cross-linked) por '${anterior}' e '${path}'.`)
        } else {
          donos.set(c, path)
        }
      }
      if (no.filhos) {
        for (const filho of no.filhos.values()) {
          visitar(filho, path === '/' ? `/${filho.nome}` : `${path}/${filho.nome}`)
        }
      }
    }
    visitar(d.root, '/')

    for (const [c, v] of d.fat) {
      if (v !== 'livre' && v !== 'defeituoso' && !donos.has(c)) {
        erros.push(`Cluster ${c} está ocupado na FAT mas não referenciado por nenhum arquivo.`)
      }
    }

    return { consistente: erros.length === 0, erros } satisfies DiskCheck
  },

  async ls(path) {
    await espera()
    const d = exigirDisco()
    const dir = exigirDir(d, path)
    const entradas = [...dir.filhos!.values()]
      .map(paraEntry)
      .sort((a, b) =>
        a.tipo !== b.tipo
          ? a.tipo === 'diretorio'
            ? -1
            : 1
          : a.nome.localeCompare(b.nome, 'pt-BR', { numeric: true }),
      )
    return { path, entradas } satisfies LsData
  },

  async mkdir(path) {
    await espera()
    const d = exigirDisco()
    const nome = basename(path)
    const pai = paiPara(d, path, nome)

    const no = novoDir(nome)
    no.cadeia = alocar(d, 1) // um diretorio sempre ocupa ao menos um cluster
    pai.filhos!.set(nome, no)
    pai.mtime = agora()

    return { path, primeiro_cluster: no.cadeia[0] } satisfies MkdirData
  },

  async createFile(path) {
    await espera()
    const d = exigirDisco()
    const nome = basename(path)
    const pai = paiPara(d, path, nome)

    const no = novoArquivo(nome)
    pai.filhos!.set(nome, no)
    pai.mtime = agora()

    // arquivo vazio nao aloca cluster: primeiro_cluster = 0
    return { path, tamanho: 0, primeiro_cluster: 0 } satisfies CreateData
  },

  async readFile(path) {
    await espera()
    const d = exigirDisco()
    const no = exigirArquivo(d, path)
    return {
      path,
      tamanho: no.dados.length,
      conteudo_base64: bytesToBase64(no.dados),
      conteudo_texto: new TextDecoder('utf-8').decode(no.dados),
    } satisfies ReadData
  },

  async write(path, conteudo_base64) {
    await espera()
    const d = exigirDisco()
    const no = exigirArquivo(d, path)

    const novos = base64ToBytes(conteudo_base64)
    const juntos = new Uint8Array(no.dados.length + novos.length)
    juntos.set(no.dados, 0)
    juntos.set(novos, no.dados.length)

    redimensionar(d, no, juntos.length)
    no.dados = juntos
    no.mtime = agora()

    return {
      path,
      bytes_escritos: novos.length,
      tamanho_novo: juntos.length,
    } satisfies WriteData
  },

  async overwrite(path, offset, conteudo_base64) {
    await espera()
    const d = exigirDisco()
    const no = exigirArquivo(d, path)

    const novos = base64ToBytes(conteudo_base64)
    if (offset < 0 || offset + novos.length > no.dados.length) {
      throw new ApiError(
        400,
        `O intervalo ${offset}..${offset + novos.length} excede o tamanho do arquivo (${no.dados.length} bytes).`,
      )
    }

    no.dados.set(novos, offset)
    no.mtime = agora()

    return { path, offset, bytes_escritos: novos.length } satisfies OverwriteData
  },

  async replace(path, conteudo_base64) {
    await espera()
    const d = exigirDisco()
    const no = exigirArquivo(d, path)

    const novos = base64ToBytes(conteudo_base64)
    redimensionar(d, no, novos.length)
    no.dados = novos
    no.mtime = agora()

    return { path, tamanho_novo: novos.length } satisfies ReplaceData
  },

  async remove(path) {
    await espera()
    const d = exigirDisco()
    if (path === '/') throw new ApiError(400, 'Não é possível remover o diretório raiz.')

    const no = exigirNo(d, path)
    if (no.tipo === 'diretorio' && no.filhos!.size > 0) {
      throw new ApiError(409, `A pasta '${no.nome}' não está vazia.`)
    }

    const liberados = liberar(d, no.cadeia)
    const pai = resolver(d, parentOf(path))!
    pai.filhos!.delete(no.nome)
    pai.mtime = agora()

    return { path, clusters_liberados: liberados } satisfies DeleteData
  },

  async rename(path, novo_nome) {
    await espera()
    const d = exigirDisco()
    if (novo_nome.includes('/')) throw new ApiError(400, 'Um nome não pode conter /.')

    const no = exigirNo(d, path)
    const pai = resolver(d, parentOf(path))!
    const chaveNova = novo_nome

    if (chaveNova !== no.nome && pai.filhos!.has(chaveNova)) {
      throw new ApiError(409, `Já existe um item chamado '${novo_nome}' nesse diretório.`)
    }

    pai.filhos!.delete(no.nome)
    no.nome = novo_nome
    no.mtime = agora()
    pai.filhos!.set(chaveNova, no)

    return {
      path_antigo: path,
      path_novo: parentOf(path) === '/' ? `/${novo_nome}` : `${parentOf(path)}/${novo_nome}`,
    } satisfies PathPairData
  },

  async move(origem, destino) {
    await espera()
    const d = exigirDisco()

    const no = exigirNo(d, origem)
    const destDir = exigirDir(d, destino)

    if (no.tipo === 'diretorio' && (destino === origem || destino.startsWith(origem + '/'))) {
      throw new ApiError(400, 'Não é possível mover uma pasta para dentro dela mesma.')
    }

    const chave = no.nome
    if (destDir.filhos!.has(chave)) {
      throw new ApiError(409, `Já existe um item chamado '${no.nome}' no destino.`)
    }
    if (destDir === d.root && destDir.filhos!.size >= ROOT_MAX_ENTRADAS) {
      throw new ApiError(400, `O diretório raiz atingiu o limite de ${ROOT_MAX_ENTRADAS} entradas.`)
    }

    const paiAntigo = resolver(d, parentOf(origem))!
    paiAntigo.filhos!.delete(chave)
    paiAntigo.mtime = agora()
    destDir.filhos!.set(chave, no)
    destDir.mtime = agora()

    return {
      path_antigo: origem,
      path_novo: destino === '/' ? `/${no.nome}` : `${destino}/${no.nome}`,
    } satisfies PathPairData
  },

  async chain(path) {
    await espera()
    const d = exigirDisco()
    const no = exigirArquivo(d, path)
    const ocupado = no.cadeia.length * d.cluster_size
    return {
      path,
      cadeia: [...no.cadeia],
      num_clusters: no.cadeia.length,
      tamanho_total_clusters: ocupado,
      tamanho_arquivo: no.dados.length,
      slack_interno: Math.max(0, ocupado - no.dados.length),
    } satisfies ChainData
  },
}

// ---------------------------------------------------------------------------
// Utilitarios so do mock (nao existem no back)
// ---------------------------------------------------------------------------

/** Popula o disco para abrir a app com algo na tela durante o desenvolvimento. */
export async function semear(): Promise<void> {
  await mockApi.formatDisk({ variante: 'fat16', cluster_size: 512, num_clusters: 256 })
  await mockApi.mkdir('/docs')
  await mockApi.mkdir('/docs/fotos')
  await mockApi.mkdir('/backup')

  const texto = (s: string) => bytesToBase64(new TextEncoder().encode(s))

  await mockApi.createFile('/leiame.txt')
  await mockApi.write('/leiame.txt', texto('Disco de testes do simulador FAT.\n'))

  await mockApi.createFile('/docs/relatorio.txt')
  await mockApi.write('/docs/relatorio.txt', texto('x'.repeat(1300)))

  // este vai virar o buraco: precisa de alguem DEPOIS dele, senao o espaco
  // liberado fica no fim e a proxima alocacao sai contigua
  await mockApi.createFile('/docs/notas.txt')
  await mockApi.write('/docs/notas.txt', texto('y'.repeat(700)))

  await mockApi.createFile('/backup/copia.txt')
  await mockApi.write('/backup/copia.txt', texto('w'.repeat(1500)))

  // abre o buraco no MEIO e grava um arquivo maior que ele: o first-fit
  // preenche o buraco e continua depois do copia.txt, entao a cadeia sai
  // fragmentada e o ClusterMap ja tem o que mostrar na primeira tela
  await mockApi.remove('/docs/notas.txt')
  await mockApi.createFile('/docs/dados.bin')
  await mockApi.write('/docs/dados.bin', texto('z'.repeat(2600)))

  // um cluster defeituoso, para o mapa ter os quatro estados visiveis
  marcarDefeituoso(clustersLivres(exigirDisco())[4])
}

/** Marca um cluster como defeituoso. Util para demonstrar o CheckDialog. */
export function marcarDefeituoso(cluster: number): void {
  const d = exigirDisco()
  if (d.fat.get(cluster) === 'livre') d.fat.set(cluster, 'defeituoso')
}

/** Cria uma inconsistencia de proposito, para a tela de verificacao ter o que mostrar. */
export function corromper(): void {
  const d = exigirDisco()
  const livre = clustersLivres(d)[0]
  if (livre !== undefined) d.fat.set(livre, 'EOF') // ocupado sem dono
}

export function resetar(): void {
  disco = null
}
