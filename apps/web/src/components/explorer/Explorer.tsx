// The Explorer window wired to the API.
// Phase 2: navigation. Phase 3: new folder / file, rename, move (dialog and
// cut / paste) and delete, recursive for folders with content. Phase 4: open
// a file (viewer and the three writes) and upload one from the computer.
// Phase 5: the selection lit on the map, Propriedades and Verificar disco.
// Phase 6: Formatar (telas 08 and 17) and the insufficient space box (05).

import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, ReactNode } from 'react'

import {
  ApiError,
  api,
  basename,
  ehSemDisco,
  fileToBase64,
  isAncestor,
  joinPath,
  parentOf,
  validateName,
} from '../../api'
import type { DiskInfo, LsData, LsEntry } from '../../api'
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
  useWrite,
} from '../../api/queries'
import { useDragMove } from '../../hooks/useDragMove'
import { useHighlight } from '../../hooks/useHighlight'
import type { Target } from '../../hooks/useHighlight'
import { useNavigation } from '../../hooks/useNavigation'
import { usePref } from '../../hooks/usePref'
import { useSelection } from '../../hooks/useSelection'
import { useWindowShortcuts } from '../../hooks/useWindowShortcuts'
import { checkBalloon, formattedBalloon } from '../../lib/balloons'
import { chainFromFat } from '../../lib/chain'
import { clustersNeeded, formatCount } from '../../lib/content'
import { planDelete } from '../../lib/deletePlan'
import type { DeletePlan } from '../../lib/deletePlan'
import { DRIVE, formatBytes, parseTypedPath, toDosPath } from '../../lib/display'
import {
  ShortageError,
  describeShortage,
  errorTitle,
  isNetworkError,
  messageOf,
} from '../../lib/errors'
import { describeMany, describeOne } from '../../lib/inspect'
import { fitName, remapPath, uniqueName } from '../../lib/names'
import { zoomPref } from '../../lib/prefs'
import { nextSort, sortEntries } from '../../lib/sort'
import type { SortState } from '../../lib/sort'
import { formatZoom, stepZoom } from '../../lib/zoom'
import { FileViewer } from '../content/FileViewer'
import { ConfirmDelete } from '../dialogs/ConfirmDelete'
import { DeleteProgress } from '../dialogs/DeleteProgress'
import { ErrorDialog } from '../dialogs/ErrorDialog'
import { FormatDialog } from '../dialogs/FormatDialog'
import { MoveDialog } from '../dialogs/MoveDialog'
import { PropertiesDialog } from '../dialogs/PropertiesDialog'
import { UploadDialog } from '../dialogs/UploadDialog'
import { ChainStrip } from '../inspector/ChainStrip'
import type { StripRow } from '../inspector/ChainStrip'
import { useNotify, useWindow } from '../desktop/DeskContext'
import { CheckReport } from '../inspector/CheckReport'
import { ClusterMap } from '../inspector/ClusterMap'
import type { MapLit } from '../inspector/ClusterMap'
import { AddressBar } from '../shell/AddressBar'
import { AppWindow } from '../shell/AppWindow'
import { ContextMenu } from '../shell/ContextMenu'
import type { Point } from '../shell/ContextMenu'
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
type Failure = {
  title: string
  message: string
  retry?: () => void
  /** tela 05 */
  lead?: string
  facts?: [string, string][]
  note?: string
}
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
/** a local file waiting for a name the disk accepts */
type Upload = { file: File; reason: string; suggestion: string; taken: Set<string> }

/**
 * Pause before each deletion of a batch, so tela 10 can be read and Cancelar
 * can land between two calls. It slows the run, it fakes nothing: every
 * count on screen is the API's. A long batch never waits more than ~3 s.
 */
const deleteStep = (total: number) => Math.min(150, 3000 / total)
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const plural = (n: number, one: string, many: string) => `${formatCount(n)} ${n === 1 ? one : many}`

/** '3 objetos · 3.900 B'; the byte sum only counts files (folders have tamanho 0). */
const describeFolder = (entries: LsEntry[]) => {
  const total = entries.reduce((sum, e) => sum + e.tamanho, 0)
  const count = plural(entries.length, 'objeto', 'objetos')
  return total > 0 ? `${count} · ${formatBytes(total)}` : count
}

