// Sesión de pedidos (token OTP de WhatsApp) y último pedido, por negocio, en localStorage. Todo con try/catch: sin
// almacenamiento la tienda funciona igual, sólo que pide el código otra vez.
export interface OrderingSession { token: string; phone: string; name: string | null; savedAt: number }
export interface LastOrder { trackingToken: string; orderNumber: string }

const TTL_MS = 29 * 24 * 60 * 60 * 1000
const sKey = (slug: string) => `avq_order_session:${slug}`
const lKey = (slug: string) => `avq_order_last:${slug}`

const read = (key: string): any => {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}
const write = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* sin almacenamiento */
  }
}
const remove = (key: string) => {
  try {
    localStorage.removeItem(key)
  } catch {
    /* sin almacenamiento */
  }
}

export function loadSession(slug: string): OrderingSession | null {
  const s = read(sKey(slug))
  if (!s || typeof s.token !== 'string' || typeof s.phone !== 'string' || !Number.isFinite(s.savedAt)) return null
  if (Date.now() - s.savedAt >= TTL_MS) {
    remove(sKey(slug))
    return null
  }
  return { token: s.token, phone: s.phone, name: typeof s.name === 'string' ? s.name : null, savedAt: s.savedAt }
}
export const saveSession = (slug: string, s: OrderingSession): void => write(sKey(slug), s)
export const clearSession = (slug: string): void => remove(sKey(slug))

/** Mismo teléfono = mismos últimos 10 dígitos (con o sin lada de país). */
const last10 = (p: string) => p.replace(/\D/g, '').slice(-10)
export const samePhone = (a: string, b: string): boolean => last10(a).length === 10 && last10(a) === last10(b)

export const saveLastOrder = (slug: string, o: LastOrder): void => write(lKey(slug), o)
export function loadLastOrder(slug: string): LastOrder | null {
  const o = read(lKey(slug))
  return o && typeof o.trackingToken === 'string' && typeof o.orderNumber === 'string'
    ? { trackingToken: o.trackingToken, orderNumber: o.orderNumber }
    : null
}
export const clearLastOrder = (slug: string): void => remove(lKey(slug))
