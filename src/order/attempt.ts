// Un intento de pedido = una Idempotency-Key. `{key, body}` se guarda en sessionStorage ANTES del POST y sobrevive a una
// recarga; mientras no haya respuesta DEFINITIVA del servidor sólo se reintenta ese mismo cuerpo con esa llave. Si no se puede
// guardar, no se envía: una respuesta perdida + recarga jamás puede duplicar el pedido.
import type { CreateOrderBody } from './types'
import { clienteDelToken, llaveCompraConTarjeta, llaveIntentoDePedido } from '../lib/sesionDeCliente'

/**
 * W3-r3: un reintento es REENVIAR LA MISMA PETICIÓN (la regla de Stripe y Square). Con la llave y el cuerpo se guarda, ANTES de mandar,
 * la autorización exacta con que sale: `token` (`null` = sin sesión). Todo reintento manda eso, nunca la sesión de ahora: la huella del
 * SERVIDOR (llave, cuerpo y la clienta que resuelve ESE token) es la misma por construcción. Se borra con el intento al resolverse.
 * `requiereEntrar`: ese token recibió 401 (vencido o revocado); sólo entrar otra vez lo reemplaza. Un intento de antes de este cambio
 * no trae `token` (`undefined`): sale con la sesión de ahora, como entonces.
 * `porSesion` (pulido W5): sólo para el aviso; quedó pendiente porque se cerró la sesión y ya entró otra vez. No cambia lo que se manda.
 */
export interface PendingAttempt {
  key: string; body: CreateOrderBody; startedAt: number; token?: string | null; requiereEntrar?: boolean; porSesion?: boolean
}

const KEY_RE = /^[A-Za-z0-9_-]{32,64}$/
const storageKey = llaveIntentoDePedido // «Cerrar sesión» lo borra (`soltarLaPagina`, ronda 4)

/**
 * D661 ronda 2 #1 (Ruling 54, enmendada en la ronda 3): la compra con tarjeta en curso de un negocio se comparte entre las pestañas del
 * navegador (localStorage). Otra pestaña la reusa (su llave) SÓLO si manda exactamente el mismo cuerpo (carrito, medio, nombre, teléfono,
 * correo, nota y premios) con la misma sesión (o ninguna en las dos): la pestaña duplicada recibe el mismo borrador y la misma página de
 * pago, nunca un segundo cobro; otra clienta en el mismo navegador, o un dato corregido, es otra compra. La sesión se compara por su
 * identidad (`identidadDe`: ficha, versión y contactos probados), no por su token, que el SERVIDOR renueva (ronda 4, Minor C). Vive
 * mientras la compra se puede pagar: se suelta con una respuesta que no deja su página de pago abierta, cuando el seguimiento ve el pago
 * resuelto, al «Cerrar sesión» (`soltarLaPagina`), o a los 35 min de la última vez que su página siguió abierta (lo que el SERVIDOR la
 * deja: 30 + 5); vencida, se borra al leerla. Sin localStorage, cada pestaña la suya, como antes.
 */
interface CompraConTarjeta { attempt: PendingAttempt; huella: string; hasta: number; trackingToken?: string }
const compraKey = llaveCompraConTarjeta
const COMPRA_MS = 35 * 60_000
const huellaDe = (body: CreateOrderBody, identidad: string | null) => JSON.stringify([identidad, body])

function compraEnCurso(slug: string): CompraConTarjeta | null {
  try {
    const c = JSON.parse(localStorage.getItem(compraKey(slug)) ?? 'null')
    if (!c) return null
    // Vencida: sus datos y su sesión no se quedan en el navegador (ronda 3, Minor 2).
    if (typeof c.hasta === 'number' && Date.now() >= c.hasta) {
      guardarCompra(slug, null)
      return null
    }
    return typeof c.huella === 'string' && typeof c.hasta === 'number'
      && typeof c.attempt?.key === 'string' && KEY_RE.test(c.attempt.key) && c.attempt.body ? (c as CompraConTarjeta) : null
  } catch {
    return null
  }
}
function guardarCompra(slug: string, c: CompraConTarjeta | null): void {
  try {
    if (c) localStorage.setItem(compraKey(slug), JSON.stringify(c))
    else localStorage.removeItem(compraKey(slug))
  } catch {
    /* sin almacenamiento compartido: cada pestaña la suya, como antes */
  }
}
/** El seguimiento de `trackingToken` vio su pago resuelto (pagado o no completado): otra compra igual ya es nueva. */
export function soltarCompraConTarjeta(slug: string, trackingToken: string): void {
  if (compraEnCurso(slug)?.trackingToken === trackingToken) guardarCompra(slug, null)
}