/** From three selected items on, the strip under the map lists only the fragmented ones (tela 02). */
const STRIP_ALL = 2

/**
 * A new disk is a new window: history, selection, the clipboard, a rename
 * and the tree's open folders all referred to the old one, so a format
 * mounts the window again instead of resetting each of them.
 */
export function Explorer() {
  const [disk, setDisk] = useState(0)
  const notify = useNotify()
  return (
    <ExplorerBody
      key={disk}
      onFormatted={(info) => {
        setDisk((n) => n + 1)
        notify(formattedBalloon(info))
      }}
    />
  )
}

function ExplorerBody({ onFormatted }: { onFormatted: (info: DiskInfo) => void }) {
  const win = useWindow()
  const notify = useNotify()
  const queryClient = useQueryClient()
  /** one level for every window; the keys and Ctrl+wheel live in AppWindow */
  const [zoom, setZoom] = usePref(zoomPref)
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
  const write = useWrite()

  const [sort, setSort] = useState<SortState>({ column: 'name', asc: true })
  const [failure, setFailure] = useState<Failure | null>(null)
  const [clipboard, setClipboard] = useState<Clipboard | null>(null)
  const [confirm, setConfirm] = useState<DeletePlan | null>(null)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [moving, setMoving] = useState<Item[] | null>(null)
  const [menu, setMenu] = useState<{ at: Point; onItem: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  /** the file open in the viewer (telas 11a and 11b) */
  const [viewing, setViewing] = useState<string | null>(null)
  const [uploading, setUploading] = useState<Upload | null>(null)
  /** telas 06 and 07 */
  const [properties, setProperties] = useState<Item | null>(null)
  /** telas 18a and 18b */
  const [checking, setChecking] = useState(false)
  /** tela 17 when no disk is open, tela 08 otherwise */
  const [formatting, setFormatting] = useState<'required' | 'normal' | null>(null)
  /** tela 17 opens Formatar by itself once; after Cancelar it comes back from the menu */
  const offered = useRef(false)
  const cancelDelete = useRef(false)
  const fileInput = useRef<HTMLInputElement>(null)

  // Mirrored in a ref so the field's blur, which Chrome also fires while the
  // input is being removed, never acts on a rename that already ended.
  const [renaming, setRenamingState] = useState<Renaming | null>(null)
  const renamingRef = useRef<Renaming | null>(null)
  const setRenaming = (r: Renaming | null) => {
    renamingRef.current = r
    setRenamingState(r)
  }
  // an async answer cannot trust the `current` it closed over
  const currentRef = useRef(current)
  currentRef.current = current
  // Leaving the folder cancels a rename in progress. One that ends on an error
  // is not dropped in silence: the error opens as a dialog, as it was.
  useEffect(() => {
    if (!renaming || renaming.dir === current || renaming.busy) return
    if (renaming.error) setFailure({ title: 'Erro', message: renaming.error })
    setRenaming(null)
  }, [renaming, current])

  // every endpoint answers 400 "Nenhum disco aberto" when there is no disk
  const noDisk = ehSemDisco(info.error) || ehSemDisco(fat.error) || ehSemDisco(dir.error)
  // first read only: a refresh keeps the old FAT on screen meanwhile
  const readingFat = !noDisk && fat.isPending
  // tela 04 locks the whole toolbar while the FAT is read; tela 17 leaves
  // only Formatar
  const locked = noDisk || readingFat
  const modal = !!(
    failure ||
    confirm ||
    progress ||
    moving ||
    viewing ||
    uploading ||
    properties ||
    checking ||
    formatting
  )
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
  const canOpen = !locked && !!single
  const canPaste = canEdit && !!clipboard && clipboard.from !== current
  const disk = noDisk ? undefined : info.data

  // ------------------------------------------------------------- helpers

  const fail = (e: unknown, retry?: () => void) =>
    setFailure(
      e instanceof ShortageError
        ? { title: 'Espaço insuficiente', message: e.message, ...describeShortage(e.shortage) }
        : {
            title: errorTitle(e),
            message: messageOf(e),
            retry: isNetworkError(e) ? retry : undefined,
          },
    )

  // every endpoint answering "Nenhum disco aberto" opens Formatar, never an
  // error box (telas.md, tela 17)
  useEffect(() => {
    if (noDisk && !offered.current) {
      offered.current = true
      setFormatting('required')
    }
  }, [noDisk])

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
    if (locked) return
    if (entry.tipo === 'diretorio') nav.navigate(path)
    else setViewing(path)
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

  // ------------------------------------------------------------- upload

  /**
   * There is no multipart: an upload is POST /file/create, then POST
   * /file/write with the bytes in Base64 (build-frontend.md, "Upload").
   */
  const upload = async (file: File, name: string) => {
    const where = current
    const path = joinPath(where, name)
    // read before touching the disk: a local read error leaves nothing behind
    const base64 = await fileToBase64(file)
    const before = disk?.clustersLivres
    await createFile.mutateAsync(path)
    if (file.size > 0) {
      try {
        await write.mutateAsync({ path, base64 })
      } catch (e) {
        // create passed and write did not (a full disk, typically): without
        // this the folder keeps an empty orphan
        await remove.mutateAsync(path).catch(() => {})
        throw await explainWrite(e, file.size, name, where, before)
      }
    }
    await settle(where)
    selection.select([path], where)
  }

  /**
   * Tela 05: a refused write becomes ShortageError when a fresh /disk/info
   * shows the content needs more clusters than are free. Any other refusal
   * goes on as it came.
   */
  const explainWrite = async (
    e: unknown,
    size: number,
    name: string,
    where: string,
    before: number | undefined,
  ) => {
    if (!(e instanceof ApiError) || e.status !== 400) return e
    try {
      const now = await queryClient.fetchQuery({ queryKey: keys.info, queryFn: api.diskInfo })
      const needed = clustersNeeded(size, now.clusterSize)
      if (needed <= now.clustersLivres) return e
      return new ShortageError(
        {
          name,
          dir: where,
          needed,
          free: now.clustersLivres,
          clusterSize: now.clusterSize,
          untouched: before === now.clustersLivres,
        },
        e,
      )
    } catch {
      return e
    }
  }

  const uploadNow = async (file: File) => {
    setBusy(true)
    try {
      await upload(file, file.name)
    } catch (e) {
      fail(e, () => void uploadNow(file))
    } finally {
      setBusy(false)
    }
  }

  /** A name the disk refuses stops in UploadDialog; any other goes straight out. */
  const onFilePicked = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    // cleared so picking the same file again still fires onChange
    e.target.value = ''
    if (!file || !canEdit) return
    const taken = new Set(entries.map((x) => x.nome))
    const reason =
      validateName(file.name) ?? (taken.has(file.name) ? `Já existe "${file.name}" nesta pasta.` : null)
    if (reason) setUploading({ file, reason, suggestion: fitName(file.name, taken), taken })
    else void uploadNow(file)
  }

  const uploadRenamed = async (name: string) => {
    if (!uploading) return
    setBusy(true)
    try {
      // a rejection stays in the dialog, which shows the backend detail;
      // a lack of space is tela 05, over the window
      await upload(uploading.file, name)
      setUploading(null)
    } catch (e) {
      if (!(e instanceof ShortageError)) throw e
      setUploading(null)
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  // ------------------------------------------------------------- rename

  const startRename =(path = single?.path) => {
    if (!path || !canEdit) return
    selection.select([path])
    setRenaming({ dir: current, path, error: null, busy: false })
  }

  /**
   * POST /file/rename, then every place holding the old path follows it. Rejects as the API did.
   * `reselect` says, once the answer is in, whether the selection still is this item's.
   */
  const renamePath = async (dir: string, path: string, name: string, reselect = () => true) => {
    const { path_novo } = await rename.mutateAsync({ path, nome: name })
    await settle(dir)
    forget(path)
    nav.remap(path, path_novo)
    setClipboard((c) => c && { ...c, paths: c.paths.map((p) => remapPath(p, path, path_novo)) })
    if (reselect()) selection.select([path_novo], dir)
  }

  const commitRename = async (name: string) => {
    const r = renamingRef.current
    if (!r || r.busy) return
    // the backend answers 409 when a name is "renamed" to itself
    if (name === basename(r.path)) return setRenaming(null)
    const invalid = validateName(name)
    if (invalid) return setRenaming({ ...r, error: invalid })

    const sent = { ...r, error: null, busy: true }
    setRenaming(sent)
    // A click on Nova pasta or Novo arquivo commits this rename on its way and
    // opens the new item's rename before this request is back: the answer
    // ends only this rename, never the one that replaced it, nor moves the
    // selection off the new item.
    const stillOurs = () => renamingRef.current === sent
    try {
      await renamePath(r.dir, r.path, name, stillOurs)
      if (stillOurs()) setRenaming(null)
    } catch (e) {
      // 15b: the field stays open with the text, the backend message under it
      if (!stillOurs()) fail(e)
      else if (r.dir !== currentRef.current) {
        // the folder changed meanwhile: no field to show it in, so the dialog does
        fail(e)
        setRenaming(null)
      } else setRenaming({ ...r, error: messageOf(e), busy: false })
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
    let moved = false
    try {
      for (const path of from) {
        const { path_novo } = await move.mutateAsync({ origem: path, destino: target })
        moved = true
        forget(path)
        nav.remap(path, path_novo)
        onMoved?.(path)
      }
    } finally {
      // A collapsed tree node's query is disabled, so the invalidation alone
      // leaves its cached listing (and its missing "+") as it was. The default
      // staleTime is 0, so this really fetches. A failed refresh is not a
      // failed move: nothing waits for it and nothing is shown.
      if (moved) void listFolder(target).catch(() => {})
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

  /** Rows dropped on a folder of the list or the tree: the moves Colar makes. */
  const drop = async (paths: string[], target: string) => {
    const pending = new Set(paths)
    setBusy(true)
    try {
      await moveAll(paths, target, (p) => pending.delete(p))
      // the items left the folder being shown
      selection.clear()
    } catch (e) {
      fail(e, () => void drop([...pending], target))
    } finally {
      // what moved is no longer waiting for a paste
      const moved = new Set(paths.filter((p) => !pending.has(p)))
      setClipboard((c) => {
        const left = c?.paths.filter((p) => !moved.has(p)) ?? []
        return c && left.length > 0 ? { ...c, paths: left } : null
      })
      setBusy(false)
    }
  }

  const drag = useDragMove({
    enabled: canEdit && !renaming && !modal,
    current,
    onDrop: (paths, target) => void drop(paths, target),
  })

  // ------------------------------------------------------------- map

  // the selection, or the folder being shown when nothing is selected
  // (tela 03: the tree's selection in the primary tone)
  const parentListing =
    current === '/' ? undefined : queryClient.getQueryData<LsData>(keys.dir(parentOf(current)))
  const folderFirst =
    current === '/'
      ? (disk?.rootCluster ?? null)
      : (parentListing?.entradas.find((e) => e.nome === basename(current))?.primeiro_cluster ?? null)
  const targets: Target[] = useMemo(
    () =>
      selectedItems.length > 0
        ? selectedItems.map(({ path, entry }) => ({
            path,
            name: entry.nome,
            dir: entry.tipo === 'diretorio',
            size: entry.tamanho,
            first: entry.primeiro_cluster,
          }))
        : [
            {
              path: current,
              name: current === '/' ? toDosPath('/') : basename(current),
              dir: true,
              size: 0,
              first: folderFirst,
            },
          ],
    [selectedItems, current, folderFirst],
  )
  const showMap = !noDisk && !readingFat && !!fat.data && !dir.isError
  const highlight = useHighlight(showMap ? targets : [], fat.data?.entradas)
  // with two items each gets a tone; from three on, all share the primary one
  const tone = (i: number): 'a' | 'b' => (highlight.length === 2 && i === 1 ? 'b' : 'a')
  const litKey = highlight.map((h) => h.chain.join(',')).join('|')
  const lit: MapLit[] = useMemo(
    () => highlight.map((h, i) => ({ chain: h.chain, tone: tone(i) })),
    // the chains' contents, not the array: useHighlight builds a new one per render
    [litKey],
  )

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
          properties: () => doProperties?.(),
        },
    // a minimized or inactive window must not delete what it has selected
    !modal && win.takesKeys,
  )

  // --------------------------------------------------------- menus, toolbar

  const hasSelection = canEdit && selectedItems.length > 0
  const canRename = canEdit && !!single
  const newFolder = canEdit ? () => void createItem('pasta') : undefined
  const newFile = canEdit ? () => void createItem('arquivo') : undefined
  const doUpload = canEdit ? () => fileInput.current?.click() : undefined
  const doDelete = hasSelection ? () => void requestDelete() : undefined
  const doMove = hasSelection ? () => setMoving(selectedItems) : undefined
  const doCut = hasSelection ? cutSelection : undefined
  const doPaste = canPaste ? () => void paste() : undefined
  const doRename = canRename ? () => startRename() : undefined
  const doProperties = canOpen && !busy && single ? () => setProperties(single) : undefined
  const doCheck = !locked && !busy ? () => setChecking(true) : undefined
  const doFormat =
    !readingFat && !busy ? () => setFormatting(noDisk ? 'required' : 'normal') : undefined
  // off at 200% and 75%, where a step goes nowhere
  const zoomIn = stepZoom(zoom, 1)
  const zoomOut = stepZoom(zoom, -1)
  const doZoomIn = zoomIn !== zoom ? () => setZoom(zoomIn) : undefined
  const doZoomOut = zoomOut !== zoom ? () => setZoom(zoomOut) : undefined
  const doZoomReset = zoom !== 1 ? () => setZoom(1) : undefined

  // items without onSelect render disabled until their phase lands
  const menus: Menu[] = [
    {
      label: 'Arquivo',
      items: [
        { label: 'Abrir', shortcut: 'Enter', onSelect: canOpen ? openSelected : undefined },
        { separator: true },
        { label: 'Nova pasta', onSelect: newFolder },
        { label: 'Novo arquivo', onSelect: newFile },
        { label: 'Enviar arquivo…', onSelect: doUpload },
        { separator: true },
        { label: 'Renomear', shortcut: 'F2', onSelect: doRename },
        { label: 'Mover…', onSelect: doMove },
        { label: 'Excluir', shortcut: 'Del', onSelect: doDelete },
        { separator: true },
        { label: 'Propriedades', shortcut: 'Alt+Enter', onSelect: doProperties },
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
        { label: 'Ampliar', shortcut: 'Ctrl++', onSelect: doZoomIn },
        { label: 'Reduzir', shortcut: 'Ctrl+−', onSelect: doZoomOut },
        { label: 'Tamanho normal', shortcut: 'Ctrl+0', onSelect: doZoomReset },
        { separator: true },
        { label: 'Atualizar', shortcut: 'F5', onSelect: refresh },
      ],
    },
    {
      label: 'Disco',
      items: [
        { label: 'Formatar…', onSelect: doFormat },
        { label: 'Verificar disco', onSelect: doCheck },
        { separator: true },
        { label: 'Inspetor de disco' },
      ],
    },
    { label: 'Ajuda', items: [{ label: 'Sobre o Simulador FAT' }] },
  ]

  const toolbar: ToolbarAction[][] = [
    [
      { label: 'Voltar', icon: 'back', onClick: nav.goBack, disabled: locked || !nav.canGoBack },
      {
        label: 'Avançar',
        icon: 'forward',
        iconOnly: true,
        onClick: nav.goForward,
        disabled: locked || !nav.canGoForward,
      },
      {
        label: 'Acima',
        icon: 'up',
        iconOnly: true,
        onClick: goUp,
        disabled: locked || current === '/',
      },
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
      { label: 'Propriedades', onClick: doProperties, disabled: !doProperties },
    ],
    [
      { label: 'Formatar…', onClick: doFormat, disabled: !doFormat },
      { label: 'Verificar disco', onClick: doCheck, disabled: !doCheck },
    ],
  ]

  // build-frontend.md, "Context menu": the items depend on what was clicked
  let contextItems: MenuItem[] = []
  if (menu && !menu.onItem) {
    contextItems = [
      { label: 'Nova pasta', onSelect: newFolder },
      { label: 'Novo arquivo', onSelect: newFile },
      { label: 'Enviar arquivo…', onSelect: doUpload },
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
      { label: 'Propriedades', onSelect: doProperties },
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
  else if (selectedItems.length > 1) statusMain = describeMany(highlight)
  else if (single && highlight[0]) statusMain = describeOne(highlight[0])
  else statusMain = describeFolder(entries)

  const statusSpace = disk
    ? `${plural(disk.clustersLivres, 'cluster livre', 'clusters livres')} · ${formatBytes(disk.espacoLivre)}`
    : info.isPending
      ? 'Calculando espaço livre…'
      : '—'
  const statusDisk = disk ? `${disk.variante} · ${formatBytes(disk.clusterSize)}/cluster` : '—'

  let mapFooter: ReactNode
  if (noDisk) mapFooter = 'Sem disco aberto: não há tabela de alocação para mostrar.'
  else if (fat.data && showMap) {
    const rows: StripRow[] = highlight.map((h, i) => ({
      key: h.path,
      name: h.name,
      chain: h.chain,
      tone: tone(i),
    }))
    let shown = rows
    let more: string | undefined
    if (rows.length > STRIP_ALL) {
      const broken = rows.filter((r) => r.chain.some((c, i) => i > 0 && c !== r.chain[i - 1] + 1))
      shown = broken.length > STRIP_ALL ? broken.slice(0, 1) : broken
      if (broken.length === 0) more = `Nenhum dos ${rows.length} itens selecionados está fragmentado.`
      else if (broken.length > STRIP_ALL) more = `… e mais ${broken.length - 1} itens fragmentados`
    }
    mapFooter = <ChainStrip rows={shown} fat={fat.data.entradas} more={more} />
  } else if (fat.isError) mapFooter = messageOf(fat.error)
  else if (fat.data) mapFooter = ''
  else mapFooter = 'O mapa é preenchido à medida que a FAT é lida.'

  // ---------------------------------------------------------------- layout

  const right = (
    <>
      <FileList
        dir={current}
        entries={notice ? [] : entries}
        sort={sort}
        active={win.takesKeys}
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
        onDragBegin={drag.begin}
      />
      <ClusterMap
        entries={noDisk ? undefined : fat.data?.entradas}
        total={noDisk ? 0 : disk?.numClusters}
        lit={lit}
        footer={mapFooter}
      />
    </>
  )

  return (
    <AppWindow
      title={noDisk ? 'Simulador FAT' : `${toDosPath(current)} (Simulador FAT)`}
      icon="folderOpen"
    >
      <MenuBar menus={menus} />
      {/* every button checks locked itself, so Formatar can stay on in tela 17 */}
      <Toolbar groups={toolbar} disabled={readingFat} />
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
      <StatusBar
        main={statusMain}
        space={statusSpace}
        disk={statusDisk}
        zoom={zoom !== 1 ? `Zoom: ${formatZoom(zoom)}` : undefined}
      />

      {drag.ghost}
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
      {viewing && (
        <FileViewer
          path={viewing}
          disk={disk}
          fat={fat.data?.entradas}
          onClose={() => setViewing(null)}
        />
      )}
      {uploading && (
        <UploadDialog
          file={uploading.file}
          reason={uploading.reason}
          suggestion={uploading.suggestion}
          taken={uploading.taken}
          clusterSize={disk?.clusterSize}
          onUpload={uploadRenamed}
          onClose={() => setUploading(null)}
        />
      )}
      {properties && (
        <PropertiesDialog
          path={properties.path}
          entry={properties.entry}
          disk={disk}
          fat={fat.data?.entradas}
          canRename={canEdit}
          onRename={(name) => renamePath(current, properties.path, name)}
          onClose={() => setProperties(null)}
        />
      )}
      {checking && (
        <CheckReport
          fat={fat.data?.entradas}
          onClose={() => setChecking(false)}
          onResult={(r) => notify(checkBalloon(r))}
        />
      )}
      {/* the computer's file picker; Arquivo > Enviar arquivo clicks it */}
      <input ref={fileInput} type="file" hidden onChange={onFilePicked} />
      {formatting && (
        <FormatDialog
          required={formatting === 'required'}
          onFormatted={onFormatted}
          onClose={() => setFormatting(null)}
        />
      )}
      {failure && (
        <ErrorDialog
          title={failure.title}
          message={failure.message}
          lead={failure.lead}
          facts={failure.facts}
          note={failure.note}
          onRetry={failure.retry}
          onClose={() => setFailure(null)}
        />
      )}
    </AppWindow>
  )
}
