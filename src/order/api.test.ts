import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  API_BASE,
  ApiError,
  cancelOrder,
  createOrder,
  getInfo,
  getTracking,
  quote,
  requestOrderingOtp,
  verifyOrderingOtp,
} from './api'
import type { CreateOrderBody } from './types'
import { abrirPagina, guardarSesion, leerSesion, paginaDe } from '../lib/sesionDeCliente'
import { loadSession } from './session'

const fetchMock = vi.fn()

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** Lo que recibió `fetch` en la llamada `n`: URL, método, cabeceras y cuerpo ya parseado. */
function call(n = 0) {
  const [url, init] = fetchMock.mock.calls[n] as [string, RequestInit]
  return {
    url,
    method: init.method ?? 'GET',
    headers: (init.headers ?? {}) as Record<string, string>,
    body: init.body === undefined ? undefined : JSON.parse(init.body as string),
  }
}

async function caught(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError)
    return e as ApiError
  }
  throw new Error('se esperaba un ApiError')
}

const BODY: CreateOrderBody = {
  items: [{ productId: 'cprod00000000000000000001', quantity: 2, modifiers: [{ modifierId: 'cmod000000000000000000001' }] }],
  paymentMode: 'PAY_AT_PICKUP',
  expectedTotal: '206.00',
  customer: { name: 'Ana López', phone: '+525512345678' },
}
const KEY = 'k_0123456789abcdefghijklmnopqrstuv'

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('respuestas correctas', () => {
  it('devuelve `data` y codifica el slug en la ruta', async () => {
    const info = { venue: { slug: 'flautas coyoacán', name: 'Flautas', timezone: 'America/Mexico_City', currency: 'MXN' }, status: 'OPEN' }
    fetchMock.mockResolvedValue(json(200, { success: true, data: info }))

    await expect(getInfo('flautas coyoacán')).resolves.toEqual(info)
    expect(call().url).toBe(`${API_BASE}/venues/flautas%20coyoac%C3%A1n/ordering/info`)
  })

  it('un GET no manda Content-Type ni la cabecera de ngrok (sin preflight en cada sondeo)', async () => {
    fetchMock.mockResolvedValue(json(200, { success: true, data: { status: 'ACCEPTED' } }))

    await getTracking('flautas', 'TRK_abcdefghijklmnopqrstuvwxyz012')

    const c = call()
    expect(c.url).toBe(`${API_BASE}/venues/flautas/ordering/orders/TRK_abcdefghijklmnopqrstuvwxyz012`)
    expect(c.method).toBe('GET')
    expect(Object.keys(c.headers).map(h => h.toLowerCase())).not.toContain('content-type')
    expect(Object.keys(c.headers).map(h => h.toLowerCase())).not.toContain('ngrok-skip-browser-warning')
  })

  it('un POST manda JSON con Content-Type', async () => {
    fetchMock.mockResolvedValue(json(200, { success: true, data: { ok: true, lines: [], subtotal: 0, total: 0, minOrderAmount: 0, issues: [] } }))

    await quote('flautas', BODY.items)

    const c = call()
    expect(c.url).toBe(`${API_BASE}/venues/flautas/ordering/quote`)
    expect(c.method).toBe('POST')
    expect(c.headers['Content-Type']).toBe('application/json')
    expect(c.body).toEqual({ items: BODY.items })
  })

  it('createOrder manda la llave y el token, y devuelve el pedido plano con `replay` (201 nuevo)', async () => {
    // Cuerpo literal del servidor (onlineOrdering.public.controller.ts postOrder: 201 al crear).
    const created = {
      orderId: 'corder0000000000000000001',
      onlineOrderId: 'conline000000000000000001',
      trackingToken: 'TRK_abcdefghijklmnopqrstuvwxyz012',
      status: 'PENDING_ACCEPTANCE',
      orderNumber: 'WEB-0042',
      total: '206.00',
      acceptDeadlineAt: '2026-10-17T19:40:00.000Z',
      replay: false,
    }
    fetchMock.mockResolvedValue(json(201, { success: true, data: created }))

    await expect(createOrder('flautas', BODY, { idempotencyKey: KEY, token: 'jwt.del.pedido' })).resolves.toEqual(created)

    const c = call()
    expect(c.url).toBe(`${API_BASE}/venues/flautas/ordering/orders`)
    expect(c.method).toBe('POST')
    expect(c.headers['Idempotency-Key']).toBe(KEY)
    expect(c.headers.Authorization).toBe('Bearer jwt.del.pedido')
    expect(c.headers['Content-Type']).toBe('application/json')
    expect(c.body).toEqual(BODY)
  })

  it('fase 2: createOrder con tarjeta, sin token ⇒ NO manda Authorization (sí la llave) y devuelve el borrador con checkoutUrl', async () => {
    const draft = {
      trackingToken: 'TRK_abcdefghijklmnopqrstuvwxyz012', checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_1',
      status: 'AWAITING_PAYMENT', total: '206.00', replay: false,
    }
    fetchMock.mockResolvedValue(json(201, { success: true, data: draft }))

    await expect(createOrder('flautas', { ...BODY, paymentMode: 'CARD_ONLINE' }, { idempotencyKey: KEY })).resolves.toEqual(draft)

    const c = call()
    expect(c.headers['Idempotency-Key']).toBe(KEY)
    expect(Object.keys(c.headers).map(h => h.toLowerCase())).not.toContain('authorization')
    expect(c.body.paymentMode).toBe('CARD_ONLINE')
  })

  it('createOrder con 200 (repetición) devuelve el mismo pedido con replay:true', async () => {
    const replayed = {
      orderId: 'corder0000000000000000001',
      onlineOrderId: 'conline000000000000000001',
      trackingToken: 'TRK_abcdefghijklmnopqrstuvwxyz012',
      status: 'ACCEPTED',
      orderNumber: 'WEB-0042',
      total: '206.00',
      acceptDeadlineAt: '2026-10-17T19:40:00.000Z',
      replay: true,
    }
    fetchMock.mockResolvedValue(json(200, { success: true, data: replayed }))

    const r = await createOrder('flautas', BODY, { idempotencyKey: KEY, token: 't' })
    expect(r).toEqual(replayed)
    expect(r.replay).toBe(true)
  })

  it('cancelOrder hace POST a /cancel y devuelve el estado', async () => {
    fetchMock.mockResolvedValue(json(200, { success: true, data: { status: 'CANCELLED_BY_CUSTOMER' } }))

    await expect(cancelOrder('flautas', 'TRK_abcdefghijklmnopqrstuvwxyz012')).resolves.toEqual({ status: 'CANCELLED_BY_CUSTOMER' })
    expect(call().url).toBe(`${API_BASE}/venues/flautas/ordering/orders/TRK_abcdefghijklmnopqrstuvwxyz012/cancel`)
    expect(call().method).toBe('POST')
  })
})

