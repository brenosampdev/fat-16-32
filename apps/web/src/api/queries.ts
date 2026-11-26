// Query keys e invalidacao.
//
// Cinco consumidores observam o mesmo disco: FolderTree, FileList, AddressBar,
// StatusBar e ClusterMap. Sem cache compartilhado, apagar um arquivo na lista
// deixa a arvore e o mapa desatualizados. Toda escrita passa por useInvalidar().

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './index'
import { parentOf } from './paths'

export const keys = {
  info: ['disk', 'info'] as const,
  fat: ['disk', 'fat'] as const,
  check: ['disk', 'check'] as const,
  dir: (path: string) => ['dir', path] as const,
  chain: (path: string) => ['chain', path] as const,
  file: (path: string) => ['file', path] as const,
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

export const useDiskInfo = () =>
  useQuery({ queryKey: keys.info, queryFn: api.diskInfo })

export const useDiskFat = () =>
  useQuery({ queryKey: keys.fat, queryFn: api.diskFat })

export const useDir = (path: string) =>
  useQuery({ queryKey: keys.dir(path), queryFn: () => api.ls(path) })

export const useChain = (path: string | null, enabled = true) =>
  useQuery({
    queryKey: keys.chain(path ?? ''),
    queryFn: () => api.chain(path!),
    enabled: enabled && !!path,
  })

export const useFile = (path: string | null) =>
  useQuery({
    queryKey: keys.file(path ?? ''),
    queryFn: () => api.readFile(path!),
    enabled: !!path,
  })

/** Caro e sob demanda: so roda quando o usuario pede. */
export const useDiskCheck = () =>
  useQuery({
    queryKey: keys.check,
    queryFn: api.diskCheck,
    enabled: false,
    staleTime: Infinity,
  })

// ---------------------------------------------------------------------------
// Invalidacao
// ---------------------------------------------------------------------------

type Escopo = 'espaco' | 'fat'

export function useInvalidar() {
  const qc = useQueryClient()
  return (dirs: string[], escopos: Escopo[] = ['espaco', 'fat']) => {
    for (const d of new Set(dirs)) {
      qc.invalidateQueries({ queryKey: keys.dir(d) })
    }
    if (escopos.includes('espaco')) qc.invalidateQueries({ queryKey: keys.info })
    if (escopos.includes('fat')) qc.invalidateQueries({ queryKey: keys.fat })
  }
}

// ---------------------------------------------------------------------------
// Escrita
// ---------------------------------------------------------------------------

export function useMkdir() {
  const invalidar = useInvalidar()
  return useMutation({
    mutationFn: (path: string) => api.mkdir(path),
    onSuccess: (_, path) => invalidar([parentOf(path)]),
  })
}

export function useCreateFile() {
  const invalidar = useInvalidar()
  return useMutation({
    mutationFn: (path: string) => api.createFile(path),
    // o arquivo nasce sem cluster, mas a pasta pai cresce um cluster quando
    // os slots acabam: FAT e espaco livre mudam
    onSuccess: (_, path) => invalidar([parentOf(path)]),
  })
}

export function useRemove() {
  const invalidar = useInvalidar()
  return useMutation({
    mutationFn: (path: string) => api.remove(path),
    onSuccess: (_, path) => invalidar([parentOf(path)]),
  })
}

export function useRename() {
  const invalidar = useInvalidar()
  return useMutation({
    mutationFn: ({ path, nome }: { path: string; nome: string }) => api.rename(path, nome),
    onSuccess: (_, { path }) => invalidar([parentOf(path)], []),
  })
}

export function useMove() {
  const invalidar = useInvalidar()
  return useMutation({
    mutationFn: ({ origem, destino }: { origem: string; destino: string }) =>
      api.move(origem, destino),
    // os DOIS pais mudam, e o destino pode crescer um cluster (FAT e espaco)
    onSuccess: (_, { origem, destino }) => invalidar([parentOf(origem), destino]),
  })
}

export function useWrite() {
  const invalidar = useInvalidar()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ path, base64 }: { path: string; base64: string }) =>
      api.write(path, base64),
    onSuccess: (_, { path }) => {
      invalidar([parentOf(path)])
      qc.invalidateQueries({ queryKey: keys.chain(path) })
      qc.invalidateQueries({ queryKey: keys.file(path) })
    },
  })
}

export function useReplace() {
  const invalidar = useInvalidar()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ path, base64 }: { path: string; base64: string }) =>
      api.replace(path, base64),
    onSuccess: (_, { path }) => {
      invalidar([parentOf(path)])
      qc.invalidateQueries({ queryKey: keys.chain(path) })
      qc.invalidateQueries({ queryKey: keys.file(path) })
    },
  })
}

/** Nao muda tamanho nem alocacao, mas muda o mtime: conteudo e a pasta pai. */
export function useOverwrite() {
  const invalidar = useInvalidar()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ path, offset, base64 }: { path: string; offset: number; base64: string }) =>
      api.overwrite(path, offset, base64),
    onSuccess: (_, { path }) => {
      invalidar([parentOf(path)], [])
      qc.invalidateQueries({ queryKey: keys.file(path) })
    },
  })
}

export function useFormatDisk() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: api.formatDisk,
    onSuccess: () => qc.clear(),
  })
}
