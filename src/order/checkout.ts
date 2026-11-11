// Envío del pedido sin duplicados. Reglas (spec §5.3 y notas de las tareas 5 y 6):
// - Un intento = una llave. Si hay un intento pendiente se manda ESE cuerpo con ESA llave (beginAttempt lo devuelve).
// - Sólo una respuesta DEFINITIVA lo borra; red, 5xx, 408, 429, 401 y un 404 sin la marca `final` lo conservan y se reintenta igual.
// - El teléfono que se verifica es el del cuerpo que se va a mandar (el del intento pendiente, si lo hay).
// - «Nadie» (tienda híbrida): el pedido va sin teléfono, sin sesión y sin token; no pasa por el código. Un intento pendiente sin
//   teléfono se reenvía tal cual (mismo cuerpo, misma llave) aunque el negocio ya sea «Mi equipo»; sólo un 401 PHONE_VERIFICATION_REQUIRED
//   (nunca llegó a crearse) lo suelta y pide los datos de «Mi equipo».
// - Fase 2: pagar con tarjeta no pide el código ni manda token; el pago en Stripe es la prueba. El modo es el del cuerpo que se manda.
import { signal, type Signal } from '@preact/signals'
import { ApiError, createOrder, quote, verifyOrderingOtp } from './api'
import { beginAttempt, pendingAttempt, settleAttempt } from './attempt'
import { loadSession, samePhone, saveLastOrder, type OrderingSession } from './session'
import { abrirPagina, epocaDelNegocio, fijarPagina, guardarSesion, soltarLaPagina, tokenDeLaPagina } from '../lib/sesionDeCliente'
import { toQuoteItems } from './cart'
import { expectedTotalFromQuote } from './money'
import { createOrderT } from './i18n'
import { emitOrderCreated } from './events'
import type { OrderStore } from './store'
import type {
  BeneficioElegido, CreateOrderBody, CreatedCardOrder, CreatedOrder, EleccionDeBeneficios, PaymentMode, Quote, QuoteIssue, QuoteItem, StoreReason,
  StoreStatus,
} from './types'

export type SubmitResult =
  | { kind: 'created'; order: CreatedOrder | CreatedCardOrder }
  | { kind: 'needsOtp' }
  /** El servidor exige teléfono verificado a un pedido anónimo (el negocio pasó a «Mi equipo»): el intento ya se soltó. */
  | { kind: 'needsPhone' }
  /**
   * `body` = el cuerpo enviado con el total nuevo (sin lo que ya no está): se manda (con OTRA llave) sólo si la persona confirma.
   * `motivo` (W3): `SIN_SESION` = la sesión se cerró (va sin beneficios); un beneficio = ése ya no está (p. ej. el premio se usó).
   */
  | { kind: 'priceChanged'; quote: Quote; body: CreateOrderBody; motivo?: Motivo }
  | { kind: 'cartInvalid'; issues: QuoteIssue[] }
  | { kind: 'storeUnavailable'; status: StoreStatus; reason: StoreReason }
  | { kind: 'error'; message: string; retryable: boolean }

type T = ReturnType<typeof createOrderT>

/**
 * ¿El servidor dio un desenlace? Sin red, 5xx (también un 502/504 de proxy con HTML), 408, 429 y 401 no lo dan. Un 404 tampoco,
 * salvo que traiga `final: true`: el 404 del resolver (el slug cambió un rato) llega ANTES de cualquier decisión guardada, y un
 * envío anterior con esa llave todavía puede crear el pedido. Un servidor que aún no manda `final` deja el 404 pendiente (seguro).
 */
export const isDefinitive = (e: ApiError): boolean =>
  !e.network && e.status >= 400 && e.status < 500 && ![401, 408, 429].includes(e.status) && (e.status !== 404 || e.final)

/** Texto para una falla de la API. El 429 en texto plano llega con message «HTTP 429»: se elige por `code`. */
export function errorText(t: T, e: unknown): string {
  if (!(e instanceof ApiError) || e.network) return t('common.offline')
  if (e.code === 'RATE_LIMIT_EXCEEDED') return t('checkout.rateLimited')
  if (e.status >= 500) return t('checkout.serverError')
  return e.message || t('checkout.failed')
}

