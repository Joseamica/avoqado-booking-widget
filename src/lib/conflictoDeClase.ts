/**
 * Qué hacer cuando el SERVIDOR rechaza con 409 la reserva de una clase entre elegir y confirmar (alguien tomó su lugar o la
 * clase se llenó). Puro: la relectura de la clase la hace quien llama, con la MISMA ventana del horario ya cargado.
 *
 * - `CLASS_FULL` trae `details.available`; `SPOTS_TAKEN` trae `details.takenSpotIds`. Un SERVIDOR viejo manda el 409 sin
 *   código: se decide igual, con la relectura.
 * - La relectura es lo más nuevo y manda; si falló (sin red), sólo cuenta lo que dijo el 409.
 * - «Quita lugares» sólo existe con mapa: sin mapa la reserva es de un lugar y queda el aviso genérico de hoy.
 */
import type { PublicClassSessionSlot } from '../types'

export type ConflictoDeClase =
  /** Al horario (que se vuelve a pedir al regresar), con su aviso. */
  | { a: 'horario'; aviso: 'seLleno' | 'noDisponible' }
  /**
   * De vuelta al mapa de ESA clase con lo que se sabe ahora (`slot`: lugares ocupados y los que quedan) y su selección SIN los
   * lugares que ya se ocuparon (nunca vuelven a viajar en el siguiente pedido).
   */
  | { a: 'mapa'; aviso: 'lugarTomado' | 'soloQueda'; slot: PublicClassSessionSlot; lugares: string[] }
  /** Nada lo explica: el aviso genérico de hoy y al horario. */
  | { a: 'generico' }

export function decidirConflicto(o: {
  /** `err.data.code` del 409 (`undefined` en un SERVIDOR viejo). */
  code?: unknown
  /** `err.data.details` del 409. */
  details?: unknown
  /** La clase como estaba cuando se mandó la reserva. */
  actual: PublicClassSessionSlot
  /** La misma clase en la relectura; `null` si ya no aparece; `undefined` si la relectura falló. */
  fresca: PublicClassSessionSlot | null | undefined
  /** Los lugares que se mandaron. */
  elegidos: readonly string[]
  /** La clase tiene mapa y se eligieron lugares en él. */
  conMapa: boolean
}): ConflictoDeClase {
  if (o.fresca === null) return { a: 'horario', aviso: 'noDisponible' }
  const details = (o.details && typeof o.details === 'object' ? o.details : {}) as { available?: unknown; takenSpotIds?: unknown }
  const tomadosSegunElSERVIDOR =
    o.code === 'SPOTS_TAKEN' && Array.isArray(details.takenSpotIds)
      ? details.takenSpotIds.filter((id): id is string => typeof id === 'string')
      : []
  const base = o.fresca ?? o.actual
  const ocupados = Array.from(new Set([...(base.takenSpotIds ?? []), ...tomadosSegunElSERVIDOR]))
  // Cuántos lugares quedan: lo que dice la relectura; sin ella, lo que dijo el 409 (lo que se tenía antes ya es viejo).
  const libres: number | null = o.fresca
    ? typeof o.fresca.remaining === 'number' ? Math.max(0, o.fresca.remaining) : null
    : o.code === 'CLASS_FULL' && typeof details.available === 'number' ? Math.max(0, details.available) : null
  const llena = libres === 0 || (libres === null && o.fresca?.available === false)
  if (llena) return { a: 'horario', aviso: 'seLleno' }
  if (!o.conMapa) return { a: 'generico' }

  const tomado = new Set(ocupados)
  const lugares = o.elegidos.filter(id => !tomado.has(id))
  const slot: PublicClassSessionSlot = { ...base, takenSpotIds: ocupados, ...(libres !== null ? { remaining: libres } : {}) }
  if (lugares.length < o.elegidos.length) return { a: 'mapa', aviso: 'lugarTomado', slot, lugares }
  if (libres !== null && o.elegidos.length > libres) return { a: 'mapa', aviso: 'soloQueda', slot, lugares }
  return { a: 'generico' }
}
