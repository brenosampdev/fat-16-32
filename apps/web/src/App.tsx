import { Explorer } from './components/explorer/Explorer'
import { Desktop } from './components/shell/Desktop'

export function App() {
  return (
    <div className="xp">
      <Desktop>
        <Explorer />
      </Desktop>
    </div>
  )
}
