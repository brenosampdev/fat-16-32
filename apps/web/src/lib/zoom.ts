import type { Point, Size } from './windows'

export const ZOOM_STEPS: readonly number[] = [0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]

/** Nearest step strictly beyond z in the given direction; stays put at the ends. */
export function stepZoom(z: number, dir: 1 | -1): number {
  if (dir === 1) {
    const next = ZOOM_STEPS.find((s) => s > z)
    return next ?? ZOOM_STEPS[ZOOM_STEPS.length - 1]
  }
  for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) {
    if (ZOOM_STEPS[i] < z) return ZOOM_STEPS[i]
  }
  return ZOOM_STEPS[0]
}

export function parseZoom(stored: string | null): number {
  if (stored === null) return 1
  const n = Number(stored)
  return ZOOM_STEPS.includes(n) ? n : 1
}

export function formatZoom(z: number): string {
  return `${Math.round(z * 100)}%`
}

/**
 * Where a menu opened at the pointer goes: to the left / upwards when there is
 * no room, as menus do. `at`, `size` and `viewport` are screen px; the result
 * is CSS px for left/top inside a body zoomed by `zoom`.
 */
export function clampMenu(at: Point, size: Size, viewport: Size, zoom: number): Point {
  const x = at.x + size.width > viewport.width ? Math.max(0, at.x - size.width) : at.x
  const y = at.y + size.height > viewport.height ? Math.max(0, at.y - size.height) : at.y
  return { x: x / zoom, y: y / zoom }
}
