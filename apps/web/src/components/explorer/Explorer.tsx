// The Explorer window wired to the API: /disk/info, /disk/fat and /ls.
// Phase 2 covers navigation only; operations stay disabled until their phase.

import { useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import { api, clusterState, ehSemDisco, joinPath, parentOf } from '../../api'
import type { FatEntry, LsEntry } from '../../api'
import { keys, useDir, useDiskFat, useDiskInfo } from '../../api/queries'
import { useNavigation } from '../../hooks/useNavigation'
import { useWindowShortcuts } from '../../hooks/useWindowShortcuts'
import { DRIVE, formatBytes, parseTypedPath, toDosPath } from '../../lib/display'
import { nextSort, sortEntries } from '../../lib/sort'
import type { SortState } from '../../lib/sort'
import { ErrorDialog } from '../dialogs/ErrorDialog'
import { ClusterMap } from '../inspector/ClusterMap'
import { AddressBar } from '../shell/AddressBar'
import { ExplorerWindow } from '../shell/ExplorerWindow'
import { MenuBar } from '../shell/MenuBar'
import type { Menu } from '../shell/MenuBar'
import { SplitPane } from '../shell/SplitPane'
import { StatusBar } from '../shell/StatusBar'
import { Toolbar } from '../shell/Toolbar'
import type { ToolbarAction } from '../shell/Toolbar'
import { FileList } from './FileList'
import { FolderTree } from './FolderTree'

/** Selection belongs to one folder; leaving the folder drops it without an effect. */
type Selection = { dir: string; path: string } | null
type Failure = { title: string; message: string }

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** '3 objetos · 3.900 B'; the byte sum only counts files (folders have tamanho 0). */
const describeFolder = (entries: LsEntry[]) => {
  const total = entries.reduce((sum, e) => sum + e.tamanho, 0)
  const count = plural(entries.length, 'objeto', 'objetos')
  return total > 0 ? `${count} · ${formatBytes(total)}` : count
}

/** Counts by FAT state, for the strip under the map. */
const describeFat = (entries: FatEntry[]) => {
  let free = 0
  let bad = 0
  for (const c of entries) {
    const s = clusterState(c.status)
    if (s === 'livre') free++
    else if (s === 'defeituoso') bad++
  }
  const used = entries.length - free - bad
  return `${plural(free, 'livre', 'livres')} · ${used} em uso · ${plural(bad, 'defeituoso', 'defeituosos')}`
}

export function Explorer() {
  const queryClient = useQueryClient()
  const nav = useNavigation('/')
  const { current } = nav

  const info = useDiskInfo()
  const fat = useDiskFat()
  const dir = useDir(current)

  const [sort, setSort] = useState<SortState>({ column: 'name', asc: true })
  const [selection, setSelection] = useState<Selection>(null)
  const [failure, setFailure] = useState<Failure | null>(null)

  // every endpoint answers 400 "Nenhum disco aberto" when there is no disk
  const noDisk = ehSemDisco(info.error) || ehSemDisco(fat.error) || ehSemDisco(dir.error)
  // first read only: a refresh keeps the old FAT on screen meanwhile
  const readingFat = !noDisk && fat.isPending
  // tela 04 locks the toolbar while the FAT is read; tela 17 leaves only
  // Formatar, which arrives in phase 6
  const locked = noDisk || readingFat

  const entries = useMemo(() => sortEntries(dir.data?.entradas ?? [], sort), [dir.data, sort])
  const selectedEntry =
    selection?.dir === current
      ? entries.find((e) => joinPath(current, e.nome) === selection.path)
      : undefined
  const selectedPath = selectedEntry ? joinPath(current, selectedEntry.nome) : null
  const canOpen = !locked && selectedEntry?.tipo === 'diretorio'

  // ------------------------------------------------------------- actions

  const goUp = () => {
    if (current === '/') return
    // XP selects the folder you just came out of
    setSelection({ dir: parentOf(current), path: current })
    nav.navigate(parentOf(current))
  }

  const open = (entry: LsEntry, path: string) => {
    if (entry.tipo === 'diretorio') nav.navigate(path)
    // files open in the viewer, phase 4
  }

  const openSelected = () => {
    if (selectedEntry && selectedPath) open(selectedEntry, selectedPath)
  }

  const refresh = () => {
    // ['dir'] is the prefix of every keys.dir(path): the list and each expanded tree node
    void queryClient.invalidateQueries({ queryKey: ['dir'] })
    void queryClient.invalidateQueries({ queryKey: keys.info })
    void queryClient.invalidateQueries({ queryKey: keys.fat })
  }

  /** Lists the typed folder before going there; an error keeps the old path. */
  const goTyped = async (typed: string): Promise<boolean> => {
    const path = parseTypedPath(typed)
    try {
      await queryClient.fetchQuery({ queryKey: keys.dir(path), queryFn: () => api.ls(path) })
      nav.navigate(path)
      return true
    } catch (e) {
      // detail as the API sent it (404 not found, 400 not a folder, network...)
      setFailure({ title: toDosPath(path), message: messageOf(e) })
      return false
    }
  }

  useWindowShortcuts(
    locked
      ? { refresh }
      : { up: goUp, back: nav.goBack, forward: nav.goForward, refresh },
    !failure,
  )

  // --------------------------------------------------------- menus, toolbar

  // items without onSelect render disabled until their phase lands
  const menus: Menu[] = [
    {
      label: 'Arquivo',
      items: [
        { label: 'Abrir', shortcut: 'Enter', onSelect: canOpen ? openSelected : undefined },
        { separator: true },
        { label: 'Nova pasta' },
        { label: 'Novo arquivo' },
        { separator: true },
        { label: 'Renomear', shortcut: 'F2' },
        { label: 'Mover…' },
        { label: 'Excluir', shortcut: 'Del' },
        { separator: true },
        { label: 'Propriedades', shortcut: 'Alt+Enter' },
      ],
    },
    {
      label: 'Editar',
      items: [
        { label: 'Recortar', shortcut: 'Ctrl+X' },
        { label: 'Copiar', shortcut: 'Ctrl+C' },
        { label: 'Colar', shortcut: 'Ctrl+V' },
        { separator: true },
        { label: 'Selecionar tudo', shortcut: 'Ctrl+A' },
      ],
    },
    {
      label: 'Exibir',
      items: [
        { label: 'Ícones', checked: false },
        { label: 'Detalhes', checked: true },
        { separator: true },
        { label: 'Atualizar', shortcut: 'F5', onSelect: refresh },
      ],
    },
    {
      label: 'Disco',
      items: [
        { label: 'Formatar…' },
        { label: 'Verificar disco' },
        { separator: true },
        { label: 'Inspetor de disco' },
      ],
    },
    { label: 'Ajuda', items: [{ label: 'Sobre o Simulador FAT' }] },
  ]

  const toolbar: ToolbarAction[][] = [
    [
      { label: 'Voltar', icon: 'back', onClick: nav.goBack, disabled: !nav.canGoBack },
      {
        label: 'Avançar',
        icon: 'forward',
        iconOnly: true,
        onClick: nav.goForward,
        disabled: !nav.canGoForward,
      },
      { label: 'Acima', icon: 'up', iconOnly: true, onClick: goUp, disabled: current === '/' },
    ],
    [
      { label: 'Abrir', onClick: openSelected, disabled: !canOpen },
      { label: 'Nova pasta' },
      { label: 'Novo arquivo' },
    ],
    [{ label: 'Renomear' }, { label: 'Mover…' }, { label: 'Excluir' }, { label: 'Propriedades' }],
    [{ label: 'Formatar…' }, { label: 'Verificar disco' }],
  ]

  // ---------------------------------------------------------------- texts

  let notice: ReactNode
  if (noDisk) {
    notice = (
      <>
        <strong className="notice-title">Nenhum disco aberto</strong>
        O arquivo de disco ainda não existe. Formate um disco para começar.
      </>
    )
  } else if (readingFat) {
    notice = (
      <>
        Lendo a tabela de alocação de {DRIVE}…
        <div className="xp-progress" role="progressbar" aria-label="Lendo a FAT" />
      </>
    )
  } else if (dir.isPending) {
    notice = 'Carregando…'
  } else if (dir.isError) {
    notice = messageOf(dir.error)
  } else if (entries.length === 0) {
    notice = 'Esta pasta está vazia.'
  }

  let statusMain: string
  if (noDisk) statusMain = 'Nenhum disco aberto'
  else if (readingFat) statusMain = 'Lendo a FAT…'
  else if (dir.isPending) statusMain = 'Carregando…'
  else if (dir.isError) statusMain = '—'
  else if (selectedEntry)
    statusMain = `${selectedEntry.nome}: ${
      selectedEntry.tipo === 'diretorio' ? 'Pasta de arquivos' : formatBytes(selectedEntry.tamanho)
    }`
  else statusMain = describeFolder(entries)

  const disk = noDisk ? undefined : info.data
  const statusSpace = disk
    ? `${plural(disk.clustersLivres, 'cluster livre', 'clusters livres')} · ${formatBytes(disk.espacoLivre)}`
    : info.isPending
      ? 'Calculando espaço livre…'
      : '—'
  const statusDisk = disk ? `${disk.variante} · ${formatBytes(disk.clusterSize)}/cluster` : '—'

  let mapFooter: string
  if (noDisk) mapFooter = 'Sem disco aberto: não há tabela de alocação para mostrar.'
  else if (fat.data) mapFooter = describeFat(fat.data.entradas)
  else if (fat.isError) mapFooter = messageOf(fat.error)
  else mapFooter = 'O mapa é preenchido à medida que a FAT é lida.'

  // ---------------------------------------------------------------- layout

  const right = (
    <>
      <FileList
        dir={current}
        entries={notice ? [] : entries}
        sort={sort}
        selected={selectedPath}
        notice={notice}
        onSort={(column) => setSort((s) => nextSort(s, column))}
        onSelect={(path) => setSelection(path ? { dir: current, path } : null)}
        onOpen={open}
      />
      <ClusterMap
        entries={noDisk ? undefined : fat.data?.entradas}
        total={noDisk ? 0 : disk?.numClusters}
        footer={mapFooter}
      />
    </>
  )

  return (
    <ExplorerWindow title={noDisk ? 'Simulador FAT' : `${toDosPath(current)} (Simulador FAT)`}>
      <MenuBar menus={menus} />
      <Toolbar groups={toolbar} disabled={locked} />
      <AddressBar
        value={noDisk ? '(nenhum disco)' : toDosPath(current)}
        history={nav.visited.map(toDosPath)}
        onGo={goTyped}
        disabled={noDisk}
      />
      <SplitPane
        left={
          <FolderTree
            current={current}
            onNavigate={nav.navigate}
            loading={readingFat}
            empty={noDisk}
          />
        }
        right={right}
      />
      <StatusBar main={statusMain} space={statusSpace} disk={statusDisk} />
      {failure && (
        <ErrorDialog
          title={failure.title}
          message={failure.message}
          onClose={() => setFailure(null)}
        />
      )}
    </ExplorerWindow>
  )
}
