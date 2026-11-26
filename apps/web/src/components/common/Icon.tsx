// Hand-drawn SVG icons with an XP feel. Original artwork, no Microsoft assets.
// Flat fills only (no gradients) so repeated instances never clash on ids.

import type { ReactElement } from 'react'

export type IconName =
  | 'folder'
  | 'folderOpen'
  | 'file'
  | 'drive'
  | 'back'
  | 'forward'
  | 'up'
  | 'go'
  | 'error'
  | 'warning'
  | 'ok'
  | 'computer'
  | 'recycle'
  | 'user'
  | 'logoff'
  | 'shutdown'
  | 'start'
  | 'speaker'
  | 'speakerOff'
  | 'mock'

type Props = { name: IconName; size?: number; className?: string }

/** The grid each shape was drawn on; `size` scales it. */
const BOX: Record<IconName, number> = {
  folder: 16,
  folderOpen: 16,
  file: 16,
  drive: 16,
  go: 16,
  back: 20,
  forward: 20,
  up: 20,
  error: 32,
  warning: 32,
  ok: 32,
  computer: 32,
  recycle: 32,
  user: 32,
  logoff: 32,
  shutdown: 32,
  start: 16,
  speaker: 16,
  speakerOff: 16,
  mock: 16,
}

export function Icon({ name, size = 16, className }: Props) {
  const box = BOX[name]
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox={`0 0 ${box} ${box}`}
      aria-hidden="true"
      focusable="false"
    >
      {SHAPES[name]}
    </svg>
  )
}

