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
import { buildOrderBody, checkoutOf, isDefinitive, nav, phoneToVerify, retry, send, storageWorks, submitOrder, verifyPhone } from './checkout'
import { createOrderStore, type OrderStore } from './store'
import { loadLastOrder, loadSession, saveSession } from './session'
import { guardarSesion, leerSesion } from '../lib/sesionDeCliente'
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
    const { store, body } = setup({ sessionPhone: null })
    guardarSesion(store.slug, { ...sesion('tok-vieja'), guardadaEn: Date.now() } as any)
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
    const { store, body } = setup({ sessionPhone: null })
    guardarSesion(store.slug, { ...sesion('tok-A'), guardadaEn: Date.now() } as any)
    checkoutOf(store) // abrir la tienda: toma A
    guardarSesion(store.slug, { ...sesion('tok-B'), contactos: [{ tipo: 'PHONE', valor: PHONE, metodo: 'WHATSAPP', probadoEn: 2 }], guardadaEn: Date.now() } as any)
    expect(await submitOrder(store, body)).toEqual({ kind: 'needsOtp' })
    expect(api.createOrder).not.toHaveBeenCalled()
  })

  it('codex-r6 #2: el 401 de A también suelta su renovación A2 (la misma sesión): no queda guardada ni vuelve al recargar', async () => {
    const { store, body } = setup({ sessionPhone: null })
    guardarSesion(store.slug, { ...sesion('tok-A'), guardadaEn: Date.now() } as any)
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
    const { store, body } = setup({ sessionPhone: null })
    guardarSesion(store.slug, { ...sesion('tok-1'), guardadaEn: Date.now() } as any)
    api.createOrder.mockRejectedValueOnce(new ApiError('Esta cuenta está desactivada', 401, 'CUSTOMER_INACTIVE'))
    expect((await submitOrder(store, body)).kind).toBe('error')
    expect(leerSesion(store.slug)).toBeNull()
    expect(pendingAttempt(store.slug)).not.toBeNull()
  })

  it('codex-r2: pedir en «Mi equipo» manda la sesión vigente al momento de mandar', async () => {
    const { store, body } = setup({ sessionPhone: null })
    guardarSesion(store.slug, { ...sesion('tok-vieja'), guardadaEn: Date.now() } as any)
    guardarSesion(store.slug, { ...sesion('tok-vigente'), guardadaEn: Date.now() } as any)
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

  it.each([
    ['CARD_PAYMENT_NOT_ACCEPTED', 'Este negocio ya no acepta tarjeta en línea. Elige pagar al recoger.'],
    ['CARD_AMOUNT_OUT_OF_RANGE', 'El total no se puede pagar con tarjeta en línea (mínimo $10, máximo $50,000).'],
  ])('400 %s ⇒ su texto, sin «Reintentar», y el intento se borra', async (code, text) => {
    const { store, body } = card()
    store.info.value = { ...store.info.value!, paymentModes: { payAtPickup: true, cardOnline: true } }
    api.createOrder.mockRejectedValueOnce(new ApiError('x', 400, code))
    expect(await submitOrder(store, body)).toEqual({ kind: 'error', message: text, retryable: false })
    expect(pendingAttempt(store.slug)).toBeNull()
  })

  it('400 CARD_PAYMENT_NOT_ACCEPTED en una tienda de sólo tarjeta ⇒ no ofrece pagar al recoger, porque no existe', async () => {
    const { store, body } = card()
    store.info.value = { ...store.info.value!, paymentModes: { payAtPickup: false, cardOnline: true } }
    api.createOrder.mockRejectedValueOnce(new ApiError('x', 400, 'CARD_PAYMENT_NOT_ACCEPTED'))
    expect(await submitOrder(store, body)).toEqual({ kind: 'error', message: 'Este negocio ya no acepta tarjeta en línea.', retryable: false })
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

describe('W3: pedir con beneficios', () => {
  const nadieInfo = { ...info, requiresAcceptance: false } as StoreInfo
  /** «Nadie» con la sesión única de la página y lo elegido. */
  function nadie(opts: { eleccion?: Record<string, unknown>; q?: Partial<Quote>; total?: number; mode?: 'CARD_ONLINE' } = {}) {
    const store = createOrderStore(`ben${++n}`, { locale: 'es' })
    store.cart.value = [line()]
    store.info.value = opts.mode ? ({ ...info, paymentModes: { payAtPickup: true, cardOnline: true } } as StoreInfo) : nadieInfo
    guardarSesion(store.slug, { ...sesion('tok-A'), guardadaEn: Date.now() } as any)
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

  it('401 en «Nadie»: suelta la sesión y manda el MISMO intento sin ella; con beneficios, el SIN_SESION dice «Tu sesión se cerró»', async () => {
    const { store, body, c } = nadie({ eleccion: { premioId: 'pr1' } })
    api.createOrder
      .mockRejectedValueOnce(new ApiError('Sesión vencida', 401, 'CUSTOMER_TOKEN_INVALID'))
      .mockRejectedValueOnce(fin(409, 'PRICE_CHANGED', { quote: quoteOf(170), motivo: 'SIN_SESION' }))
    await send(store, body)
    expect(api.createOrder).toHaveBeenCalledTimes(2)
    expect(sent(0).token).toBe('tok-A')
    expect(sent(1).token).toBeUndefined()
    expect(sent(1).key).toBe(sent(0).key)
    expect(leerSesion(store.slug)).toBeNull()
    expect(c.feedback.value).toMatchObject({ kind: 'priceChanged', motivo: 'SIN_SESION' })
  })

  it('un folio de $0 en «Nadie» (cerrado por el SERVIDOR) va directo al seguimiento', async () => {
    const { store, body } = nadie({ eleccion: { premioId: 'pr1' }, total: 0 })
    expect(body.expectedTotal).toBe('0.00')
    api.createOrder.mockResolvedValueOnce(created({ total: '0.00', status: 'ACCEPTED' }))
    await send(store, body)
    expect(store.screen.value).toBe('tracking')
  })
})
