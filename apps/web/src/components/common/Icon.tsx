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

type Props = { name: IconName; size?: number; className?: string }

export function Icon({ name, size = 16, className }: Props) {
  const box = name === 'error' || name === 'warning' ? 32 : name === 'back' || name === 'forward' || name === 'up' ? 20 : 16
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
}
