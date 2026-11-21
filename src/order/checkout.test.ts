import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Las mismas funciones simuladas sobreviven a `vi.resetModules()` (la «recarga» de la página).
const api = vi.hoisted(() => ({
  createOrder: vi.fn(),
  requestOrderingOtp: vi.fn(),
  verifyOrderingOtp: vi.fn(),
  getInfo: vi.fn(),
  getMenu: vi.fn(),
  quote: vi.fn(),
}))
vi.mock('./api', async () => ({ ...(await vi.importActual<typeof import('./api')>('./api')), ...api }))

import { ApiError } from './api'
import {
  buildOrderBody, checkoutOf, cotizar, entroEnLaTienda, isDefinitive, nav, phoneToVerify, retry, salioEnLaTienda, send, storageWorks, submitOrder,
  verifyPhone,
} from './checkout'
import { toQuoteItems } from './cart'
import { createOrderStore, type OrderStore } from './store'
import { loadLastOrder, loadSession, saveSession } from './session'
import { aplicarRenovacion, borrarSesion, documentoNuevoParaPruebas, guardarSesion, leerSesion, paginaDe } from '../lib/sesionDeCliente'
import { clearCustomerSession, setCustomerSession, tokenParaMandar } from '../state/booking'
import { pendingAttempt } from './attempt'
import { phoneE164 } from './phone'
import type { CartLine } from './cart'
import type { CreatedCardOrder, CreatedOrder, Quote, StoreInfo } from './types'

const KEY_RE = /^[A-Za-z0-9_-]{32,64}$/
const PHONE = phoneE164('52', '55 4442 2262')

const line = (over: Partial<CartLine> = {}): CartLine => ({
  lineId: 'l1', productId: 'p-flauta', name: 'Flautas', unitPrice: 85, quantity: 2, note: null,
  modifiers: [{ modifierId: 'm-salsa', name: 'Verde', price: 0, quantity: 1 }], ...over,
})
const quoteOf = (total: number, over: Partial<Quote> = {}): Quote => ({
  ok: true, lines: [], subtotal: total, total, minOrderAmount: 0, issues: [], ...over,
})
const info = { venue: { slug: 'x', name: 'Flautas Coyoacán' }, status: 'OPEN', reason: null } as unknown as StoreInfo
const created = (over: Partial<CreatedOrder> = {}): CreatedOrder => ({
  orderId: 'o1', onlineOrderId: 'oo1', trackingToken: 'T'.repeat(32), status: 'PENDING_ACCEPTANCE', orderNumber: '101',
  total: '170.00', acceptDeadlineAt: '2026-10-17T19:00:00Z', replay: false, ...over,
})
const offline = () => new ApiError('Sin conexión', 0, undefined, undefined, true)
/** W2: lo que responde el código con `purpose: 'SESSION'` (la sesión única de S7). */
const sesion = (token: string) => ({
  token, customer: { id: 'c1', firstName: 'Ana', lastName: null, email: null, phone: PHONE },
  contactos: [{ tipo: 'PHONE', valor: PHONE, metodo: 'WHATSAPP', probadoEn: 1 }], otraFicha: null,
})
/** Un rechazo con la marca `final: true` que el servidor pone a lo que dejó guardado. */
const fin = (status: number, code: string, details?: unknown) => new ApiError('x', status, code, details, false, true)
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }

let n = 0
/** `antes`: lo guardado ANTES de abrir la tienda (crearla abre la página y toma lo guardado en ese momento). */
function setup(opts: { total?: number; sessionPhone?: string | null; antes?: (slug: string) => void } = {}) {
  const slug = `chk${++n}`
  const sessionPhone = opts.sessionPhone === undefined ? PHONE : opts.sessionPhone
  if (sessionPhone) saveSession(slug, { token: 'tok-1', phone: sessionPhone, name: 'Ana', savedAt: Date.now() })
  opts.antes?.(slug)
  const store = createOrderStore(slug, { locale: 'es' })
  store.cart.value = [line()]
  store.quote.value = quoteOf(opts.total ?? 170)
  store.info.value = info
  const body = buildOrderBody(store, { customer: { name: ' Ana López ', phone: PHONE }, note: null })
  return { store, body }
}
const sent = (i = 0) => {
  const [slug, body, opts] = api.createOrder.mock.calls[i]
  return { slug, body, key: opts.idempotencyKey as string, token: opts.token as string }
}

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  // `clearMocks` no vacía las colas de mockResolvedValueOnce: una que sobre no debe pasar a la prueba siguiente.
  for (const f of Object.values(api)) f.mockReset()
})
afterEach(() => vi.restoreAllMocks())

describe('buildOrderBody', () => {
  it('W4: con canal QR el pedido manda channel QR; sin él (la liga copiada), LINK', () => {
    const mk = (channel?: 'QR' | 'LINK') => {
      const store = createOrderStore(`chk${++n}`, { locale: 'es', ...(channel ? { channel } : {}) })
      store.cart.value = [line()]
      store.quote.value = quoteOf(170)
      return buildOrderBody(store, { customer: { name: 'Ana' }, note: null }).channel
    }
    expect(mk('QR')).toBe('QR')
    expect(mk()).toBe('LINK')
    expect(mk('LINK')).toBe('LINK')
  })
  it('el total que se manda es el de la cotización del servidor, con dos decimales; nombre recortado; sin correo ni nota vacíos', () => {
    const { store, body } = setup({ total: 206.5 })
    expect(body).toEqual({
      items: [{ productId: 'p-flauta', quantity: 2, modifiers: [{ modifierId: 'm-salsa', quantity: 1 }] }],
      paymentMode: 'PAY_AT_PICKUP',
      expectedTotal: '206.50',
      customer: { name: 'Ana López', phone: '+525544422262' },
      channel: 'LINK',
    })
    const withAll = buildOrderBody(store, { customer: { name: 'Ana', phone: PHONE, email: ' ana@x.mx ' }, note: ' sin cebolla ' })
    expect(withAll.customer.email).toBe('ana@x.mx')
    expect(withAll.note).toBe('sin cebolla')
  })
  it('el teléfono es el de phoneE164: con el 52 repetido nunca sale +5252…', () => {
    expect(phoneE164('52', '525544422262')).toBe('+525544422262')
  })
})

describe('isDefinitive', () => {
  it.each([
    ['sin red', offline(), false],
    ['500', new ApiError('No se pudo crear tu pedido', 500), false],
    ['502 de un proxy con HTML', new ApiError('HTTP 502', 502), false],
    ['504', new ApiError('HTTP 504', 504), false],
    ['429', new ApiError('HTTP 429', 429, 'RATE_LIMIT_EXCEEDED'), false],
    ['401', new ApiError('Token inválido', 401, 'CUSTOMER_TOKEN_INVALID'), false],
    ['400 CART_INVALID', new ApiError('x', 400, 'CART_INVALID'), true],
    ['400 de validación', new ApiError('Error de validación: …', 400), true],
    ['403', new ApiError('x', 403, 'PLAN_REQUIRED'), true],
    ['404 VENUE_NOT_FOUND sin marca final (el slug pudo cambiar: el pedido aún puede crearse)', new ApiError('x', 404, 'VENUE_NOT_FOUND'), false],
    ['404 con final:true (rechazo que el servidor dejó guardado)', fin(404, 'VENUE_NOT_FOUND'), true],
    ['409 PRICE_CHANGED', new ApiError('x', 409, 'PRICE_CHANGED'), true],
    ['409 PRICE_CHANGED con final:true', fin(409, 'PRICE_CHANGED'), true],
    ['409 IDEMPOTENCY_KEY_CONFLICT', new ApiError('x', 409, 'IDEMPOTENCY_KEY_CONFLICT'), true],
  ])('%s ⇒ %s', (_, e, expected) => {
    expect(isDefinitive(e)).toBe(expected)
  })
})