/** W3: por qué cambió el precio al pedir. */
export type Motivo = 'SIN_SESION' | BeneficioElegido

/** Lo elegido sin lo que ya no está (`fuera`); `undefined` si no queda nada. */
function sinLosDe(e: EleccionDeBeneficios | undefined, fuera: BeneficioElegido[]): EleccionDeBeneficios | undefined {
  const b: EleccionDeBeneficios = {
    ...(e?.premioId && !fuera.includes('PREMIO') ? { premioId: e.premioId } : {}),
    ...(e?.puntos && !fuera.includes('PUNTOS') ? { puntos: e.puntos } : {}),
    ...(e?.cupon && !fuera.includes('CUPON') ? { cupon: e.cupon } : {}),
  }
  return Object.keys(b).length ? b : undefined
}

/** W3: lo elegido que la cotización ofreció y no descartó: lo mismo con que se calculó su total (el `expectedTotal`). */
function beneficiosCotizados(store: OrderStore, q: Quote): EleccionDeBeneficios | undefined {
  const e = checkouts.get(store)?.eleccion.value ?? {} // sin abrir la página: armar el cuerpo no es abrir la tienda
  const o = q.oferta
  const ofrecido = {
    ...(e.premioId && o?.premio?.id === e.premioId ? { premioId: e.premioId } : {}),
    ...(e.puntos && o?.puntos ? { puntos: e.puntos } : {}),
    ...(e.cupon && o?.cupon ? { cupon: e.cupon } : {}),
  }
  return sinLosDe(ofrecido, q.descartados ?? [])
}

export function buildOrderBody(
  store: OrderStore,
  input: { customer: { name: string; phone?: string; email?: string }; note: string | null; paymentMode?: PaymentMode },
): CreateOrderBody {
  const quote = store.quote.value
  if (!quote) throw new Error('buildOrderBody sin cotización')
  const email = input.customer.email?.trim()
  const note = input.note?.trim()
  const beneficios = beneficiosCotizados(store, quote)
  return {
    items: toQuoteItems(store.cart.value),
    paymentMode: input.paymentMode ?? 'PAY_AT_PICKUP',
    expectedTotal: expectedTotalFromQuote(quote.total),
    customer: { name: input.customer.name.trim(), ...(input.customer.phone ? { phone: input.customer.phone } : {}), ...(email ? { email } : {}) },
    channel: store.channel,
    ...(note ? { note } : {}),
    ...(beneficios ? { beneficios } : {}),
  }
}

/** Estado del envío de UNA tienda (dos `<avoqado-order>` nunca lo comparten). */
/** `payment`: lo que eligió la persona en «¿Cómo quieres pagar?»; sin elegir, tarjeta si el negocio la acepta. */
export interface CheckoutDraft {
  note: string; name: string; dial: string; national: string; email: string; accepted: boolean; payment?: PaymentMode
}
export type Feedback =
  /** `premio`: la etiqueta del premio que ya se usó (para decirlo: «Tu café gratis ya se usó en otro pedido»). */
  | { kind: 'priceChanged'; total: number; body: CreateOrderBody; motivo?: Motivo; premio?: string }
  | { kind: 'error'; message: string; retryable: boolean }
