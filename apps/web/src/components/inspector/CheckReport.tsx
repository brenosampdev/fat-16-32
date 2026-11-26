import { useEffect, useId, useRef, useState } from 'react'

import type { FatEntry } from '../../api'
import { useDiskCheck } from '../../api/queries'
import { DRIVE, formatDateTimeFull } from '../../lib/display'
import { messageOf } from '../../lib/errors'
import { countStates } from '../../lib/inspect'
import { Icon } from '../common/Icon'
import { Modal } from '../dialogs/Modal'

type Props = {
  /** the window's FAT, for the cluster counts of a clean report */
  fat: FatEntry[] | undefined
  onClose: () => void
}

/**
 * What check() in fat_simulator.py walks, in the words of tela 18a. The
 * endpoint answers only {consistente, erros}: the list comes from the code,
 * so a clean report says what was tested and not only "nenhum problema".
 */
const TESTS = [
  'Nenhuma cadeia com ciclo ou apontando para cluster inválido',
  'Nenhum cluster compartilhado entre arquivos',
  'Nenhum cluster ocupado sem dono',
  'Tamanho de cada cadeia compatível com o tamanho registrado',
]

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/**
 * Telas 18a and 18b. POST /disk/check answers 200 even when it finds
 * problems: consistente = false is the result of the check, not an API
 * error, so this is a report with a warning icon, never an error dialog.
 * Each problem is shown as the backend wrote it. There is no Corrigir:
 * the backend only detects.
 */
export function CheckReport({ fat, onClose }: Props) {
  const check = useDiskCheck()
  const textId = useId()
  const [copied, setCopied] = useState<string | null>(null)
  // a report from an earlier opening may sit in the cache: never shown
  const [ran, setRan] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)

  // expensive and on demand: runs when the dialog opens, never in the background
  useEffect(() => {
    void check.refetch().finally(() => setRan(true))
  }, [])

  const running = !ran || check.isFetching
  const data = running ? undefined : check.data
  const error = !running && check.isError ? messageOf(check.error) : null

  const again = () => {
    // not disabled while running: a disabled button drops the focus, and Esc with it
    if (running) return
    setCopied(null)
    void check.refetch()
  }

  const copy = async () => {
    if (!data) return
    const text = [
      `Verificação de consistência: ${DRIVE} (${formatDateTimeFull(Date.now() / 1000)})`,
      `${plural(data.erros.length, 'problema encontrado', 'problemas encontrados')}:`,
      ...data.erros.map((e, i) => `${i + 1}. ${e}`),
    ].join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopied('Relatório copiado para a área de transferência.')
    } catch {
      setCopied('O navegador não permitiu copiar o relatório.')
    }
  }

  let body
  if (running) {
    body = (
      <div className="dialog-text" id={textId}>
        <p>Verificando {DRIVE}…</p>
        <div className="xp-progress" role="progressbar" aria-label="Verificando o disco" />
      </div>
    )
  } else if (error) {
    body = (
      <>
        <Icon name="error" size={32} />
        <div className="dialog-text" id={textId}>
          <p>Não foi possível verificar o disco.</p>
          <p>{error}</p>
        </div>
      </>
    )
  } else if (data?.consistente) {
    const counts = fat ? countStates(fat) : null
    body = (
      <>
        <Icon name="ok" size={32} />
        <div className="dialog-text check-text" id={textId}>
          <p className="check-lead">Nenhum problema encontrado.</p>
          {counts && (
            <fieldset>
              <legend>Clusters na FAT</legend>
              <dl className="facts">
                <dt>Em uso</dt>
                <dd>{counts.usado + counts.fim}</dd>
                <dt>Defeituosos</dt>
                <dd>{counts.defeituoso}</dd>
                <dt>Livres</dt>
                <dd>{counts.livre}</dd>
              </dl>
            </fieldset>
          )}
          <fieldset>
            <legend>Testes</legend>
            <ul className="check-tests">
              {TESTS.map((t) => (
                <li key={t}>
                  <span className="check-mark" aria-hidden="true">
                    ✓
                  </span>
                  {t}
                </li>
              ))}
            </ul>
          </fieldset>
        </div>
      </>
    )
  } else if (data) {
    body = (
      <>
        <Icon name="warning" size={32} />
        <div className="dialog-text check-text" id={textId}>
          <p>
            {plural(data.erros.length, 'problema encontrado', 'problemas encontrados')}. O disco continua
            utilizável; os itens abaixo podem dar leituras incorretas.
          </p>
          <ol className="check-problems" aria-label="Problemas">
            {data.erros.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ol>
          {copied && (
            <p className="muted" role="status">
              {copied}
            </p>
          )}
        </div>
      </>
    )
  }

  return (
    <Modal
      title={`Verificação de consistência: ${DRIVE}`}
      onClose={onClose}
      describedBy={textId}
      initialFocus={closeRef}
      className="check-report"
      buttons={
        <>
          {data && !data.consistente && (
            <button type="button" onClick={() => void copy()}>
              Copiar relatório
            </button>
          )}
          <button type="button" onClick={again} aria-disabled={running}>
            Verificar novamente
          </button>
          <button type="button" ref={closeRef} onClick={onClose}>
            Fechar
          </button>
        </>
      }
    >
      <div className="window-body dialog-body">{body}</div>
    </Modal>
  )
}