describe('submitOrder', () => {
  it('sesión válida del mismo teléfono ⇒ crea sin pedir código, con su token y una llave válida', async () => {
    const { store, body } = setup()
    api.createOrder.mockResolvedValueOnce(created())
    const r = await submitOrder(store, body)
    expect(r).toEqual({ kind: 'created', order: created() })
    expect(api.requestOrderingOtp).not.toHaveBeenCalled()
    expect(sent().body).toEqual(body)
    expect(sent().key).toMatch(KEY_RE)
    expect(sent().token).toBe('tok-1')
    expect(pendingAttempt(store.slug)).toBeNull()
    expect(loadLastOrder(store.slug)).toEqual({ trackingToken: 'T'.repeat(32), orderNumber: '101' })
  })

  it('teléfono distinto al de la sesión (o sin sesión) ⇒ needsOtp, sin llamada y sin intento guardado', async () => {
    const { store, body } = setup({ sessionPhone: '+525511111111' })
    expect(await submitOrder(store, body)).toEqual({ kind: 'needsOtp' })
    const other = setup({ sessionPhone: null })
    expect(await submitOrder(other.store, other.body)).toEqual({ kind: 'needsOtp' })
    expect(api.createOrder).not.toHaveBeenCalled()
    expect(pendingAttempt(store.slug)).toBeNull()
  })

  it('red caída y reintento ⇒ misma llave y mismo cuerpo, aunque se le pase otro', async () => {
    const { store, body } = setup()
    api.createOrder.mockRejectedValueOnce(offline()).mockResolvedValueOnce(created({ replay: true }))
    const r1 = await submitOrder(store, body)
    expect(r1).toEqual({ kind: 'error', message: 'Sin conexión. Revisa tu internet y vuelve a intentar.', retryable: true })
    expect(pendingAttempt(store.slug)?.key).toBe(sent(0).key)
    const r2 = await submitOrder(store, { ...body, expectedTotal: '999.00' })
    expect(r2.kind).toBe('created')
    expect(sent(1).key).toBe(sent(0).key)
    expect(sent(1).body).toEqual(sent(0).body)
  })

  it('red caída, recarga (módulos nuevos) y carrito editado ⇒ el siguiente envío lleva el cuerpo y la llave ORIGINALES', async () => {
    const { store, body } = setup()
    api.createOrder.mockRejectedValueOnce(offline())
    await submitOrder(store, body)
    const original = sent(0)

    vi.resetModules()
    const fresh = await import('./checkout')
    const { createOrderStore: freshStore } = await import('./store')
    const reloaded = freshStore(store.slug, { locale: 'es' })
    reloaded.cart.value = [line({ productId: 'p-taco', quantity: 5 })]
    reloaded.quote.value = quoteOf(300)
    api.createOrder.mockResolvedValueOnce(created({ replay: true }))

    const r = await fresh.submitOrder(reloaded, fresh.buildOrderBody(reloaded, { customer: { name: 'Otro', phone: PHONE }, note: null }))
    expect(r.kind).toBe('created')
    expect(sent(1).key).toBe(original.key)
    expect(sent(1).body).toEqual(original.body)
    expect(sent(1).body.items[0].productId).toBe('p-flauta')
  })

  it('PRICE_CHANGED ⇒ devuelve la cotización nueva, borra el intento y NO vuelve a llamar sin un toque', async () => {
    const { store, body } = setup()
    api.createOrder.mockRejectedValueOnce(new ApiError('El precio cambió', 409, 'PRICE_CHANGED', { quote: quoteOf(190) }))
    const r = await submitOrder(store, body)
    expect(r).toMatchObject({ kind: 'priceChanged', quote: { total: 190 } })
    await flush()
    expect(api.createOrder).toHaveBeenCalledTimes(1)
    expect(pendingAttempt(store.slug)).toBeNull()
  })

  it('CART_INVALID ⇒ los issues y el intento se borra', async () => {
    const { store, body } = setup()
    const issues = [{ code: 'PRODUCT_UNAVAILABLE', productId: 'p-flauta', lineIndex: 0, message: 'Un platillo de tu pedido ya no está disponible.' }]
    api.createOrder.mockRejectedValueOnce(new ApiError('Carrito inválido', 400, 'CART_INVALID', { issues }))
    expect(await submitOrder(store, body)).toEqual({ kind: 'cartInvalid', issues })
    expect(pendingAttempt(store.slug)).toBeNull()
  })

  it('401 ⇒ borra la sesión, conserva el intento y, tras verificar, reintenta el MISMO intento con el token nuevo', async () => {
    const { store, body } = setup()
    api.createOrder.mockRejectedValueOnce(new ApiError('Token inválido', 401, 'CUSTOMER_TOKEN_INVALID'))
    expect(await submitOrder(store, body)).toEqual({ kind: 'needsOtp' })
    expect(loadSession(store.slug)).toBeNull()
    expect(pendingAttempt(store.slug)?.key).toBe(sent(0).key)

    api.verifyOrderingOtp.mockResolvedValueOnce(sesion('tok-2'))
    await verifyPhone(store, phoneToVerify(store)!, '123456')
    api.createOrder.mockResolvedValueOnce(created())
    expect((await submitOrder(store, body)).kind).toBe('created')
    expect(sent(1).key).toBe(sent(0).key)
    expect(sent(1).body).toEqual(sent(0).body)
    expect(sent(1).token).toBe('tok-2')
    // W2: el código deja la sesión ÚNICA (la que también abre «Mi cuenta» y reservas), no la de pedidos de hoy.
    expect(leerSesion(store.slug)).toMatchObject({ token: 'tok-2', contactos: [{ tipo: 'PHONE', valor: PHONE }] })
    expect(localStorage.getItem(`avq_order_session:${store.slug}`)).toBeNull()

    // W1: un 401 con la sesión única la borra (y se pide el código otra vez), sin perder el intento.
    api.createOrder.mockRejectedValueOnce(new ApiError('Sesión vieja', 401, 'CUSTOMER_TOKEN_INVALID'))
    expect(await submitOrder(store, body)).toEqual({ kind: 'needsOtp' })
    expect(sent(2).token).toBe('tok-2')
    expect(leerSesion(store.slug)).toBeNull()
    expect(pendingAttempt(store.slug)).not.toBeNull()
  })

  it('alcance A: un 401 con la sesión vieja pide el código sin reenviar (ni con otra sesión ni con la vieja) y conserva carrito e intento', async () => {
    const { store, body } = setup({ sessionPhone: null, antes: slug => guardarSesion(slug, { ...sesion('tok-vieja'), guardadaEn: Date.now() } as any) })
    api.createOrder.mockImplementationOnce(async () => {
      // Otra pestaña entró (otra prueba del teléfono: otra sesión, no una renovación).
      guardarSesion(store.slug, { ...sesion('tok-nueva'), contactos: [{ tipo: 'PHONE', valor: PHONE, metodo: 'WHATSAPP', probadoEn: 2 }], guardadaEn: Date.now() } as any)
      throw new ApiError('Sesión vieja', 401, 'CUSTOMER_TOKEN_INVALID')
    })
    expect(await submitOrder(store, body)).toEqual({ kind: 'needsOtp' })
    expect(api.createOrder).toHaveBeenCalledTimes(1)
    expect(pendingAttempt(store.slug)?.key).toBe(sent(0).key)
    expect(store.cart.value).toHaveLength(1)
    expect(leerSesion(store.slug)?.token).toBe('tok-nueva') // la de la otra pestaña no se borra
  })

  it('codex-r5 E1: la tienda pide con la sesión con que se abrió; si otra pestaña entró con otra, no la toma: pide el código', async () => {
    const { store, body } = setup({ sessionPhone: null, antes: slug => guardarSesion(slug, { ...sesion('tok-A'), guardadaEn: Date.now() } as any) })
    checkoutOf(store) // abrir la tienda: toma A
    guardarSesion(store.slug, { ...sesion('tok-B'), contactos: [{ tipo: 'PHONE', valor: PHONE, metodo: 'WHATSAPP', probadoEn: 2 }], guardadaEn: Date.now() } as any)
    expect(await submitOrder(store, body)).toEqual({ kind: 'needsOtp' })
    expect(api.createOrder).not.toHaveBeenCalled()
  })

  it('codex-r6 #2: el 401 de A también suelta su renovación A2 (la misma sesión): no queda guardada ni vuelve al recargar', async () => {
    const { store, body } = setup({ sessionPhone: null, antes: slug => guardarSesion(slug, { ...sesion('tok-A'), guardadaEn: Date.now() } as any) })
    api.createOrder.mockImplementationOnce(async () => {
      // Otra petición, autenticada antes de revocar, renovó A (misma ficha, contactos y versión).
      guardarSesion(store.slug, { ...sesion('tok-A2'), guardadaEn: Date.now() } as any)
      throw new ApiError('Sesión revocada', 401, 'CUSTOMER_TOKEN_INVALID')
    })
    expect(await submitOrder(store, body)).toEqual({ kind: 'needsOtp' })
    expect(leerSesion(store.slug)).toBeNull()
    vi.resetModules() // recargar la página
    expect((await import('./session')).loadSession(store.slug)).toBeNull()
  })

  it('codex-r4 R4-4: 401 CUSTOMER_INACTIVE también suelta la sesión rechazada (el intento queda)', async () => {
    const { store, body } = setup({ sessionPhone: null, antes: slug => guardarSesion(slug, { ...sesion('tok-1'), guardadaEn: Date.now() } as any) })
    api.createOrder.mockRejectedValueOnce(new ApiError('Esta cuenta está desactivada', 401, 'CUSTOMER_INACTIVE'))
    expect((await submitOrder(store, body)).kind).toBe('error')
    expect(leerSesion(store.slug)).toBeNull()
    expect(pendingAttempt(store.slug)).not.toBeNull()
  })

  it('codex-r2: pedir en «Mi equipo» manda la sesión vigente al momento de mandar', async () => {
    const { store, body } = setup({ sessionPhone: null, antes: slug => { guardarSesion(slug, { ...sesion('tok-vieja'), guardadaEn: Date.now() } as any); guardarSesion(slug, { ...sesion('tok-vigente'), guardadaEn: Date.now() } as any) } })
    api.createOrder.mockResolvedValueOnce(created())
    expect((await submitOrder(store, body)).kind).toBe('created')
    expect(sent().token).toBe('tok-vigente')
  })

  it('200 replay:true (el reintento recupera su pedido, aun con el plan vencido) ⇒ created', async () => {
    const { store, body } = setup()
    api.createOrder.mockResolvedValueOnce(created({ replay: true, status: 'ACCEPTED' }))
    expect(await submitOrder(store, body)).toEqual({ kind: 'created', order: created({ replay: true, status: 'ACCEPTED' }) })
    expect(pendingAttempt(store.slug)).toBeNull()
  })

  it('sin almacenamiento ⇒ ninguna llamada a createOrder y el aviso del navegador', async () => {
    const { store, body } = setup()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('lleno', 'QuotaExceededError')
    })
    expect(await submitOrder(store, body)).toEqual({
      kind: 'error',
      message: 'Tu navegador no deja guardar datos de esta página. Ábrela en otro navegador o fuera del modo privado para pedir.',
      retryable: false,
    })
    expect(api.createOrder).not.toHaveBeenCalled()
  })

  it('502 de un proxy ⇒ no definitivo: el intento queda y se puede reintentar igual', async () => {
    const { store, body } = setup()
    api.createOrder.mockRejectedValueOnce(new ApiError('HTTP 502', 502))
    const r = await submitOrder(store, body)
    expect(r).toMatchObject({ kind: 'error', retryable: true })
    expect(pendingAttempt(store.slug)?.key).toBe(sent(0).key)
  })

  it('429 en texto plano («HTTP 429») ⇒ el texto sale del code, no del message; el intento queda', async () => {
    const { store, body } = setup()
    api.createOrder.mockRejectedValueOnce(new ApiError('HTTP 429', 429, 'RATE_LIMIT_EXCEEDED'))
    expect(await submitOrder(store, body)).toEqual({ kind: 'error', message: 'Demasiados intentos. Espera un minuto.', retryable: true })
    expect(pendingAttempt(store.slug)).not.toBeNull()
  })

  it('TOO_MANY_PENDING_ORDERS ⇒ su texto y el intento se borra', async () => {
    const { store, body } = setup()
    api.createOrder.mockRejectedValueOnce(new ApiError('x', 409, 'TOO_MANY_PENDING_ORDERS'))
    expect(await submitOrder(store, body)).toEqual({
      kind: 'error', message: 'Ya tienes 3 pedidos esperando respuesta en este negocio.', retryable: false,
    })
    expect(pendingAttempt(store.slug)).toBeNull()
  })

  it('ORDERING_PAUSED ⇒ storeUnavailable con su motivo; el intento se borra', async () => {
    const { store, body } = setup()
    api.createOrder.mockRejectedValueOnce(new ApiError('Pausado', 409, 'ORDERING_PAUSED', { status: 'PAUSED', reason: 'TOO_BUSY' }))
    expect(await submitOrder(store, body)).toEqual({ kind: 'storeUnavailable', status: 'PAUSED', reason: 'TOO_BUSY' })
    expect(pendingAttempt(store.slug)).toBeNull()
  })

  it('W1: 404 VENUE_NOT_FOUND SIN marca final ⇒ el intento NO se resuelve (misma llave), error con «Reintentar» y el texto del restaurante', async () => {
    const { store, body } = setup()
    api.createOrder.mockRejectedValueOnce(new ApiError('Negocio no encontrado', 404, 'VENUE_NOT_FOUND'))
    const r = await submitOrder(store, body)
    expect(r).toEqual({ kind: 'error', message: 'No encontramos este negocio.', retryable: true })
    expect(pendingAttempt(store.slug)?.key).toBe(sent(0).key)
    expect(loadLastOrder(store.slug)).toBeNull()
  })

  it('W1: tras un 404 sin marca, el reintento (aunque vuelva el slug) lleva la MISMA llave y el MISMO cuerpo, y recupera el pedido', async () => {
    const { store, body } = setup()
    api.createOrder.mockRejectedValueOnce(new ApiError('x', 404, 'VENUE_NOT_FOUND')).mockResolvedValueOnce(created({ replay: true }))
    await submitOrder(store, body)
    const r = await submitOrder(store, { ...body, expectedTotal: '999.00' })
    expect(r.kind).toBe('created')
    expect(sent(1).key).toBe(sent(0).key)
    expect(sent(1).body).toEqual(sent(0).body)
    expect(pendingAttempt(store.slug)).toBeNull()
  })

  it('W1: 404 con final:true ⇒ el intento SÍ se resuelve (el rechazo quedó guardado) y no hay «Reintentar»', async () => {
    const { store, body } = setup()
    api.createOrder.mockRejectedValueOnce(fin(404, 'VENUE_NOT_FOUND'))
    expect(await submitOrder(store, body)).toEqual({ kind: 'error', message: 'No encontramos este negocio.', retryable: false })
    expect(pendingAttempt(store.slug)).toBeNull()
  })

  it('W1: compatibilidad con un servidor viejo ⇒ los 409/400 sin marca siguen resolviendo el intento como hoy', async () => {
    for (const [status, code, extra] of [
      [409, 'PRICE_CHANGED', { quote: quoteOf(190) }],
      [409, 'ORDERING_CLOSED', { status: 'CLOSED', reason: 'OUTSIDE_HOURS' }],
      [409, 'TOO_MANY_PENDING_ORDERS', undefined],
      [400, 'CART_INVALID', { issues: [] }],
      [403, 'PLAN_REQUIRED', undefined],
    ] as const) {
      sessionStorage.clear()
      const { store, body } = setup()
      api.createOrder.mockRejectedValueOnce(new ApiError('x', status, code, extra))
      await submitOrder(store, body)
      expect(pendingAttempt(store.slug), `${status} ${code}`).toBeNull()
    }
  })

  it('una petición a la vez: dos envíos simultáneos ⇒ una sola llamada', async () => {
    const { store, body } = setup()
    let resolve!: (o: CreatedOrder) => void
    api.createOrder.mockReturnValueOnce(new Promise<CreatedOrder>(r => { resolve = r }))
    const a = submitOrder(store, body)
    const b = submitOrder(store, body)
    resolve(created())
    expect((await a).kind).toBe('created')
    expect((await b).kind).toBe('created')
    expect(api.createOrder).toHaveBeenCalledTimes(1)
  })
})