const SHAPES: Record<IconName, ReactElement> = {
  folder: (
    <>
      <path d="M1.5 3.5h4.6l1.4 1.5h7v8.5h-13z" fill="#e2b043" stroke="#a87b1c" />
      <path d="M1.5 6.5h13v7h-13z" fill="#f7d774" stroke="#a87b1c" />
      <path d="M2.5 7.5h11" stroke="#fff3c4" />
    </>
  ),
  folderOpen: (
    <>
      <path d="M1.5 3.5h4.6l1.4 1.5h6v8.5h-12z" fill="#e2b043" stroke="#a87b1c" />
      <path d="M3.5 7.5h12l-2.5 6h-11.5z" fill="#f7d774" stroke="#a87b1c" />
    </>
  ),
  file: (
    <>
      <path d="M3.5 1.5h6l3 3v10h-9z" fill="#fff" stroke="#7b8796" />
      <path d="M9.5 1.5v3h3" fill="#dfe5ec" stroke="#7b8796" />
      <path d="M5 7.5h6M5 9.5h6M5 11.5h4" stroke="#9fb3cc" />
    </>
  ),
  // A: is a floppy drive
  drive: (
    <>
      <path d="M1.5 1.5h11l2 2v11h-13z" fill="#4b5d82" stroke="#23304d" />
      <path d="M4.5 1.5h6v4h-6z" fill="#cfd4db" stroke="#23304d" />
      <path d="M8 2.5h1.5v2H8z" fill="#4b5d82" />
      <path d="M3.5 8.5h9v6h-9z" fill="#fff" />
      <path d="M5 10.5h6M5 12.5h6" stroke="#b9c3d3" />
    </>
  ),
  back: (
    <>
      <circle cx="10" cy="10" r="8.5" fill="#3fa53a" stroke="#1d6b19" />
      <path d="M4.5 10 10 4.8v3.4h5.2v3.6H10v3.4z" fill="#fff" />
    </>
  ),
  forward: (
    <>
      <circle cx="10" cy="10" r="8.5" fill="#3fa53a" stroke="#1d6b19" />
      <path d="M15.5 10 10 4.8v3.4H4.8v3.6H10v3.4z" fill="#fff" />
    </>
  ),
  up: (
    <>
      <path d="M1.5 5.5h5l1.5 1.5h8.5v10.5h-15z" fill="#e2b043" stroke="#a87b1c" />
      <path d="M1.5 8.5h15v9h-15z" fill="#f7d774" stroke="#a87b1c" />
      <path d="M9 18V11H6.2L10.5 6l4.3 5H12v7z" fill="#3fa53a" stroke="#1d6b19" />
    </>
  ),
  go: (
    <>
      <rect x="1.5" y="1.5" width="13" height="13" rx="2" fill="#3fa53a" stroke="#1d6b19" />
      <path d="M12.5 8 8 3.8v2.7H3.8v3H8v2.7z" fill="#fff" />
    </>
  ),
  error: (
    <>
      <circle cx="16" cy="16" r="13.5" fill="#d8321f" stroke="#8a1a0e" />
      <path d="M10.5 10.5l11 11m0-11-11 11" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" />
    </>
  ),
  warning: (
    <>
      <path d="M16 2.5 30 28.5H2z" fill="#f6c736" stroke="#9a7208" strokeLinejoin="round" />
      <path d="M16 10.5v10" stroke="#222" strokeWidth="3.4" strokeLinecap="round" />
      <circle cx="16" cy="24.6" r="1.9" fill="#222" />
    </>
  ),
  ok: (
    <>
      <circle cx="16" cy="16" r="13.5" fill="#3fa53a" stroke="#1d6b19" />
      <path d="M9.5 16.5l4.5 4.5 8.5-9" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  // beige monitor and tower; the screen shows a hill, like the wallpaper
  computer: (
    <>
      <path d="M24.5 6.5h6v21h-6z" fill="#ddd6c1" stroke="#6f6a5c" />
      <path d="M26 9.5h3M26 11.5h3" stroke="#8d8774" />
      <path d="M26 24h1.5v1.5H26z" fill="#3fa53a" />
      <rect x="1.5" y="3.5" width="22" height="17" rx="1.5" fill="#ece7d8" stroke="#6f6a5c" />
      <path d="M4.5 6.5h16v11h-16z" fill="#3a7fe0" stroke="#33415c" />
      <path d="M5 17v-2.2c3.5-2.6 9-3.2 15-1.3V17z" fill="#55b23c" />
      <path d="M5 7h6l-4 6H5z" fill="#fff" opacity=".3" />
      <path d="M10.5 20.5h4v3h-4z" fill="#d3ccb7" stroke="#6f6a5c" />
      <path d="M6.5 23.5h12l1.5 3h-15z" fill="#ece7d8" stroke="#6f6a5c" strokeLinejoin="round" />
    </>
  ),
  // a ribbed basket with three chasing arrows
  recycle: (
    <>
      <path d="M6.5 8.5h19l-2 20h-15z" fill="#e3ebf4" stroke="#5b6f8a" strokeLinejoin="round" />
      <path d="M11 10.5l.8 16.5M16 10.5v16.5M21 10.5l-.8 16.5" stroke="#b5c4d8" />
      <path d="M8.6 10.5l1.7 16.5" stroke="#fff" />
      <rect x="5.5" y="6.5" width="21" height="3" rx="1.5" fill="#c9d6e6" stroke="#5b6f8a" />
      <path d="M16.97 14.15 19.9 19.1M20.55 23.5H14.7M10.47 21.85 13.4 16.9" stroke="#2a9a2e" strokeWidth="2.2" />
      <path d="M21.5 21.85 18 20.2l3.8-2.2zM11.45 23.5l3.25-2.2v4.4zM15 14.15l.3 3.85-3.8-2.2z" fill="#2a9a2e" />
    </>
  ),
  // the user's picture in a white frame, as on the Start menu
  user: (
    <>
      <rect x="2.5" y="2.5" width="27" height="27" rx="3" fill="#fff" stroke="#8aa4cf" />
      <path d="M5 5h22v22H5z" fill="#8cc4f2" />
      <path d="M7 27c0-5.6 4-8.6 9-8.6s9 3 9 8.6z" fill="#e07b28" stroke="#9a4f12" />
      <circle cx="16" cy="13" r="4.5" fill="#f2c9a0" stroke="#a7764d" />
      <path d="M11.5 12.5c0-3.4 2-5.4 4.5-5.4s4.5 2 4.5 5.4c-1-1.4-2.5-2.2-4.5-2.2s-3.5.8-4.5 2.2z" fill="#6b4426" />
    </>
  ),
  // an arrow walking out of a door
  logoff: (
    <>
      <rect x="2.5" y="2.5" width="27" height="27" rx="4" fill="#e9a23b" stroke="#9a5d0c" />
      <path d="M4 5.5c0-.8.7-1.5 1.5-1.5h21c.8 0 1.5.7 1.5 1.5V12H4z" fill="#f3c068" />
      <path d="M13.5 9.5h-4v13h4" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinejoin="round" />
      <path d="M13.5 16h7" stroke="#fff" strokeWidth="2.6" />
      <path d="M19.5 11.2 25 16l-5.5 4.8z" fill="#fff" />
    </>
  ),
  // the standard power symbol
  shutdown: (
    <>
      <rect x="2.5" y="2.5" width="27" height="27" rx="4" fill="#d8321f" stroke="#8a1a0e" />
      <path d="M4 5.5c0-.8.7-1.5 1.5-1.5h21c.8 0 1.5.7 1.5 1.5V12H4z" fill="#e8604f" />
      <path d="M11.4 10.8a7 7 0 1 0 9.2 0" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M16 7.5v8" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
    </>
  ),
  // our own emblem for the Start button: a green hill under a blue sky
  start: (
    <>
      <circle cx="8" cy="8" r="6.5" fill="#4d9be8" />
      <path d="M1.8 9.95C3.5 7.6 6.5 6.9 9 7.6s3.8 1.4 5.3 2A6.5 6.5 0 0 1 1.8 9.95z" fill="#47b02c" />
      <circle cx="5.5" cy="5" r="1.4" fill="#fff" opacity=".55" />
      <circle cx="8" cy="8" r="6.5" fill="none" stroke="#fff" strokeWidth="1.4" />
    </>
  ),
  speaker: (
    <>
      <path d="M2.5 5.5h3l3.5-3v11l-3.5-3h-3z" fill="#e7ebf1" stroke="#22365c" strokeLinejoin="round" />
      <path d="M11 5.5c.9.7 1.4 1.6 1.4 2.5s-.5 1.8-1.4 2.5M12.6 3.4c1.5 1.3 2.3 2.8 2.3 4.6s-.8 3.3-2.3 4.6" fill="none" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" />
    </>
  ),
  speakerOff: (
    <>
      <path d="M2.5 5.5h3l3.5-3v11l-3.5-3h-3z" fill="#e7ebf1" stroke="#22365c" strokeLinejoin="round" />
      <circle cx="11.5" cy="11.5" r="3.6" fill="#fff" stroke="#d8321f" strokeWidth="1.5" />
      <path d="M9 9l5 5" stroke="#d8321f" strokeWidth="1.5" />
    </>
  ),
  // the mock keeps its data in the browser: a small database drum
  mock: (
    <>
      <path d="M3.5 4v8c0 1.4 2 2.5 4.5 2.5s4.5-1.1 4.5-2.5V4z" fill="#f6c736" stroke="#8a6508" />
      <path d="M3.5 8c0 1.4 2 2.5 4.5 2.5s4.5-1.1 4.5-2.5" fill="none" stroke="#8a6508" />
      <ellipse cx="8" cy="4" rx="4.5" ry="2" fill="#fbe08a" stroke="#8a6508" />
    </>
  ),
}
