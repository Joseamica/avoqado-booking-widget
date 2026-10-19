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

  it('verifyOrderingOtp manda {phone, code, purpose:"ORDERING"} y devuelve token y cliente', async () => {
    const res = {
      token: 'jwt.del.pedido',
      customer: { id: 'ccust0000000000000000001', firstName: 'Ana', lastName: null, email: null, phone: '+525512345678' },
    }
    fetchMock.mockResolvedValue(json(200, res))

    await expect(verifyOrderingOtp('flautas', '+525512345678', '123456')).resolves.toEqual(res)
    expect(call().url).toBe(`${API_BASE}/venues/flautas/auth/otp/verify`)
    expect(call().body).toEqual({ phone: '+525512345678', code: '123456', purpose: 'ORDERING' })
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