/** 32 bytes de `crypto.getRandomValues` en base64url sin relleno (43 caracteres). Sin `randomUUID`: falta fuera de HTTPS. */
export function newAttemptKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Guarda el intento y lo devuelve; `null` si no se pudo guardar (y entonces NO se envía). Si ya hay uno sin desenlace devuelve
 * ESE (su llave y su cuerpo): nunca hay dos llaves vivas para el mismo negocio. Con tarjeta, la misma compra de otra pestaña (ronda 2 #1).
 * `identidad`: la de la sesión con que sale (sin ella, su token).
 */
export function beginAttempt(
  slug: string, body: CreateOrderBody, token: string | null = null, identidad: string | null = token,
): PendingAttempt | null {
  const pending = pendingAttempt(slug)
  if (pending) return pending
  const conTarjeta = body.paymentMode === 'CARD_ONLINE'
  const compra = conTarjeta ? compraEnCurso(slug) : null
  const huella = huellaDe(body, identidad)
  const misma = compra && compra.huella === huella ? compra.attempt : null
  try {
    // Dentro del try: sin `crypto` tampoco hay llave, y sin llave no se envía.
    const attempt: PendingAttempt = misma ?? { key: newAttemptKey(), body, startedAt: Date.now(), token }
    sessionStorage.setItem(storageKey(slug), JSON.stringify(attempt))
    if (conTarjeta && !misma) guardarCompra(slug, { attempt, huella, hasta: Date.now() + COMPRA_MS })
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
export function autorizarIntento(slug: string, cambio: { token?: string; requiereEntrar?: boolean; porSesion?: boolean }): void {
  const a = pendingAttempt(slug)
  if (!a) return
  try {
    sessionStorage.setItem(storageKey(slug), JSON.stringify({ ...a, ...cambio }))
  } catch {
    /* sin almacenamiento no hubo intento guardado */
  }
}
/**
 * Al entrar otra vez: si el intento pendiente esperaba una sesión (su token recibió 401), sale con ésta (misma llave y cuerpo), pero sólo
 * si es SU clienta (la ficha de los dos tokens). Ronda 5: si entró OTRA en la pestaña, el intento de la anterior se suelta sin entregárselo:
 * su cuerpo y su llave (y lo que un envío anterior haya creado con ellos) son de la anterior. Sin poder leer alguna de las dos fichas, como
 * antes.
 */
export function reautorizarIntento(slug: string, token: string): void {
  const a = pendingAttempt(slug)
  if (!a?.requiereEntrar) return
  const suya = a.token ? clienteDelToken(a.token) : null
  const entra = clienteDelToken(token)
  if (!suya || !entra || suya === entra) return autorizarIntento(slug, { token, requiereEntrar: false, porSesion: true })
  try {
    sessionStorage.removeItem(storageKey(slug))
  } catch {
    /* sin almacenamiento no hubo intento */
  }
}

/**
 * Sólo ante una respuesta DEFINITIVA del servidor (creado, precio cambiado, carrito inválido, tienda no disponible…). Si era la compra
 * con tarjeta compartida, también la suelta, salvo `abierta`: su borrador espera el pago con su página (sigue compartida, con su
 * seguimiento, hasta resolverse).
 */
export function settleAttempt(slug: string, abierta?: { trackingToken: string }): void {
  const key = pendingAttempt(slug)?.key
  try {
    sessionStorage.removeItem(storageKey(slug))
  } catch {
    /* sin almacenamiento no hubo intento guardado */
  }
  const compra = key ? compraEnCurso(slug) : null
  // Su página sigue abierta (un reintento puede renovarla en el SERVIDOR): los 35 min vuelven a contar (ronda 3, Minor 3).
  if (compra && compra.attempt.key === key)
    guardarCompra(slug, abierta ? { ...compra, trackingToken: abierta.trackingToken, hasta: Date.now() + COMPRA_MS } : null)
}
