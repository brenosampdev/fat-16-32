import { useId, useRef, useState } from 'react'

import type { DiskInfo, Variante } from '../../api'
import { useFormatDisk } from '../../api/queries'
import { formatCount } from '../../lib/content'
import { DRIVE, cls } from '../../lib/display'
import { messageOf } from '../../lib/errors'
import {
  CLUSTER_SIZES,
  DEFAULT_CLUSTER_SIZE,
  DEFAULT_CLUSTERS,
  describeCapacity,
  parseClusterCount,
  planFormat,
} from '../../lib/format'
import type { FormatPlan } from '../../lib/format'
import { Icon } from '../common/Icon'
import { Modal } from './Modal'

type Props = {
  /**
   * Tela 17: no disk is open. The compact form, and no second step: there
   * is nothing to erase. Otherwise tela 08, with Resultado and a warning
   * before anything is sent.
   */
  required: boolean
  /** /disk/format answered 200 with this disk */
  onFormatted: (info: DiskInfo) => void
  onClose: () => void
}

type Step = 'edit' | 'confirm' | 'running'

const VARIANTS: { value: Variante; label: string }[] = [
  { value: 'fat16', label: 'FAT16' },
  { value: 'fat32', label: 'FAT32' },
]

/**
 * The three fields are the endpoint's parameters (variante, cluster_size,
 * num_clusters); everything else is computed as FATDisk.format does it.
 * Formatting is one request: there is no count to show, so the bar only
 * says it is running.
 */
