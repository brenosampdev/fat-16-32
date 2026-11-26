import type { ReactNode } from 'react'

import { USANDO_MOCK } from '../../api'

/** Blue XP desktop. Hosts the single Explorer window. */
export function Desktop({ children }: { children: ReactNode }) {
  return (
    <div className="desktop">
      {children}
      {/* dev aid: makes it obvious which backend the screen is talking to */}
      {USANDO_MOCK && <div className="desktop-mock-badge">modo mock</div>}
    </div>
  )
}