describe('código de WhatsApp (responde sin `success`)', () => {
  it('requestOrderingOtp manda el teléfono', async () => {
    fetchMock.mockResolvedValue(json(200, { ok: true }))

    await expect(requestOrderingOtp('flautas', '+525512345678')).resolves.toBeUndefined()
    expect(call().url).toBe(`${API_BASE}/venues/flautas/auth/otp/request`)
    expect(call().body).toEqual({ phone: '+525512345678' })
  })

  it('W2: verifyOrderingOtp manda {phone, code, purpose:"SESSION"} y devuelve la sesión única (token, cliente y contactos)', async () => {
    const res = {
      token: 'jwt.de.la.sesion',
      customer: { id: 'ccust0000000000000000001', firstName: 'Ana', lastName: null, email: null, phone: '+525512345678' },
      contactos: [{ tipo: 'PHONE', valor: '+525512345678', metodo: 'WHATSAPP', probadoEn: 1794000000 }],
      otraFicha: null,
    }
    fetchMock.mockResolvedValue(json(200, res))

    await expect(verifyOrderingOtp('flautas', '+525512345678', '123456')).resolves.toEqual(res)
    expect(call().url).toBe(`${API_BASE}/venues/flautas/auth/otp/verify`)
    // Sin `alNoEncontrar`: un teléfono sin ficha la crea como hoy (el pedido está esperando; la pregunta vive en «Entrar»).
    expect(call().body).toEqual({ phone: '+525512345678', code: '123456', purpose: 'SESSION' })
  })
})

