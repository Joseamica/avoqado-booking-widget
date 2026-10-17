import type { CreateOrderBody, CreatedOrder, Menu, OrderingCustomer, Quote, QuoteItem, StoreInfo, Tracking } from './types'

export const API_BASE: string =
  (import.meta.env?.VITE_API_URL as string | undefined) || 'https://api.avoqado.io/api/v1/public'

const TIMEOUT_MS = 15_000

/**
 * Un error de la API con las dos formas del servidor unidas: la pública `{success:false, code, error, details}` y la global
 * `{message, code?, details?}`. `network` = no hubo respuesta usable (sin red, 15 s sin respuesta): el desenlace es desconocido.
 */
export class ApiError extends Error {
  status: number
  code?: string
  details?: unknown
  network: boolean

  constructor(message: string, status: number, code?: string, details?: unknown, network = false) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
    this.network = network
  }
}

const offline = () => new ApiError('Sin conexión', 0, undefined, undefined, true)

/**
 * Los GET no llevan cabeceras propias (petición simple: sin preflight en cada sondeo); un POST con cuerpo lleva
 * `Content-Type: application/json`. Devuelve el JSON tal cual (sin desenvolver `data`).
 */
async function send<T>(path: string, opts: { method?: 'POST'; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    let res: Response
    try {
      res = await fetch(API_BASE + path, {
        method: opts.method ?? 'GET',
        headers: { ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...opts.headers },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: ctrl.signal,
      })
    } catch {
      throw offline()
    }
    const body: any = await res.json().catch(() => null)
    // Un 2xx sin JSON legible (portal cautivo, lectura abortada) no dice qué pasó: se trata como sin red.
    if (res.ok) {
      if (body === null) throw offline()
      return body as T
    }
    const code = body?.code ?? (res.status === 429 ? 'RATE_LIMIT_EXCEEDED' : undefined)
    throw new ApiError(body?.error ?? body?.message ?? `HTTP ${res.status}`, res.status, code, body?.details)
  } finally {
    clearTimeout(timer)
  }
}

const ordering = (slug: string) => `/venues/${encodeURIComponent(slug)}/ordering`
const data = <T>(p: Promise<{ data: T }>) => p.then(r => r.data)

export const getInfo = (slug: string) => data(send<{ data: StoreInfo }>(`${ordering(slug)}/info`))

export const getMenu = (slug: string) => data(send<{ data: Menu }>(`${ordering(slug)}/menu`))

export const quote = (slug: string, items: QuoteItem[]) =>
  data(send<{ data: Quote }>(`${ordering(slug)}/quote`, { method: 'POST', body: { items } }))

/** 201 al crear, 200 si es una repetición de la misma llave: `data.replay` lo dice. */
export const createOrder = (slug: string, body: CreateOrderBody, opts: { idempotencyKey: string; token: string }) =>
  data(
    send<{ data: CreatedOrder }>(`${ordering(slug)}/orders`, {
      method: 'POST',
      body,
      headers: { 'Idempotency-Key': opts.idempotencyKey, Authorization: `Bearer ${opts.token}` },
    }),
  )

export const getTracking = (slug: string, trackingToken: string) =>
  data(send<{ data: Tracking }>(`${ordering(slug)}/orders/${encodeURIComponent(trackingToken)}`))

export const cancelOrder = (slug: string, trackingToken: string) =>
  data(
    send<{ data: { status: 'CANCELLED_BY_CUSTOMER' } }>(`${ordering(slug)}/orders/${encodeURIComponent(trackingToken)}/cancel`, {
      method: 'POST',
    }),
  )

// El OTP vive fuera de /ordering y responde sin `success`/`data`.
const otp = (slug: string) => `/venues/${encodeURIComponent(slug)}/auth/otp`

export async function requestOrderingOtp(slug: string, phone: string): Promise<void> {
  await send(`${otp(slug)}/request`, { method: 'POST', body: { phone } })
}

export const verifyOrderingOtp = (slug: string, phone: string, code: string) =>
  send<{ token: string; customer: OrderingCustomer }>(`${otp(slug)}/verify`, {
    method: 'POST',
    body: { phone, code, purpose: 'ORDERING' },
  })
