import { usePref } from '../../hooks/usePref'
import { zoomPref } from '../../lib/prefs'
import { formatZoom } from '../../lib/zoom'
import { AppWindow } from '../shell/AppWindow'
import { StatusBar } from '../shell/StatusBar'

/**
 * Always empty, and says why: the API has no recycle bin, a deletion frees
 * the clusters at once (spec, "Lixeira").
 */
export function RecycleBin() {
  const [zoom] = usePref(zoomPref)
  return (
    <AppWindow title="Lixeira" icon="recycle">
      <div className="recycle-list">
        <p className="recycle-empty">A Lixeira está vazia.</p>
        <p className="recycle-note">
          No simulador, excluir libera os clusters na hora: nada passa pela Lixeira.
        </p>
      </div>
      <StatusBar main="0 objetos" zoom={zoom !== 1 ? `Zoom: ${formatZoom(zoom)}` : undefined} />
    </AppWindow>
  )
}