export interface Checkout {
  busy: Signal<boolean>
  feedback: Signal<Feedback | null>
  /** Hay un intento sin desenlace (también tras recargar). */
  pending: Signal<boolean>
  /** El último cuerpo que se pidió mandar: el que se manda tras verificar el código. */
  lastBody: Signal<CreateOrderBody | null>
  draft: Signal<CheckoutDraft>
  /** Hora (ms) del último código de WhatsApp pedido por teléfono: volver a la pantalla del código no manda otro antes de 30 s. */
  otpSentAt: Map<string, number>
  /** W3: lo que la clienta eligió usar en este pedido (premio, puntos, cupón). Sólo se manda lo que la cotización ofreció. */
  eleccion: Signal<EleccionDeBeneficios>
  /** W3: un 401 soltó la sesión de la página en esta tienda: el carrito lo dice con calma y ofrece entrar otra vez. */
  sesionCerrada: Signal<boolean>
}
const checkouts = new WeakMap<OrderStore, Checkout>()
export function checkoutOf(store: OrderStore): Checkout {
  let c = checkouts.get(store)
  if (!c) {
    const feedback = signal<Feedback | null>(null)
    c = {
      busy: signal(false),
      feedback,
      pending: signal(!!pendingAttempt(store.slug)),
      lastBody: signal(null),
      draft: signal({ note: '', name: '', dial: '52', national: '', email: '', accepted: false }),
      otpSentAt: new Map(),
      eleccion: signal({}),
      sesionCerrada: signal(false),
    }
    // W1 (alcance A): abrir la tienda abre la página de ese negocio (la primera vez en el documento; recrear la tienda no relee).
    abrirPagina(store.slug, 'pedidos', leerPedidos(store.slug))
    // La cotización y la pregunta de «el precio cambió» valen sólo para el carrito que se cotizó: si cambia (también desde
    // la carta), ya no valen y «Continuar» espera la cotización nueva. OrderApp crea esto en su primer pintado.
    let first = true
    store.cart.subscribe(() => {
      if (!first) {
        feedback.value = null
        store.quote.value = null
      }
      first = false
    })
    checkouts.set(store, c)
  }
  return c
}

export const phoneToVerify = (store: OrderStore): string | null =>
  (pendingAttempt(store.slug)?.body ?? checkoutOf(store).lastBody.value)?.customer.phone ?? null

/**
 * Verifica el código y guarda la sesión ÚNICA (W2: también abre «Mi cuenta» y reservas). `loadSession` la usa con el teléfono que el
 * SERVIDOR probó, que es este mismo número en su forma canónica (`samePhone`).
 */
export async function verifyPhone(store: OrderStore, phone: string, code: string): Promise<boolean> {
  const antes = epocaDelNegocio(store.slug)
  const r = await verifyOrderingOtp(store.slug, phone, code)
  // codex-r8 H3: llegó después de «Cerrar sesión» u otro cambio de sesión en la página: no guarda, no revive y no se manda el pedido.
  if (epocaDelNegocio(store.slug) !== antes) return false
  guardarSesion(store.slug, { token: r.token, customer: r.customer, contactos: r.contactos, guardadaEn: Date.now() })
  fijarPagina(store.slug, 'pedidos', loadSession(store.slug)) // entró aquí
  return true
}

const leerPedidos = (slug: string) => () => loadSession(slug)

/**
 * La sesión con que pide la tienda: la de la página (el guardián, `tokenDeLaPagina`), mientras siga guardada (la renovada cuenta como
 * la misma). Si ya no (salió en otra pestaña, entró otra ficha u otra prueba del teléfono), queda sin sesión; nunca toma otra.
 */
function sesionDeLaTienda(store: OrderStore): OrderingSession | null {
  checkoutOf(store) // abre la página si la tienda todavía no se pintó
  return tokenDeLaPagina(store.slug, 'pedidos', leerPedidos(store.slug)) ? loadSession(store.slug) : null
}

/** Un 401 de la sesión con que pidió la tienda: el guardián la suelta (también su renovación) y la página queda sin sesión. */
const soltar401 = (store: OrderStore, s: OrderingSession | null) => { if (s) soltarLaPagina(store.slug, 'pedidos', s.token, leerPedidos(store.slug)) }

/**
 * W3: cotiza con la sesión de la página y lo elegido (sin sesión, como hoy). (b) Un 401 suelta la sesión por el guardián y se vuelve a
 * cotizar sin ella; el carrito lo dice con calma (`sesionCerrada`).
 */
export async function cotizar(store: OrderStore, items: QuoteItem[]): Promise<Quote> {
  const c = checkoutOf(store)
  const s = sesionDeLaTienda(store)
  try {
    return await quote(store.slug, items, s ? { token: s.token, beneficios: c.eleccion.value } : {})
  } catch (e) {
    if (!s || !(e instanceof ApiError) || e.status !== 401) throw e
    soltar401(store, s)
    c.sesionCerrada.value = true
    return cotizar(store, items)
  }
}

