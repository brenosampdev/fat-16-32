// The Explorer window wired to the API.
// Phase 2: navigation. Phase 3: new folder / file, rename, move (dialog and
// cut / paste) and delete, recursive for folders with content.

import { useQueryClient } from '@tanstack/react-query'
import { useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import {
  api,
  basename,
  clusterState,
  ehSemDisco,
  isAncestor,
  joinPath,
  parentOf,
  validateName,
} from '../../api'
import type { FatEntry, LsEntry } from '../../api'
import {
  keys,
  useCreateFile,
  useDir,
  useDiskFat,
  useDiskInfo,
  useMkdir,
  useMove,
  useRemove,
  useRename,
} from '../../api/queries'
import { useNavigation } from '../../hooks/useNavigation'
import { useSelection } from '../../hooks/useSelection'
import { useWindowShortcuts } from '../../hooks/useWindowShortcuts'
import { chainFromFat } from '../../lib/chain'
import { planDelete } from '../../lib/deletePlan'
import type { DeletePlan } from '../../lib/deletePlan'
import { DRIVE, formatBytes, parseTypedPath, toDosPath } from '../../lib/display'
import { errorTitle, isNetworkError, messageOf } from '../../lib/errors'
import { remapPath, uniqueName } from '../../lib/names'
import { nextSort, sortEntries } from '../../lib/sort'
import type { SortState } from '../../lib/sort'
import { ConfirmDelete } from '../dialogs/ConfirmDelete'
import { DeleteProgress } from '../dialogs/DeleteProgress'
import { ErrorDialog } from '../dialogs/ErrorDialog'
import { MoveDialog } from '../dialogs/MoveDialog'
import { ClusterMap } from '../inspector/ClusterMap'
import { AddressBar } from '../shell/AddressBar'
import { ContextMenu } from '../shell/ContextMenu'
import type { Point } from '../shell/ContextMenu'
import { ExplorerWindow } from '../shell/ExplorerWindow'
import { MenuBar } from '../shell/MenuBar'
import type { Menu, MenuItem } from '../shell/MenuBar'
import { SplitPane } from '../shell/SplitPane'
import { StatusBar } from '../shell/StatusBar'
import { Toolbar } from '../shell/Toolbar'
import type { ToolbarAction } from '../shell/Toolbar'
import { FileList } from './FileList'
import { FolderTree } from './FolderTree'
import { RenameField } from './RenameField'

type Item = { path: string; entry: LsEntry }
type Failure = { title: string; message: string; retry?: () => void }
type Renaming = { dir: string; path: string; error: string | null; busy: boolean }
/** cut items wait here for a paste; nothing is moved until then */
type Clipboard = { from: string; paths: string[] }
type Progress = {
  plan: DeletePlan
  title: string
  index: number
  freed: number
  cancelling: boolean
}

/**
 * Pause before each deletion of a batch, so tela 10 can be read and Cancelar
 * can land between two calls. It slows the run, it fakes nothing: every
 * count on screen is the API's. A long batch never waits more than ~3 s.
 */
const deleteStep = (total: number) => Math.min(150, 3000 / total)
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

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

  const mkdir = useMkdir()
  const createFile = useCreateFile()
  const remove = useRemove()
  const rename = useRename()
  const move = useMove()

  const [sort, setSort] = useState<SortState>({ column: 'name', asc: true })
  const [failure, setFailure] = useState<Failure | null>(null)
  const [clipboard, setClipboard] = useState<Clipboard | null>(null)
  const [confirm, setConfirm] = useState<DeletePlan | null>(null)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [moving, setMoving] = useState<Item[] | null>(null)
  const [menu, setMenu] = useState<{ at: Point; onItem: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const cancelDelete = useRef(false)

  // Mirrored in a ref so the field's blur, which Chrome also fires while the
  // input is being removed, never acts on a rename that already ended.
  const [renaming, setRenamingState] = useState<Renaming | null>(null)
  const renamingRef = useRef<Renaming | null>(null)
  const setRenaming = (r: Renaming | null) => {
    renamingRef.current = r
    setRenamingState(r)
  }
  // leaving the folder cancels a rename in progress
  if (renaming && renaming.dir !== current && !renaming.busy) setRenaming(null)

  // every endpoint answers 400 "Nenhum disco aberto" when there is no disk
  const noDisk = ehSemDisco(info.error) || ehSemDisco(fat.error) || ehSemDisco(dir.error)
  // first read only: a refresh keeps the old FAT on screen meanwhile
  const readingFat = !noDisk && fat.isPending
  // tela 04 locks the toolbar while the FAT is read; tela 17 leaves only
  // Formatar, which arrives in phase 6
  const locked = noDisk || readingFat
  const modal = !!(failure || confirm || progress || moving)
  /** writes are allowed: a disk, a listed folder, nothing else running */
  const canEdit = !locked && !busy && !!dir.data

  const entries = useMemo(() => sortEntries(dir.data?.entradas ?? [], sort), [dir.data, sort])
  const paths = useMemo(() => entries.map((e) => joinPath(current, e.nome)), [entries, current])
  const selection = useSelection(current, paths)
  const selectedItems: Item[] = useMemo(
    () =>
      entries.flatMap((entry, i) =>
        selection.selected.has(paths[i]) ? [{ path: paths[i], entry }] : [],
      ),
    [entries, paths, selection.selected],
  )
  const single = selectedItems.length === 1 ? selectedItems[0] : null
  const canOpen = !locked && single?.entry.tipo === 'diretorio'
  const canPaste = canEdit && !!clipboard && clipboard.from !== current
  const disk = noDisk ? undefined : info.data

  // ------------------------------------------------------------- helpers

  const fail = (e: unknown, retry?: () => void) =>
    setFailure({
      title: errorTitle(e),
      message: messageOf(e),
      retry: isNetworkError(e) ? retry : undefined,
    })

  /**
   * Creating a file or moving an entry can make the folder's chain grow a
   * cluster, but useCreateFile and useMove do not refresh /disk/fat and (for
   * move) /disk/info. Refreshed here until src/api/queries.ts covers it.
   */
  const refreshDisk = () => {
    void queryClient.invalidateQueries({ queryKey: keys.info })
    void queryClient.invalidateQueries({ queryKey: keys.fat })
  }

  /** Waits for a folder's fresh listing, joining the refetch a mutation already started. */
  const settle = (path: string) =>
    queryClient.refetchQueries({ queryKey: keys.dir(path), exact: true }, { cancelRefetch: false })

  /** Drops cached listings under a path that no longer exists, so a new folder
   *  with the same name never flashes the old content. */
  const forget = (path: string) =>
    queryClient.removeQueries({
      predicate: (q) =>
        q.queryKey[0] === 'dir' &&
        typeof q.queryKey[1] === 'string' &&
        isAncestor(path, q.queryKey[1]),
    })

  const listFolder = (path: string) =>
    queryClient.fetchQuery({ queryKey: keys.dir(path), queryFn: () => api.ls(path) })

  // ------------------------------------------------------------- navigation

  const goUp = () => {
    if (current === '/') return
    // XP selects the folder you just came out of
    selection.select([current], parentOf(current))
    nav.navigate(parentOf(current))
  }

  const open = (entry: LsEntry, path: string) => {
    if (entry.tipo === 'diretorio') nav.navigate(path)
    // files open in the viewer, phase 4
  }

  const openSelected = () => {
    if (single) open(single.entry, single.path)
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
      await listFolder(path)
      nav.navigate(path)
      return true
    } catch (e) {
      // detail as the API sent it (404 not found, 400 not a folder, network...)
      setFailure({ title: toDosPath(path), message: messageOf(e) })
      return false
    }
  }

  // ------------------------------------------------------------- create

  /** Creates 'Nova pasta' / 'Novo arquivo.txt' and opens its name for editing, as XP. */
  const createItem = async (kind: 'pasta' | 'arquivo') => {
    if (!canEdit) return
    const taken = new Set(entries.map((e) => e.nome))
    const name =
      kind === 'pasta' ? uniqueName('Nova pasta', '', taken) : uniqueName('Novo arquivo', '.txt', taken)
    const where = current
    const path = joinPath(where, name)
    setBusy(true)
    try {
      if (kind === 'pasta') {
        await mkdir.mutateAsync(path)
      } else {
        await createFile.mutateAsync(path)
        refreshDisk()
      }
      await settle(where)
      selection.select([path], where)
      setRenaming({ dir: where, path, error: null, busy: false })
    } catch (e) {
      fail(e, () => void createItem(kind))
    } finally {
      setBusy(false)
    }
  }

  // ------------------------------------------------------------- rename

  const startRename = (path = single?.path) => {
    if (!path || !canEdit) return
    selection.select([path])
    setRenaming({ dir: current, path, error: null, busy: false })
  }

  const commitRename = async (name: string) => {
    const r = renamingRef.current
    if (!r || r.busy) return
    // the backend answers 409 when a name is "renamed" to itself
    if (name === basename(r.path)) return setRenaming(null)
    const invalid = validateName(name)
    if (invalid) return setRenaming({ ...r, error: invalid })

    setRenaming({ ...r, error: null, busy: true })
    try {
      const { path_novo } = await rename.mutateAsync({ path: r.path, nome: name })
      await settle(r.dir)
      forget(r.path)
      nav.remap(r.path, path_novo)
      setClipboard((c) => c && { ...c, paths: c.paths.map((p) => remapPath(p, r.path, path_novo)) })
      selection.select([path_novo], r.dir)
      setRenaming(null)
    } catch (e) {
      // 15b: the field stays open with the text, the backend message under it
      setRenaming({ ...r, error: messageOf(e), busy: false })
    }
  }

  const activeRename = renaming?.dir === current ? renaming : null
  const renameField = activeRename && {
    path: activeRename.path,
    field: (
      <RenameField
        key={activeRename.path}
        initial={basename(activeRename.path)}
        error={activeRename.error}
        busy={activeRename.busy}
        onCommit={(name) => void commitRename(name)}
        onCancel={() => setRenaming(null)}
        onEdit={() => {
          const r = renamingRef.current
          if (r?.error) setRenaming({ ...r, error: null })
        }}
      />
    ),
  }

  // ------------------------------------------------------------- delete

  /** Lists and counts everything first, then asks (tela 09). */
  const requestDelete = async (items: Item[] = selectedItems) => {
    if (!canEdit || items.length === 0) return
    setBusy(true)
    try {
      // fresh FAT: chains are read from it instead of one /file/chain per item
      const table = await queryClient.fetchQuery({ queryKey: keys.fat, queryFn: api.diskFat })
      const plan = await planDelete(items, listFolder, (first) =>
        chainFromFat(table.entradas, first),
      )
      setConfirm(plan)
    } catch (e) {
      fail(e, () => void requestDelete(items))
    } finally {
      setBusy(false)
    }
  }

  /** One DELETE per item, contents before their folder (tela 10). */
  const runDelete = async (plan: DeletePlan) => {
    setConfirm(null)
    const batch = plan.items.length > 1
    const title =
      plan.roots.length === 1
        ? `Excluindo ${toDosPath(plan.roots[0].path)}`
        : `Excluindo ${plan.roots.length} itens`
    cancelDelete.current = false
    if (batch) setProgress({ plan, title, index: 0, freed: 0, cancelling: false })
    setBusy(true)

    const deleted: string[] = []
    let freed = 0
    try {
      for (const [i, item] of plan.items.entries()) {
        // checked before the pause: the item on screen as current always
        // finishes, as 'Cancelando depois do item atual' promises
        if (cancelDelete.current) break
        if (batch) await pause(deleteStep(plan.items.length))
        // useRemove refreshes the folder, /disk/info and /disk/fat after each
        // call: the tree, the status bar and the map follow along
        const res = await remove.mutateAsync(item.path)
        deleted.push(item.path)
        freed += res.clusters_liberados
        if (batch) setProgress((p) => p && { ...p, index: i + 1, freed })
      }
    } catch (e) {
      // the folder keeps what was not reached; no chain is left half freed
      fail(e, refresh)
    } finally {
      setProgress(null)
      setBusy(false)
      for (const p of deleted) forget(p)
      const gone = new Set(deleted)
      setClipboard((c) => {
        const left = c?.paths.filter((p) => !gone.has(p)) ?? []
        return c && left.length > 0 ? { ...c, paths: left } : null
      })
      selection.clear()
    }
  }

  const cancelRun = () => {
    cancelDelete.current = true
    setProgress((p) => p && { ...p, cancelling: true })
  }

  // ------------------------------------------------------------- move

  /** POST /file/move per item. Not atomic: what moved before an error stays moved. */
  const moveAll = async (from: string[], target: string, onMoved?: (path: string) => void) => {
    try {
      for (const path of from) {
        const { path_novo } = await move.mutateAsync({ origem: path, destino: target })
        forget(path)
        nav.remap(path, path_novo)
        onMoved?.(path)
      }
    } finally {
      refreshDisk()
    }
  }

  const moveTo = async (target: string) => {
    if (!moving) return
    // a rejection stays in the dialog, which shows the backend detail
    await moveAll(
      moving.map((it) => it.path),
      target,
    )
    setMoving(null)
    selection.clear()
  }

  const cutSelection = () => {
    if (!canEdit || selectedItems.length === 0) return
    setClipboard({ from: current, paths: selectedItems.map((it) => it.path) })
  }

  /** Ctrl+V: the cut items move into the folder being shown (same endpoint as the dialog). */
  const paste = async () => {
    if (!canPaste || !clipboard) return
    const target = current
    const pending = new Set(clipboard.paths)
    setBusy(true)
    try {
      await moveAll(clipboard.paths, target, (p) => pending.delete(p))
      await settle(target)
      selection.select(
        clipboard.paths.map((p) => joinPath(target, basename(p))),
        target,
      )
    } catch (e) {
      fail(e, () => void paste())
    } finally {
      setClipboard(pending.size > 0 ? { ...clipboard, paths: [...pending] } : null)
      setBusy(false)
    }
  }

  // ------------------------------------------------------------- keys

  useWindowShortcuts(
    locked
      ? { refresh }
      : {
          up: goUp,
          back: nav.goBack,
          forward: nav.goForward,
          refresh,
          remove: () => void requestDelete(),
          rename: () => startRename(),
          selectAll: canEdit ? selection.all : undefined,
          cut: cutSelection,
          paste: () => void paste(),
        },
    !modal,
  )

  // --------------------------------------------------------- menus, toolbar

  const hasSelection = canEdit && selectedItems.length > 0
  const canRename = canEdit && !!single
  const newFolder = canEdit ? () => void createItem('pasta') : undefined
  const newFile = canEdit ? () => void createItem('arquivo') : undefined
  const doDelete = hasSelection ? () => void requestDelete() : undefined
  const doMove = hasSelection ? () => setMoving(selectedItems) : undefined
  const doCut = hasSelection ? cutSelection : undefined
  const doPaste = canPaste ? () => void paste() : undefined
  const doRename = canRename ? () => startRename() : undefined

  // items without onSelect render disabled until their phase lands
  const menus: Menu[] = [
    {
      label: 'Arquivo',
      items: [
        { label: 'Abrir', shortcut: 'Enter', onSelect: canOpen ? openSelected : undefined },
        { separator: true },
        { label: 'Nova pasta', onSelect: newFolder },
        { label: 'Novo arquivo', onSelect: newFile },
        { separator: true },
        { label: 'Renomear', shortcut: 'F2', onSelect: doRename },
        { label: 'Mover…', onSelect: doMove },
        { label: 'Excluir', shortcut: 'Del', onSelect: doDelete },
        { separator: true },
        { label: 'Propriedades', shortcut: 'Alt+Enter' },
      ],
    },
    {
      label: 'Editar',
      items: [
        { label: 'Recortar', shortcut: 'Ctrl+X', onSelect: doCut },
        { label: 'Copiar', shortcut: 'Ctrl+C' },
        { label: 'Colar', shortcut: 'Ctrl+V', onSelect: doPaste },
        { separator: true },
        {
          label: 'Selecionar tudo',
          shortcut: 'Ctrl+A',
          onSelect: canEdit && entries.length > 0 ? selection.all : undefined,
        },
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
      { label: 'Nova pasta', onClick: newFolder, disabled: !newFolder },
      { label: 'Novo arquivo', onClick: newFile, disabled: !newFile },
    ],
    [
      { label: 'Renomear', onClick: doRename, disabled: !doRename },
      { label: 'Mover…', onClick: doMove, disabled: !doMove },
      { label: 'Excluir', onClick: doDelete, disabled: !doDelete },
      { label: 'Propriedades' },
    ],
    [{ label: 'Formatar…' }, { label: 'Verificar disco' }],
  ]

  // build-frontend.md, "Context menu": the items depend on what was clicked
  let contextItems: MenuItem[] = []
  if (menu && !menu.onItem) {
    contextItems = [
      { label: 'Nova pasta', onSelect: newFolder },
      { label: 'Novo arquivo', onSelect: newFile },
      { separator: true },
      { label: 'Colar', onSelect: doPaste },
      { separator: true },
      { label: 'Atualizar', onSelect: refresh },
    ]
  } else if (menu && selectedItems.length > 1) {
    contextItems = [
      { label: 'Recortar', onSelect: doCut },
      { label: 'Copiar' },
      { separator: true },
      { label: 'Excluir', onSelect: doDelete },
    ]
  } else if (menu) {
    contextItems = [
      { label: 'Abrir', onSelect: canOpen ? openSelected : undefined },
      { separator: true },
      { label: 'Recortar', onSelect: doCut },
      { label: 'Copiar' },
      { separator: true },
      { label: 'Renomear', onSelect: doRename },
      { label: 'Excluir', onSelect: doDelete },
      { separator: true },
      { label: 'Propriedades' },
    ]
  }

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
  else if (activeRename)
    statusMain = `Renomeando ${basename(activeRename.path)}: Enter confirma, Esc cancela`
  else if (selectedItems.length > 1) {
    const bytes = selectedItems.reduce((sum, it) => sum + it.entry.tamanho, 0)
    statusMain = `${selectedItems.length} objetos selecionados${bytes > 0 ? ` · ${formatBytes(bytes)}` : ''}`
  }
  else if (single)
    statusMain = `${single.entry.nome}: ${
      single.entry.tipo === 'diretorio' ? 'Pasta de arquivos' : formatBytes(single.entry.tamanho)
    }`
  else statusMain = describeFolder(entries)

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
        selected={selection.selected}
        focus={selection.focus}
        cut={clipboard?.from === current ? new Set(clipboard.paths) : undefined}
        renaming={renameField ?? undefined}
        notice={notice}
        onSort={(column) => setSort((s) => nextSort(s, column))}
        onPick={selection.pick}
        onClear={selection.clear}
        onOpen={open}
        onSlowClick={(path) => startRename(path)}
        onContextMenu={(path, at) => !locked && setMenu({ at, onItem: path !== null })}
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

      {menu && contextItems.length > 0 && (
        <ContextMenu at={menu.at} items={contextItems} onClose={() => setMenu(null)} />
      )}
      {confirm && (
        <ConfirmDelete
          plan={confirm}
          base={current}
          onConfirm={() => void runDelete(confirm)}
          onCancel={() => setConfirm(null)}
        />
      )}
      {progress && (
        <DeleteProgress
          title={progress.title}
          plan={progress.plan}
          base={current}
          index={progress.index}
          freed={progress.freed}
          cancelling={progress.cancelling}
          onCancel={cancelRun}
        />
      )}
      {moving && (
        <MoveDialog
          items={moving}
          source={current}
          fat={fat.data?.entradas}
          disk={disk}
          onMove={moveTo}
          onClose={() => setMoving(null)}
        />
      )}
      {failure && (
        <ErrorDialog
          title={failure.title}
          message={failure.message}
          onRetry={failure.retry}
          onClose={() => setFailure(null)}
        />
      )}
    </ExplorerWindow>
  )
}
