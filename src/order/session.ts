// Sesión de pedidos (token OTP de WhatsApp) y último pedido, por negocio, en localStorage. Todo con try/catch: sin
// almacenamiento la tienda funciona igual, sólo que pide el código otra vez.
// W1: la sesión ÚNICA (`lib/sesionDeCliente`) manda cuando trae un teléfono probado; la de pedidos de hoy (`avq_order_session`) sólo
// queda para quien entró antes y no tiene la nueva.
import { borrarSesion, identidadDe, leerSesion, salioEnOtraPagina } from '../lib/sesionDeCliente'

/** `identidad`: qué sesión es (la única: `identidadDe`; la de hoy: su token). La tienda abierta sólo sigue con la misma (alcance A). */
export interface OrderingSession { token: string; phone: string; name: string | null; savedAt: number; identidad?: string }
export interface LastOrder { trackingToken: string; orderNumber: string; /** Para el folio de «Nadie»: el nombre con que se pidió (el seguimiento no lo trae). */ name?: string }

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
  const nueva = leerSesion(slug)
  if (nueva) {
    // «Mi equipo» pide un teléfono probado: una sesión que sólo probó un correo (Google, código por correo) no sirve aquí y se pide
    // el código. Con una sesión única guardada, el token de hoy (quizá de otra ficha) nunca se usa (codex-r2 #3).
    const telefono = nueva.contactos.find(c => c.tipo === 'PHONE')?.valor
    return telefono
      ? { token: nueva.token, phone: telefono, name: nueva.customer.firstName, savedAt: nueva.guardadaEn, identidad: identidadDe(nueva) }
      : null
  }
  // Salió en reservas (la otra página): su token de hoy de aquí tampoco vale (codex-r1 #1).
  if (salioEnOtraPagina(slug)) {
    remove(sKey(slug))
    return null
  }
  const s = read(sKey(slug))
  if (!s || typeof s.token !== 'string' || typeof s.phone !== 'string' || !Number.isFinite(s.savedAt)) return null
  if (Date.now() - s.savedAt >= TTL_MS) {
    remove(sKey(slug))
    return null
  }
  return { token: s.token, phone: s.phone, name: typeof s.name === 'string' ? s.name : null, savedAt: s.savedAt, identidad: `hoy|${s.token}` }
}
export const saveSession = (slug: string, s: OrderingSession): void => write(sKey(slug), s)
/** Tras un 401: se olvida el token que lo recibió. Si era el de la sesión única, se va entera (también para reservas: ya no vale). */
export function clearSession(slug: string, token?: string): void {
  if (token && leerSesion(slug)?.token === token) borrarSesion(slug)
  remove(sKey(slug))
}

/** Mismo teléfono = mismos últimos 10 dígitos (con o sin lada de país). */
const last10 = (p: string) => p.replace(/\D/g, '').slice(-10)
export const samePhone = (a: string, b: string): boolean => last10(a).length === 10 && last10(a) === last10(b)

export const saveLastOrder = (slug: string, o: LastOrder): void => write(lKey(slug), o)
export function loadLastOrder(slug: string): LastOrder | null {
  const o = read(lKey(slug))
  return o && typeof o.trackingToken === 'string' && typeof o.orderNumber === 'string'
    ? { trackingToken: o.trackingToken, orderNumber: o.orderNumber, ...(typeof o.name === 'string' && o.name ? { name: o.name } : {}) }
    : null
}
export const clearLastOrder = (slug: string): void => remove(lKey(slug))

// Fase 2: «cancelar el pago» pendiente (de regreso de Stripe con `?pago=cancelado`, o con el botón del seguimiento). En
// sessionStorage y por pedido: sobrevive a recargar la pestaña y se borra sólo cuando el servidor contesta el abandono.
const aKey = (trackingToken: string) => `avq_order_abandon:${trackingToken}`
export function markAbandon(trackingToken: string): void {
  try {
    sessionStorage.setItem(aKey(trackingToken), '1')
  } catch {
    /* sin almacenamiento: recargar ya no reintenta, pero el abandono de esta vista sigue */
  }
}
export function abandonPending(trackingToken: string): boolean {
  try {
    return sessionStorage.getItem(aKey(trackingToken)) === '1'
  } catch {
    return false
  }
}
export function clearAbandon(trackingToken: string): void {
  try {
    sessionStorage.removeItem(aKey(trackingToken))
  } catch {
    /* sin almacenamiento */
  }
}
