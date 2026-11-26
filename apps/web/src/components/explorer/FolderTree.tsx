import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import { api, isAncestor, joinPath, segments } from '../../api'
import { keys } from '../../api/queries'
import { DRIVE } from '../../lib/display'
import { byName } from '../../lib/sort'
import { TreeItem } from './TreeItem'
import type { TreeToggle } from './TreeItem'

type Props = {
  /** folder shown in the list; the tree highlights it and keeps it revealed */
  current: string
  onNavigate: (path: string) => void
  /** while the FAT is being read the tree shows only the collapsed drive (tela 04) */
  loading?: boolean
  /** no disk open: there is nothing to draw (tela 17) */
  empty?: boolean
}

type Ctx = {
  current: string
  expanded: Set<string>
  toggle: (path: string) => void
  onNavigate: (path: string) => void
}

const ROOT_LABEL = `${DRIVE}\\`

/** '/a/b' -> ['/', '/a', '/a/b'] */
const lineage = (path: string): string[] => {
  const out = ['/']
  let acc = ''
  for (const s of segments(path)) {
    acc += `/${s}`
    out.push(acc)
  }
  return out
}

/**
 * Folders only, loaded one level at a time with the same GET /ls the list
 * uses, so both share one cache entry per folder.
 */
export function FolderTree({ current, onNavigate, loading, empty }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(lineage(current)))
  const [revealed, setRevealed] = useState(current)
  const [collapsedTo, setCollapsedTo] = useState<string | null>(null)

  // Navigation from anywhere (list, address bar, history) reveals the current
  // folder. Adjusted during render instead of in an effect, so the tree never
  // paints one frame with the old expansion.
  if (revealed !== current) {
    setRevealed(current)
    setCollapsedTo(null)
    setExpanded((prev) => {
      const next = new Set(prev)
      // a folder the user just collapsed to stays collapsed
      for (const p of lineage(current)) if (p !== collapsedTo) next.add(p)
      return next
    })
  }

  const toggle = (path: string) => {
    const open = expanded.has(path)
    setExpanded((prev) => {
      const next = new Set(prev)
      if (open) next.delete(path)
      else next.add(path)
      return next
    })
    // collapsing a folder that hides the current one moves the selection to it, as in XP
    if (open && path !== current && isAncestor(path, current)) {
      setCollapsedTo(path)
      onNavigate(path)
    }
  }

  const ctx: Ctx = { current, expanded, toggle, onNavigate }

  return (
    <div className="tree" tabIndex={0}>
      <ul role="tree" aria-label="Pastas">
        {empty ? null : loading ? (
          <TreeItem label={ROOT_LABEL} icon="drive" toggle="collapsed" selected={false} />
        ) : (
          <FolderNode path="/" label={ROOT_LABEL} ctx={ctx} />
        )}
      </ul>
    </div>
  )
}

function FolderNode({ path, label, ctx }: { path: string; label: string; ctx: Ctx }) {
  const isRoot = path === '/'
  // the drive never collapses: its box is only an indicator
  const open = isRoot || ctx.expanded.has(path)

  // disabled while collapsed, but still returns what the cache already knows,
  // so a folder visited through the list stops showing a '+' it does not need
  const query = useQuery({ queryKey: keys.dir(path), queryFn: () => api.ls(path), enabled: open })

  const subfolders = useMemo(
    () =>
      query.data?.entradas
        .filter((e) => e.tipo === 'diretorio')
        .map((e) => e.nome)
        .sort(byName),
    [query.data],
  )

  // /ls does not say whether a folder has subfolders: until it is listed the
  // answer is unknown and the '+' is drawn (build-frontend.md, "O problema do +")
  const toggle: TreeToggle =
    query.isError || subfolders?.length === 0 ? 'leaf' : open ? 'expanded' : 'collapsed'

  const selected = path === ctx.current

  return (
    <TreeItem
      label={label}
      icon={isRoot ? 'drive' : selected ? 'folderOpen' : 'folder'}
      toggle={toggle}
      selected={selected}
      onToggle={isRoot ? undefined : () => ctx.toggle(path)}
      onSelect={() => ctx.onNavigate(path)}
    >
      {open && subfolders && subfolders.length > 0
        ? subfolders.map((name) => (
            <FolderNode key={name} path={joinPath(path, name)} label={name} ctx={ctx} />
          ))
        : undefined}
    </TreeItem>
  )
}
