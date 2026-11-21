// Envío del pedido sin duplicados. Reglas (spec §5.3 y notas de las tareas 5 y 6):
// - Un intento = una llave. Si hay un intento pendiente se manda ESE cuerpo con ESA llave (beginAttempt lo devuelve).
// - Sólo una respuesta DEFINITIVA lo borra; red, 5xx, 408, 429, 401 y un 404 sin la marca `final` lo conservan y se reintenta igual.
// - El teléfono que se verifica es el del cuerpo que se va a mandar (el del intento pendiente, si lo hay).
// - «Nadie» (tienda híbrida): el pedido de caja va sin teléfono y no pasa por el código; con la sesión de la página si la hay (W3: sus
//   beneficios). Un intento pendiente sin teléfono se reenvía tal cual (mismo cuerpo, misma llave) aunque el negocio ya sea «Mi equipo»;
//   sólo un 401 PHONE_VERIFICATION_REQUIRED (nunca llegó a crearse) lo suelta y pide los datos de «Mi equipo».
// - Fase 2: pagar con tarjeta no pide el código; el pago en Stripe es la prueba. Va con la sesión de la página si la hay (W3 c); en
//   «Nadie» la exige (D661, abajo). El modo es el del cuerpo que se manda.
// - D661: en «Nadie» la tarjeta (el cuerpo de tarjeta SIN teléfono) es de la clienta de la sesión: sin sesión se va a entrar, sin mandar
//   nada ni guardar un intento. Si la tarjeta ya no se acepta o está llena, se dice en una línea y se deja lista «Pagar en caja».
import { signal, type Signal } from '@preact/signals'
import { ApiError, createOrder, quote, verifyOrderingOtp } from './api'
import { autorizarIntento, beginAttempt, pendingAttempt, reautorizarIntento, settleAttempt, soltarIntento } from './attempt'
import { desdeUnica, loadSession, samePhone, saveLastOrder, type OrderingSession } from './session'
import {
  abrirPagina, alCambiarLaPagina, clienteDelToken, entrarAqui, epocaDe, epocaDelNegocio, fijarPagina, paginaDe, salidaDe, sesionParaMandar,
  soltarLaPagina, type SesionEmitida,
} from '../lib/sesionDeCliente'
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
  /**
   * El negocio pasó a «Mi equipo» y el pedido salió sin teléfono: el anónimo (401 PHONE_VERIFICATION_REQUIRED) o la tarjeta de «Nadie»
   * (el 400 sin código «Escribe tu teléfono», ronda 1 M4). La pantalla pide WhatsApp; el intento ya se soltó.
   */
  | { kind: 'needsPhone' }
  /** W3-r3: el token con que salió el intento recibió 401: sólo entrar otra vez lo termina (el intento se queda). */
  | { kind: 'needsSesion' }
  /**
   * D661: la tarjeta en «Nadie» va con su cuenta: a entrar y de regreso a «Tus datos». Sin sesión no se manda nada; un intento de
   * «Mi equipo» con tarjeta y sin sesión que recibió 401 (el negocio pasó a «Nadie», ronda 1 M4) ya se soltó.
   */
  | { kind: 'entrarParaPagar' }
  /**
   * D661: la tarjeta no se puede ahora: en «Nadie», ya no se acepta, hay muchos pagos en línea, el tope de pagos sin terminar o el monto
   * (ronda 1 M5), y se paga en caja; en cualquier modo, CARD_PAYMENT_NOT_ACCEPTED (ronda 2, Ruling 59). Se relee /info y la caja queda
   * elegida si existe. El intento se soltó.
   */
  | { kind: 'tarjetaNoDisponible'; message: string }
  /**
   * `body` = el cuerpo enviado con el total nuevo (sin lo que ya no está): se manda (con OTRA llave) sólo si la persona confirma.
   * `motivo` (W3): `SIN_SESION` = la sesión se cerró (va sin beneficios); un beneficio = ése ya no está (p. ej. el premio se usó).
   */
  | { kind: 'priceChanged'; quote: Quote; body: CreateOrderBody; motivo?: Motivo; descartados?: BeneficioElegido[] }
  | { kind: 'cartInvalid'; issues: QuoteIssue[] }
  | { kind: 'storeUnavailable'; status: StoreStatus; reason: StoreReason }
  | { kind: 'error'; message: string; retryable: boolean }
  /**
   * Pasada por familias (Ruling 84): la respuesta llegó cuando la sesión que la mandó ya no está en la tienda (salió, entró otra, o la
   * página ya es de otra clienta). Lo que toca al intento se hizo igual; la pantalla no la pinta: ni Stripe, ni el seguimiento guardado,
   * ni la pregunta del precio.
   */
  | { kind: 'ajena' }

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
  // Sin nada de beneficios en la cotización, se cotizó sin sesión: no se manda nada (sería `SIN_SESION`).
  if (!q.oferta && !q.aplicados && !q.beneficios) return undefined
  const o = q.oferta
  // codex-w3-r1 #2: sin `oferta` (sin calcular por carga, o la recotización de un PRICE_CHANGED) lo elegido va igual: se calcula al
  // pedir, o ya está en su total. Con `oferta`, sólo lo que se ofreció.
  const ofrecido = !o ? e : {
    ...(e.premioId && o.premio?.id === e.premioId ? { premioId: e.premioId } : {}),
    ...(e.puntos && o.puntos ? { puntos: e.puntos } : {}),
    ...(e.cupon && o.cupon ? { cupon: e.cupon } : {}),
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
/**
 * `payment`: lo que eligió la persona en «¿Cómo quieres pagar?». Sin elegir, tarjeta si el negocio la acepta; en «Nadie», sólo con sesión
 * (ronda 1, Ruling 46: si no, «Pagar en caja»).
 */
export interface CheckoutDraft {
  note: string; name: string; dial: string; national: string; email: string; accepted: boolean; payment?: PaymentMode
}
const borradorVacio = (): CheckoutDraft => ({ note: '', name: '', dial: '52', national: '', email: '', accepted: false })
export type Feedback =
  | { kind: 'sesionParaTerminar' }
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
  /**
   * D17: los teléfonos cuyo ÚLTIMO código el SERVIDOR dijo que NO salió (`OTP_SEND_FAILED`). Vive aquí y no en la pantalla: una respuesta
   * que llega después de salir y volver la ve la pantalla nueva (codex-r2 #1). Uno por teléfono: el de A no toca el de B (codex-r3).
   */
  otpNoSalio: Signal<ReadonlySet<string>>
  /** D17: el número de la última petición de código de cada teléfono. Una respuesta sólo cuenta si sigue siendo la última del suyo. */
  otpPeticion: Map<string, number>
  /** W3: lo que la clienta eligió usar en este pedido (premio, puntos, cupón). Sólo se manda lo que la cotización ofreció. */
  eleccion: Signal<EleccionDeBeneficios>
  /** W3: un 401 soltó la sesión de la página en esta tienda: el carrito lo dice con calma y ofrece entrar otra vez. */
  sesionCerrada: Signal<boolean>
  /** W4: la tienda tiene sesión (el guardián): el menú dice «Mi cuenta»; sin ella, «Entrar». */
  conSesion: Signal<boolean>
  /** D661: se fue a entrar para pagar con tarjeta: al entrar regresa a «Tus datos». La tienda lo lee (y lo apaga) al llegar a «entrar». */
  paraPagar: boolean
  /**
   * Limpieza final (Ruling 77): la ficha de la última sesión que tuvo la tienda (aunque ya se haya perdido por un 401). Si llega la de OTRA,
   * lo de la anterior se vacía; `null` tras su «Cerrar sesión» (lo que se escriba después ya es de quien sigue).
   */
  clienta: string | null
}
const checkouts = new WeakMap<OrderStore, Checkout>()
/** Lo que una clienta escribió en «Tus datos» y eligió usar (premio, puntos, cupón) no se queda para la siguiente; el carrito sí. */
function vaciarLoSuyo(c: Checkout): void {
  c.draft.value = borradorVacio()
  c.eleccion.value = {}
}
export function checkoutOf(store: OrderStore): Checkout {
  let c = checkouts.get(store)
  if (!c) {
    const feedback = signal<Feedback | null>(null)
    c = {
      busy: signal(false),
      feedback,
      pending: signal(!!pendingAttempt(store.slug)),
      lastBody: signal(null),
      draft: signal(borradorVacio()),
      otpSentAt: new Map(),
      otpNoSalio: signal(new Set<string>()),
      otpPeticion: new Map(),
      eleccion: signal({}),
      sesionCerrada: signal(false),
      conSesion: signal(false),
      paraPagar: false,
      clienta: null,
    }
    // W1 (alcance A): abrir la tienda abre la página de ese negocio (la primera vez en el documento; recrear la tienda no relee).
    abrirPagina(store.slug, 'pedidos', leerPedidos(store.slug))
    const abierta = paginaDe(store.slug, 'pedidos')
    c.conSesion.value = !!abierta
    c.clienta = abierta && clienteDelToken(abierta.token)
    // r12, la pantalla no miente: si la tienda pierde su sesión (por donde sea: ya no está guardada, un 401 al cotizar o al pedir), lo
    // cotizado con ella ya no vale (se vuelve a cotizar sin sesión) y se dice con calma. Si entra otra vez, el aviso se va.
    // ponytail: un oyente por tienda creada, sin quitarlo al recrearla (pesa un cierre); si se recrean miles, devolver un «dejar de oír».
    const slug = store.slug
    alCambiarLaPagina((s, afecta, misma) => {
      if (s !== slug) return
      // Ronda 5: «Cerrar sesión» en cualquier superficie del negocio (también reservas, en esta misma página) suelta el intento de la
      // pestaña: el aviso y «Pedir» bloqueado se van con él.
      c!.pending.value = !!pendingAttempt(slug)
      if (misma || !afecta.includes('pedidos')) return
      const p = paginaDe(slug, 'pedidos')
      c!.conSesion.value = !!p
      c!.sesionCerrada.value = !p
      if (!p) store.quote.value = null
      // Limpieza final: llegó la sesión de OTRA clienta sin su «Cerrar sesión» (tras un 401, o tras salir en reservas): lo de la anterior
      // se vacía. Si vuelve la misma, lo suyo se queda.
      const ahora = p && clienteDelToken(p.token)
      if (ahora && c!.clienta && ahora !== c!.clienta) vaciarLoSuyo(c!)
      if (ahora) c!.clienta = ahora
    })
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
  // Entró aquí: la tienda adopta EXACTAMENTE la que guardó (r11), nunca una que otra pestaña escriba después.
  if (entrarAqui(store.slug, 'pedidos', { token: r.token, customer: r.customer, contactos: r.contactos, guardadaEn: Date.now() }, desdeUnica) !== 'fallo')
    reautorizarIntento(store.slug, r.token)
  return true
}

const leerPedidos = (slug: string) => () => loadSession(slug)

/**
 * La sesión con que pide la tienda: la de la página (el guardián, `tokenDeLaPagina`), mientras siga guardada (la renovada cuenta como
 * la misma). Si ya no (salió en otra pestaña, entró otra ficha u otra prueba del teléfono), queda sin sesión; nunca toma otra.
 */
function sesionDeLaTienda(store: OrderStore): OrderingSession | null {
  checkoutOf(store) // abre la página si la tienda todavía no se pintó
  // r11: UNA lectura; lo que se valida es lo que se manda. Si ya no es la guardada, la suelta (y el oyente de `checkoutOf` lo dice).
  return sesionParaMandar(store.slug, 'pedidos', leerPedidos(store.slug))
}

/** Un 401 del token con que pidió la tienda: el guardián lo suelta (si es de su sesión, también la renovación) y queda sin sesión. */
const soltar401 = (store: OrderStore, token: string | undefined) => {
  if (token) soltarLaPagina(store.slug, 'pedidos', token, leerPedidos(store.slug))
}

/**
 * W3: cotiza con la sesión de la página y lo elegido (sin sesión, como hoy). (b) Un 401 suelta la sesión por el guardián y se vuelve a
 * cotizar sin ella; el carrito lo dice con calma (`sesionCerrada`).
 */
export async function cotizar(store: OrderStore, items: QuoteItem[]): Promise<Quote> {
  const c = checkoutOf(store)
  const s = sesionDeLaTienda(store)
  const epoca = epocaDe(store.slug, 'pedidos')
  let q: Quote
  try {
    q = await quote(store.slug, items, s ? { token: s.token, beneficios: c.eleccion.value } : {})
  } catch (e) {
    if (!s || !(e instanceof ApiError) || e.status !== 401) throw e
    soltar401(store, s.token)
    return cotizar(store, items)
  }
  // r12: la sesión de la tienda cambió mientras volaba (se perdió, o entró otra): esa respuesta ya no es de nadie; se cotiza de nuevo.
  return epocaDe(store.slug, 'pedidos') === epoca ? q : cotizar(store, items)
}

/**
 * (e) Entró otra vez desde la tienda (`EntrarConCuenta`): la página toma esa sesión y se vuelve al carrito, que cotiza con ella.
 * W4: desde «Mi cuenta» (`volverA` null) se queda ahí. D661: si entró para pagar con tarjeta, regresa a «Tus datos» (`'details'`).
 */
export function entroEnLaTienda(store: OrderStore, r: SesionEmitida, volverA: 'cart' | 'details' | null = 'cart'): void {
  const c = checkoutOf(store)
  // r11: adopta la sesión con que entró (`EntrarConCuenta` ya la guardó), sin releer lo guardado.
  fijarPagina(store.slug, 'pedidos', desdeUnica({ token: r.token, customer: r.customer, contactos: r.contactos, guardadaEn: Date.now() }))
  reautorizarIntento(store.slug, r.token, true) // un intento que esperaba entrar sale con ésta (misma llave y cuerpo), si es de ella
  c.pending.value = !!pendingAttempt(store.slug) // ronda 5: si entró otra, el de la anterior se soltó
  c.sesionCerrada.value = false
  c.feedback.value = null
  if (volverA) store.go(volverA)
}

/**
 * W4: «Cerrar sesión» en «Mi cuenta» de la tienda. Salió ella: el carrito no dice «Tu sesión se cerró». Ronda 4: su intento pendiente se fue
 * con la sesión (`soltarLaPagina`; el oyente de `checkoutOf` lo ve): la pantalla ya no ofrece «Reintentar» lo suyo ni bloquea «Pedir» por
 * él. Ronda 5: lo que escribió en «Tus datos» y lo que eligió usar tampoco se quedan para quien sigue (el carrito sí, como siempre).
 */
export function salioEnLaTienda(store: OrderStore): void {
  const c = checkoutOf(store)
  soltarLaPagina(store.slug, 'pedidos', undefined, leerPedidos(store.slug))
  c.sesionCerrada.value = false
  c.feedback.value = null
  vaciarLoSuyo(c)
  c.clienta = null
}

/**
 * Pasada por familias (Ruling 83): lo que se manda es SIEMPRE el medio que se ve. Con un intento pendiente, el suyo (lo que «Reintentar»
 * manda; mientras, el radio no se mueve); con «El precio cambió» a la vista, el de su cuerpo (lo que «Confirmar» manda; cambiar el radio
 * quita la pregunta, Ruling 58). `null`: el que elija la persona.
 */
export function medioFijo(store: OrderStore): PaymentMode | null {
  const c = checkoutOf(store)
  const f = c.feedback.value
  return (c.pending.value ? pendingAttempt(store.slug)?.body.paymentMode : null) ?? (f?.kind === 'priceChanged' ? f.body.paymentMode : null)
}

/**
 * Pasada por familias (Ruling 83): «Empezar de nuevo» suelta A PROPÓSITO el intento pendiente de la pestaña (quizá nunca llegue su
 * respuesta). El medio queda como estaba, ya libre: el siguiente «Pedir» manda lo que se ve, con otra llave (con tarjeta, la copia exacta
 * de la misma compra recupera su llave: `attempt.ts`).
 */
export function empezarDeNuevo(store: OrderStore): void {
  const c = checkoutOf(store)
  const a = pendingAttempt(store.slug)
  if (a) c.draft.value = { ...c.draft.value, payment: a.body.paymentMode }
  soltarIntento(store.slug)
  c.pending.value = false
  c.feedback.value = null
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

/**
 * Ruling 84: la sesión con que sale un pedido: la marca de «Cerrar sesión» del negocio (cambia al salir en cualquier página o pestaña)
 * y la sesión de la tienda.
 */
interface Generacion { salida: string | null; identidad: string | null }
const generacionDe = (slug: string): Generacion => ({ salida: salidaDe(slug), identidad: paginaDe(slug, 'pedidos')?.identidad ?? null })
/**
 * Ruling 84: ¿la respuesta ya es de otra sesión? Sí si salió (aquí, en reservas o en otra pestaña), si entró alguien en la tienda, o si el
 * pedido (un reintento) salió con una clienta y la tienda ya tiene a OTRA (las dos fichas legibles). Que la tienda se quede sin sesión (un
 * 401, también el de esta misma respuesta) no la vuelve de otra: se pinta como siempre (W3-r3).
 */
function esAjena(slug: string, al: Generacion, token: string | undefined): boolean {
  const p = paginaDe(slug, 'pedidos')
  const suya = token ? clienteDelToken(token) : null
  const deAhora = p && clienteDelToken(p.token)
  return salidaDe(slug) !== al.salida || (!!p && p.identidad !== al.identidad) || (!!suya && !!deAhora && suya !== deAhora)
}
/** Ruling 84: `doSubmit` deja aquí, al llegar la respuesta, si ya es de otra sesión. */
interface Envio { ajena?: boolean }

export function submitOrder(store: OrderStore, body: CreateOrderBody): Promise<SubmitResult> {
  const running = inflight.get(store.slug)
  if (running) return running
  const envio: Envio = {}
  const p = doSubmit(store, body, envio)
    .then((r): SubmitResult => (envio.ajena ? { kind: 'ajena' } : r))
    .finally(() => inflight.delete(store.slug))
  inflight.set(store.slug, p)
  return p
}

async function doSubmit(store: OrderStore, body: CreateOrderBody, envio: Envio): Promise<SubmitResult> {
  const { slug } = store
  const t = createOrderT(store.locale)
  const pending = pendingAttempt(slug)
  // Con el almacenamiento bloqueado la sesión no se guardaría: se pediría un código tras otro sin poder pedir nunca.
  if (!pending && !storageWorks()) return { kind: 'error', message: t('checkout.noStorage'), retryable: false }
  const card = (pending?.body ?? body).paymentMode === 'CARD_ONLINE'
  const phone = (pending?.body ?? body).customer.phone
  // Sin teléfono (el pedido de «Nadie») no hay nada que verificar ni código; si la página tiene sesión, va con ella (W3: sus beneficios).
  const anon = !card && !phone
  // D661: la tarjeta de «Nadie» va sin teléfono y SIEMPRE con la sesión (de ella es el apartado y su saldo a favor).
  const cardNadie = card && !phone
  let attempt = pending
  // codex-w3-r3 #3: en un reintento se lee la sesión de la página para que la pantalla se entere si se perdió («Tu sesión se cerró»,
  // sin premios); lo que se manda es lo guardado. codex-w3-r4 #1: UNA lectura, que también usa un intento viejo sin `token`.
  const vista = attempt ? sesionDeLaTienda(store) : null
  if (attempt?.requiereEntrar) return card || anon ? { kind: 'needsSesion' } : { kind: 'needsOtp' }
  if (!attempt) {
    const session = sesionDeLaTienda(store)
    // El mismo texto que se verificó cuenta siempre (samePhone pide 10 dígitos y no reconoce números más cortos).
    if (!card && phone && (!session?.phone || (session.phone !== phone && !samePhone(session.phone, phone)))) return { kind: 'needsOtp' }
    // D661: sin sesión el SERVIDOR contestaría 401 (no crea nada): se va a entrar antes, sin mandar ni guardar un intento.
    if (cardNadie && !session) return { kind: 'entrarParaPagar' }
    // W3-r3: ANTES de mandar se guarda todo lo que sale: llave, cuerpo y token (o sin sesión).
    attempt = beginAttempt(slug, body, session?.token ?? null, session?.identidad ?? null)
    if (!attempt) return { kind: 'error', message: t('checkout.noStorage'), retryable: false }
  }
  // W3-r3: un reintento reenvía EXACTAMENTE lo guardado, nunca la sesión de ahora. codex-w3-r3 #1: un intento de antes de este cambio
  // (sin `token`) sale como en producción: «Nadie» y tarjeta sin sesión; «Mi equipo» al recoger, con la de ahora.
  const token = attempt.token !== undefined ? attempt.token ?? undefined : anon || card ? undefined : vista?.token
  // Ruling 84: la respuesta es de la sesión que la mandó. Si al llegar ya salió, entró otra, o la tienda ya tiene a otra clienta, lo del
  // intento se hace igual pero nada se pinta (`submitOrder`). Se mira al llegar, antes de lo que la misma respuesta haga con la sesión.
  const generacion = generacionDe(slug)

  let order: CreatedOrder | CreatedCardOrder
  try {
    // W3: la sesión de la página va también en «Nadie» y con tarjeta (c): así el SERVIDOR aplica lo elegido y liga el folio a ella.
    order = await createOrder(slug, attempt.body, { idempotencyKey: attempt.key, token })
    envio.ajena = esAjena(slug, generacion, token)
    if (typeof order?.trackingToken !== 'string') throw new Error('respuesta sin pedido')
  } catch (e) {
    envio.ajena ??= esAjena(slug, generacion, token)
    if (!(e instanceof ApiError) || !isDefinitive(e)) {
      // Desenlace desconocido: el intento queda tal cual.
      // 401 CUSTOMER_INACTIVE: volver a verificar no sirve (el servidor contesta lo mismo). El intento NO se resuelve: queda
      // hasta que se cierre la pestaña (sessionStorage); sólo una respuesta definitiva lo borra.
      if (e instanceof ApiError && e.code === 'CUSTOMER_INACTIVE') {
        // codex-r4 R4-4: la sesión rechazada no se queda guardada (el intento sí, como cualquier respuesta no definitiva).
        soltar401(store, token)
        return { kind: 'error', message: t('checkout.inactive'), retryable: false }
      }
      if (e instanceof ApiError && e.status === 401 && e.code === 'PHONE_VERIFICATION_REQUIRED' && anon) {
        // Nunca llegó a crearse: se suelta el intento y la persona da los datos de «Mi equipo».
        settleAttempt(slug)
        return { kind: 'needsPhone' }
      }
      // Ronda 1 M4: un intento con tarjeta de «Mi equipo» (con teléfono, sin sesión) y el negocio ya en «Nadie», donde la tarjeta pide su
      // cuenta. Nunca se creó: se suelta (si no, «Reintentar» lo repetiría sin fin) y a entrar, de regreso a «Tus datos».
      if (e instanceof ApiError && e.status === 401 && e.code === 'PHONE_VERIFICATION_REQUIRED' && card && !token) {
        settleAttempt(slug)
        return { kind: 'entrarParaPagar' }
      }
      if (e instanceof ApiError && e.status === 401 && token) {
        // W3-r3: el token guardado ya no vale (vencido o revocado). El SERVIDOR lo rechazó antes de tocar el pedido; el intento se queda y
        // sólo entrar otra vez lo termina («Mi equipo», con el código): nunca se reintenta con la vieja ni sale sin ella.
        soltar401(store, token)
        autorizarIntento(slug, { requiereEntrar: true })
        return card || anon ? { kind: 'needsSesion' } : { kind: 'needsOtp' }
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
      // codex-w3-r1 #3: con tarjeta, el total exacto con beneficios viene aparte (`totalEstricto`) cuando la cotización salió degradada.
      const quote: Quote = typeof details.totalEstricto === 'number' ? { ...details.quote, total: details.totalEstricto } : details.quote
      const fuera: BeneficioElegido[] = details.descartados ?? details.quote.descartados ?? []
      const { beneficios: antes, ...resto } = attempt.body
      const beneficios = sinSesion ? undefined : sinLosDe(antes, fuera)
      return {
        kind: 'priceChanged',
        quote,
        body: { ...resto, ...(beneficios ? { beneficios } : {}), expectedTotal: expectedTotalFromQuote(quote.total) },
        ...(sinSesion ? { motivo: 'SIN_SESION' as const } : fuera[0] ? { motivo: fuera[0], descartados: fuera } : {}),
      }
    }
    if (e.code === 'CART_INVALID') return { kind: 'cartInvalid', issues: details.issues ?? [] }
    // D661: la tarjeta de «Nadie» se ofrece sólo mientras una caja avisa (puede irse entre cargar y pagar) y tiene cupo por sucursal.
    // Ninguna de las dos es «la tienda no recibe pedidos» (nunca `ORDERING_*`): en caja se sigue pagando. Ronda 2 (Ruling 59): la tarjeta
    // que ya no se acepta SIEMPRE relee /info, también en «Mi equipo» (el negocio pudo cambiar de modo: el SERVIDOR revisa la tarjeta antes
    // que la sesión) y deja la caja elegida si existe; «Elige pagar al recoger» sólo si esa opción existe.
    if (e.code === 'CARD_PAYMENT_NOT_ACCEPTED')
      return {
        kind: 'tarjetaNoDisponible',
        message: t(cardNadie ? 'checkout.cardNadieUnavailable'
          : store.info.value?.paymentModes?.payAtPickup ? 'checkout.cardNotAccepted' : 'checkout.cardNotAcceptedOnly'),
      }
    if (cardNadie && e.code === 'CARD_ONLINE_QUEUE_FULL') return { kind: 'tarjetaNoDisponible', message: t('checkout.cardNadieBusy') }
    // Ronda 1 M5: el tope por cliente (cuenta páginas de pago sin terminar; en «Nadie» nadie «responde») y el monto fuera de lo que se paga
    // con tarjeta. En caja sí se puede.
    if (cardNadie && e.code === 'TOO_MANY_PENDING_ORDERS') return { kind: 'tarjetaNoDisponible', message: t('checkout.cardNadiePending') }
    if (cardNadie && e.code === 'CARD_AMOUNT_OUT_OF_RANGE') return { kind: 'tarjetaNoDisponible', message: t('checkout.cardNadieAmount') }
    // Ronda 1 M4: el negocio pasó a «Mi equipo» y la tarjeta de «Nadie» va sin teléfono: lo pide el 400 sin código del esquema (sólo su
    // texto lo distingue de otro 400 de validación). Como el pedido anónimo: la pantalla pide WhatsApp.
    if (cardNadie && e.status === 400 && !e.code && e.message.includes('Escribe tu teléfono')) return { kind: 'needsPhone' }
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
      : e.code === 'CARD_AMOUNT_OUT_OF_RANGE' ? t('checkout.cardAmountOutOfRange')
      : errorText(t, e)
    return { kind: 'error', message, retryable: false }
  }
  // El borrador de tarjeta todavía no tiene folio (nace con el pedido, al confirmarse el pago).
  const orderNumber = 'orderNumber' in order ? order.orderNumber : ''
  // Ruling 84: de otra sesión, ni su seguimiento se guarda en este navegador, ni se avisa, ni se abre su página de pago.
  const mia = !envio.ajena
  // Primero el pedido guardado y luego borrar el intento: si algo muere en medio, el reintento recupera el mismo pedido.
  if (mia) saveLastOrder(slug, { trackingToken: order.trackingToken, orderNumber, ...(anon ? { name: attempt.body.customer.name } : {}) })
  // Stripe sólo con un borrador que espera el pago y su liga: una repetición que ya avanzó o venció va al seguimiento (`send`). Ronda 2 #1:
  // mientras esa página siga abierta, la misma compra en otra pestaña la reusa (attempt.ts).
  const pagina = 'checkoutUrl' in order && order.status === 'AWAITING_PAYMENT' && /^https:\/\//.test(order.checkoutUrl) ? order.checkoutUrl : null
  settleAttempt(slug, pagina ? { trackingToken: order.trackingToken } : undefined)
  // Aquí (una vez por respuesta del servidor) y no en `send`: un doble toque comparte esta petición y no repite el evento.
  if (mia && store.host) emitOrderCreated(store.host, slug, { trackingToken: order.trackingToken, orderNumber })
  if (mia && pagina) nav.assign(pagina)
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
    case 'needsSesion':
      c.feedback.value = { kind: 'sesionParaTerminar' }
      break
    case 'entrarParaPagar':
      // D661: entra y regresa a «Tus datos» con su carrito y lo que escribió; ahí «Pedir» ya paga con su sesión.
      c.paraPagar = true
      // Ronda 1 M4: llegó por un intento de «Mi equipo» y el negocio ya está en «Nadie»: la pantalla se pone al día (como needsPhone).
      if (store.info.value && store.info.value.requiresAcceptance !== false) {
        store.info.value = { ...store.info.value, requiresAcceptance: false }
        void store.refreshInfo()
      }
      store.go('entrar')
      break
    case 'tarjetaNoDisponible':
      // D661: una línea (ámbar en «Nadie», CheckoutStatus; la de «Mi equipo», como hoy) y la caja lista si existe; nunca una pantalla de
      // error ni un carrito perdido. /info al día: si la tarjeta ya no se ofrece, la opción se va (o el formulario pasa al otro modo).
      c.draft.value = { ...c.draft.value, payment: 'PAY_AT_PICKUP' }
      c.feedback.value = { kind: 'error', message: r.message, retryable: false }
      void store.refreshInfo()
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
        // codex-w3-r2 #4: TODOS los descartados salen de la elección.
        if (r.descartados?.length) c.eleccion.value = sinLosDe(c.eleccion.value, r.descartados) ?? {}
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
