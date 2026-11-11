// Un intento de pedido = una Idempotency-Key. `{key, body}` se guarda en sessionStorage ANTES del POST y sobrevive a una
// recarga; mientras no haya respuesta DEFINITIVA del servidor sólo se reintenta ese mismo cuerpo con esa llave. Si no se puede
// guardar, no se envía: una respuesta perdida + recarga jamás puede duplicar el pedido.
import type { CreateOrderBody } from './types'

/**
 * `identidad` (codex-w3-r1 #1): con qué sesión salió la vez que quedó sin desenlace (`''` = sin sesión). El SERVIDOR mete a la clienta
 * en la huella de la llave: un intento que pudo crearse sólo se reenvía con la misma clienta (o sin sesión, si salió sin ella).
 */
export interface PendingAttempt { key: string; body: CreateOrderBody; startedAt: number; identidad?: string }

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
export function beginAttempt(slug: string, body: CreateOrderBody): PendingAttempt | null {
  const pending = pendingAttempt(slug)
  if (pending) return pending
  try {
    // Dentro del try: sin `crypto` tampoco hay llave, y sin llave no se envía.
    const attempt: PendingAttempt = { key: newAttemptKey(), body, startedAt: Date.now() }
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

/** El intento salió y no hubo desenlace: se anota con qué sesión (la primera vez; después ya no cambia). */
export function marcarIdentidad(slug: string, identidad: string): void {
  const a = pendingAttempt(slug)
  if (!a || a.identidad !== undefined) return
  try {
    sessionStorage.setItem(storageKey(slug), JSON.stringify({ ...a, identidad }))
  } catch {
    /* sin almacenamiento no hubo intento guardado */
  }
}

/** Sólo ante una respuesta DEFINITIVA del servidor (creado, precio cambiado, carrito inválido, tienda no disponible…). */
export function settleAttempt(slug: string): void {
  try {
    sessionStorage.removeItem(storageKey(slug))
  } catch {
    /* sin almacenamiento no hubo intento guardado */
  }
}
