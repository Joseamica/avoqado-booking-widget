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
import { buildOrderBody, checkoutOf, isDefinitive, phoneToVerify, retry, send, submitOrder, verifyPhone } from './checkout'
import { createOrderStore, type OrderStore } from './store'
import { loadLastOrder, loadSession, saveSession } from './session'
import { pendingAttempt } from './attempt'
import { phoneE164 } from './phone'
import type { CartLine } from './cart'
import type { CreatedOrder, Quote, StoreInfo } from './types'

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
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }

let n = 0
function setup(opts: { total?: number; sessionPhone?: string | null } = {}) {
  const store = createOrderStore(`chk${++n}`, { locale: 'es' })
  store.cart.value = [line()]
  store.quote.value = quoteOf(opts.total ?? 170)
  store.info.value = info
  const sessionPhone = opts.sessionPhone === undefined ? PHONE : opts.sessionPhone
  if (sessionPhone) saveSession(store.slug, { token: 'tok-1', phone: sessionPhone, name: 'Ana', savedAt: Date.now() })
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
})
afterEach(() => vi.restoreAllMocks())

describe('buildOrderBody', () => {
  it('el total que se manda es el de la cotización del servidor, con dos decimales; nombre recortado; sin correo ni nota vacíos', () => {
    const { store, body } = setup({ total: 206.5 })
    expect(body).toEqual({
      items: [{ productId: 'p-flauta', quantity: 2, modifiers: [{ modifierId: 'm-salsa', quantity: 1 }] }],
      paymentMode: 'PAY_AT_PICKUP',
      expectedTotal: '206.50',
      customer: { name: 'Ana López', phone: '+525544422262' },
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
    ['404', new ApiError('x', 404, 'VENUE_NOT_FOUND'), true],
    ['409 PRICE_CHANGED', new ApiError('x', 409, 'PRICE_CHANGED'), true],
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

    api.verifyOrderingOtp.mockResolvedValueOnce({ token: 'tok-2', customer: { id: 'c1' } })
    await verifyPhone(store, phoneToVerify(store)!, '123456')
    api.createOrder.mockResolvedValueOnce(created())
    expect((await submitOrder(store, body)).kind).toBe('created')
    expect(sent(1).key).toBe(sent(0).key)
    expect(sent(1).body).toEqual(sent(0).body)
    expect(sent(1).token).toBe('tok-2')
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
      kind: 'error', message: 'Ya tienes 3 pedidos esperando respuesta en este restaurante.', retryable: false,
    })
    expect(pendingAttempt(store.slug)).toBeNull()
  })

  it('ORDERING_PAUSED ⇒ storeUnavailable con su motivo; el intento se borra', async () => {
    const { store, body } = setup()
    api.createOrder.mockRejectedValueOnce(new ApiError('Pausado', 409, 'ORDERING_PAUSED', { status: 'PAUSED', reason: 'TOO_BUSY' }))
    expect(await submitOrder(store, body)).toEqual({ kind: 'storeUnavailable', status: 'PAUSED', reason: 'TOO_BUSY' })
    expect(pendingAttempt(store.slug)).toBeNull()
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
    api.verifyOrderingOtp.mockResolvedValueOnce({ token: 'tok-otp', customer: { id: 'c1' } })
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

  it('«Reintentar» sin intento pendiente no inventa uno nuevo', async () => {
    const { store } = setup()
    await retry(store)
    expect(api.createOrder).not.toHaveBeenCalled()
  })
})
