import { TooltipLayer } from './components/desktop/TooltipLayer'
import { Session } from './components/session/Session'

export function App() {
  return (
    <div className="xp">
      <Session />
      {/* outside the session: the tips cover every screen, above all of it */}
      <TooltipLayer />
    </div>
  )
}
