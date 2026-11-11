// Un intento de pedido = una Idempotency-Key. `{key, body}` se guarda en sessionStorage ANTES del POST y sobrevive a una
// recarga; mientras no haya respuesta DEFINITIVA del servidor sólo se reintenta ese mismo cuerpo con esa llave. Si no se puede
// guardar, no se envía: una respuesta perdida + recarga jamás puede duplicar el pedido.
import type { CreateOrderBody } from './types'

/**
 * W3-r3: un reintento es REENVIAR LA MISMA PETICIÓN (la regla de Stripe y Square). Con la llave y el cuerpo se guarda, ANTES de mandar,
 * la autorización exacta con que sale: `token` (`null` = sin sesión). Todo reintento manda eso, nunca la sesión de ahora: la huella del
 * SERVIDOR (llave, cuerpo y la clienta que resuelve ESE token) es la misma por construcción. Se borra con el intento al resolverse.
 * `requiereEntrar`: ese token recibió 401 (vencido o revocado); sólo entrar otra vez lo reemplaza. Un intento de antes de este cambio
 * no trae `token` (`undefined`): sale con la sesión de ahora, como entonces.
 */
export interface PendingAttempt {
  key: string; body: CreateOrderBody; startedAt: number; token?: string | null; requiereEntrar?: boolean
}

const KEY_RE = /^[A-Za-z0-9_-]{32,64}$/
const storageKey = (slug: string) => `avq_order_attempt:${slug}`

/** 32 bytes de `crypto.getRandomValues` en base64url sin relleno (43 caracteres). Sin `randomUUID`: falta fuera de HTTPS. */
export function newAttemptKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Guarda el intento y lo devuelve; `null` si no se pudo guardar (y entonces NO se envía). Si ya hay uno sin desenlace devuelve
 * ESE (su llave y su cuerpo): nunca hay dos llaves vivas para el mismo negocio.
 */
export function beginAttempt(slug: string, body: CreateOrderBody, token: string | null = null): PendingAttempt | null {
  const pending = pendingAttempt(slug)
  if (pending) return pending
  try {
    // Dentro del try: sin `crypto` tampoco hay llave, y sin llave no se envía.
    const attempt: PendingAttempt = { key: newAttemptKey(), body, startedAt: Date.now(), token }
    sessionStorage.setItem(storageKey(slug), JSON.stringify(attempt))
    return attempt
  } catch {
    return null
  }
}

export function pendingAttempt(slug: string): PendingAttempt | null {
  try {
    const a = JSON.parse(sessionStorage.getItem(storageKey(slug)) ?? 'null')
    return a && typeof a.key === 'string' && KEY_RE.test(a.key) && a.body ? (a as PendingAttempt) : null
  } catch {
    return null
  }
}

/** Cambia la autorización del intento pendiente: `requiereEntrar` tras un 401; o, al entrar otra vez, el token nuevo. */
export function autorizarIntento(slug: string, cambio: { token?: string; requiereEntrar?: boolean }): void {
  const a = pendingAttempt(slug)
  if (!a) return
  try {
    sessionStorage.setItem(storageKey(slug), JSON.stringify({ ...a, ...cambio }))
  } catch {
    /* sin almacenamiento no hubo intento guardado */
  }
}
/** Al entrar otra vez: si el intento pendiente esperaba una sesión (su token recibió 401), sale con ésta (misma llave y cuerpo). */
export function reautorizarIntento(slug: string, token: string): void {
  if (pendingAttempt(slug)?.requiereEntrar) autorizarIntento(slug, { token, requiereEntrar: false })
}

/** Sólo ante una respuesta DEFINITIVA del servidor (creado, precio cambiado, carrito inválido, tienda no disponible…). */
export function settleAttempt(slug: string): void {
  try {
    sessionStorage.removeItem(storageKey(slug))
  } catch {
    /* sin almacenamiento no hubo intento guardado */
  }
}
