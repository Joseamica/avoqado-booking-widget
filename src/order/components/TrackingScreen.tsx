import { h } from 'preact'
import { useContext, useEffect, useId, useRef, useState } from 'preact/hooks'
import { ApiError, cancelOrder, getTracking } from '../api'
import { formatTime } from '../hours'
import { createOrderT } from '../i18n'
import { formatMXN } from '../money'
import { clearLastOrder } from '../session'
import { OrderStoreContext } from '../store'
import { isFinalStatus, type OnlineOrderStatus, type Tracking } from '../types'
import { Notice, type NoticeIcon } from './StoreStatusBanner'
import { VenueMark } from './VenueMark'
import { optionsText } from './lineOptions'

const POLL_MS = 10_000
/** Los 4 pasos del avance, en orden. Rechazado, vencido y cancelado no tienen paso: ahí no se pinta el avance. */
const STEPS = ['received', 'preparing', 'ready', 'completed'] as const
const STEP_OF: Partial<Record<OnlineOrderStatus, number>> = { PENDING_ACCEPTANCE: 0, ACCEPTED: 1, READY: 2, COMPLETED: 3 }

// Íconos de «Cómo llegar» y «Llamar» (de la maqueta; sólo se usan aquí).
const Pin = () => (
  <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 21s-7-6.1-7-11a7 7 0 0 1 14 0c0 4.9-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" />
  </svg>
)
const Phone = () => (
  <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />
  </svg>
)

/**
 * Seguimiento del pedido. No usa `/info` ni `/menu` (el plan puede haber vencido): todo sale de la respuesta del seguimiento (el logo,
 * si `/info` cargó). Lleva su propio encabezado chico, el titular del estado con su línea de hora, el avance en 4 pasos, el ticket con
 * el folio enorme y los renglones SIN importe (spec §11.2: no cuadraría con cortesías ni descuentos), «Dónde recoger», cancelar y
 * «Pedir algo más».
 */