describe('send (lo que ve la tienda)', () => {
  it('created ⇒ carrito vacío, seguimiento con su token y el pedido guardado', async () => {
    const { store, body } = setup()
    api.createOrder.mockResolvedValueOnce(created())
    await send(store, body)
    expect(store.cart.value).toEqual([])
    expect(store.trackingToken.value).toBe('T'.repeat(32))
    expect(store.screen.value).toBe('tracking')
    expect(checkoutOf(store).busy.value).toBe(false)
  })

  it('customer.phone es phoneE164(...) y es el MISMO texto que se verificó por WhatsApp', async () => {
    const { store, body } = setup({ sessionPhone: null })
    await send(store, body)
    expect(store.screen.value).toBe('otp')
    const phone = phoneToVerify(store)!
    expect(phone).toBe('+525544422262')
    api.verifyOrderingOtp.mockResolvedValueOnce(sesion('tok-otp'))
    await verifyPhone(store, phone, '654321')
    expect(api.verifyOrderingOtp).toHaveBeenCalledWith(store.slug, '+525544422262', '654321')
    expect(loadSession(store.slug)).toMatchObject({ token: 'tok-otp', phone: '+525544422262' })
    api.createOrder.mockResolvedValueOnce(created())
    await send(store, body)
    expect(sent().body.customer.phone).toBe(api.verifyOrderingOtp.mock.calls[0][1])
    expect(sent().token).toBe('tok-otp')
  })

  it('PRICE_CHANGED ⇒ pregunta con el total nuevo; sólo con el toque se manda un cuerpo nuevo con OTRA llave', async () => {
    const { store, body } = setup()
    api.createOrder.mockRejectedValueOnce(new ApiError('x', 409, 'PRICE_CHANGED', { quote: quoteOf(190) }))
    await send(store, body)
    const f = checkoutOf(store).feedback.value
    expect(f).toMatchObject({ kind: 'priceChanged', total: 190 })
    expect(store.quote.value?.total).toBe(190)
    await flush()
    expect(api.createOrder).toHaveBeenCalledTimes(1)

    api.createOrder.mockResolvedValueOnce(created({ total: '190.00' }))
    if (f?.kind !== 'priceChanged') throw new Error('sin pregunta')
    await send(store, f.body)
    expect(api.createOrder).toHaveBeenCalledTimes(2)
    expect(sent(1).body.expectedTotal).toBe('190.00')
    expect(sent(1).key).not.toBe(sent(0).key)
  })

  it('PRICE_CHANGED y luego se edita el carrito ⇒ la pregunta y la cotización desaparecen (no se manda lo viejo)', async () => {
    const { store, body } = setup()
    api.createOrder.mockRejectedValueOnce(new ApiError('x', 409, 'PRICE_CHANGED', { quote: quoteOf(190) }))
    await send(store, body)
    expect(checkoutOf(store).feedback.value?.kind).toBe('priceChanged')
    store.cart.value = [line({ quantity: 3 })]
    expect(checkoutOf(store).feedback.value).toBeNull()
    expect(store.quote.value).toBeNull()
  })

  it('ORDERING_CLOSED ⇒ refresca /info, la tienda muestra el banner y el carrito queda intacto', async () => {
    const { store, body } = setup()
    api.getInfo.mockResolvedValueOnce({ ...info, status: 'CLOSED', reason: 'OUTSIDE_HOURS' })
    api.createOrder.mockRejectedValueOnce(new ApiError('x', 409, 'ORDERING_CLOSED', { status: 'CLOSED', reason: 'OUTSIDE_HOURS' }))
    await send(store, body)
    expect(store.info.value?.status).toBe('CLOSED')
    expect(api.getInfo).toHaveBeenCalledWith(store.slug)
    expect(store.cart.value).toEqual([line()])
    store.dispose()
  })

  it('con un intento pendiente (también tras recargar) el aviso aparece y «Reintentar» manda ese intento', async () => {
    const { store, body } = setup()
    api.createOrder.mockRejectedValueOnce(offline())
    await send(store, body)
    vi.resetModules()
    const fresh = await import('./checkout')
    const { createOrderStore: freshStore } = await import('./store')
    const reloaded: OrderStore = freshStore(store.slug, { locale: 'es' })
    expect(fresh.checkoutOf(reloaded).pending.value).toBe(true)
    api.createOrder.mockResolvedValueOnce(created({ replay: true }))
    await fresh.retry(reloaded)
    expect(sent(1).key).toBe(sent(0).key)
    expect(fresh.checkoutOf(reloaded).pending.value).toBe(false)
  })

  it('W1: 404 sin marca ⇒ la tienda muestra el error con «Reintentar», el intento sigue pendiente y reintentar manda la misma llave', async () => {
    const { store, body } = setup()
    api.createOrder.mockRejectedValueOnce(new ApiError('x', 404, 'VENUE_NOT_FOUND'))
    await send(store, body)
    expect(checkoutOf(store).feedback.value).toEqual({ kind: 'error', message: 'No encontramos este negocio.', retryable: true })
    expect(checkoutOf(store).pending.value).toBe(true)
    api.createOrder.mockResolvedValueOnce(created({ replay: true }))
    await retry(store)
    expect(sent(1).key).toBe(sent(0).key)
    expect(store.screen.value).toBe('tracking')
    expect(checkoutOf(store).pending.value).toBe(false)
  })

  it('«Reintentar» sin intento pendiente no inventa uno nuevo', async () => {
    const { store } = setup()
    await retry(store)
    expect(api.createOrder).not.toHaveBeenCalled()
  })
})

describe('ronda 1 de arreglos', () => {
  const NO_STORAGE = 'Tu navegador no deja guardar datos de esta página. Ábrela en otro navegador o fuera del modo privado para pedir.'

  it('almacenamiento bloqueado desde el inicio y sin sesión ⇒ aviso del navegador, sin pedir código ni crear pedido', async () => {
    const { store, body } = setup({ sessionPhone: null })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('bloqueado', 'SecurityError')
    })
    expect(await send(store, body)).toEqual({ kind: 'error', message: NO_STORAGE, retryable: false })
    expect(store.screen.value).not.toBe('otp')
    expect(api.requestOrderingOtp).not.toHaveBeenCalled()
    expect(api.createOrder).not.toHaveBeenCalled()
  })

  it('storageWorks prueba sessionStorage Y localStorage', () => {
    expect(storageWorks()).toBe(true)
    vi.spyOn(globalThis, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('bloqueado', 'SecurityError')
    })
    expect(storageWorks()).toBe(false)
  })

  it('teléfono de menos de 10 dígitos con sesión del MISMO texto ⇒ crea sin pedir código', async () => {
    const { store } = setup({ sessionPhone: '+298123456' })
    const body = buildOrderBody(store, { customer: { name: 'Jón', phone: '+298123456' }, note: null })
    api.createOrder.mockResolvedValueOnce(created())
    expect((await submitOrder(store, body)).kind).toBe('created')
  })

  it('401 CUSTOMER_INACTIVE ⇒ «Tu cuenta está desactivada…», sin pedir código, y el intento queda', async () => {
    const { store, body } = setup()
    api.createOrder.mockRejectedValueOnce(new ApiError('Cuenta desactivada', 401, 'CUSTOMER_INACTIVE'))
    expect(await submitOrder(store, body)).toEqual({
      kind: 'error', message: 'Tu cuenta está desactivada en este negocio.', retryable: false,
    })
    expect(pendingAttempt(store.slug)?.key).toBe(sent(0).key)
  })

  it('created de un intento viejo con el carrito ya editado ⇒ el carrito nuevo NO se vacía', async () => {
    const { store, body } = setup()
    api.createOrder.mockRejectedValueOnce(offline())
    await send(store, body)
    const edited = [line({ productId: 'p-taco', quantity: 4 })]
    store.cart.value = edited
    api.createOrder.mockResolvedValueOnce(created({ replay: true }))
    await retry(store)
    expect(store.screen.value).toBe('tracking')
    expect(store.cart.value).toEqual(edited)
  })

  it('W8: PRICE_CHANGED de un intento viejo con el carrito ya editado ⇒ no ofrece «Confirmar» lo viejo: «revisa tu pedido» y al carrito', async () => {
    const { store, body } = setup()
    api.createOrder.mockRejectedValueOnce(offline())
    await send(store, body)
    const edited = [line({ productId: 'p-taco', quantity: 4 })]
    store.cart.value = edited
    store.quote.value = quoteOf(400)
    store.go('details')
    api.createOrder.mockRejectedValueOnce(new ApiError('x', 409, 'PRICE_CHANGED', { quote: quoteOf(190) }))
    await retry(store)
    expect(checkoutOf(store).feedback.value).toEqual({ kind: 'error', message: 'El precio cambió; revisa tu pedido.', retryable: false })
    expect(store.screen.value).toBe('cart')
    expect(store.quote.value).toBeNull()
    expect(store.cart.value).toEqual(edited)
    // El intento viejo quedó resuelto (el servidor no creó nada) y nadie lo vuelve a mandar.
    expect(pendingAttempt(store.slug)).toBeNull()
    await flush()
    expect(api.createOrder).toHaveBeenCalledTimes(2)
  })

  it('W3: 409 ORDERING_PAUSED después de verificar el código ⇒ vuelve al carrito, intacto, con el estado nuevo de la tienda', async () => {
    const { store, body } = setup({ sessionPhone: null })
    await send(store, body)
    expect(store.screen.value).toBe('otp')
    api.verifyOrderingOtp.mockResolvedValueOnce(sesion('tok-otp'))
    await verifyPhone(store, phoneToVerify(store)!, '123456')
    api.getInfo.mockResolvedValueOnce({ ...info, status: 'PAUSED', reason: 'MANUAL_PAUSE' })
    api.createOrder.mockRejectedValueOnce(new ApiError('Pausado', 409, 'ORDERING_PAUSED', { status: 'PAUSED', reason: 'MANUAL_PAUSE' }))
    await send(store, body)
    expect(store.screen.value).toBe('cart')
    expect(store.cart.value).toEqual([line()])
    expect(store.info.value).toMatchObject({ status: 'PAUSED', reason: 'MANUAL_PAUSE' })
    expect(pendingAttempt(store.slug)).toBeNull()
    store.dispose()
  })

  it('send deja busy en false aunque algo lance', async () => {
    const { store } = setup()
    await expect(send(store, null as any)).rejects.toThrow()
    expect(checkoutOf(store).busy.value).toBe(false)
  })
})

