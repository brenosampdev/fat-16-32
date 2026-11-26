// Pure window-manager rules for the simulated XP desktop. No React here.

export type WindowKind = 'explorer' | 'recycle'
export type Point = { x: number; y: number }
export type Size = { width: number; height: number }
export type Win = {
  id: string
  kind: WindowKind
  title: string
  pos: Point
  z: number
  minimized: boolean
  maximized: boolean
  data?: string
}
export type Desk = { windows: Win[]; activeId: string | null; nextId: number; nextZ: number }
export type DeskAction =
  /** maximized: the new window starts so; a single-instance window already open keeps its state */
  | { type: 'open'; kind: WindowKind; pos: Point; data?: string; maximized?: boolean }
  | { type: 'activate' | 'minimize' | 'toggleMaximize' | 'close' | 'taskbar'; id: string }
  | { type: 'deactivate' }
  | { type: 'move'; id: string; pos: Point }
  | { type: 'retitle'; id: string; title: string }
  | { type: 'clampAll'; viewport: Size }

export const TASKBAR_HEIGHT = 30
export const TITLE_HEIGHT = 28
export const KEEP_VISIBLE = 120

export const SINGLE_INSTANCE: Record<WindowKind, boolean> = { explorer: true, recycle: true }
export const WINDOW_SIZE: Record<WindowKind, Size> = {
  explorer: { width: 860, height: 620 },
  recycle: { width: 420, height: 300 },
}
export const DEFAULT_TITLE: Record<WindowKind, string> = { explorer: 'Simulador FAT', recycle: 'Lixeira' }

export const EMPTY_DESK: Desk = { windows: [], activeId: null, nextId: 1, nextZ: 1 }

/** Non-minimized window with the highest z, or null. */
export function topVisible(desk: Desk): Win | null {
  let top: Win | null = null
  for (const w of desk.windows) if (!w.minimized && (top === null || w.z > top.z)) top = w
  return top
}

/** Only the active, non-minimized window receives keyboard shortcuts. */
export function takesKeys(desk: Desk, id: string): boolean {
  const w = desk.windows.find((x) => x.id === id)
  return desk.activeId === id && !!w && !w.minimized
}

/**
 * The window's fixed size fits the desktop area. One that does not opens
 * maximized, so its bottom (the status bar) is not cut off at the taskbar.
 */
export function fits(kind: WindowKind, viewport: Size): boolean {
  const size = WINDOW_SIZE[kind]
  return viewport.width >= size.width && viewport.height >= size.height
}

export function initialPos(kind: WindowKind, viewport: Size, openCount: number): Point {
  const size = WINDOW_SIZE[kind]
  const offset = kind === 'explorer' ? 0 : 24 * openCount
  return {
    x: Math.max(0, Math.round((viewport.width - size.width) / 2)) + offset,
    y: Math.max(0, Math.round((viewport.height - size.height) / 2)) + offset,
  }
}

/** Keeps the title bar reachable: viewport is the desktop area (above the taskbar). */
export function clampPos(pos: Point, size: Size, viewport: Size): Point {
  return {
    x: Math.min(Math.max(pos.x, KEEP_VISIBLE - size.width), viewport.width - KEEP_VISIBLE),
    y: Math.min(Math.max(pos.y, 0), viewport.height - TITLE_HEIGHT),
  }
}

function patch(desk: Desk, id: string, fn: (w: Win) => Win): Desk {
  return { ...desk, windows: desk.windows.map((w) => (w.id === id ? fn(w) : w)) }
}

function activate(desk: Desk, id: string): Desk {
  if (!desk.windows.some((w) => w.id === id)) return desk
  const z = desk.nextZ
  return { ...patch(desk, id, (w) => ({ ...w, minimized: false, z })), activeId: id, nextZ: z + 1 }
}

function minimize(desk: Desk, id: string): Desk {
  if (!desk.windows.some((w) => w.id === id)) return desk
  const after = patch(desk, id, (w) => ({ ...w, minimized: true }))
  return desk.activeId === id ? { ...after, activeId: topVisible(after)?.id ?? null } : after
}

export function deskReducer(desk: Desk, action: DeskAction): Desk {
  switch (action.type) {
    case 'open': {
      if (SINGLE_INSTANCE[action.kind]) {
        const existing = desk.windows.find((w) => w.kind === action.kind)
        if (existing) return activate(desk, existing.id)
      }
      const win: Win = {
        id: `${action.kind}-${desk.nextId}`,
        kind: action.kind,
        title: DEFAULT_TITLE[action.kind],
        pos: action.pos,
        z: desk.nextZ,
        minimized: false,
        maximized: action.maximized ?? false,
        data: action.data,
      }
      return {
        windows: [...desk.windows, win],
        activeId: win.id,
        nextId: desk.nextId + 1,
        nextZ: desk.nextZ + 1,
      }
    }
    case 'activate':
      return activate(desk, action.id)
    case 'minimize':
      return minimize(desk, action.id)
    case 'taskbar': {
      const w = desk.windows.find((x) => x.id === action.id)
      if (!w) return desk
      return desk.activeId === w.id && !w.minimized ? minimize(desk, w.id) : activate(desk, w.id)
    }
    case 'toggleMaximize':
      return activate(patch(desk, action.id, (w) => ({ ...w, maximized: !w.maximized })), action.id)
    case 'deactivate':
      return { ...desk, activeId: null }
    case 'move':
      return patch(desk, action.id, (w) => (w.maximized ? w : { ...w, pos: action.pos }))
    case 'retitle':
      return patch(desk, action.id, (w) => ({ ...w, title: action.title }))
    case 'close': {
      const after = { ...desk, windows: desk.windows.filter((w) => w.id !== action.id) }
      return desk.activeId === action.id ? { ...after, activeId: topVisible(after)?.id ?? null } : after
    }
    case 'clampAll':
      return {
        ...desk,
        windows: desk.windows.map((w) => ({ ...w, pos: clampPos(w.pos, WINDOW_SIZE[w.kind], action.viewport) })),
      }
  }
}