/** (e) Entró otra vez desde la tienda (`EntrarConCuenta`): la página toma esa sesión y se vuelve al carrito, que cotiza con ella. */
export function entroEnLaTienda(store: OrderStore): void {
  const c = checkoutOf(store)
  fijarPagina(store.slug, 'pedidos', loadSession(store.slug))
  c.sesionCerrada.value = false
  c.feedback.value = null
  store.go('cart')
}

/** ¿Se puede guardar? Sin sessionStorage no hay intento y sin localStorage no hay sesión: pedir código sería en balde. */
export function storageWorks(): boolean {
  try {
    for (const s of [sessionStorage, localStorage]) {
      s.setItem('avq_order_probe', '1')
      s.removeItem('avq_order_probe')
    }
    return true
  } catch {
    return false
  }
}

/** Abre la página de pago (Stripe). Un objeto para que las pruebas lo cambien: jsdom no navega. */
export const nav = { assign: (url: string): void => location.assign(url) }

const sameItems = (a: CreateOrderBody['items'], b: CreateOrderBody['items']) => JSON.stringify(a) === JSON.stringify(b)

// Una petición a la vez por negocio (el intento guardado también es por negocio).
const inflight = new Map<string, Promise<SubmitResult>>()

export function submitOrder(store: OrderStore, body: CreateOrderBody): Promise<SubmitResult> {
  const running = inflight.get(store.slug)
  if (running) return running
  const p = doSubmit(store, body).finally(() => inflight.delete(store.slug))
  inflight.set(store.slug, p)
  return p
}

