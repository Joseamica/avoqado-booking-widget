/**
 * Task 13 (founder, 27-nov; ajustado por Codex r5 y r6): tras un error de red o un 5xx al tocar «Confirmar reserva», la reserva y
 * el canje pudieron ocurrir aunque la respuesta se perdió. Antes de dejar «Intentar de nuevo» (que gastaría otra sesión), se revisan
 * dos veces las reservas de la clienta en ESA clase. Puro: quien llama da la lectura, la cuenta y el reloj.
 */

/** Una reserva de clase de la clienta (la forma de `MiReservaDeClase`, Task 10: se asigna sin convertir). */
export type ReservaPropia = {
  classSessionId: string
  confirmationCode: string
  cancelSecret: string
  spotIds: string[]
  status: 'PENDING' | 'CONFIRMED' | 'CHECKED_IN'
  depositStatus: string | null
}

/**
 * Se fija al tocar «Confirmar reserva», ANTES del POST (r5 #5): de qué estudio, cuenta e instancia de `<avoqado-booking>` es, qué
 * clase y qué lugares se pidieron, y los códigos que ya tenía en esa clase según la última lectura del horario (`null` si no la hubo).
 * Sin lectura extra antes del POST: sale al tocar, como hoy (r6 #2 y #4).
 */
export type Intento = {
  slug: string
  identidad: string
  instancia: string
  classSessionId: string
  spotIds: string[]
  antes: ReadonlySet<string> | null
}

export type ResultadoDeLaRevision =
  | { estado: 'quedo'; reserva: ReservaPropia }
  | { estado: 'no-quedo' }
  | { estado: 'sin-red' }
  | { estado: 'no-disponible' }
  | { estado: 'cambio-de-cuenta' }

const statusDe = (err: unknown): number | null => {
  const s = (err as { status?: unknown } | null | undefined)?.status
  return typeof s === 'number' ? s : null
}

/**
 * ¿No se sabe si la reserva quedó? Sí si el error no trae `status` (sin red, el tope de 20 s, el `TypeError` de `fetch`, un cuerpo
 * que no llegó) o trae un 5xx. Un 4xx no: el SERVIDOR contestó (incluido el 401 local `CUSTOMER_SESSION_CLOSED`, que sale antes de
 * `fetch`) y sigue su manejo de hoy. El 400 de «monto menor al mínimo de Stripe» que el SERVIDOR lanza después de guardar es un
 * defecto suyo ya existente (deuda, r5 #1): no se revisa.
 */
export function esResultadoIncierto(err: unknown): boolean {
  const status = statusDe(err)
  return status === null || status >= 500
}

const mismosLugares = (a: readonly string[], b: readonly string[]) => {
  const x = [...a].sort()
  const y = [...b].sort()
  return x.length === y.length && x.every((v, i) => v === y[i])
}

/**
 * La reserva que apareció por ESTE intento: de esa clase (nunca de otra, r6 #1), con un código que no estaba en `antes` y, si se
 * eligieron lugares, con esos mismos lugares. `null` si no hay.
 */
export function reservaNueva(intento: Intento, despues: readonly ReservaPropia[]): ReservaPropia | null {
  return despues.find(r =>
    r.classSessionId === intento.classSessionId
    && !intento.antes?.has(r.confirmationCode)
    && (intento.spotIds.length === 0 || mismosLugares(r.spotIds, intento.spotIds)),
  ) ?? null
}

/**
 * Sesión cerrada (401, 403) o SERVIDOR viejo sin la ruta (404): no se puede revisar, y volver a probar no lo arregla (r5 #4). Lo mismo
 * cualquier otro 4xx, salvo los pasajeros: 408 (tardó), 429 (demasiadas lecturas, r6 #3) y 409 (la sesión cambió mientras leía: lo
 * decide `sigueSiendoEl`).
 */
const PASAJEROS = new Set([408, 409, 429])
const noDisponible = (status: number | null) => status !== null && status >= 400 && status < 500 && !PASAJEROS.has(status)

const dormirDeVerdad = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

/**
 * Revisa si la reserva quedó: espera cada plazo de `esperasMs` (por default 2 s y luego 5 s) y lee TODAS sus reservas de la ventana.
 * - Antes y después de cada lectura, si `sigueSiendoEl()` es falso (otra cuenta, otro estudio u otra instancia) ⇒ `cambio-de-cuenta`,
 *   sin enseñar nada.
 * - Una lectura con `reservaNueva` ⇒ `quedo`.
 * - Una lectura con 401, 403 o 404 (u otro 4xx que no sea pasajero) ⇒ `no-disponible` de inmediato. Un 408, 429, 5xx o sin red es
 *   falla pasajera: sigue la siguiente.
 * - Al final manda la ÚLTIMA lectura: bien y sin nada nuevo ⇒ `no-quedo`; fallida ⇒ `sin-red` (todavía no se sabe).
 */
export async function revisarSiQuedo(o: {
  intento: Intento
  leer: () => Promise<ReservaPropia[]>
  sigueSiendoEl: () => boolean
  esperasMs?: readonly number[]
  dormir?: (ms: number) => Promise<void>
}): Promise<ResultadoDeLaRevision> {
  const esperas = o.esperasMs ?? [2000, 5000]
  const dormir = o.dormir ?? dormirDeVerdad
  let ultimaFallo = true
  for (const ms of esperas) {
    if (!o.sigueSiendoEl()) return { estado: 'cambio-de-cuenta' }
    await dormir(ms)
    if (!o.sigueSiendoEl()) return { estado: 'cambio-de-cuenta' }
    let lista: ReservaPropia[]
    try {
      lista = await o.leer()
    } catch (err) {
      // Antes que la cuenta: con un 401 la API ya soltó la sesión, y lo que se le dice es que no se pudo revisar.
      const status = statusDe(err)
      if (noDisponible(status)) return { estado: 'no-disponible' }
      if (!o.sigueSiendoEl()) return { estado: 'cambio-de-cuenta' }
      ultimaFallo = true
      continue
    }
    if (!o.sigueSiendoEl()) return { estado: 'cambio-de-cuenta' }
    const reserva = reservaNueva(o.intento, lista)
    if (reserva) return { estado: 'quedo', reserva }
    ultimaFallo = false
  }
  return ultimaFallo ? { estado: 'sin-red' } : { estado: 'no-quedo' }
}
