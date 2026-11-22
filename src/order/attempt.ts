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
 * D661 ronda 2 #1 (Ruling 54, enmendada en la ronda 3): las compras con tarjeta en curso de un negocio se comparten entre las pestañas
 * del navegador (localStorage). Otra pestaña reusa la llave de una SÓLO si manda exactamente el mismo cuerpo (carrito, medio, nombre,
 * teléfono, correo, nota y premios) con la misma sesión (o ninguna en las dos): la pestaña duplicada recibe el mismo borrador y la misma
 * página de pago, nunca un segundo cobro; otra clienta en el mismo navegador, o un dato corregido, es otra compra. La sesión se compara por
 * su identidad (`identidadDe`: ficha, versión y contactos probados), no por su token, que el SERVIDOR renueva (ronda 4, Minor C).
 * Pasada por familias (Ruling 82): UN registro por compra, así empezar otra compra Y no borra el de X (su copia exacta sigue recibiendo la
 * llave de X). Cada uno vive mientras su compra se puede pagar: se suelta con una respuesta que no deja su página de pago abierta, cuando
 * el seguimiento ve el pago resuelto, al «Cerrar sesión» (`soltarLaPagina`, todos), o a los 35 min de la última vez que su página siguió
 * abierta (lo que el SERVIDOR la deja: 30 + 5); vencido, se borra al leerlo. Sin localStorage, cada pestaña la suya, como antes.
 */
interface CompraConTarjeta { attempt: PendingAttempt; huella: string; hasta: number; trackingToken?: string }
const compraKey = llaveCompraConTarjeta
const COMPRA_MS = 35 * 60_000
// ponytail: tope fijo de 5 compras vivas por negocio y navegador, ordenadas por su última actividad; con más en 35 min, la más vieja deja
// de compartirse (su copia exacta haría otro borrador). Subirlo si alguien de verdad lleva más compras distintas a la vez.
const COMPRAS_MAX = 5
const huellaDe = (body: CreateOrderBody, identidad: string | null) => JSON.stringify([identidad, body])

function comprasEnCurso(slug: string): CompraConTarjeta[] {
  try {
    const crudo = JSON.parse(localStorage.getItem(compraKey(slug)) ?? '[]')
    const todas: any[] = Array.isArray(crudo) ? crudo : []
    const vivas = todas.filter(c => typeof c?.huella === 'string' && typeof c.hasta === 'number' && Date.now() < c.hasta
      && typeof c.attempt?.key === 'string' && KEY_RE.test(c.attempt.key) && c.attempt.body) as CompraConTarjeta[]
    // Vencidas (o dañadas): sus datos y su sesión no se quedan en el navegador (ronda 3, Minor 2).
    if (vivas.length !== todas.length || !Array.isArray(crudo)) guardarCompras(slug, vivas)
    return vivas
  } catch {
    return []
  }
}
/** De la actividad más vieja a la más nueva: al pasar del tope sale la primera. */
function guardarCompras(slug: string, compras: CompraConTarjeta[]): void {
  try {
    if (compras.length) localStorage.setItem(compraKey(slug), JSON.stringify(compras.slice(-COMPRAS_MAX)))
    else localStorage.removeItem(compraKey(slug))
  } catch {
    /* sin almacenamiento compartido: cada pestaña la suya, como antes */
  }
}
/** El seguimiento de `trackingToken` vio su pago resuelto (pagado o no completado): otra compra igual ya es nueva; las demás siguen. */
export function soltarCompraConTarjeta(slug: string, trackingToken: string): void {
  const compras = comprasEnCurso(slug)
  const quedan = compras.filter(c => c.trackingToken !== trackingToken)
  if (quedan.length !== compras.length) guardarCompras(slug, quedan)
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
  const compras = conTarjeta ? comprasEnCurso(slug) : []
  const huella = huellaDe(body, identidad)
  const misma = compras.find(c => c.huella === huella)?.attempt ?? null
  try {
    // Dentro del try: sin `crypto` tampoco hay llave, y sin llave no se envía.
    const attempt: PendingAttempt = misma ?? { key: newAttemptKey(), body, startedAt: Date.now(), token }
    sessionStorage.setItem(storageKey(slug), JSON.stringify(attempt))
    if (conTarjeta && !misma) guardarCompras(slug, [...compras, { attempt, huella, hasta: Date.now() + COMPRA_MS }])
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
 * Al entrar otra vez: si el intento pendiente esperaba una sesión (su token recibió 401), sale con ésta (misma llave y cuerpo).
 * `alEntrarConCuenta` (ronda 5, Ruling 77): si entró OTRA clienta (la ficha de los dos tokens), el intento de la anterior se suelta sin
 * entregárselo: su cuerpo y su llave (y lo que un envío anterior haya creado con ellos) son de la anterior. Con el código de WhatsApp no:
 * prueba el teléfono del propio intento, y soltarlo haría otra llave (un segundo pedido si el primero se creó). Sin poder leer alguna de las
 * dos fichas, como antes.
 */
export function reautorizarIntento(slug: string, token: string, alEntrarConCuenta = false): void {
  const a = pendingAttempt(slug)
  if (!a?.requiereEntrar) return
  const suya = a.token ? clienteDelToken(a.token) : null
  const entra = clienteDelToken(token)
  if (!alEntrarConCuenta || !suya || !entra || suya === entra)
    return autorizarIntento(slug, { token, requiereEntrar: false, porSesion: true })
  try {
    sessionStorage.removeItem(storageKey(slug))
  } catch {
    /* sin almacenamiento no hubo intento */
  }
}

/**
 * El intento de la pestaña se va SIN resolverse: «Empezar de nuevo» a propósito (pasada por familias, Ruling 83). Su compra con tarjeta
 * compartida se queda: su copia exacta sigue siendo la misma compra (misma llave).
 */
export function soltarIntento(slug: string): void {
  try {
    sessionStorage.removeItem(storageKey(slug))
  } catch {
    /* sin almacenamiento no hubo intento guardado */
  }
}

/**
 * Sólo ante una respuesta DEFINITIVA del servidor (creado, precio cambiado, carrito inválido, tienda no disponible…). Si era una compra
 * con tarjeta compartida, también suelta ESA (las demás siguen), salvo `abierta`: su borrador espera el pago con su página (sigue
 * compartida, con su seguimiento, hasta resolverse).
 */
export function settleAttempt(slug: string, abierta?: { trackingToken: string }): void {
  const key = pendingAttempt(slug)?.key
  soltarIntento(slug)
  const compras = key ? comprasEnCurso(slug) : []
  const suya = compras.find(c => c.attempt.key === key)
  if (!suya) return
  const otras = compras.filter(c => c !== suya)
  // Su página sigue abierta (un reintento puede renovarla en el SERVIDOR): los 35 min vuelven a contar (ronda 3, Minor 3) y pasa al final.
  guardarCompras(slug, abierta ? [...otras, { ...suya, trackingToken: abierta.trackingToken, hasta: Date.now() + COMPRA_MS }] : otras)
}