describe('fase 2: pagar con tarjeta', () => {
  const URL_PAGO = 'https://checkout.stripe.com/c/pay/cs_test_1'
  const draft = (over: Partial<CreatedCardOrder> = {}): CreatedCardOrder => ({
    trackingToken: 'D'.repeat(32), checkoutUrl: URL_PAGO, status: 'AWAITING_PAYMENT', total: '170.00', replay: false, ...over,
  })
  /** Tienda con tarjeta, SIN sesión de WhatsApp (pagar con tarjeta no la pide) y escuchando el evento público. */
  function card() {
    const host = new EventTarget()
    const events: any[] = []
    host.addEventListener('avoqado:pedido-creado', e => events.push((e as CustomEvent).detail))
    const store = createOrderStore(`card${++n}`, { locale: 'es', host })
    store.cart.value = [line()]
    store.quote.value = quoteOf(170)
    store.info.value = info
    const body = buildOrderBody(store, { customer: { name: ' Ana López ', phone: PHONE }, note: null, paymentMode: 'CARD_ONLINE' })
    const assign = vi.spyOn(nav, 'assign').mockImplementation(() => {})
    return { store, body, events, assign }
  }

  it('el cuerpo lleva CARD_ONLINE, el nombre y el teléfono; sin sesión NO pide el código y manda la llave del intento sin token', async () => {
    const { store, body } = card()
    expect(body).toEqual({
      items: [{ productId: 'p-flauta', quantity: 2, modifiers: [{ modifierId: 'm-salsa', quantity: 1 }] }],
      paymentMode: 'CARD_ONLINE', expectedTotal: '170.00', customer: { name: 'Ana López', phone: '+525544422262' }, channel: 'LINK',
    })
    api.createOrder.mockResolvedValueOnce(draft())
    await send(store, body)
    expect(store.screen.value).not.toBe('otp')
    expect(api.requestOrderingOtp).not.toHaveBeenCalled()
    expect(api.createOrder).toHaveBeenCalledTimes(1)
    expect(sent().body).toEqual(body)
    expect(sent().key).toMatch(KEY_RE)
    expect(sent().token).toBeUndefined()
  })

  it('201 AWAITING_PAYMENT con liga ⇒ guarda el token (folio vacío), emite el evento sin folio y abre la página de pago', async () => {
    const { store, body, events, assign } = card()
    api.createOrder.mockResolvedValueOnce(draft())
    await send(store, body)
    expect(loadLastOrder(store.slug)).toEqual({ trackingToken: 'D'.repeat(32), orderNumber: '' })
    expect(pendingAttempt(store.slug)).toBeNull()
    expect(events).toEqual([expect.objectContaining({ orderNumber: '', trackingToken: 'D'.repeat(32) })])
    expect(assign).toHaveBeenCalledTimes(1)
    expect(assign).toHaveBeenCalledWith(URL_PAGO)
    // Al volver con «atrás» desde Stripe se ve el seguimiento de ese borrador, no el formulario.
    expect(store.trackingToken.value).toBe('D'.repeat(32))
    expect(store.screen.value).toBe('tracking')
    expect(store.cart.value).toEqual([])
  })

  it('una repetición que ya avanzó o venció (otro estado, o sin liga) NO abre Stripe: va al seguimiento de ese token', async () => {
    for (const over of [
      { replay: true, status: 'PENDING_ACCEPTANCE', checkoutUrl: '' },
      { replay: true, status: 'PAYMENT_NOT_COMPLETED', checkoutUrl: '' },
      { replay: true, status: 'AWAITING_PAYMENT', checkoutUrl: '' },
      { replay: true, status: 'PENDING_ACCEPTANCE', checkoutUrl: URL_PAGO },
    ]) {
      sessionStorage.clear()
      const { store, body, assign } = card()
      api.createOrder.mockResolvedValueOnce(draft(over))
      await send(store, body)
      expect(assign, JSON.stringify(over)).not.toHaveBeenCalled()
      expect(store.trackingToken.value).toBe('D'.repeat(32))
      expect(store.screen.value).toBe('tracking')
      vi.restoreAllMocks()
    }
  })

  it('una liga que no es https no se abre (va al seguimiento)', async () => {
    const { store, body, assign } = card()
    api.createOrder.mockResolvedValueOnce(draft({ checkoutUrl: 'javascript:alert(1)' }))
    await send(store, body)
    expect(assign).not.toHaveBeenCalled()
    expect(store.screen.value).toBe('tracking')
  })

  it('502 CARD_PROVIDER_UNAVAILABLE ⇒ «No pudimos abrir el pago…» con «Reintentar»; el reintento lleva la MISMA llave', async () => {
    const { store, body, assign } = card()
    api.createOrder.mockRejectedValueOnce(new ApiError('No pudimos abrir la página de pago.', 502, 'CARD_PROVIDER_UNAVAILABLE'))
    await send(store, body)
    expect(checkoutOf(store).feedback.value).toEqual({ kind: 'error', message: 'No pudimos abrir el pago. Intenta de nuevo.', retryable: true })
    expect(pendingAttempt(store.slug)?.key).toBe(sent(0).key)
    api.createOrder.mockResolvedValueOnce(draft({ replay: true }))
    await retry(store)
    expect(sent(1).key).toBe(sent(0).key)
    expect(sent(1).body).toEqual(sent(0).body)
    expect(sent(1).token).toBeUndefined()
    expect(assign).toHaveBeenCalledWith(URL_PAGO)
  })

  it('400 CARD_AMOUNT_OUT_OF_RANGE ⇒ su texto, sin «Reintentar», y el intento se borra', async () => {
    const { store, body } = card()
    store.info.value = { ...store.info.value!, paymentModes: { payAtPickup: true, cardOnline: true } }
    api.createOrder.mockRejectedValueOnce(new ApiError('x', 400, 'CARD_AMOUNT_OUT_OF_RANGE'))
    expect(await submitOrder(store, body)).toEqual({
      kind: 'error', message: 'El total no se puede pagar con tarjeta en línea (mínimo $10, máximo $50,000).', retryable: false,
    })
    expect(pendingAttempt(store.slug)).toBeNull()
  })

  it('ronda 2 (Ruling 59): 400 CARD_PAYMENT_NOT_ACCEPTED ⇒ su texto sin «Reintentar», el intento se borra, /info se relee y la caja queda elegida', async () => {
    const { store, body } = card()
    store.info.value = { ...store.info.value!, paymentModes: { payAtPickup: true, cardOnline: true } }
    api.createOrder.mockRejectedValueOnce(new ApiError('x', 400, 'CARD_PAYMENT_NOT_ACCEPTED'))
    api.getInfo.mockResolvedValueOnce({ ...store.info.value!, paymentModes: { payAtPickup: true, cardOnline: false } })
    await send(store, body)
    await flush()
    const c = checkoutOf(store)
    expect(c.feedback.value).toEqual({ kind: 'error', message: 'Este negocio ya no acepta tarjeta en línea. Elige pagar al recoger.', retryable: false })
    expect(pendingAttempt(store.slug)).toBeNull()
    expect(api.getInfo).toHaveBeenCalledTimes(1)
    expect(store.info.value?.paymentModes.cardOnline).toBe(false)
    expect(c.draft.value.payment).toBe('PAY_AT_PICKUP')
    expect(store.screen.value).not.toBe('cart')
    expect(store.cart.value).toEqual([line()])
  })

  it('400 CARD_PAYMENT_NOT_ACCEPTED en una tienda de sólo tarjeta ⇒ no ofrece pagar al recoger, porque no existe', async () => {
    const { store, body } = card()
    store.info.value = { ...store.info.value!, paymentModes: { payAtPickup: false, cardOnline: true } }
    api.createOrder.mockRejectedValueOnce(new ApiError('x', 400, 'CARD_PAYMENT_NOT_ACCEPTED'))
    expect(await submitOrder(store, body)).toEqual({ kind: 'tarjetaNoDisponible', message: 'Este negocio ya no acepta tarjeta en línea.' })
  })

  it('ronda 2 (Ruling 59): «Mi equipo» de sólo tarjeta pasa a «Nadie» sin tarjeta: el primer «Pedir» relee /info y deja pagar en caja, con el carrito', async () => {
    const { store, body } = card()
    store.info.value = { ...store.info.value!, paymentModes: { payAtPickup: false, cardOnline: true } }
    // El SERVIDOR revisa la tarjeta antes que la sesión: el formulario viejo recibe este rechazo, no el 401 de M4.
    api.createOrder.mockRejectedValueOnce(new ApiError('Este negocio no acepta pagar con tarjeta en línea.', 400, 'CARD_PAYMENT_NOT_ACCEPTED'))
    api.getInfo.mockResolvedValueOnce({ ...store.info.value!, requiresAcceptance: false, paymentModes: { payAtPickup: true, cardOnline: false } })
    await send(store, body)
    await flush()
    expect(store.info.value?.requiresAcceptance).toBe(false)
    expect(store.info.value?.paymentModes.payAtPickup).toBe(true)
    expect(checkoutOf(store).draft.value.payment).toBe('PAY_AT_PICKUP')
    expect(store.cart.value).toEqual([line()])
    expect(pendingAttempt(store.slug)).toBeNull()
    // Ya en «Nadie»: «Pedir» manda el pedido de caja, sin teléfono ni código.
    api.createOrder.mockResolvedValueOnce(created())
    await send(store, buildOrderBody(store, { customer: { name: 'Ana' }, note: null, paymentMode: 'PAY_AT_PICKUP' }))
    expect(sent(1).body.paymentMode).toBe('PAY_AT_PICKUP')
    expect(store.screen.value).toBe('tracking')
  })

  describe('ronda 2 #1 (Ruling 54): dos pestañas no pagan dos veces la misma compra', () => {
    /**
     * Otra pestaña del mismo navegador: su sessionStorage empieza vacía y la localStorage es la misma. Por omisión la pestaña duplicada:
     * los mismos datos que `card()` (ronda 3: sólo la misma compra, de la misma sesión, se comparte).
     */
    function otraPestana(slug: string, items = [line()], customer: { name: string; phone: string } = { name: ' Ana López ', phone: PHONE }) {
      sessionStorage.clear()
      const store = createOrderStore(slug, { locale: 'es' })
      store.cart.value = items
      store.quote.value = quoteOf(170)
      store.info.value = info
      return { store, body: buildOrderBody(store, { customer, note: null, paymentMode: 'CARD_ONLINE' }) }
    }

    it('ronda 3 (Ruling 54 enmendada): otra clienta en el mismo navegador, con el mismo carrito, hace SU compra (nunca la página de la otra)', async () => {
      const { store, body } = card()
      api.createOrder.mockResolvedValueOnce(draft())
      await send(store, body)
      const deBea = otraPestana(store.slug, [line()], { name: 'Bea Ruiz', phone: '+525599998888' })
      api.createOrder.mockResolvedValueOnce(draft({ trackingToken: 'B'.repeat(32) }))
      await send(deBea.store, deBea.body)
      expect(sent(1).key).not.toBe(sent(0).key)
      expect(sent(1).body.customer).toEqual({ name: 'Bea Ruiz', phone: '+525599998888' })
    })

    it('ronda 3: «Cerrar sesión» en la tienda borra la compra compartida; la siguiente es nueva', async () => {
      const { store, body } = card()
      api.createOrder.mockResolvedValueOnce(draft())
      await send(store, body)
      expect(localStorage.getItem(`avq_card_attempt:${store.slug}`)).not.toBeNull()
      salioEnLaTienda(store)
      expect(localStorage.getItem(`avq_card_attempt:${store.slug}`)).toBeNull()
      const tab2 = otraPestana(store.slug)
      api.createOrder.mockResolvedValueOnce(draft({ trackingToken: 'E'.repeat(32) }))
      await send(tab2.store, tab2.body)
      expect(sent(1).key).not.toBe(sent(0).key)
    })

    it('mismo carrito: la segunda pestaña manda la llave y el cuerpo de la primera y abre la MISMA página de pago (un solo borrador)', async () => {
      const { store, body, assign } = card()
      api.createOrder.mockResolvedValueOnce(draft())
      await send(store, body)
      const tab2 = otraPestana(store.slug)
      api.createOrder.mockResolvedValueOnce(draft({ replay: true }))
      await send(tab2.store, tab2.body)
      expect(api.createOrder).toHaveBeenCalledTimes(2)
      expect(sent(1).key).toBe(sent(0).key)
      expect(sent(1).body).toEqual(sent(0).body) // la compra de la primera, tal cual
      expect(sent(1).token).toBe(sent(0).token)
      expect(assign).toHaveBeenCalledTimes(2)
      expect(assign).toHaveBeenLastCalledWith(URL_PAGO)
    })

    it('la respuesta de la primera se perdió (su intento sigue pendiente): la segunda manda ESA llave', async () => {
      const { store, body } = card()
      api.createOrder.mockRejectedValueOnce(offline())
      await send(store, body)
      const tab2 = otraPestana(store.slug)
      api.createOrder.mockResolvedValueOnce(draft())
      await send(tab2.store, tab2.body)
      expect(sent(1).key).toBe(sent(0).key)
    })

    it('otro carrito: otra compra, con su llave', async () => {
      const { store, body } = card()
      api.createOrder.mockResolvedValueOnce(draft())
      await send(store, body)
      const tab2 = otraPestana(store.slug, [line({ quantity: 3 })])
      api.createOrder.mockResolvedValueOnce(draft({ trackingToken: 'E'.repeat(32) }))
      await send(tab2.store, tab2.body)
      expect(sent(1).key).not.toBe(sent(0).key)
    })

    it('ya resuelta (un rechazo, o el borrador repetido que ya no espera su pago): la siguiente es una compra nueva', async () => {
      // Un rechazo definitivo: no quedó página de pago.
      const a = card()
      api.createOrder.mockRejectedValueOnce(new ApiError('x', 400, 'CARD_AMOUNT_OUT_OF_RANGE'))
      await send(a.store, a.body)
      const a2 = otraPestana(a.store.slug)
      api.createOrder.mockResolvedValueOnce(draft())
      await send(a2.store, a2.body)
      expect(sent(1).key).not.toBe(sent(0).key)
      // La segunda pestaña recupera el borrador de la primera ya pagado (va a su seguimiento): una tercera ya es otra compra.
      const b = card()
      api.createOrder.mockResolvedValueOnce(draft())
      await send(b.store, b.body)
      const b2 = otraPestana(b.store.slug)
      api.createOrder.mockResolvedValueOnce(draft({ replay: true, status: 'ACCEPTED', checkoutUrl: '' }))
      await send(b2.store, b2.body)
      expect(sent(3).key).toBe(sent(2).key)
      expect(b2.store.screen.value).toBe('tracking')
      const b3 = otraPestana(b.store.slug)
      api.createOrder.mockResolvedValueOnce(draft({ trackingToken: 'F'.repeat(32) }))
      await send(b3.store, b3.body)
      expect(sent(4).key).not.toBe(sent(2).key)
    })
  })

  it('un intento pendiente de tarjeta tras recargar se reintenta igual, sin pedir el código', async () => {
    const { store, body } = card()
    api.createOrder.mockRejectedValueOnce(offline())
    await send(store, body)
    api.createOrder.mockResolvedValueOnce(draft({ replay: true }))
    // Otro cuerpo (al recoger) en pantalla: se manda el pendiente, con su modo y su llave.
    await submitOrder(store, buildOrderBody(store, { customer: { name: 'Ana', phone: PHONE }, note: null }))
    expect(sent(1).body.paymentMode).toBe('CARD_ONLINE')
    expect(sent(1).key).toBe(sent(0).key)
  })
})