export function TrackingScreen() {
  const store = useContext(OrderStoreContext)!
  const t = createOrderT(store.locale)
  const whereId = useId()
  const token = store.trackingToken.value
  const [tracking, setTracking] = useState<Tracking | null>(null)
  /** Llave del aviso de la última consulta fallida: sin red, o el servidor falló (no es lo mismo). */
  const [problem, setProblem] = useState<string | null>(null)
  const [gone, setGone] = useState(false)
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [cancelMsg, setCancelMsg] = useState<{ text: string; tone: 'neutral' | 'warn' | 'error'; icon?: NoticeIcon } | null>(null)
  const refresh = useRef<() => Promise<void>>(async () => {})
  const cancelling = useRef(false)
  const cancelBtn = useRef<HTMLButtonElement>(null)
  const noBtn = useRef<HTMLButtonElement>(null)
  const wasAsking = useRef(false)

  useEffect(() => {
    if (!token) return
    let stopped = false
    let finished = false
    let inflight = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const run = async () => {
      if (timer) clearTimeout(timer)
      timer = null
      if (stopped || finished || inflight || document.visibilityState !== 'visible') return
      inflight = true
      try {
        const r = await getTracking(store.slug, token)
        if (stopped) return
        setTracking(r)
        setProblem(null)
        if (isFinalStatus(r.status)) finished = true
      } catch (e) {
        if (stopped) return
        if (e instanceof ApiError && e.status === 404) {
          finished = true
          setGone(true)
          clearLastOrder(store.slug)
        } else setProblem(e instanceof ApiError && e.network ? 'store.reconnecting' : 'tracking.updateFailed')
      } finally {
        inflight = false
      }
      if (!stopped && !finished) timer = setTimeout(() => void run(), POLL_MS)
    }
    refresh.current = run
    const onVisible = () => void run()
    document.addEventListener('visibilitychange', onVisible)
    void run()
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [store, token])

  // El foco sigue a la confirmación: al abrirla va a «No» (el botón que no hace nada); al cerrarse vuelve a «Cancelar pedido», que
  // regresa a su lugar (si el pedido ya no se puede cancelar, ese botón no está y no se mueve nada). Al cargar la pantalla no se toca.
  useEffect(() => {
    if (asking) noBtn.current?.focus()
    else if (wasAsking.current) cancelBtn.current?.focus()
    wasAsking.current = asking
  }, [asking])

  // De vuelta a la carta (el aviso «Tienes un pedido en curso · Ver» de OrderApp regresa aquí).
  const orderMore = (
    <div class="avq-o-track__more">
      <button type="button" class="avq-o-btn avq-o-btn--neutral" onClick={() => { store.trackingToken.value = null; store.go('menu') }}>
        {t('tracking.orderMore')}
      </button>
    </div>
  )
  // Sin red, o el servidor falló, mientras se reintenta solo: es un estado normal (ámbar), nunca un error en rojo.
  const problemNotice = problem && <Notice tone="warn" icon={problem === 'store.reconnecting' ? 'cloudOff' : undefined} text={t(problem)} />
  if (gone) return <div class="avq-o-track"><Notice tone="neutral" text={t('tracking.notFound')} />{orderMore}</div>
  if (!tracking)
    return problemNotice ? <div class="avq-o-track">{problemNotice}{orderMore}</div> : <p role="status" class="avq-o-empty">{t('tracking.loading')}</p>

  const tz = tracking.venueTimezone ?? store.info.value?.venue.timezone ?? 'America/Mexico_City'
  const time = (iso: string) => formatTime(iso, tz, store.locale)
  const step = STEP_OF[tracking.status]
  // Algo que recoger: esperando, en preparación o listo. Un estado que la tienda no conoce no se da por confirmado.
  const toPickUp = step !== undefined && tracking.status !== 'COMPLETED'
  // Titular y su línea de hora; rechazado, vencido y cancelado dicen su frase de hoy, sin línea. Un estado nuevo del servidor, uno
  // neutro (y el sondeo sigue: no es final).
  const [head, sub] = ((): [string, string | null] => {
    switch (tracking.status) {
      case 'PENDING_ACCEPTANCE': return [t('tracking.head.PENDING_ACCEPTANCE'), t('tracking.sub.waiting', { time: time(tracking.acceptDeadlineAt) })]
      case 'ACCEPTED':
        return [t('tracking.head.ACCEPTED'), tracking.estimatedReadyAt ? t('tracking.sub.eta', { time: time(tracking.estimatedReadyAt) }) : null]
      case 'READY': return [t('tracking.head.READY'), t('tracking.sub.ready')]
      case 'COMPLETED': return [t('tracking.head.COMPLETED'), t('tracking.sub.completed')]
      case 'REJECTED':
        return [tracking.rejectReason ? t('tracking.rejected', { reason: t(`tracking.reason.${tracking.rejectReason}`) }) : t('tracking.rejectedNoReason'), null]
      case 'EXPIRED': return [t('tracking.expired'), null]
      case 'CANCELLED_BY_CUSTOMER': return [t('tracking.cancelledByCustomer'), null]
      case 'CANCELLED_BY_STAFF': return [t('tracking.cancelledByStaff'), null]
      default: return [t('tracking.head.unknown'), null]
    }
  })()
  // Sin cobro, «Pagas al recoger» sólo en curso o entregado (la regla de hoy): no en cancelado, rechazado, vencido ni un estado nuevo.
  const pay = tracking.paid ? t('tracking.paid') : step !== undefined ? t('cart.taxPickup') : null

  async function doCancel() {
    if (cancelling.current || !token) return
    cancelling.current = true
    setBusy(true)
    setCancelMsg(null)
    try {
      await cancelOrder(store.slug, token)
    } catch (e) {
      const code = e instanceof ApiError ? e.code : undefined
      if (code === 'ORDER_STATE_CHANGED') setCancelMsg({ text: t('tracking.stateChanged'), tone: 'neutral' })
      else if (code === 'ORDER_HAS_PAYMENTS') setCancelMsg({ text: t('tracking.hasPayments'), tone: 'neutral' })
      else if (e instanceof ApiError && e.network) setCancelMsg({ text: t('common.offline'), tone: 'warn', icon: 'cloudOff' })
      else setCancelMsg({ text: t('checkout.failed'), tone: 'error', icon: 'alert' })
    } finally {
      cancelling.current = false
      setBusy(false)
      setAsking(false)
    }
    await refresh.current()
  }

  const contact = tracking.venueContact
  return (
    <div class="avq-o-track">
      <header class="avq-o-head">
        <VenueMark small name={tracking.venueName} />
        <span class="avq-o-head__name">{tracking.venueName}</span>
      </header>
      {problemNotice}
      {/* Un cambio de estado se anuncia (como la frase de hoy, que era `role="status"`). */}
      <div class="avq-o-track__intro" role="status">
        <h2 class="avq-o-title">{head}</h2>
        {sub && <p>{sub}</p>}
      </div>
      {step !== undefined && (
        <ol class="avq-o-steps" role="list" aria-label={t('tracking.progress')}>
          {STEPS.map((k, i) => (
            <li key={k} class={i <= step ? 'avq-o-step avq-o-step--done' : 'avq-o-step'} aria-current={i === step ? 'step' : undefined}>
              {t(`tracking.steps.${k}`)}
            </li>
          ))}
        </ol>
      )}
      <div class="avq-o-ticket">
        <div class="avq-o-ticket__folio">
          <span class="avq-o-ticket__label">{t('tracking.folioLabel')}</span>
          <span class="avq-o-ticket__n">{tracking.orderNumber}</span>
          {toPickUp && <span class="avq-o-ticket__say">{t('tracking.sayAtCounter')}</span>}
        </div>
        <div class="avq-o-ticket__tear" aria-hidden="true" />
        <div class="avq-o-ticket__body">
          <ul class="avq-o-ticket__lines" role="list">
            {tracking.items.map((it, i) => {
              const options = optionsText(it.modifiers)
              return (
                <li key={i}>
                  <span>{it.quantity} × {it.name}</span>
                  {options && <span class="avq-o-ticket__sub">{options}</span>}
                  {it.note && <span class="avq-o-ticket__sub">{it.note}</span>}
                </li>
              )
            })}
          </ul>
          <div class="avq-o-ticket__sum">
            <p class="avq-o-total__row"><span>{t('cart.totalShort')}</span><span>{formatMXN(tracking.total, store.locale)}</span></p>
            {pay && <p class="avq-o-total__tax">{pay}</p>}
          </div>
        </div>
      </div>
      {(contact?.address || contact?.phone) && (
        <section class="avq-o-where" aria-labelledby={whereId}>
          <h3 id={whereId} class="avq-o-where__title">{t('tracking.whereTitle')}</h3>
          {contact.address && <p>{contact.address}</p>}
          {/* El número también a la vista: en una computadora el «Llamar» no marca. */}
          {contact.phone && <p>{contact.phone}</p>}
          <div class="avq-o-where__actions">
            {contact.address && (
              <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(contact.address)}`} target="_blank" rel="noopener noreferrer">
                <Pin />{t('tracking.directions')}
              </a>
            )}
            {contact.phone && <a href={`tel:${contact.phone.replace(/[^\d+]/g, '')}`}><Phone />{t('tracking.call')}</a>}
          </div>
        </section>
      )}
      {(cancelMsg || tracking.canCancel) && (
        <div class="avq-o-track__cancel">
          {cancelMsg && <Notice tone={cancelMsg.tone} icon={cancelMsg.icon} text={cancelMsg.text} />}
          {tracking.canCancel && !asking && (
            <button ref={cancelBtn} type="button" class="avq-o-btn avq-o-btn--quiet" onClick={() => { setCancelMsg(null); setAsking(true) }}>{t('tracking.cancel')}</button>
          )}
          {/* La pantalla no tiene acción principal (§5.6): los dos botones pesan igual y el acento no «recomienda» cancelar. */}
          {tracking.canCancel && asking && (
            <div role="group" aria-label={t('tracking.cancelAsk')} class="avq-o-track__ask">
              <p>{t('tracking.cancelAsk')}</p>
              <div>
                <button type="button" class="avq-o-btn avq-o-btn--neutral" disabled={busy} onClick={() => void doCancel()}>{busy ? t('tracking.cancelling') : t('tracking.cancelYes')}</button>
                <button ref={noBtn} type="button" class="avq-o-btn avq-o-btn--neutral" disabled={busy} onClick={() => setAsking(false)}>{t('tracking.cancelNo')}</button>
              </div>
            </div>
          )}
        </div>
      )}
      {orderMore}
    </div>
  )
}
