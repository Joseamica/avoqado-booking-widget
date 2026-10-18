// Envío del pedido sin duplicados. Reglas (spec §5.3 y notas de las tareas 5 y 6):
// - Un intento = una llave. Si hay un intento pendiente se manda ESE cuerpo con ESA llave (beginAttempt lo devuelve).
// - Sólo una respuesta DEFINITIVA lo borra; red, 5xx, 408, 429 y 401 lo conservan y se reintenta igual.
// - El teléfono que se verifica es el del cuerpo que se va a mandar (el del intento pendiente, si lo hay).
import { signal, type Signal } from '@preact/signals'
import { ApiError, createOrder, verifyOrderingOtp } from './api'
import { beginAttempt, pendingAttempt, settleAttempt } from './attempt'
import { clearSession, loadSession, samePhone, saveLastOrder, saveSession } from './session'
import { toQuoteItems } from './cart'
import { expectedTotalFromQuote } from './money'
import { createOrderT } from './i18n'
import { emitOrderCreated } from './events'
import type { OrderStore } from './store'
import type { CreateOrderBody, CreatedOrder, Quote, QuoteIssue, StoreReason, StoreStatus } from './types'

export type SubmitResult =
  | { kind: 'created'; order: CreatedOrder }
  | { kind: 'needsOtp' }
  /** `body` = el cuerpo enviado con el total nuevo: se manda (con OTRA llave) sólo si la persona confirma. */
  | { kind: 'priceChanged'; quote: Quote; body: CreateOrderBody }
  | { kind: 'cartInvalid'; issues: QuoteIssue[] }
  | { kind: 'storeUnavailable'; status: StoreStatus; reason: StoreReason }
  | { kind: 'error'; message: string; retryable: boolean }

type T = ReturnType<typeof createOrderT>

/** ¿El servidor dio un desenlace? Sin red, 5xx (también un 502/504 de proxy con HTML), 408, 429 y 401 no lo dan. */
export const isDefinitive = (e: ApiError): boolean =>
  !e.network && e.status >= 400 && e.status < 500 && ![401, 408, 429].includes(e.status)

/** Texto para una falla de la API. El 429 en texto plano llega con message «HTTP 429»: se elige por `code`. */
export function errorText(t: T, e: unknown): string {
  if (!(e instanceof ApiError) || e.network) return t('common.offline')
  if (e.code === 'RATE_LIMIT_EXCEEDED') return t('checkout.rateLimited')
  if (e.status >= 500) return t('checkout.serverError')
  return e.message || t('checkout.failed')
}

export function buildOrderBody(
  store: OrderStore,
  input: { customer: { name: string; phone: string; email?: string }; note: string | null },
): CreateOrderBody {
  const quote = store.quote.value
  if (!quote) throw new Error('buildOrderBody sin cotización')
  const email = input.customer.email?.trim()
  const note = input.note?.trim()
  return {
    items: toQuoteItems(store.cart.value),
    paymentMode: 'PAY_AT_PICKUP',
    expectedTotal: expectedTotalFromQuote(quote.total),
    customer: { name: input.customer.name.trim(), phone: input.customer.phone, ...(email ? { email } : {}) },
    ...(note ? { note } : {}),
  }
}

/** Estado del envío de UNA tienda (dos `<avoqado-order>` nunca lo comparten). */
export interface CheckoutDraft { note: string; name: string; dial: string; national: string; email: string; accepted: boolean }
export type Feedback =
  | { kind: 'priceChanged'; total: number; body: CreateOrderBody }
  | { kind: 'error'; message: string; retryable: boolean }
export interface Checkout {
  busy: Signal<boolean>
  feedback: Signal<Feedback | null>
  /** Hay un intento sin desenlace (también tras recargar). */
  pending: Signal<boolean>
  /** El último cuerpo que se pidió mandar: el que se manda tras verificar el código. */
  lastBody: Signal<CreateOrderBody | null>
  draft: Signal<CheckoutDraft>
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
    }
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

/** Verifica el código y guarda la sesión con ESE teléfono (el mismo texto que viaja en `customer.phone`). */
export async function verifyPhone(store: OrderStore, phone: string, code: string): Promise<void> {
  const r = await verifyOrderingOtp(store.slug, phone, code)
  saveSession(store.slug, { token: r.token, phone, name: checkoutOf(store).draft.value.name.trim() || null, savedAt: Date.now() })
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
  const session = loadSession(slug)
  const phone = (pending?.body ?? body).customer.phone
  // El mismo texto que se verificó cuenta siempre (samePhone pide 10 dígitos y no reconoce números más cortos).
  if (!session || (session.phone !== phone && !samePhone(session.phone, phone))) return { kind: 'needsOtp' }
  const attempt = pending ?? beginAttempt(slug, body)
  if (!attempt) return { kind: 'error', message: t('checkout.noStorage'), retryable: false }

  let order: CreatedOrder
  try {
    order = await createOrder(slug, attempt.body, { idempotencyKey: attempt.key, token: session.token })
    if (typeof order?.trackingToken !== 'string') throw new Error('respuesta sin pedido')
  } catch (e) {
    if (!(e instanceof ApiError) || !isDefinitive(e)) {
      // Desenlace desconocido: el intento queda tal cual.
      // 401 CUSTOMER_INACTIVE: volver a verificar no sirve (el servidor contesta lo mismo). El intento NO se resuelve: queda
      // hasta que se cierre la pestaña (sessionStorage); sólo una respuesta definitiva lo borra.
      if (e instanceof ApiError && e.code === 'CUSTOMER_INACTIVE')
        return { kind: 'error', message: t('checkout.inactive'), retryable: false }
      if (e instanceof ApiError && e.status === 401) {
        clearSession(slug)
        return { kind: 'needsOtp' }
      }
      return { kind: 'error', message: errorText(t, e), retryable: true }
    }
    settleAttempt(slug)
    const details = (e.details ?? {}) as any
    if (e.code === 'PRICE_CHANGED' && details.quote)
      return {
        kind: 'priceChanged',
        quote: details.quote,
        body: { ...attempt.body, expectedTotal: expectedTotalFromQuote(details.quote.total) },
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
      : e.code === 'PLAN_REQUIRED' ? t('store.disabled')
      : e.code === 'VENUE_NOT_FOUND' ? t('store.notFound')
      : e.code === 'IDEMPOTENCY_KEY_CONFLICT' ? t('checkout.failed')
      : errorText(t, e)
    return { kind: 'error', message, retryable: false }
  }
  // Primero el pedido guardado y luego borrar el intento: si algo muere en medio, el reintento recupera el mismo pedido.
  saveLastOrder(slug, { trackingToken: order.trackingToken, orderNumber: order.orderNumber })
  settleAttempt(slug)
  // Aquí (una vez por respuesta del servidor) y no en `send`: un doble toque comparte esta petición y no repite el evento.
  if (store.host) emitOrderCreated(store.host, slug, order)
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
    case 'priceChanged':
      store.quote.value = isSentCart() ? r.quote : null
      c.feedback.value = { kind: 'priceChanged', total: r.quote.total, body: r.body }
      break
    case 'cartInvalid':
      // El carrito vuelve a cotizar al entrar y cuelga los issues de cada renglón.
      store.go('cart')
      break
    case 'storeUnavailable':
      if (store.info.value) store.info.value = { ...store.info.value, status: r.status, reason: r.reason }
      void store.refreshInfo()
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