describe('«Nadie»: pedido anónimo (sin teléfono)', () => {
  const anon = () => {
    const { store } = setup({ sessionPhone: null })
    store.info.value = { ...info, requiresAcceptance: false } as StoreInfo
    const body = buildOrderBody(store, { customer: { name: ' Ana ' }, note: null })
    return { store, body }
  }

  it('el cuerpo no lleva teléfono, y se manda sin sesión ni token ni pasar por el código', async () => {
    const { store, body } = anon()
    expect(body.customer).toEqual({ name: 'Ana' })
    api.createOrder.mockResolvedValueOnce(created())
    expect((await submitOrder(store, body)).kind).toBe('created')
    expect(sent().body.customer).toEqual({ name: 'Ana' })
    expect(sent().token).toBeUndefined()
  })

  it('reintento anónimo: el negocio cambió a «Mi equipo» y la clienta recargó ⇒ MISMO cuerpo y MISMA llave, sin pedir código, y recibe SU folio', async () => {
    const { store, body } = anon()
    api.createOrder.mockRejectedValueOnce(offline())
    await send(store, body)
    const first = sent(0)
    expect(pendingAttempt(store.slug)).not.toBeNull()
    // Recarga: tienda nueva con el mismo slug, y /info ya dice «Mi equipo».
    vi.resetModules()
    const again = await import('./checkout')
    const { createOrderStore: mk } = await import('./store')
    const reloaded = mk(store.slug, { locale: 'es' })
    reloaded.cart.value = [line()]
    reloaded.quote.value = quoteOf(170)
    reloaded.info.value = { ...info, requiresAcceptance: true } as StoreInfo
    api.createOrder.mockResolvedValueOnce(created({ replay: true, orderNumber: 'W7KQ2' }))
    const r = await again.retry(reloaded)
    expect(r?.kind).toBe('created')
    expect(api.createOrder).toHaveBeenCalledTimes(2)
    expect(sent(1).body).toEqual(first.body)
    expect(sent(1).key).toBe(first.key)
    expect(sent(1).token).toBeUndefined()
    expect(reloaded.screen.value).toBe('tracking')
    expect(loadLastOrder(store.slug)?.orderNumber).toBe('W7KQ2')
  })

  it('R79 #1: el reintento recibe el folio REPETIDO (200 replay) tras pasar a «Mi equipo» ⇒ seguimiento de ESE folio, sin intento nuevo ni "needsPhone"', async () => {
    const { store, body } = anon()
    api.createOrder.mockRejectedValueOnce(offline())
    await send(store, body)
    api.getInfo.mockResolvedValue({ ...info, requiresAcceptance: true })
    api.createOrder.mockResolvedValueOnce(created({ replay: true, orderNumber: 'W7KQ2' }))
    const r = await retry(store)
    expect(r?.kind).toBe('created')
    expect(api.createOrder).toHaveBeenCalledTimes(2)
    expect(pendingAttempt(store.slug)).toBeNull() // el intento se resolvió: no queda uno para crear otro folio
    expect(loadLastOrder(store.slug)?.orderNumber).toBe('W7KQ2')
    expect(store.screen.value).toBe('tracking')
    expect(checkoutOf(store).feedback.value).not.toMatchObject({ kind: 'error' })
  })

  it('401 PHONE_VERIFICATION_REQUIRED al reintento ⇒ suelta el intento y pide los datos de «Mi equipo»', async () => {
    const { store, body } = anon()
    api.createOrder.mockRejectedValueOnce(offline())
    await send(store, body)
    api.getInfo.mockResolvedValue({ ...info, requiresAcceptance: true })
    api.createOrder.mockRejectedValueOnce(new ApiError('x', 401, 'PHONE_VERIFICATION_REQUIRED'))
    const r = await retry(store)
    expect(r?.kind).toBe('needsPhone')
    expect(pendingAttempt(store.slug)).toBeNull()
    expect(checkoutOf(store).pending.value).toBe(false)
    expect(store.screen.value).toBe('details')
    expect(store.info.value?.requiresAcceptance).toBe(true)
    expect(checkoutOf(store).feedback.value).toEqual({ kind: 'error', message: expect.stringContaining('WhatsApp'), retryable: false })
  })

  it.each([
    ['TOO_MANY_UNPAID_FOLIOS', 409, 'Hay muchos pedidos esperando pago. Pide directo en caja.'],
    ['ZERO_TOTAL', 400, 'Tu pedido no tiene costo: pídelo directo en caja.'],
  ])('%s ⇒ su texto, sin «Reintentar», y el intento se borra', async (code, status, text) => {
    const { store, body } = anon()
    api.createOrder.mockRejectedValueOnce(new ApiError('texto del servidor', status, code))
    expect(await submitOrder(store, body)).toEqual({ kind: 'error', message: text, retryable: false })
    expect(pendingAttempt(store.slug)).toBeNull()
  })

  it('409 ORDERING_OFFLINE con NO_DEVICE ⇒ tienda no disponible con su motivo', async () => {
    const { store, body } = anon()
    api.createOrder.mockRejectedValueOnce(new ApiError('x', 409, 'ORDERING_OFFLINE', { status: 'OFFLINE', reason: 'NO_DEVICE' }))
    expect(await submitOrder(store, body)).toEqual({ kind: 'storeUnavailable', status: 'OFFLINE', reason: 'NO_DEVICE' })
  })
})

/** Otra pestaña escribe B en el almacenamiento justo DESPUÉS de la siguiente lectura (o escritura) de la sesión de `slug`. */
function intercalar(slug: string, b: Record<string, unknown>, tras: 'leer' | 'escribir') {
  const llave = `avq_sesion:${slug}`
  const get = Storage.prototype.getItem
  const set = Storage.prototype.setItem
  let listo = false
  const meteB = () => { listo = true; set.call(localStorage, llave, JSON.stringify(b)) }
  if (tras === 'leer')
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, k: string) {
      const v = get.call(this, k)
      if (k === llave && !listo) meteB()
      return v
    })
  else
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      set.call(this, k, v)
      if (k === llave && !listo) meteB()
    })
}
const sesionB = () => ({
  token: 'tok-B', customer: { id: 'c2', firstName: 'Bea', lastName: null, email: null, phone: '+525599998888' },
  contactos: [{ tipo: 'PHONE', valor: '+525599998888', metodo: 'WHATSAPP', probadoEn: 2 }], guardadaEn: Date.now(),
})

describe('r11: leer y validar UNA vez (otra pestaña escribe B en medio)', () => {
  afterEach(() => vi.restoreAllMocks())

  it('codex-r10: la tienda manda EXACTAMENTE la sesión que validó, aunque B se escriba justo después de leerla', async () => {
    const slug = `r11a${++n}`
    guardarSesion(slug, { ...sesion('tok-A'), guardadaEn: Date.now() } as any)
    const store = createOrderStore(slug, { locale: 'es' })
    store.cart.value = [line()]
    store.info.value = { ...info, requiresAcceptance: false } as StoreInfo
    store.quote.value = quoteOf(170)
    const body = buildOrderBody(store, { customer: { name: 'Ana' }, note: null })
    api.createOrder.mockResolvedValueOnce(created())
    intercalar(slug, sesionB(), 'leer')
    await submitOrder(store, body)
    expect(sent().token).toBe('tok-A') // manda exactamente la que validó (ni B ni sin sesión)
  })

  it('el código de «Mi equipo»: la tienda adopta la sesión que guardó, no la B que otra pestaña escribió justo después', async () => {
    const { store } = setup({ sessionPhone: null })
    api.verifyOrderingOtp.mockResolvedValueOnce(sesion('tok-2'))
    intercalar(store.slug, sesionB(), 'escribir')
    expect(await verifyPhone(store, PHONE, '123456')).toBe(true)
    expect(paginaDe(store.slug, 'pedidos')?.token).toBe('tok-2')
  })

  it('«Entrar otra vez» en la tienda adopta la sesión con que entró, no la que esté guardada después', () => {
    const { store } = setup({ sessionPhone: null })
    guardarSesion(store.slug, sesionB() as any) // otra pestaña ya escribió B
    entroEnLaTienda(store, { ...sesion('tok-2') } as any)
    expect(paginaDe(store.slug, 'pedidos')?.token).toBe('tok-2')
  })

  it('W4: entrar desde «Mi cuenta» de la tienda adopta esa sesión sin cambiar de pantalla; el menú pasa a «Mi cuenta» (conSesion)', () => {
    const { store } = setup({ sessionPhone: null })
    store.go('cuenta')
    entroEnLaTienda(store, { ...sesion('tok-2') } as any, null)
    expect(paginaDe(store.slug, 'pedidos')?.token).toBe('tok-2')
    expect(store.screen.value).toBe('cuenta')
    expect(checkoutOf(store).conSesion.value).toBe(true)
    expect(checkoutOf(store).sesionCerrada.value).toBe(false)
  })
})