export function FormatDialog({ required, onFormatted, onClose }: Props) {
  const [variante, setVariante] = useState<Variante>('fat16')
  const [clusterSize, setClusterSize] = useState(DEFAULT_CLUSTER_SIZE)
  const [countText, setCountText] = useState(String(DEFAULT_CLUSTERS.fat16))
  /** once the user types a count, switching the variant no longer replaces it */
  const [edited, setEdited] = useState(false)
  const [step, setStep] = useState<Step>('edit')
  const [failure, setFailure] = useState<string | null>(null)
  const format = useFormatDisk()

  const firstRef = useRef<HTMLSelectElement>(null)
  const countRef = useRef<HTMLInputElement>(null)
  const startRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const id = useId()
  const problemId = `${id}-problem`
  const warningId = `${id}-warning`

  const parsed = parseClusterCount(countText)
  const plan = 'value' in parsed ? planFormat(variante, clusterSize, parsed.value) : null
  const problem = 'error' in parsed ? parsed.error : null
  const running = step === 'running'
  const label = variante === 'fat16' ? 'FAT16' : 'FAT32'

  const changeVariante = (v: Variante) => {
    setVariante(v)
    // the default count follows the variant until the user types one (build-frontend.md)
    if (!edited) setCountText(String(DEFAULT_CLUSTERS[v]))
    setFailure(null)
  }

  const run = async () => {
    if (!plan || !('value' in parsed)) return
    // the fields lock while the request runs; keep the focus (and Esc) in the box
    startRef.current?.focus()
    setStep('running')
    setFailure(null)
    try {
      const info = await format.mutateAsync({
        variante,
        cluster_size: clusterSize,
        num_clusters: parsed.value,
      })
      onFormatted(info)
    } catch (e) {
      // the backend detail, as it came; the fields keep what was typed
      setFailure(messageOf(e))
      setStep('edit')
    }
  }

  const start = () => {
    if (running) return
    if (!plan) return countRef.current?.focus()
    // formatting erases the open disk: a second step first, Cancelar focused
    if (required) void run()
    else setStep('confirm')
  }

  const close = () => {
    if (!running) onClose()
  }

  const fields = (
    <fieldset className="format-fields" disabled={running}>
      <label htmlFor={`${id}-fs`} className="fs-label">
        Sistema de arquivos:
      </label>
      <select
        id={`${id}-fs`}
        ref={firstRef}
        className="fs-field"
        value={variante}
        onChange={(e) => changeVariante(e.target.value as Variante)}
      >
        {VARIANTS.map((v) => (
          <option key={v.value} value={v.value}>
            {v.label}
          </option>
        ))}
      </select>
      <label htmlFor={`${id}-cs`} className="cs-label">
        Tamanho do cluster:
      </label>
      <select
        id={`${id}-cs`}
        className="cs-field"
        value={clusterSize}
        onChange={(e) => {
          setClusterSize(Number(e.target.value))
          setFailure(null)
        }}
      >
        {CLUSTER_SIZES.map((cs) => (
          <option key={cs} value={cs}>
            {formatCount(cs)} {required ? 'B' : 'bytes'}
          </option>
        ))}
      </select>
      <label htmlFor={`${id}-n`} className="n-label">
        {required ? 'Nº de clusters:' : 'Número de clusters:'}
      </label>
      <input
        id={`${id}-n`}
        ref={countRef}
        type="text"
        inputMode="numeric"
        value={countText}
        aria-invalid={!!problem}
        aria-describedby={problem ? problemId : undefined}
        className={cls('n-field', problem && 'invalid')}
        spellCheck={false}
        onChange={(e) => {
          setCountText(e.target.value)
          setEdited(true)
          setFailure(null)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            start()
          }
        }}
      />
    </fieldset>
  )

  const capacity = (
    <p className="format-capacity">
      {required ? 'Capacidade: ' : 'Capacidade (calculada): '}
      <span>{plan ? describeCapacity(plan.capacity, required ? 'B' : 'bytes') : '—'}</span>
    </p>
  )

  const messages = (
    <>
      {problem && (
        <p className="format-problem" id={problemId}>
          {problem}
        </p>
      )}
      {failure && (
        <p className="format-problem" role="alert">
          {failure}
        </p>
      )}
      {running && (
        <div className="format-running">
          Formatando {DRIVE}…
          <div className="xp-progress" role="progressbar" aria-label={`Formatando ${DRIVE}`} />
        </div>
      )}
    </>
  )

  return (
    <>
      <Modal
        title={required ? 'Formatar disco' : `Formatar ${DRIVE}`}
        onClose={close}
        initialFocus={firstRef}
        className={cls('format-dialog', required && 'required')}
        buttons={
          <>
            {/* never disabled: start() ignores clicks while running, and a
                disabled button would drop the focus (and Esc with it) */}
            <button type="button" ref={startRef} onClick={start} aria-disabled={running}>
              {required ? 'Formatar' : 'Iniciar'}
            </button>
            <button type="button" onClick={close} aria-disabled={running}>
              {required ? 'Cancelar' : 'Fechar'}
            </button>
          </>
        }
      >
        <div className="window-body format-body">
          {required && (
            <div className="format-lead">
              <Icon name="drive" size={32} />
              <p>Não há disco aberto. Escolha os parâmetros para criar um.</p>
            </div>
          )}
          {fields}
          {capacity}
          {!required && <Result plan={plan} />}
          {messages}
        </div>
      </Modal>

      {step === 'confirm' && plan && (
        <Modal
          title={`Formatar ${DRIVE}`}
          role="alertdialog"
          describedBy={warningId}
          initialFocus={cancelRef}
          onClose={() => setStep('edit')}
          buttons={
            <>
              <button type="button" onClick={() => void run()}>
                Formatar
              </button>
              <button type="button" ref={cancelRef} onClick={() => setStep('edit')}>
                Cancelar
              </button>
            </>
          }
        >
          <div className="window-body dialog-body">
            <Icon name="warning" size={32} />
            <div className="dialog-text" id={warningId}>
              <p>
                Todos os dados de {DRIVE} serão apagados. Os arquivos e pastas atuais não poderão ser
                recuperados.
              </p>
              <p className="muted">
                Novo disco: {label} · {formatCount(plan.last - plan.first + 1)} clusters de{' '}
                {formatCount(clusterSize)} B · {describeCapacity(plan.capacity, 'B')}
              </p>
              <p>Deseja continuar?</p>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}

/** Tela 08's Resultado group, recomputed on every change. */
function Result({ plan }: { plan: FormatPlan | null }) {
  return (
    <fieldset className="format-result">
      <legend>Resultado</legend>
      {plan ? (
        <dl className="facts">
          <dt>Clusters de dados</dt>
          <dd>
            {formatCount(plan.last - plan.first + 1)} ({plan.first}–{formatCount(plan.last)})
          </dd>
          <dt>Tabela FAT</dt>
          <dd>
            1 × {formatCount(plan.fatBytes)} B
            <span className="muted">
              ({formatCount(plan.fatEntries)} entradas de {plan.entrySize} B; 0 e 1 reservadas)
            </span>
          </dd>
          {plan.rootMax !== null ? (
            <>
              <dt>Entradas na raiz</dt>
              <dd>{plan.rootMax} (fixa)</dd>
            </>
          ) : (
            <>
              <dt>Raiz</dt>
              <dd>cadeia a partir do cluster {plan.first}</dd>
            </>
          )}
          <dt>Espaço útil</dt>
          <dd>{formatCount(plan.capacity)} B</dd>
        </dl>
      ) : (
        <p className="muted">Corrija o número de clusters para ver o resultado.</p>
      )}
    </fieldset>
  )
}
