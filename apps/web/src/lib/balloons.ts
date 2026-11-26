// Tray balloons. No React here, so smoke.ts can import it.

import type { DiskCheck, DiskInfo } from '../api'
import { formatCount } from './content'

export type BalloonInput = { title: string; text: string; icon: 'ok' | 'warning' | 'drive' }

/** After /disk/format: the variant and the free clusters of the disk it returned. */
export function formattedBalloon(info: DiskInfo): BalloonInput {
  return {
    title: 'Disco formatado',
    text: `${info.variante} · ${formatCount(info.clustersLivres)} clusters livres`,
    icon: 'drive',
  }
}

/** After /disk/check: the report still opens; this is the extra word from the tray. */
export function checkBalloon(r: DiskCheck): BalloonInput {
  const n = r.erros.length
  let text
  if (r.consistente) text = 'Nenhum problema encontrado.'
  else if (n === 1) text = '1 problema encontrado.'
  else text = `${n} problemas encontrados.`
  return { title: 'Verificação concluída', text, icon: r.consistente ? 'ok' : 'warning' }
}