describe('W3: pedir con beneficios', () => {
  const nadieInfo = { ...info, requiresAcceptance: false } as StoreInfo
  /** «Nadie» con la sesión única de la página y lo elegido. */
  function nadie(opts: { eleccion?: Record<string, unknown>; q?: Partial<Quote>; total?: number; mode?: 'CARD_ONLINE' } = {}) {
    const slug = `ben${++n}`
    guardarSesion(slug, { ...sesion('tok-A'), guardadaEn: Date.now() } as any)
    const store = createOrderStore(slug, { locale: 'es' }) // abrir la página
    store.cart.value = [line()]
    store.info.value = opts.mode ? ({ ...info, paymentModes: { payAtPickup: true, cardOnline: true } } as StoreInfo) : nadieInfo
    const c = checkoutOf(store) // abrir la página
    if (opts.eleccion) c.eleccion.value = opts.eleccion
    store.quote.value = quoteOf(opts.total ?? 105, {
      subtotal: 170, oferta: { premio: { id: 'pr1', etiqueta: 'Café gratis' }, puntos: null, cupon: false }, ...opts.q,
    })
    const body = buildOrderBody(store, {
      customer: opts.mode ? { name: 'Ana', phone: PHONE } : { name: 'Ana' }, note: null, paymentMode: opts.mode,
    })
    return { store, body, c }
  }

  it('codex-r8 H1 (A refinada + W3-r3): Bea entra en reservas a medio pedido; el 401 de Ana no reenvía (ni con Bea ni sin sesión) y Bea sigue guardada', async () => {
    const { store, body } = nadie({ eleccion: { premioId: 'pr1' } })
    const bea = { token: 'tok-B', customer: { id: 'c2', firstName: 'Bea', lastName: null, email: null, phone: '+525599998888' },
      contactos: [{ tipo: 'PHONE' as const, valor: '+525599998888', metodo: 'WHATSAPP' as const, probadoEn: 2 }] }
    api.createOrder
      .mockImplementationOnce(async () => {
        setCustomerSession(store.slug, bea.token, bea.customer, null, bea.contactos) // entró Bea en reservas, en la misma página
        throw new ApiError('Sesión vencida', 401, 'CUSTOMER_TOKEN_INVALID')
      })
    expect((await send(store, body)).kind).toBe('needsSesion')
    expect(api.createOrder).toHaveBeenCalledTimes(1)
    expect(sent(0).token).toBe('tok-A')
    expect(leerSesion(store.slug)?.token).toBe('tok-B') // nunca se borra la sesión más nueva que guardó otra superficie
    expect(tokenParaMandar(store.slug)).toBe('tok-B') // reservas sigue con Bea
  })

  it('W3-r3 regla: un reintento reenvía LA MISMA petición — llave, cuerpo y token guardados al confirmar —, nunca la sesión de ahora', async () => {
    const { store, body } = nadie({ eleccion: { premioId: 'pr1' } })
    api.createOrder.mockRejectedValueOnce(offline()) // el folio pudo crearse con Ana; la respuesta se perdió
    expect((await submitOrder(store, body)).kind).toBe('error')
    borrarSesion(store.slug) // otra pestaña cerró su sesión (sólo en el navegador: el token sigue valiendo en el SERVIDOR)
    api.createOrder.mockResolvedValueOnce(created({ replay: true }))
    expect((await submitOrder(store, body)).kind).toBe('created')
    expect(sent(1)).toMatchObject({ key: sent(0).key, body: sent(0).body, token: 'tok-A' })
    expect(pendingAttempt(store.slug)).toBeNull() // resuelto: se borra lo guardado, también el token
  })

  it('codex-w3-r3 #1: un intento de antes del cambio (sin token) sale como en producción: «Nadie» sin sesión, «Mi equipo» con la de ahora', async () => {
    const { store, body } = nadie({ eleccion: { premioId: 'pr1' } })
    sessionStorage.setItem(`avq_order_attempt:${store.slug}`, JSON.stringify({ key: 'K'.repeat(43), body, startedAt: Date.now() }))
    api.createOrder.mockResolvedValueOnce(created({ replay: true }))
    await submitOrder(store, body)
    expect(sent(0)).toMatchObject({ key: 'K'.repeat(43), token: undefined })
    const mi = setup() // «Mi equipo», con la sesión de hoy del teléfono
    sessionStorage.setItem(`avq_order_attempt:${mi.store.slug}`, JSON.stringify({ key: 'M'.repeat(43), body: mi.body, startedAt: Date.now() }))
    api.createOrder.mockResolvedValueOnce(created({ replay: true }))
    await submitOrder(mi.store, mi.body)
    expect(sent(1)).toMatchObject({ key: 'M'.repeat(43), token: 'tok-1' })
    const t = nadie({ mode: 'CARD_ONLINE' }) // tarjeta: en producción salía sin token
    sessionStorage.setItem(`avq_order_attempt:${t.store.slug}`, JSON.stringify({ key: 'T'.repeat(43), body: t.body, startedAt: Date.now() }))
    api.createOrder.mockResolvedValueOnce({ trackingToken: 'T'.repeat(32), checkoutUrl: '', status: 'PENDING', total: '105.00', replay: true })
    nav.assign = vi.fn()
    await submitOrder(t.store, t.body)
    expect(sent(2)).toMatchObject({ key: 'T'.repeat(43), token: undefined })
  })

  it('codex-w3-r4 #1: un intento viejo de «Mi equipo» lee la sesión UNA vez: si otra pestaña escribe B justo después, sale con la que leyó', async () => {
    const mi = setup() // «Mi equipo», con la sesión de hoy del teléfono (tok-1)
    sessionStorage.setItem(`avq_order_attempt:${mi.store.slug}`, JSON.stringify({ key: 'M'.repeat(43), body: mi.body, startedAt: Date.now() }))
    checkoutOf(mi.store)
    intercalar(mi.store.slug, sesionB(), 'leer')
    api.createOrder.mockResolvedValueOnce(created({ replay: true }))
    await submitOrder(mi.store, mi.body)
    vi.restoreAllMocks()
    expect(sent(0)).toMatchObject({ key: 'M'.repeat(43), token: 'tok-1' })
  })

  it('codex-w3-r2 #1: recargar con el pedido en vuelo y la sesión cerrada en otra pestaña reenvía con el token guardado', async () => {
    const { store, body } = nadie({ eleccion: { premioId: 'pr1' } })
    api.createOrder.mockImplementationOnce(() => new Promise(() => {})) // en vuelo
    void submitOrder(store, body)
    await flush()
    vi.resetModules() // recarga
    const fresh = await import('./checkout')
    const { createOrderStore: freshStore } = await import('./store')
    borrarSesion(store.slug)
    const reloaded = freshStore(store.slug, { locale: 'es' })
    reloaded.info.value = nadieInfo
    api.createOrder.mockResolvedValueOnce(created({ replay: true }))
    expect((await fresh.retry(reloaded))?.kind).toBe('created')
    expect(sent(1)).toMatchObject({ key: sent(0).key, token: 'tok-A' })
  })

  it('codex-w3-r2 #2: con tarjeta, volver a entrar con correo a la misma ficha no cambia el token del reintento', async () => {
    const { store, body } = nadie({ eleccion: { premioId: 'pr1' }, mode: 'CARD_ONLINE' })
    api.createOrder.mockRejectedValueOnce(offline())
    await submitOrder(store, body)
    borrarSesion(store.slug)
    const porCorreo = { ...sesion('tok-correo'), contactos: [{ tipo: 'EMAIL', valor: 'ana@correo.mx', metodo: 'EMAIL_CODE', probadoEn: 3 }] }
    guardarSesion(store.slug, { ...porCorreo, guardadaEn: Date.now() } as any)
    entroEnLaTienda(store, porCorreo as any)
    api.createOrder.mockResolvedValueOnce({ trackingToken: 'T'.repeat(32), checkoutUrl: '', status: 'PENDING', total: '105.00', replay: true })
    nav.assign = vi.fn()
    await submitOrder(store, body)
    expect(sent(1)).toMatchObject({ key: sent(0).key, token: 'tok-A' })
  })

  it('codex-w3-r2 #3: un intento con el token viejo de pedidos se reenvía con ese token aunque haya entrado con la sesión nueva', async () => {
    const slug = `ben${++n}`
    saveSession(slug, { token: 'tok-viejo', phone: PHONE, name: 'Ana', savedAt: Date.now() })
    const store = createOrderStore(slug, { locale: 'es' })
    store.cart.value = [line()]
    store.info.value = nadieInfo
    store.quote.value = quoteOf(170)
    const body = buildOrderBody(store, { customer: { name: 'Ana' }, note: null })
    api.createOrder.mockRejectedValueOnce(offline())
    await submitOrder(store, body)
    expect(sent(0).token).toBe('tok-viejo')
    guardarSesion(slug, { ...sesion('tok-nuevo'), guardadaEn: Date.now() } as any)
    entroEnLaTienda(store, sesion('tok-nuevo') as any)
    api.createOrder.mockResolvedValueOnce(created({ replay: true }))
    expect((await submitOrder(store, body)).kind).toBe('created')
    expect(sent(1)).toMatchObject({ key: sent(0).key, token: 'tok-viejo' })
  })

  it('un intento que salió SIN sesión se reenvía sin sesión aunque la página ya tenga una', async () => {
    const slug = `ben${++n}`
    const store = createOrderStore(slug, { locale: 'es' })
    store.cart.value = [line()]
    store.info.value = nadieInfo
    store.quote.value = quoteOf(170)
    const body = buildOrderBody(store, { customer: { name: 'Ana' }, note: null })
    api.createOrder.mockRejectedValueOnce(offline())
    await submitOrder(store, body)
    expect(sent(0).token).toBeUndefined()
    guardarSesion(slug, { ...sesion('tok-A'), guardadaEn: Date.now() } as any)
    entroEnLaTienda(store, sesion('tok-A') as any) // entró después
    api.createOrder.mockResolvedValueOnce(created({ replay: true }))
    await submitOrder(store, body)
    expect(sent(1)).toMatchObject({ key: sent(0).key, token: undefined })
  })

  it('el token guardado recibe 401 (revocado): «Entra otra vez para terminar tu pedido», el intento se queda; al entrar, sale con la sesión nueva y la misma llave', async () => {
    const { store, body } = nadie({ eleccion: { premioId: 'pr1' } })
    api.createOrder.mockRejectedValueOnce(offline())
    await submitOrder(store, body)
    api.createOrder.mockRejectedValueOnce(new ApiError('Sesión revocada', 401, 'CUSTOMER_TOKEN_INVALID'))
    expect(await submitOrder(store, body)).toEqual({ kind: 'needsSesion' })
    expect(await submitOrder(store, body)).toEqual({ kind: 'needsSesion' }) // sin entrar no se reenvía
    expect(api.createOrder).toHaveBeenCalledTimes(2)
    expect(pendingAttempt(store.slug)?.key).toBe(sent(0).key)
    guardarSesion(store.slug, { ...sesion('tok-A2'), guardadaEn: Date.now() } as any)
    entroEnLaTienda(store, sesion('tok-A2') as any)
    api.createOrder.mockResolvedValueOnce(created({ replay: true }))
    expect((await submitOrder(store, body)).kind).toBe('created')
    expect(sent(2)).toMatchObject({ key: sent(0).key, token: 'tok-A2' })
  })

  it('codex-w3-r2 #4: un PRICE_CHANGED con dos descartados los quita a los dos de lo elegido', async () => {
    const { store, body, c } = nadie({ eleccion: { premioId: 'pr1', cupon: 'X' }, q: { oferta: { premio: { id: 'pr1', etiqueta: 'Café' }, puntos: null, cupon: true } } })
    api.createOrder.mockRejectedValueOnce(fin(409, 'PRICE_CHANGED', { quote: quoteOf(170, { descartados: ['CUPON', 'PREMIO'] }), descartados: ['CUPON', 'PREMIO'] }))
    await send(store, body)
    expect(c.eleccion.value).toEqual({})
  })

  it('codex-w3-r1 #2: con los beneficios sin calcular (sin oferta) lo elegido se manda para calcularse al pedir', () => {
    const { body } = nadie({ eleccion: { puntos: 340 }, total: 170, q: { oferta: undefined, beneficios: { calculados: false } } })
    expect(body.beneficios).toEqual({ puntos: 340 })
  })

  it('codex-w3-r1 #2: una recotización con lo aplicado y sin oferta manda lo elegido que su total ya incluye', () => {
    const { body } = nadie({ eleccion: { puntos: 340 }, total: 136, q: { oferta: undefined, aplicados: [{ tipo: 'PUNTOS', nombre: 'Puntos', monto: 34 }] } })
    expect(body).toMatchObject({ expectedTotal: '136.00', beneficios: { puntos: 340 } })
  })

  it('sin sesión (sin oferta, sin aplicados, sin beneficios) no se manda nada de lo elegido', () => {
    const { body } = nadie({ eleccion: { puntos: 340 }, total: 170, q: { oferta: undefined } })
    expect(body.beneficios).toBeUndefined()
  })

  it('codex-w3-r1 #3: con tarjeta, el PRICE_CHANGED trae totalEstricto: se confirma ESE total, no el de la cotización degradada', async () => {
    const { store, body, c } = nadie({ eleccion: { premioId: 'pr1' }, mode: 'CARD_ONLINE' })
    api.createOrder.mockRejectedValueOnce(fin(409, 'PRICE_CHANGED', { quote: quoteOf(250, { beneficios: { calculados: false } }), totalEstricto: 244.99, descartados: [] }))
    await send(store, body)
    expect(c.feedback.value).toMatchObject({ kind: 'priceChanged', total: 244.99 })
    expect((c.feedback.value as any).body.expectedTotal).toBe('244.99')
  })

  it('el cuerpo lleva lo elegido que la cotización ofreció y el total de la cotización con lo elegido', () => {
    const { body } = nadie({ eleccion: { premioId: 'pr1', puntos: 340 } })
    expect(body.expectedTotal).toBe('105.00')
    expect(body.beneficios).toEqual({ premioId: 'pr1' }) // sin oferta de puntos, los puntos no se mandan
  })

  it('lo que la cotización descartó no se manda', () => {
    const { body } = nadie({ eleccion: { premioId: 'pr1', cupon: 'X' }, q: { oferta: { premio: { id: 'pr1', etiqueta: 'Café' }, puntos: null, cupon: true }, descartados: ['CUPON'] } })
    expect(body.beneficios).toEqual({ premioId: 'pr1' })
  })

  it('sin elegir nada no hay `beneficios`', () => {
    expect(nadie().body.beneficios).toBeUndefined()
  })

  it('«Nadie» con sesión manda la sesión de la página (también sin beneficios)', async () => {
    const { store, body } = nadie({ eleccion: { premioId: 'pr1' } })
    api.createOrder.mockResolvedValueOnce(created())
    expect((await submitOrder(store, body)).kind).toBe('created')
    expect(sent().token).toBe('tok-A')
    expect(sent().body.beneficios).toEqual({ premioId: 'pr1' })
  })

  it('(c) con tarjeta en línea también manda la sesión y lo elegido', async () => {
    const { store, body } = nadie({ eleccion: { premioId: 'pr1' }, mode: 'CARD_ONLINE' })
    api.createOrder.mockResolvedValueOnce({ trackingToken: 'T'.repeat(32), checkoutUrl: '', status: 'PENDING', total: '105.00', replay: false })
    nav.assign = vi.fn()
    await submitOrder(store, body)
    expect(sent().token).toBe('tok-A')
    expect(sent().body.beneficios).toEqual({ premioId: 'pr1' })
  })

  it('PRICE_CHANGED con descartados [PREMIO]: quita el premio de la elección y del cuerpo a confirmar; avisa por qué', async () => {
    const { store, body, c } = nadie({ eleccion: { premioId: 'pr1' } })
    store.go('details')
    api.createOrder.mockRejectedValueOnce(fin(409, 'PRICE_CHANGED', { quote: quoteOf(170, { descartados: ['PREMIO'] }), descartados: ['PREMIO'] }))
    const r = await send(store, body)
    expect(r.kind).toBe('priceChanged')
    expect(c.eleccion.value).toEqual({})
    expect(c.feedback.value).toMatchObject({ kind: 'priceChanged', total: 170, motivo: 'PREMIO', premio: 'Café gratis' })
    const f = c.feedback.value as any
    expect(f.body.beneficios).toBeUndefined()
    expect(f.body.expectedTotal).toBe('170.00')
    api.createOrder.mockResolvedValueOnce(created())
    await send(store, f.body)
    expect(sent(1).body.beneficios).toBeUndefined()
  })

  it('PRICE_CHANGED con motivo SIN_SESION: «Tu sesión se cerró»; confirmar manda sin beneficios y con el precio sin ellos', async () => {
    const { store, body, c } = nadie({ eleccion: { premioId: 'pr1' } })
    api.createOrder.mockRejectedValueOnce(fin(409, 'PRICE_CHANGED', { quote: quoteOf(170), motivo: 'SIN_SESION' }))
    await send(store, body)
    expect(c.feedback.value).toMatchObject({ kind: 'priceChanged', motivo: 'SIN_SESION', total: 170 })
    expect((c.feedback.value as any).body.beneficios).toBeUndefined()
  })

  it('W3-r3: 401 en «Nadie» suelta la sesión, NO reenvía sin ella y pide entrar para terminar; el intento se queda', async () => {
    const { store, body, c } = nadie({ eleccion: { premioId: 'pr1' } })
    api.createOrder.mockRejectedValueOnce(new ApiError('Sesión vencida', 401, 'CUSTOMER_TOKEN_INVALID'))
    expect((await send(store, body)).kind).toBe('needsSesion')
    expect(api.createOrder).toHaveBeenCalledTimes(1)
    expect(leerSesion(store.slug)).toBeNull()
    expect(pendingAttempt(store.slug)?.key).toBe(sent(0).key)
    expect(c.feedback.value).toEqual({ kind: 'sesionParaTerminar' })
  })

  it('un folio de $0 en «Nadie» (cerrado por el SERVIDOR) va directo al seguimiento', async () => {
    const { store, body } = nadie({ eleccion: { premioId: 'pr1' }, total: 0 })
    expect(body.expectedTotal).toBe('0.00')
    api.createOrder.mockResolvedValueOnce(created({ total: '0.00', status: 'ACCEPTED' }))
    await send(store, body)
    expect(store.screen.value).toBe('tracking')
  })
})