describe('errores', () => {
  it('error público {success:false, code, error, details} ⇒ ApiError con status, code y details', async () => {
    const details = { quote: { ok: true, lines: [], subtotal: 210, total: 210, minOrderAmount: 0, issues: [] } }
    fetchMock.mockResolvedValue(
      json(409, { success: false, code: 'PRICE_CHANGED', error: 'El precio de tu pedido cambió.', details }),
    )

    const e = await caught(createOrder('flautas', BODY, { idempotencyKey: KEY, token: 't' }))
    expect(e).toMatchObject({ status: 409, code: 'PRICE_CHANGED', details, network: false, message: 'El precio de tu pedido cambió.' })
  })

  it('W1: la marca `final: true` del cuerpo llega en ApiError.final; sin ella (o con otro valor) es false', async () => {
    fetchMock.mockResolvedValueOnce(json(404, { success: false, code: 'VENUE_NOT_FOUND', error: 'x', final: true }))
    expect((await caught(createOrder('flautas', BODY, { idempotencyKey: KEY, token: 't' }))).final).toBe(true)
    fetchMock.mockResolvedValueOnce(json(404, { success: false, code: 'VENUE_NOT_FOUND', error: 'x' }))
    expect((await caught(createOrder('flautas', BODY, { idempotencyKey: KEY, token: 't' }))).final).toBe(false)
    fetchMock.mockResolvedValueOnce(json(404, { success: false, code: 'VENUE_NOT_FOUND', error: 'x', final: 'true' }))
    expect((await caught(createOrder('flautas', BODY, { idempotencyKey: KEY, token: 't' }))).final).toBe(false)
  })

  it('error global {message} ⇒ ApiError 400 sin code y con el mensaje del servidor', async () => {
    fetchMock.mockResolvedValue(json(400, { message: 'Código incorrecto.' }))

    const e = await caught(verifyOrderingOtp('flautas', '+525512345678', '000000'))
    expect(e.status).toBe(400)
    expect(e.code).toBeUndefined()
    expect(e.message).toBe('Código incorrecto.')
    expect(e.network).toBe(false)
  })

  it('429 con texto plano (limitador por omisión del OTP) ⇒ RATE_LIMIT_EXCEEDED', async () => {
    fetchMock.mockResolvedValue(new Response('Too many requests, please try again later.', { status: 429 }))

    const e = await caught(requestOrderingOtp('flautas', '+525512345678'))
    expect(e).toMatchObject({ status: 429, code: 'RATE_LIMIT_EXCEEDED', network: false })
  })

  it('fetch que lanza TypeError (sin red) ⇒ ApiError network:true, status 0', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    const e = await caught(getInfo('flautas'))
    expect(e).toMatchObject({ network: true, status: 0 })
  })

  it('sin respuesta en 15 s ⇒ ApiError network:true (se aborta la petición)', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          signal = init.signal ?? undefined
          signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        }),
    )

    const p = caught(getTracking('flautas', 'TRK_abcdefghijklmnopqrstuvwxyz012'))
    await vi.advanceTimersByTimeAsync(14_999)
    expect(signal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)

    const e = await p
    expect(signal?.aborted).toBe(true)
    expect(e).toMatchObject({ network: true, status: 0 })
  })
})

describe('codex-r8 H4: el 401 de la tienda suelta la sesión ANTES de leer el cuerpo', () => {
  it('con el cuerpo detenido, la sesión ya no está guardada ni es la de la página', async () => {
    const PHONE = '+525512345678'
    guardarSesion('h4', { token: 'tok-A', customer: { id: 'c1', firstName: 'Ana', lastName: null, email: null, phone: PHONE },
      contactos: [{ tipo: 'PHONE', valor: PHONE, metodo: 'WHATSAPP', probadoEn: 1 }], guardadaEn: Date.now() })
    abrirPagina('h4', 'pedidos', () => loadSession('h4'))
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, headers: new Headers(), json: () => new Promise(() => {}) })
    void quote('h4', [{ productId: 'p1', quantity: 1 }], { token: 'tok-A' }).catch(() => {})
    for (let i = 0; i < 5; i++) await Promise.resolve()
    expect(leerSesion('h4')).toBeNull()
    expect(paginaDe('h4', 'pedidos')).toBeNull()
  })
})

