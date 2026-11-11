import { h } from 'preact'
import { useContext, useEffect, useId, useRef, useState } from 'preact/hooks'
import { ApiError, abandonPayment, cancelOrder, getTracking } from '../api'
import { errorText } from '../checkout'
import { avisarSiCambio } from '../events'
import { formatTime } from '../hours'
import { createOrderT } from '../i18n'
import { formatMXN } from '../money'
import { abandonPending, clearAbandon, clearLastOrder, loadLastOrder, markAbandon } from '../session'
import { OrderStoreContext } from '../store'
import { isFinalStatus, type OnlineOrderStatus, type Tracking } from '../types'
import { focusLost } from './focus'
import { Notice, type NoticeIcon } from './StoreStatusBanner'
import { VenueMark } from './VenueMark'
import { optionsText } from './lineOptions'

const POLL_MS = 10_000
/** Los 4 pasos del avance, en orden. Rechazado, vencido y cancelado no tienen paso: ahí no se pinta el avance. */
const STEPS = ['received', 'preparing', 'ready', 'completed'] as const
const STEP_OF: Partial<Record<OnlineOrderStatus, number>> = { PENDING_ACCEPTANCE: 0, ACCEPTED: 1, READY: 2, COMPLETED: 3 }
/** Cerrado sin entregar (también el borrador de tarjeta que no se pagó): ahí la línea del dinero dice qué pasó con la tarjeta. */
const CLOSED: ReadonlySet<OnlineOrderStatus> = new Set(['REJECTED', 'EXPIRED', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_STAFF', 'PAYMENT_NOT_COMPLETED'])
/** Fase 2: un pedido final cuyo dinero sigue en duda (apartado, cobrándose o liberándose) se sigue sondeando (Codex plan r1 #3). */
const MONEY_IN_DOUBT: ReadonlySet<string> = new Set(['AUTHORIZED', 'CONFIRMING', 'RELEASING'])
/** Un folio de «Nadie» vencido se sigue consultando 2 h después de su hora: un efectivo registrado tarde lo pasa a «PAGADO». */
const LATE_MONEY_MS = 2 * 60 * 60_000
const isFolioOf = (r: Tracking) => r.requiresAcceptance === false && r.paymentMode !== 'CARD_ONLINE'
/** Un folio vencido o cancelado sin dinero sigue en la ventana de 2 h: el menú lo recuerda y el seguimiento lo consulta. */
const LAPSED: ReadonlySet<OnlineOrderStatus> = new Set(['EXPIRED', 'CANCELLED_BY_STAFF', 'CANCELLED_BY_CUSTOMER'])
export const isLapsedFolio = (r: Tracking) => isFolioOf(r) && LAPSED.has(r.status)
/** Con dinero el servidor lo revive (ACCEPTED, luego READY/COMPLETED): se sigue hasta 24 h. */
/** Un vencido o cancelado que dice `paid` y nunca se revive deja de consultarse a las 24 h (Wc1-m1). */
const CANCELLED_PAID_MS = 24 * 60 * 60_000
export const lateWindowOpen = (r: Tracking) => {
  if (!isLapsedFolio(r)) return false
  // Con dinero el servidor lo revive en ~30 s; si en 24 h no lo hizo, ya no se espera más (ni se recuerda en el menú).
  return Date.now() < Date.parse(r.acceptDeadlineAt) + (r.paid ? CANCELLED_PAID_MS : LATE_MONEY_MS)
}
const done = (r: Tracking) => isFinalStatus(r.status) && !MONEY_IN_DOUBT.has(r.cardStatus ?? '') && !lateWindowOpen(r)
const FOLIO_STEPS = ['order', 'paid', 'ready', 'completed'] as const
const FOLIO_PAID: ReadonlySet<OnlineOrderStatus> = new Set(['ACCEPTED', 'READY', 'COMPLETED'])
const FOLIO_VOID: ReadonlySet<OnlineOrderStatus> = new Set(['CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_STAFF', 'REJECTED', 'PAYMENT_NOT_COMPLETED'])
/** Abono sin pagar del todo (R18): la cuenta no vence, así que no hay cuenta regresiva ni «se cancela solo». */
export const partialOf = (r: Tracking) => isFolioOf(r) && r.status === 'PENDING_ACCEPTANCE' && !r.paid && (r.amountPaid ?? 0) > 0 && r.remaining != null
export const partialLine = (r: Tracking, t: ReturnType<typeof createOrderT>, locale: 'es' | 'en') =>
  t('tracking.folio.partial', { paid: formatMXN(r.amountPaid ?? 0, locale), left: formatMXN(r.remaining ?? 0, locale) })
const folioPaidOf = (r: Tracking) => isFolioOf(r) && !FOLIO_VOID.has(r.status) && (r.paid || FOLIO_PAID.has(r.status))

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
 * «Pedir algo más». Fase 2 (tarjeta): el borrador «Confirmando tu pago…» (sin folio), el pago no completado, la línea del dinero según
 * `cardStatus`, y el regreso de Stripe: con `?pago=cancelado` primero se avisa al servidor (`abandon-payment`, nunca `cancel`).
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
  const titleRef = useRef<HTMLHeadingElement>(null)
  /** «No» cerró la confirmación (y no un intento de cancelar): sólo entonces el foco vuelve a «Cancelar pedido» al cerrarse. */
  const closedByNo = useRef(false)
  /** Cuenta los intentos de cancelar ya resueltos y con la vista refrescada (ver el efecto de abajo). */
  const [settled, setSettled] = useState(0)
  // De regreso de Stripe: se lee UNA vez y se borra de la tienda, así volver a esta pantalla no repite nada. Un abandono que quedó
  // pendiente (falló y se recargó la pestaña) también arranca cancelando (fix ronda 1).
  const [entry] = useState(() => {
    const ret = store.paymentReturn
    store.paymentReturn = null
    return { ret, cancel: ret === 'cancelled' || (!!token && abandonPending(token)) }
  })
  /** «Cancelando el pago…» hasta que el servidor confirma el abandono; sin red o con un 5xx sigue así, con «Reintentar». */
  const [abandoning, setAbandoning] = useState(entry.cancel)
  const [abandonError, setAbandonError] = useState<string | null>(null)
  const retryAbandon = useRef<() => void>(() => {})
  /** «Cancelar el pago» del borrador (volvió de Stripe con «atrás», sin `?pago`): el mismo abandono. */
  const startAbandon = useRef<() => void>(() => {})

  useEffect(() => {
    if (!token) return
    let stopped = false
    let finished = false
    let inflight = false // una consulta del seguimiento
    let sending = false // un abandono
    /** Sube con cada abandono: una consulta que salió antes ya no pinta nada (llegaría con el borrador vivo). */
    let epoch = 0
    // Mientras no se confirme el abandono del pago, el sondeo no corre (diría «Confirmando tu pago…» del borrador vivo).
    let cancelling = entry.cancel
    let timer: ReturnType<typeof setTimeout> | null = null
    // Un solo temporizador: si ya hay uno agendado, se respeta.
    const later = () => { if (!stopped && !finished && !cancelling && !timer) timer = setTimeout(() => void run(), POLL_MS) }
    let lastValid: Tracking | null = null // la última respuesta buena: con ella se vigila el tope aunque las lecturas fallen
    const apply = (r: Tracking) => {
      avisarSiCambio(store.host, store.slug, token, lastValid, r) // W4: «Mi cuenta» se vuelve a leer
      lastValid = r
      setTracking(r)
      setProblem(null)
      if (done(r)) finished = true
    }
    const vanish = () => {
      finished = true
      setGone(true)
      clearLastOrder(store.slug)
    }
    const run = async () => {
      if (timer) clearTimeout(timer)
      timer = null
      if (stopped || finished || cancelling || document.visibilityState !== 'visible') return
      // El tope de 24 h se evalúa ANTES de cada lectura, con la última respuesta buena: sin red o con 5xx nunca llegaría otra.
      if (lastValid && done(lastValid)) { finished = true; return }
      // Una consulta vieja sigue en camino (salió antes de un abandono, o la red va lenta): se intenta en el siguiente tick, nunca se
      // deja el sondeo parado (fix ronda 2).
      if (inflight) return later()
      inflight = true
      const mine = epoch
      try {
        const r = await getTracking(store.slug, token)
        // Salió antes de un abandono: no pinta nada (traería el borrador vivo), pero el sondeo sigue (`later` de abajo).
        if (!stopped && mine === epoch) apply(r)
      } catch (e) {
        if (stopped || mine !== epoch) {
          /* respuesta vieja: se descarta */
        } else if (e instanceof ApiError && e.status === 404) vanish()
        else setProblem(e instanceof ApiError && e.network ? 'store.reconnecting' : 'tracking.updateFailed')
      } finally {
        inflight = false
      }
      later()
    }
    // `?pago=cancelado`: el servidor nunca cancela un pedido aquí; responde el borrador no completado, o el pedido si ya se pagó.
    const abandon = async () => {
      if (stopped || sending) return
      sending = true
      epoch++
      if (timer) clearTimeout(timer)
      timer = null
      // La intención se guarda ANTES de llamar, sólo en sessionStorage y por pedido (fix ronda 3: el widget nunca toca la URL): si la
      // respuesta se pierde y se recarga, la vista nueva de ESTE pedido vuelve a intentarlo. Sin almacenamiento queda «Cancelar el pago».
      markAbandon(token)
      setAbandonError(null)
      try {
        const r = await abandonPayment(store.slug, token)
        clearAbandon(token) // el servidor contestó (aunque esta vista ya se haya ido)
        if (stopped) return
        cancelling = false
        setAbandoning(false)
        apply(r)
      } catch (e) {
        // Una respuesta definitiva (4xx que no sea 408 ni 429, 404 incluido) también cierra la intención; sin red, 408, 429 o 5xx se
        // conserva para reintentar al volver a montar.
        if (e instanceof ApiError && !e.network && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429)
          clearAbandon(token)
        if (stopped) return
        if (e instanceof ApiError && e.status === 404) {
          cancelling = false
          setAbandoning(false)
          vanish()
        } else setAbandonError(errorText(t, e))
      } finally {
        sending = false
      }
      later()
    }
    refresh.current = run
    retryAbandon.current = () => void abandon()
    startAbandon.current = () => {
      cancelling = true
      setAbandoning(true)
      void abandon()
    }
    const onVisible = () => void run()
    document.addEventListener('visibilitychange', onVisible)
    void (cancelling ? abandon() : run())
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [store, token])

  // El foco sigue a la confirmación: al abrirla va a «No» (el botón que no hace nada); al cerrarla con «No» vuelve a «Cancelar pedido»,
  // que regresa a su lugar. Al cargar la pantalla no se toca. Tras un intento de cancelar NO vuelve aquí: aún no se sabe si el botón
  // seguirá (lo decide el efecto de abajo, con la vista ya refrescada).
  useEffect(() => {
    if (asking) noBtn.current?.focus()
    else if (closedByNo.current) {
      closedByNo.current = false
      cancelBtn.current?.focus()
    }
  }, [asking])

  // Un intento de cancelar ya resuelto y la vista ya refrescada: la confirmación se fue con el foco que tenía. Si el botón también se
  // fue (el pedido se canceló, o ya no se puede), el foco pasa al titular del estado, que dice lo que pasó; si sigue (sin red, un 409
  // que lo deja cancelable), vuelve a «Cancelar pedido». Sólo si el foco se perdió: quien ya está en otro elemento, ahí se queda.
  useEffect(() => {
    const target = cancelBtn.current ?? titleRef.current
    if (settled && target && focusLost(target)) target.focus()
  }, [settled])

  // Folio de «Nadie»: el reloj corre cada segundo (la cuenta regresiva y el «En vivo»), también con «reducir movimiento».
  // Sólo corre mientras algo cambia en pantalla: la cuenta regresiva (por pagar) o el «En vivo» (pagado y sin entregar).
  const folioMode = !!tracking && isFolioOf(tracking)
    && (tracking.status === 'PENDING_ACCEPTANCE' || (folioPaidOf(tracking) && tracking.status !== 'COMPLETED'))
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!folioMode) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [folioMode])
  // El seguimiento no trae el nombre: es el que se guardó al pedir (sin almacenamiento, no se muestra).
  const [who] = useState(() => {
    const last = loadLastOrder(store.slug)
    return last && last.trackingToken === token ? last.name ?? null : null
  })
  // Con «¡Listo!» la pestaña lo dice, para verlo aunque esté en otra app; al salir vuelve su título.
  const readyTab = tracking && isFolioOf(tracking) && tracking.status === 'READY' ? t('tracking.folio.tab', { venue: tracking.venueName }) : null
  useEffect(() => {
    if (!readyTab) return
    const before = document.title
    document.title = readyTab
    return () => { document.title = before }
  }, [readyTab])

  // De vuelta a la carta (el aviso «Tienes un pedido en curso · Ver» de OrderApp regresa aquí). Si el pago no se completó, «Volver al menú».
  const orderMore = (
    <div class="avq-o-track__more">
      <button type="button" class="avq-o-btn avq-o-btn--neutral" onClick={() => { store.trackingToken.value = null; store.go('menu') }}>
        {t(tracking?.status === 'PAYMENT_NOT_COMPLETED' || (tracking?.status === 'CANCELLED_BY_STAFF' && tracking.requiresAcceptance === false) ? 'tracking.backToMenu' : 'tracking.orderMore')}
      </button>
    </div>
  )
  // Sin red, o el servidor falló, mientras se reintenta solo: es un estado normal (ámbar), nunca un error en rojo.
  const problemNotice = problem && <Notice tone="warn" icon={problem === 'store.reconnecting' ? 'cloudOff' : undefined} text={t(problem)} />
  if (gone) return <div class="avq-o-track"><Notice tone="neutral" text={t('tracking.notFound')} />{orderMore}</div>
  if (abandoning)
    return (
      <div class="avq-o-track">
        <div class="avq-o-track__intro" role="status">
          <h2 ref={titleRef} class="avq-o-title" tabIndex={-1}>{t('tracking.abandoning')}</h2>
        </div>
        {abandonError && (
          <Notice tone="warn" icon={abandonError === t('common.offline') ? 'cloudOff' : undefined} text={abandonError}
            action={{ label: t('common.retry'), onClick: () => retryAbandon.current() }} />
        )}
      </div>
    )
  if (!tracking)
    return problemNotice ? <div class="avq-o-track">{problemNotice}{orderMore}</div>
      // `?pago=1`: de regreso de Stripe, lo primero que se ve es que el pago se está confirmando.
      : <p role="status" class="avq-o-empty">{t(entry.ret === 'returned' ? 'tracking.head.AWAITING_PAYMENT' : 'tracking.loading')}</p>

  const tz = tracking.venueTimezone ?? store.info.value?.venue.timezone ?? 'America/Mexico_City'
  const time = (iso: string) => formatTime(iso, tz, store.locale)
  const isFolio = isFolioOf(tracking)
  // Folio de «Nadie»: pagado en caja (o dinero que llegó tarde a uno vencido) pasa a «PAGADO»; cancelado por alguien, no.
  const folioPaid = folioPaidOf(tracking)
  const step = isFolio
    ? folioPaid ? (tracking.status === 'COMPLETED' ? 3 : tracking.status === 'READY' ? 2 : 1) : tracking.status === 'PENDING_ACCEPTANCE' ? 0 : undefined
    : STEP_OF[tracking.status]
  const offline = problem === 'store.reconnecting'
  // Sin hora del servidor en la respuesta: reloj del aparato, y pasada la hora límite no hay cuenta (nunca «Faltan 1 min»).
  const msLeft = Date.parse(tracking.acceptDeadlineAt) - now
  const left = Math.ceil(msLeft / 60_000)
  const shownName = tracking.customerName || who
  const clock = new Intl.DateTimeFormat(store.locale === 'en' ? 'en-US' : 'es-MX', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(now)
  // Algo que recoger: esperando, en preparación o listo. Un estado que la tienda no conoce no se da por confirmado.
  const toPickUp = step !== undefined && tracking.status !== 'COMPLETED'
  const card = tracking.paymentMode === 'CARD_ONLINE'
  const closed = CLOSED.has(tracking.status)
  // «No se te cobró nada» sólo con la tarjeta liberada (o sin cargo): apartada, cobrándose o liberándose, todavía no se sabe.
  const released = !tracking.cardStatus || tracking.cardStatus === 'RELEASED'
  // Titular y su línea de hora; rechazado, vencido y cancelado dicen su frase de hoy, sin línea. Un estado nuevo del servidor, uno
  // neutro (y el sondeo sigue: no es final).
  const folioHead = (): [string, string | null] | null => {
    if (!isFolio) return null
    const f = (k: string, v?: Record<string, string>) => t(`tracking.folio.${k}`, v)
    if (folioPaid) {
      if (tracking.status === 'COMPLETED') return [f('head.completed'), shownName ? f('sub.completed', { name: shownName }) : f('sub.completedAnon')]
      if (tracking.status === 'READY') return [f('head.ready'), f('sub.ready')]
      return [f('head.paid'), tracking.estimatedReadyAt ? f('sub.paidEta', { time: time(tracking.estimatedReadyAt) }) : f('sub.paid')]
    }
    if (tracking.status === 'PENDING_ACCEPTANCE') return [f('head.pay'), partialOf(tracking) ? partialLine(tracking, t, store.locale) : f('sub.pay', { time: time(tracking.acceptDeadlineAt) })]
    if (tracking.status === 'EXPIRED') return [f('head.expired'), f('sub.expired')]
    if (tracking.status === 'CANCELLED_BY_STAFF') return [f('head.staff'), f('sub.staff')]
    return null
  }
  const [head, sub] = folioHead() ?? ((): [string, string | null] => {
    switch (tracking.status) {
      case 'PENDING_ACCEPTANCE': return [t('tracking.head.PENDING_ACCEPTANCE'), t('tracking.sub.waiting', { time: time(tracking.acceptDeadlineAt) })]
      case 'ACCEPTED':
        return [t('tracking.head.ACCEPTED'), tracking.estimatedReadyAt ? t('tracking.sub.eta', { time: time(tracking.estimatedReadyAt) }) : null]
      case 'READY': return [t('tracking.head.READY'), t('tracking.sub.ready')]
      case 'COMPLETED': return [t('tracking.head.COMPLETED'), t('tracking.sub.completed')]
      case 'AWAITING_PAYMENT': return [t('tracking.head.AWAITING_PAYMENT'), t('tracking.sub.paidWait')]
      // Sin liberar todavía (o cobrada afuera): el titular no promete «No se te cobró nada»; la línea del dinero dice qué pasa.
      case 'PAYMENT_NOT_COMPLETED': return [t(released ? 'tracking.notCompleted' : 'tracking.card.notCompleted'), null]
      // Con tarjeta, el titular no habla del dinero (puede haberse cobrado): lo dice la línea del dinero.
      case 'REJECTED':
        if (tracking.rejectReason === 'PAYMENT_FAILED') return [t('tracking.paymentFailed'), null]
        return [
          tracking.rejectReason
            ? t(card ? 'tracking.card.rejected' : 'tracking.rejected', { reason: t(`tracking.reason.${tracking.rejectReason}`) })
            : t(card ? 'tracking.card.rejectedNoReason' : 'tracking.rejectedNoReason'),
          null,
        ]
      case 'EXPIRED': return [t(card ? 'tracking.card.expired' : 'tracking.expired'), null]
      case 'CANCELLED_BY_CUSTOMER': return [t('tracking.cancelledByCustomer'), null]
      case 'CANCELLED_BY_STAFF': return [t('tracking.cancelledByStaff'), null]
      default: return [t('tracking.head.unknown'), null]
    }
  })()
  // Con tarjeta, qué pasó con el dinero según `cardStatus`. Liberada (o sin estado) en cerrado: nada se cobró; el borrador no
  // completado ya lo dice en su titular.
  const cardPay = (): string | null => {
    const s = tracking.cardStatus
    if (s === 'CAPTURED') return t(closed ? 'tracking.card.refundDue' : 'tracking.card.captured')
    // Cerrado con la tarjeta aún apartada o confirmándose: se va a liberar (fix ronda 1), nunca «se cobra cuando acepte».
    if (s === 'RELEASING' || (closed && (s === 'AUTHORIZED' || s === 'CONFIRMING'))) return t('tracking.card.releasing')
    if (s === 'AUTHORIZED' || s === 'CONFIRMING') return t('tracking.card.authorized')
    return closed && tracking.status !== 'PAYMENT_NOT_COMPLETED' ? t('tracking.card.notCharged') : tracking.paid ? t('tracking.paid') : null
  }
  // Sin cobro, «Pagas al recoger» sólo en curso o entregado (la regla de hoy): no en cancelado, rechazado, vencido ni un estado nuevo.
  const pay = isFolio ? (tracking.status === 'PENDING_ACCEPTANCE' ? t('tracking.folio.tax') : folioPaid ? t('tracking.paid') : null) : card ? cardPay() : tracking.paid ? t('tracking.paid') : step !== undefined ? t('cart.taxPickup') : null

  // «Hoy» es el día del NEGOCIO: pasada su medianoche el pago lleva su fecha.
  const dayOf = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(ms)
  const paidOnOtherDay = !!tracking.paidAt && dayOf(Date.parse(tracking.paidAt)) !== dayOf(Date.now())
  const paidDate = tracking.paidAt
    ? new Intl.DateTimeFormat(store.locale === 'en' ? 'en-US' : 'es-MX', { timeZone: tz, day: 'numeric', month: 'short' }).format(Date.parse(tracking.paidAt)).replace('.', '')
    : ''
  const paidWho = tracking.paidAt
    ? paidOnOtherDay
      ? shownName ? t('tracking.folio.paidByOn', { name: shownName, date: paidDate, time: time(tracking.paidAt) }) : t('tracking.folio.paidTodayOn', { date: paidDate, time: time(tracking.paidAt) })
      : shownName ? t('tracking.folio.paidByAt', { name: shownName, time: time(tracking.paidAt) }) : t('tracking.folio.paidTodayAt', { time: time(tracking.paidAt) })
    : shownName ? t('tracking.folio.paidBy', { name: shownName }) : t('tracking.folio.paidToday')

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
    setSettled(n => n + 1)
  }

  const contact = tracking.venueContact
  return (
    <div class="avq-o-track">
      <header class="avq-o-head">
        <VenueMark small name={tracking.venueName} />
        <span class="avq-o-head__name">{tracking.venueName}</span>
      </header>
      {isFolio && offline ? <Notice tone="warn" icon="cloudOff" text={t('tracking.folio.offline')} /> : problemNotice}
      {/* Un cambio de estado se anuncia (como la frase de hoy, que era `role="status"`). */}
      <div class="avq-o-track__intro" role="status">
        <h2 ref={titleRef} class="avq-o-title" tabIndex={-1}>{head}</h2>
        {sub && <p>{sub}</p>}
        {isFolio && !folioPaid && tracking.status === 'PENDING_ACCEPTANCE' && !offline && msLeft > 0 && !partialOf(tracking) && (
          <p class="avq-o-track__chip"><span class={left <= 5 ? 'avq-o-chip avq-o-chip--warn' : 'avq-o-chip'}><span aria-hidden="true">◷</span>{t('tracking.folio.left', { n: String(left) })}</span></p>
        )}
      </div>
      {isFolio && tracking.status === 'EXPIRED' && !folioPaid && (
        <div class="avq-o-track__again"><strong>{t('tracking.folio.againTitle')}</strong><span>{t('tracking.folio.againHint')}</span></div>
      )}
      {/* Volvió de Stripe con «atrás» (sin `?pago`): puede soltar la página de pago; si ya pagó, el servidor responde el pedido. */}
      {tracking.status === 'AWAITING_PAYMENT' && (
        <div class="avq-o-track__cancel">
          <button type="button" class="avq-o-btn avq-o-btn--neutral" onClick={() => startAbandon.current()}>{t('tracking.cancelPayment')}</button>
        </div>
      )}
      {step !== undefined && (
        <ol class="avq-o-steps" role="list" aria-label={t('tracking.progress')}>
          {STEPS.map((k, i) => (
            <li key={k} class={i <= step ? 'avq-o-step avq-o-step--done' : 'avq-o-step'} aria-current={i === step ? 'step' : undefined}>
              {isFolio ? t(`tracking.folio.steps.${FOLIO_STEPS[i]}`) : t(`tracking.steps.${k}`)}
            </li>
          ))}
        </ol>
      )}
      <div class="avq-o-ticket">
        {/* El borrador de tarjeta no tiene folio todavía (nace al confirmarse el pago). */}
        {tracking.orderNumber && folioPaid && (
          <>
            <div class="avq-o-paid">
              <span class="avq-o-paid__stamp">✓ {t('tracking.folio.stamp')}</span>
              <span class="avq-o-paid__n">{tracking.orderNumber}</span>
              <span class="avq-o-paid__items">{tracking.items.map(it => (it.quantity > 1 ? `${it.quantity} × ${it.name}` : it.name)).join(' · ')}</span>
              <span class="avq-o-paid__who">{paidWho}</span>
            </div>
            {tracking.status !== 'COMPLETED' && <p class="avq-o-live"><span class="avq-o-live__dot" aria-hidden="true" /><span>{t('tracking.folio.live', { time: clock })}</span></p>}
          </>
        )}
        {tracking.orderNumber && !folioPaid && (
          <>
            <div class="avq-o-ticket__folio">
              <span class="avq-o-ticket__label">{t('tracking.folioLabel')}</span>
              <span class={isFolio ? `avq-o-ticket__n avq-o-ticket__n--folio${tracking.status === 'EXPIRED' ? ' avq-o-ticket__n--void' : ''}` : 'avq-o-ticket__n'}>{tracking.orderNumber}</span>
              {isFolio && shownName && <span class="avq-o-ticket__who">{shownName}</span>}
              {isFolio ? tracking.status === 'PENDING_ACCEPTANCE' && <span class="avq-o-ticket__say">{t('tracking.folio.say')}</span>
                : toPickUp && <span class="avq-o-ticket__say">{t('tracking.sayAtCounter')}</span>}
            </div>
            <div class="avq-o-ticket__tear" aria-hidden="true" />
          </>
        )}
        <div class="avq-o-ticket__body">
          {!folioPaid && <ul class="avq-o-ticket__lines" role="list">
            {tracking.items.map((it, i) => {
              const options = optionsText(it.modifiers)
              return (
                <li key={i}>
                  <span>{it.quantity} × {it.name}{isFolio && it.total != null && <span class="avq-o-ticket__price">{formatMXN(it.total, store.locale)}</span>}</span>
                  {options && <span class="avq-o-ticket__sub">{options}</span>}
                  {it.note && <span class="avq-o-ticket__sub">{it.note}</span>}
                </li>
              )
            })}
          </ul>}
          <div class="avq-o-ticket__sum">
            <p class="avq-o-total__row"><span>{t('cart.totalShort')}</span><span>{formatMXN(tracking.total, store.locale)}</span></p>
            {pay && <p class="avq-o-total__tax">{pay}</p>}
          </div>
          {isFolio && tracking.status === 'PENDING_ACCEPTANCE' && <p class="avq-o-total__tax">{t('tracking.folio.closePage')}</p>}
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
            <button ref={cancelBtn} type="button" class="avq-o-btn avq-o-btn--quiet" onClick={() => { setCancelMsg(null); setAsking(true) }}>{t(isFolio ? 'tracking.folio.cancel' : 'tracking.cancel')}</button>
          )}
          {/* La pantalla no tiene acción principal (§5.6): los dos botones pesan igual y el acento no «recomienda» cancelar. */}
          {tracking.canCancel && asking && (
            <div role="group" aria-label={t('tracking.cancelAsk')} class="avq-o-track__ask">
              <p>{t('tracking.cancelAsk')}</p>
              {isFolio && <p class="avq-o-track__note">{t('tracking.folio.cancelNote', { folio: tracking.orderNumber })}</p>}
              <div>
                <button type="button" class="avq-o-btn avq-o-btn--neutral" disabled={busy} onClick={() => void doCancel()}>{busy ? t('tracking.cancelling') : t('tracking.cancelYes')}</button>
                <button ref={noBtn} type="button" class="avq-o-btn avq-o-btn--neutral" disabled={busy} onClick={() => { closedByNo.current = true; setAsking(false) }}>{t('tracking.cancelNo')}</button>
              </div>
            </div>
          )}
        </div>
      )}
      {orderMore}
    </div>
  )
}