describe('D661: pagar con tarjeta en línea en «Nadie»', () => {
  const URL_PAGO = 'https://checkout.stripe.com/c/pay/cs_test_nadie'
  const nadieCardInfo = { ...info, requiresAcceptance: false, paymentModes: { payAtPickup: true, cardOnline: true } } as StoreInfo
  /** «Nadie» con tarjeta en línea: con la sesión única de la página (salvo `sesion: false`) y el cuerpo de «Pagar ahora». */
  function nadieCard(opts: { sesion?: boolean; token?: string } = {}) {
    const slug = `nc${++n}`
    if (opts.sesion !== false) guardarSesion(slug, { ...sesion(opts.token ?? 'tok-A'), guardadaEn: Date.now() } as any)
    const store = createOrderStore(slug, { locale: 'es' }) // abre la página con lo guardado
    store.cart.value = [line()]
    store.quote.value = quoteOf(170)
    store.info.value = nadieCardInfo
    store.go('details')
    checkoutOf(store)
    const body = buildOrderBody(store, { customer: { name: ' Ana ' }, note: null, paymentMode: 'CARD_ONLINE' })
    return { store, body }
  }

  it('tarjeta en «Nadie» manda sesión, CARD_ONLINE, sin teléfono', async () => {
    const { store, body } = nadieCard()
    expect(body).toEqual({
      items: [{ productId: 'p-flauta', quantity: 2, modifiers: [{ modifierId: 'm-salsa', quantity: 1 }] }],
      paymentMode: 'CARD_ONLINE', expectedTotal: '170.00', customer: { name: 'Ana' }, channel: 'LINK',
    })
    const assign = vi.spyOn(nav, 'assign').mockImplementation(() => {})
    api.createOrder.mockResolvedValueOnce({ trackingToken: 'D'.repeat(32), checkoutUrl: URL_PAGO, status: 'AWAITING_PAYMENT', total: '170.00', replay: false })
    await send(store, body)
    expect(api.createOrder).toHaveBeenCalledTimes(1)
    expect(sent().body).toEqual(body)
    expect(sent().body.customer.phone).toBeUndefined()
    expect(sent().token).toBe('tok-A')
    expect(sent().key).toMatch(KEY_RE)
    expect(api.requestOrderingOtp).not.toHaveBeenCalled() // sin código de «Mi equipo»: la sesión ya probó quién es
    expect(assign).toHaveBeenCalledWith(URL_PAGO)
  })

  it('D661: sin sesión, «Pagar ahora» lleva a entrar sin llamar al servidor ni guardar un intento', async () => {
    const { store, body } = nadieCard({ sesion: false })
    expect(await submitOrder(store, body)).toEqual({ kind: 'entrarParaPagar' })
    expect(api.createOrder).not.toHaveBeenCalled()
    expect(pendingAttempt(store.slug)).toBeNull()
    await send(store, body)
    expect(store.screen.value).toBe('entrar')
    expect(api.createOrder).not.toHaveBeenCalled()
    expect(api.getInfo).not.toHaveBeenCalled() // /info ya dice «Nadie»: no hay nada que releer
    expect(checkoutOf(store).feedback.value).toBeNull() // no es un error: es el paso que falta
    expect(store.cart.value).toEqual([line()])
  })

  it('ronda 1 M4 (a): un intento con tarjeta de «Mi equipo» (teléfono, sin sesión) que al reintentar recibe 401 PHONE_VERIFICATION_REQUIRED ⇒ se suelta y lleva a entrar', async () => {
    // El negocio pasó a «Nadie» con el intento en vuelo: ahora la tarjeta pide su cuenta. «Reintentar» no debe repetirlo para siempre.
    const { store } = setup({ sessionPhone: null })
    store.info.value = { ...info, paymentModes: { payAtPickup: true, cardOnline: true } } as StoreInfo
    const body = buildOrderBody(store, { customer: { name: 'Ana', phone: PHONE }, note: null, paymentMode: 'CARD_ONLINE' })
    api.createOrder.mockRejectedValueOnce(offline())
    await send(store, body)
    expect(pendingAttempt(store.slug)).not.toBeNull()
    expect(sent(0).token).toBeUndefined()
    api.getInfo.mockResolvedValue(nadieCardInfo)
    api.createOrder.mockRejectedValueOnce(new ApiError('Entra a tu cuenta para pagar con tarjeta en línea.', 401, 'PHONE_VERIFICATION_REQUIRED'))
    const r = await retry(store)
    await flush()
    expect(r?.kind).toBe('entrarParaPagar')
    expect(pendingAttempt(store.slug)).toBeNull() // nunca se creó: el intento se suelta
    const c = checkoutOf(store)
    expect(c.pending.value).toBe(false)
    expect(c.paraPagar).toBe(true) // al entrar regresa a «Tus datos»
    expect(store.screen.value).toBe('entrar')
    // La pantalla se pone al día: ya es «Nadie» (sin WhatsApp; la tarjeta va con su cuenta).
    expect(store.info.value?.requiresAcceptance).toBe(false)
    expect(api.getInfo).toHaveBeenCalledTimes(1)
    expect(api.createOrder).toHaveBeenCalledTimes(2)
  })

  it('ronda 1 M4 (b): la tarjeta de «Nadie» con el negocio ya en «Mi equipo» recibe el 400 sin código «Escribe tu teléfono» ⇒ pide WhatsApp, como needsPhone', async () => {
    const { store, body } = nadieCard()
    api.createOrder.mockRejectedValueOnce(new ApiError('Error de validación: Escribe tu teléfono', 400))
    api.getInfo.mockResolvedValueOnce({ ...nadieCardInfo, requiresAcceptance: true })
    const r = await send(store, body)
    await flush()
    expect(r.kind).toBe('needsPhone')
    expect(pendingAttempt(store.slug)).toBeNull()
    expect(store.screen.value).toBe('details')
    expect(store.info.value?.requiresAcceptance).toBe(true) // aparece el campo de WhatsApp
    expect(api.getInfo).toHaveBeenCalledTimes(1)
    expect(checkoutOf(store).feedback.value).toEqual({
      kind: 'error', message: 'Este negocio cambió cómo recibe pedidos. Escribe tu WhatsApp para pedir.', retryable: false,
    })
    expect(store.cart.value).toEqual([line()])
    // Otro 400 de validación sin código (no el del teléfono) sigue siendo el error de siempre.
    const otro = nadieCard()
    api.createOrder.mockRejectedValueOnce(new ApiError('Error de validación: El nombre es muy largo', 400))
    expect((await submitOrder(otro.store, otro.body)).kind).toBe('error')
  })

  it.each([
    ['TOO_MANY_PENDING_ORDERS', 409, 'Ya tienes pagos con tarjeta sin terminar en este negocio. Paga en caja o espera unos minutos.'],
    ['CARD_AMOUNT_OUT_OF_RANGE', 400, 'Este monto no se puede pagar con tarjeta en línea. Paga en caja.'],
  ])('ronda 1 M5: %s con la tarjeta de «Nadie» ⇒ su línea y «Pagar en caja» elegida (en «Nadie» la caja siempre recibe)', async (code, status, text) => {
    const { store, body } = nadieCard()
    api.createOrder.mockRejectedValueOnce(new ApiError('texto del servidor', status, code))
    api.getInfo.mockResolvedValueOnce(nadieCardInfo)
    const r = await send(store, body)
    await flush()
    expect(r).toEqual({ kind: 'tarjetaNoDisponible', message: text })
    const c = checkoutOf(store)
    expect(c.feedback.value).toEqual({ kind: 'error', message: text, retryable: false })
    expect(c.draft.value.payment).toBe('PAY_AT_PICKUP')
    expect(store.screen.value).toBe('details')
    expect(store.cart.value).toEqual([line()])
    expect(pendingAttempt(store.slug)).toBeNull()
  })

  it('D661: 400 CARD_PAYMENT_NOT_ACCEPTED en «Nadie» ⇒ una línea, «Pagar en caja» elegida, /info al día, el carrito intacto y el intento resuelto', async () => {
    const { store, body } = nadieCard()
    api.createOrder.mockRejectedValueOnce(new ApiError('Este negocio no acepta pagar con tarjeta en línea.', 400, 'CARD_PAYMENT_NOT_ACCEPTED'))
    api.getInfo.mockResolvedValueOnce({ ...nadieCardInfo, paymentModes: { payAtPickup: true, cardOnline: false } })
    await send(store, body)
    await flush()
    const c = checkoutOf(store)
    expect(c.feedback.value).toEqual({ kind: 'error', message: 'Pagar en línea no está disponible ahora. Puedes pagar en caja.', retryable: false })
    expect(c.draft.value.payment).toBe('PAY_AT_PICKUP')
    expect(api.getInfo).toHaveBeenCalledTimes(1)
    expect(store.info.value?.paymentModes.cardOnline).toBe(false)
    expect(store.screen.value).toBe('details')
    expect(store.cart.value).toEqual([line()])
    expect(pendingAttempt(store.slug)).toBeNull()
  })

  it('D661: 409 CARD_ONLINE_QUEUE_FULL ⇒ ocupado, se puede pagar en caja; nunca «la tienda no está recibiendo pedidos»', async () => {
    const { store, body } = nadieCard()
    api.createOrder.mockRejectedValueOnce(new ApiError('Por ahora hay muchos pagos con tarjeta esperando.', 409, 'CARD_ONLINE_QUEUE_FULL'))
    api.getInfo.mockResolvedValueOnce(nadieCardInfo)
    const r = await send(store, body)
    await flush()
    expect(r.kind).not.toBe('storeUnavailable')
    const c = checkoutOf(store)
    expect(c.feedback.value).toEqual({
      kind: 'error', message: 'Ahora hay muchos pagos en línea. Puedes pagar en caja o intentar en unos minutos.', retryable: false,
    })
    expect(c.draft.value.payment).toBe('PAY_AT_PICKUP')
    expect(store.info.value?.status).toBe('OPEN')
    expect(store.screen.value).toBe('details')
    expect(store.cart.value).toEqual([line()])
    expect(pendingAttempt(store.slug)).toBeNull()
  })

  describe('ronda 4: el mismo navegador compartido', () => {
    const borrador = (over: Partial<CreatedCardOrder> = {}): CreatedCardOrder => ({
      trackingToken: 'D'.repeat(32), checkoutUrl: URL_PAGO, status: 'AWAITING_PAYMENT', total: '170.00', replay: false, ...over,
    })
    /** Otra pestaña: su sessionStorage y su página empiezan de cero (abre con la sesión guardada); la localStorage es la misma. */
    function pestanaNueva(slug: string) {
      sessionStorage.clear()
      documentoNuevoParaPruebas()
      const store = createOrderStore(slug, { locale: 'es' })
      store.cart.value = [line()]
      store.quote.value = quoteOf(170)
      store.info.value = nadieCardInfo
      store.go('details')
      checkoutOf(store)
      return { store, body: buildOrderBody(store, { customer: { name: ' Ana ' }, note: null, paymentMode: 'CARD_ONLINE' }) }
    }

    it('Minor C: el SERVIDOR renovó la sesión entre dos «Pedir» (otro token, la misma clienta): la pestaña duplicada reusa la compra; otra clienta con el mismo cuerpo, no', async () => {
      const { store, body } = nadieCard()
      const assign = vi.spyOn(nav, 'assign').mockImplementation(() => {})
      api.createOrder.mockResolvedValueOnce(borrador())
      await send(store, body)
      // Su respuesta traía la sesión renovada (la de Ana tenía más de un día): `api.ts` la guarda.
      aplicarRenovacion(store.slug, new Headers({ 'x-customer-session': 'tok-A2' }), 'tok-A')
      expect(leerSesion(store.slug)?.token).toBe('tok-A2')
      const tab2 = pestanaNueva(store.slug)
      api.createOrder.mockResolvedValueOnce(borrador({ replay: true }))
      await send(tab2.store, tab2.body)
      expect(sent(1).key).toBe(sent(0).key)
      expect(sent(1).body).toEqual(sent(0).body)
      expect(sent(1).token).toBe('tok-A') // la misma petición (la renovada es de la misma clienta)
      expect(assign).toHaveBeenCalledTimes(2)
      expect(assign).toHaveBeenLastCalledWith(URL_PAGO) // la MISMA página de pago: un solo borrador
      // Bea entra en el mismo navegador y pide exactamente lo mismo (el mismo carrito y el mismo nombre: sólo la sesión las distingue).
      guardarSesion(store.slug, sesionB() as any)
      const deBea = pestanaNueva(store.slug)
      api.createOrder.mockResolvedValueOnce(borrador({ trackingToken: 'B'.repeat(32) }))
      await send(deBea.store, deBea.body)
      expect(sent(2).body).toEqual(sent(0).body)
      expect(sent(2).key).not.toBe(sent(0).key)
      expect(sent(2).token).toBe('tok-B')
    })

    it('Ruling 54 extendida: con la respuesta perdida, «Cerrar sesión» suelta el intento de la pestaña: quien entra después no reenvía lo de la otra', async () => {
      const { store, body } = nadieCard()
      api.createOrder.mockRejectedValueOnce(offline())
      await send(store, body)
      const c = checkoutOf(store)
      expect(pendingAttempt(store.slug)).not.toBeNull()
      expect(c.feedback.value).toMatchObject({ kind: 'error', retryable: true }) // «Reintentar»
      salioEnLaTienda(store)
      expect(pendingAttempt(store.slug)).toBeNull()
      // La pantalla ya no ofrece «Reintentar» lo de Ana ni deja «Pedir» bloqueado por eso.
      expect(c.pending.value).toBe(false)
      expect(c.feedback.value).toBeNull()
      // Bea entra en esa pestaña: «Reintentar» ya no manda el cuerpo ni el token de Ana (ni, con tarjeta, la lleva a su página de pago).
      guardarSesion(store.slug, sesionB() as any)
      entroEnLaTienda(store, sesionB() as any, null)
      expect(await retry(store)).toBeNull()
      expect(api.createOrder).toHaveBeenCalledTimes(1)
      // Su «Pedir» es SU compra: otra llave, con su sesión.
      vi.spyOn(nav, 'assign').mockImplementation(() => {})
      store.quote.value = quoteOf(170) // la tienda vuelve a cotizar al cambiar de sesión
      api.createOrder.mockResolvedValueOnce(borrador({ trackingToken: 'B'.repeat(32) }))
      await send(store, buildOrderBody(store, { customer: { name: 'Bea' }, note: null, paymentMode: 'CARD_ONLINE' }))
      expect(sent(1).key).not.toBe(sent(0).key)
      expect(sent(1).token).toBe('tok-B')
      expect(sent(1).body.customer).toEqual({ name: 'Bea' })
    })
  })

  describe('ronda 5: lo de Ana no se queda para quien sigue', () => {
    /** Un token con la ficha legible (`sub`), como los del SERVIDOR. */
    const jwt = (sub: string, n: number) => `h.${btoa(JSON.stringify({ sub, n }))}.s`
    const sesionVencida = () => new ApiError('Tu sesión ya no es válida.', 401, 'CUSTOMER_TOKEN_INVALID')

    it('(1) «Cerrar sesión» no deja en «Tus datos» lo que escribió Ana ni lo que eligió usar; el carrito se queda, como siempre', () => {
      const { store } = nadieCard()
      const c = checkoutOf(store)
      c.draft.value = {
        note: 'sin cebolla', name: 'Ana López', dial: '1', national: '5544422262', email: 'ana@correo.mx', accepted: true, payment: 'CARD_ONLINE',
      }
      c.eleccion.value = { premioId: 'pr1', puntos: 50, cupon: 'ANA10' }
      salioEnLaTienda(store)
      expect(c.draft.value).toEqual({ note: '', name: '', dial: '52', national: '', email: '', accepted: false })
      expect(c.eleccion.value).toEqual({})
      expect(store.cart.value).toEqual([line()])
    })

    it('(3) el intento que espera entrar (su token recibió 401) es de SU clienta: si entra otra, se suelta y no se le entrega', async () => {
      const ana = jwt('c1', 1)
      const { store, body } = nadieCard({ token: ana })
      api.createOrder.mockRejectedValueOnce(sesionVencida())
      expect((await send(store, body)).kind).toBe('needsSesion')
      expect(pendingAttempt(store.slug)).toMatchObject({ requiereEntrar: true, token: ana })
      // Entra Bea en esa pestaña: ni el cuerpo ni la llave de Ana son suyos.
      const bea = { ...sesionB(), token: jwt('c2', 2) }
      guardarSesion(store.slug, bea as any)
      entroEnLaTienda(store, bea as any, 'details')
      expect(pendingAttempt(store.slug)).toBeNull()
      const c = checkoutOf(store)
      expect(c.pending.value).toBe(false) // ni «Entra otra vez para terminar tu pedido» ni «Pedir» bloqueado
      expect(c.feedback.value).toBeNull()
      expect(await retry(store)).toBeNull()
      expect(api.createOrder).toHaveBeenCalledTimes(1)
    })

    it('(3) si entra ella otra vez (otro token, la misma ficha), su pedido sale como hoy: su sesión nueva, la misma llave y el mismo cuerpo', async () => {
      const { store, body } = nadieCard({ token: jwt('c1', 1) })
      api.createOrder.mockRejectedValueOnce(sesionVencida())
      await send(store, body)
      const otraVez = { ...sesion(jwt('c1', 3)), guardadaEn: Date.now() }
      guardarSesion(store.slug, otraVez as any)
      entroEnLaTienda(store, otraVez as any, 'details')
      expect(pendingAttempt(store.slug)).toMatchObject({ token: otraVez.token, requiereEntrar: false, porSesion: true })
      vi.spyOn(nav, 'assign').mockImplementation(() => {})
      api.createOrder.mockResolvedValueOnce({ trackingToken: 'D'.repeat(32), checkoutUrl: URL_PAGO, status: 'AWAITING_PAYMENT', total: '170.00', replay: false })
      await retry(store)
      expect(sent(1)).toMatchObject({ key: sent(0).key, token: otraVez.token })
      expect(sent(1).body).toEqual(sent(0).body)
    })
  })

  describe('limpieza final (Ruling 77)', () => {
    const jwt = (sub: string, n: number) => `h.${btoa(JSON.stringify({ sub, n }))}.s`
    const vacio = { note: '', name: '', dial: '52', national: '', email: '', accepted: false }

    it('(1) con el código de WhatsApp, el intento que esperaba entrar sale con la MISMA llave aunque el teléfono resuelva a otra ficha: nunca un segundo pedido', async () => {
      const slug = `l77${++n}`
      guardarSesion(slug, { ...sesion(jwt('c1', 1)), guardadaEn: Date.now() } as any)
      const store = createOrderStore(slug, { locale: 'es' })
      store.cart.value = [line()]
      store.quote.value = quoteOf(170)
      store.info.value = info // «Mi equipo», pagar al recoger
      const body = buildOrderBody(store, { customer: { name: ' Ana López ', phone: PHONE }, note: null })
      api.createOrder.mockRejectedValueOnce(offline()) // la respuesta se perdió: el pedido quizá ya existe
      await send(store, body)
      api.createOrder.mockRejectedValueOnce(new ApiError('Tu sesión ya no es válida.', 401, 'CUSTOMER_TOKEN_INVALID'))
      expect((await retry(store))?.kind).toBe('needsOtp')
      // Como OtpScreen: toma el cuerpo antes de verificar y lo manda después. El código del MISMO teléfono resuelve a otra ficha (c3).
      const cuerpo = pendingAttempt(slug)?.body ?? checkoutOf(store).lastBody.value!
      api.verifyOrderingOtp.mockResolvedValueOnce({ ...sesion(jwt('c3', 3)), customer: { ...sesion('x').customer, id: 'c3' } })
      expect(await verifyPhone(store, PHONE, '123456')).toBe(true)
      api.createOrder.mockRejectedValueOnce(new ApiError('x', 409, 'IDEMPOTENCY_KEY_CONFLICT', undefined, false, true))
      await send(store, cuerpo)
      expect(api.createOrder).toHaveBeenCalledTimes(3)
      expect([sent(1).key, sent(2).key]).toEqual([sent(0).key, sent(0).key]) // la misma llave: el SERVIDOR nunca crea otro
    })

    it('(2) llega la sesión de OTRA clienta sin el «Cerrar sesión» de la tienda (tras un 401, o tras salir en reservas): lo de Ana se vacía', async () => {
      const deAna = { note: 'sin cebolla', name: 'Ana López', dial: '52', national: '5544422262', email: 'ana@correo.mx', accepted: true }
      for (const como of ['401', 'reservas'] as const) {
        const { store } = nadieCard({ token: jwt('c1', 1) })
        const c = checkoutOf(store)
        c.draft.value = deAna
        c.eleccion.value = { premioId: 'pr1', puntos: 50, cupon: 'ANA10' }
        if (como === '401') {
          api.quote.mockRejectedValueOnce(new ApiError('Tu sesión ya no es válida.', 401, 'CUSTOMER_TOKEN_INVALID')).mockResolvedValueOnce(quoteOf(170))
          await cotizar(store, toQuoteItems(store.cart.value))
          expect(paginaDe(store.slug, 'pedidos')).toBeNull()
        } else clearCustomerSession(store.slug) // el «Cerrar sesión» del widget de reservas, en esta misma página
        expect(c.draft.value, como).toEqual(deAna) // todavía es de Ana: puede volver a entrar a terminar
        const bea = { ...sesionB(), token: jwt('c2', 2) }
        guardarSesion(store.slug, bea as any)
        entroEnLaTienda(store, bea as any, 'details')
        expect(c.draft.value, como).toEqual(vacio)
        expect(c.eleccion.value, como).toEqual({})
      }
    })

    it('(2) si vuelve a entrar ella (la misma ficha), lo suyo se queda', async () => {
      const { store } = nadieCard({ token: jwt('c1', 1) })
      const c = checkoutOf(store)
      c.draft.value = { ...vacio, name: 'Ana López', note: 'sin cebolla' }
      c.eleccion.value = { cupon: 'ANA10' }
      api.quote.mockRejectedValueOnce(new ApiError('Tu sesión ya no es válida.', 401, 'CUSTOMER_TOKEN_INVALID')).mockResolvedValueOnce(quoteOf(170))
      await cotizar(store, toQuoteItems(store.cart.value))
      const otraVez = { ...sesion(jwt('c1', 3)), guardadaEn: Date.now() }
      guardarSesion(store.slug, otraVez as any)
      entroEnLaTienda(store, otraVez as any, 'details')
      expect(c.draft.value).toEqual({ ...vacio, name: 'Ana López', note: 'sin cebolla' })
      expect(c.eleccion.value).toEqual({ cupon: 'ANA10' })
    })
  })
})
