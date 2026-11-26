import type { WindowKind } from '../../lib/windows'
import type { IconName } from '../common/Icon'

// A plain module, not a component file: react-refresh hot-swaps a file that
// exports only components, and reloads the page for one that exports more.

/** The icon each kind of window shows on its taskbar button. */
export const KIND_ICON: Record<WindowKind, IconName> = {
  explorer: 'folderOpen',
  recycle: 'recycle',
}