async function doSubmit(store: OrderStore, body: CreateOrderBody): Promise<SubmitResult> {
  const { slug } = store
  const t = createOrderT(store.locale)
  const pending = pendingAttempt(slug)
  // Con el almacenamiento bloqueado la sesión no se guardaría: se pediría un código tras otro sin poder pedir nunca.
  if (!pending && !storageWorks()) return { kind: 'error', message: t('checkout.noStorage'), retryable: false }
  const session = sesionDeLaTienda(store)
  const card = (pending?.body ?? body).paymentMode === 'CARD_ONLINE'
  const phone = (pending?.body ?? body).customer.phone
  // Sin teléfono (el pedido de «Nadie») no hay nada que verificar ni código; si la página tiene sesión, va con ella (W3: sus beneficios).
  const anon = !card && !phone
  // El mismo texto que se verificó cuenta siempre (samePhone pide 10 dígitos y no reconoce números más cortos).
  if (!card && phone && (!session?.phone || (session.phone !== phone && !samePhone(session.phone, phone)))) return { kind: 'needsOtp' }
  const attempt = pending ?? beginAttempt(slug, body)
  if (!attempt) return { kind: 'error', message: t('checkout.noStorage'), retryable: false }

  let order: CreatedOrder | CreatedCardOrder
  try {
    // W3: la sesión de la página va también en «Nadie» y con tarjeta (c): así el SERVIDOR aplica lo elegido y liga el folio a ella.
    order = await createOrder(slug, attempt.body, { idempotencyKey: attempt.key, token: session?.token })
    if (typeof order?.trackingToken !== 'string') throw new Error('respuesta sin pedido')
  } catch (e) {
    if (!(e instanceof ApiError) || !isDefinitive(e)) {
      // Desenlace desconocido: el intento queda tal cual.
      // 401 CUSTOMER_INACTIVE: volver a verificar no sirve (el servidor contesta lo mismo). El intento NO se resuelve: queda
      // hasta que se cierre la pestaña (sessionStorage); sólo una respuesta definitiva lo borra.
      if (e instanceof ApiError && e.code === 'CUSTOMER_INACTIVE') {
        // codex-r4 R4-4: la sesión rechazada no se queda guardada (el intento sí, como cualquier respuesta no definitiva).
        soltar401(store, session)
        return { kind: 'error', message: t('checkout.inactive'), retryable: false }
      }
      if (e instanceof ApiError && e.status === 401 && e.code === 'PHONE_VERIFICATION_REQUIRED' && anon) {
        // Nunca llegó a crearse: se suelta el intento y la persona da los datos de «Mi equipo».
        settleAttempt(slug)
        return { kind: 'needsPhone' }
      }
      if (e instanceof ApiError && e.status === 401 && session && (card || anon)) {
        // W3: la sesión de la página ya no vale y aquí no hace falta: se suelta y se manda el MISMO intento (misma llave) sin ella. Si
        // llevaba beneficios, el SERVIDOR responde `PRICE_CHANGED` con `motivo: 'SIN_SESION'` y la tienda pregunta.
        soltar401(store, session)
        return doSubmit(store, body)
      }
      if (e instanceof ApiError && e.status === 401 && !card && !anon) {
        // W1 (alcance A): se suelta esa sesión y se pide el código; nunca se reintenta con la vieja ni se toma otra a medio pedido.
        soltar401(store, session)
        return { kind: 'needsOtp' }
      }
      const message =
        e instanceof ApiError && e.code === 'VENUE_NOT_FOUND' ? t('store.notFound')
        // 502 de Stripe: no es definitivo, el reintento con la MISMA llave recupera la página de pago.
        : e instanceof ApiError && e.code === 'CARD_PROVIDER_UNAVAILABLE' ? t('checkout.cardProviderUnavailable')
        : errorText(t, e)
      return { kind: 'error', message, retryable: true }
    }
    settleAttempt(slug)
    const details = (e.details ?? {}) as any
    if (e.code === 'PRICE_CHANGED' && details.quote) {
      // W3: sin sesión va sin beneficios; si uno ya no está, sin ése. El cuerpo a confirmar es el de la cotización nueva.
      const sinSesion = details.motivo === 'SIN_SESION'
      const fuera: BeneficioElegido[] = details.descartados ?? details.quote.descartados ?? []
      const { beneficios: antes, ...resto } = attempt.body
      const beneficios = sinSesion ? undefined : sinLosDe(antes, fuera)
      return {
        kind: 'priceChanged',
        quote: details.quote,
        body: { ...resto, ...(beneficios ? { beneficios } : {}), expectedTotal: expectedTotalFromQuote(details.quote.total) },
        ...(sinSesion ? { motivo: 'SIN_SESION' as const } : fuera[0] ? { motivo: fuera[0] } : {}),
      }
    }
    if (e.code === 'CART_INVALID') return { kind: 'cartInvalid', issues: details.issues ?? [] }
    if (e.status === 409 && e.code?.startsWith('ORDERING_'))
      return {
        kind: 'storeUnavailable',
        status: details.status ?? (e.code.slice('ORDERING_'.length) as StoreStatus),
        reason: details.reason ?? null,
      }
    const message =
      e.code === 'TOO_MANY_PENDING_ORDERS' ? t('checkout.tooManyPending')
      : e.code === 'TOO_MANY_UNPAID_FOLIOS' ? t('checkout.tooManyUnpaid')
      : e.code === 'ZERO_TOTAL' ? t('checkout.zeroTotal')
      : e.code === 'PLAN_REQUIRED' ? t('store.disabled')
      : e.code === 'VENUE_NOT_FOUND' ? t('store.notFound')
      : e.code === 'IDEMPOTENCY_KEY_CONFLICT' ? t('checkout.failed')
      // «Elige pagar al recoger» sólo si esa opción existe: en una tienda de sólo tarjeta no hay a dónde ir.
      : e.code === 'CARD_PAYMENT_NOT_ACCEPTED' ? t(store.info.value?.paymentModes?.payAtPickup ? 'checkout.cardNotAccepted' : 'checkout.cardNotAcceptedOnly')
      : e.code === 'CARD_AMOUNT_OUT_OF_RANGE' ? t('checkout.cardAmountOutOfRange')
      : errorText(t, e)
    return { kind: 'error', message, retryable: false }
  }
  // El borrador de tarjeta todavía no tiene folio (nace con el pedido, al confirmarse el pago).
  const orderNumber = 'orderNumber' in order ? order.orderNumber : ''
  // Primero el pedido guardado y luego borrar el intento: si algo muere en medio, el reintento recupera el mismo pedido.
  saveLastOrder(slug, { trackingToken: order.trackingToken, orderNumber, ...(anon ? { name: attempt.body.customer.name } : {}) })
  settleAttempt(slug)
  // Aquí (una vez por respuesta del servidor) y no en `send`: un doble toque comparte esta petición y no repite el evento.
  if (store.host) emitOrderCreated(store.host, slug, { trackingToken: order.trackingToken, orderNumber })
  // Stripe sólo con un borrador que espera el pago y su liga: una repetición que ya avanzó o venció va al seguimiento (`send`).
  if ('checkoutUrl' in order && order.status === 'AWAITING_PAYMENT' && /^https:\/\//.test(order.checkoutUrl)) nav.assign(order.checkoutUrl)
  return { kind: 'created', order }
}

/** Manda y aplica el resultado a la tienda (pantalla, banner, pregunta del precio). */
export async function send(store: OrderStore, body: CreateOrderBody): Promise<SubmitResult> {
  const c = checkoutOf(store)
  c.busy.value = true
  c.feedback.value = null
  c.lastBody.value = body
  let r: SubmitResult
  // Lo que de verdad se manda: el intento pendiente si existe (submitOrder hace lo mismo).
  const sentItems = (pendingAttempt(store.slug)?.body ?? body)?.items
  try {
    r = await submitOrder(store, body)
  } finally {
    c.busy.value = false
    c.pending.value = !!pendingAttempt(store.slug)
  }
  // ¿El carrito de la pantalla es el que se mandó? Con un intento viejo (p. ej. tras recargar) puede no serlo.
  const isSentCart = () => sameItems(toQuoteItems(store.cart.value), sentItems)
  switch (r.kind) {
    case 'created':
      if (isSentCart()) store.cart.value = []
      store.quote.value = null
      c.draft.value = { ...c.draft.value, note: '' }
      store.trackingToken.value = r.order.trackingToken
      store.go('tracking')
      break
    case 'needsOtp':
      store.go('otp')
      break
    case 'needsPhone':
      // Ahora la pantalla pide WhatsApp y la casilla: se cambia en el acto y se confirma con el servidor.
      if (store.info.value) store.info.value = { ...store.info.value, requiresAcceptance: true }
      void store.refreshInfo()
      c.feedback.value = { kind: 'error', message: createOrderT(store.locale)('checkout.needsPhone'), retryable: false }
      store.go('details')
      break
    case 'priceChanged':
      if (isSentCart()) {
        // W3: lo que ya no está sale de la elección (el siguiente «Pedir» ya no lo manda); la etiqueta del premio, para decirlo.
        const premio = store.quote.value?.oferta?.premio?.etiqueta
        if (r.motivo && r.motivo !== 'SIN_SESION') c.eleccion.value = sinLosDe(c.eleccion.value, [r.motivo]) ?? {}
        store.quote.value = r.quote
        c.feedback.value = {
          kind: 'priceChanged', total: r.quote.total, body: r.body,
          ...(r.motivo ? { motivo: r.motivo } : {}), ...(r.motivo === 'PREMIO' && premio ? { premio } : {}),
        }
      } else {
        // Se reintentó un intento viejo (otro carrito): «Confirmar» mandaría lo que ya no está en pantalla. Al carrito, que
        // se cotiza solo; el intento viejo ya se resolvió (el servidor no creó nada).
        store.quote.value = null
        c.feedback.value = { kind: 'error', message: createOrderT(store.locale)('checkout.priceChangedReview'), retryable: false }
        store.go('cart')
      }
      break
    case 'cartInvalid':
      // El carrito vuelve a cotizar al entrar y cuelga los issues de cada renglón.
      store.go('cart')
      break
    case 'storeUnavailable':
      if (store.info.value) store.info.value = { ...store.info.value, status: r.status, reason: r.reason }
      void store.refreshInfo()
      // Al carrito, que conserva lo pedido y dice el motivo (la pantalla del código no tiene ese aviso).
      store.go('cart')
      break
    case 'error':
      c.feedback.value = { kind: 'error', message: r.message, retryable: r.retryable }
      break
  }
  return r
}

/** «Reintentar»: SÓLO el intento pendiente. Sin intento no se inventa uno (podría duplicar un pedido que sí llegó). */
export async function retry(store: OrderStore): Promise<SubmitResult | null> {
  const p = pendingAttempt(store.slug)
  if (p) return send(store, p.body)
  checkoutOf(store).feedback.value = null
  checkoutOf(store).pending.value = false
  return null
}
