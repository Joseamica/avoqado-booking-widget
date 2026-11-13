// W4 (P2-6, codex-w4-r2 #1 y r3 #1–#2): «Mi cuenta» es UNA por negocio y superficie (reservas o la tienda), con lo leído y el estado de
// la lectura juntos en una señal. Todos sus lectores (las dos tiendas o los dos portales de una página, «Usar en caja», «Ver más»,
// «Tu pedido de hoy») se pintan de ahí: nadie se queda con lo viejo ni girando. Sólo escribe la ÚLTIMA lectura que salió, la pida
// quien la pida, y de la misma sesión (época); otra sesión en la superficie la vacía.
import { signal, type Signal } from '@preact/signals'
import type { CustomerPortalData } from '../types'
import { alCambiarLaPagina, epocaDe, soltarLaPagina, type Superficie } from '../lib/sesionDeCliente'
import { activeVenueSlug, bookingAccess, lectorDe, portalData } from './booking'
import * as api from '../api/booking'

export interface Cuenta {
  data: CustomerPortalData | null
  /** Una lectura va en camino (con datos: «Actualizando…»; sin ellos: cargando). */
  leyendo: boolean
  /** La última lectura falló (sin datos: el aviso y «Reintentar»; con ellos: «te enseñamos lo último que supimos»). */
  falla: 'sinRed' | 'generico' | null
}
const VACIA: Cuenta = { data: null, leyendo: false, falla: null }

const llave = (slug: string, s: Superficie) => `${slug}|${s}`
const cuentas = new Map<string, Signal<Cuenta>>()
const turnos = new Map<string, number>()

export function cuentaDe(slug: string, s: Superficie): Signal<Cuenta> {
  let c = cuentas.get(llave(slug, s))
  if (!c) cuentas.set(llave(slug, s), (c = signal(VACIA)))
  return c
}
const turnoNuevo = (k: string) => {
  const n = (turnos.get(k) ?? 0) + 1
  turnos.set(k, n)
  return n
}

// Otra sesión en la superficie (entró otra, salió, un 401): lo de la anterior se va, y su lectura en vuelo ya no pinta.
alCambiarLaPagina((slug, afecta, misma) => {
  if (misma) return
  for (const s of afecta) {
    turnoNuevo(llave(slug, s))
    cuentaDe(slug, s).value = VACIA
  }
})

/**
 * Lee «Mi cuenta» con el token de la superficie y la deja en su señal si sigue siendo la última lectura y la misma sesión. En reservas
 * también al día `portalData` y `bookingAccess` (el flujo de reservas los usa). Devuelve lo que pintó, o `null`.
 */
export async function leerCuenta(slug: string, s: Superficie, token: string): Promise<CustomerPortalData | null> {
  const k = llave(slug, s)
  const n = turnoNuevo(k)
  const epoca = epocaDe(slug, s)
  const vigente = () => turnos.get(k) === n && epocaDe(slug, s) === epoca
  const c = cuentaDe(slug, s)
  c.value = { ...c.value, leyendo: true, falla: null }
  try {
    const leida = await api.getCustomerPortal(slug, token, s)
    if (!vigente()) return null
    const data = { ...leida } // siempre otro objeto: las páginas de «Ver más» se pegan a ESTA lectura
    c.value = { data, leyendo: false, falla: null }
    if (s === 'reservas' && activeVenueSlug.value === slug) {
      portalData.value = data
      // Fase 0.B: the portal carries "¿puedo reservar aquí?" — keep it fresh.
      if (data.bookingAccess) bookingAccess.value = data.bookingAccess
    }
    return data
  } catch (err: any) {
    // W1: sólo un 401 cierra la sesión que lo recibió (el oyente de arriba vacía la cuenta); sin red no se saca a nadie.
    if (err?.status === 401) soltarLaPagina(slug, s, err?.enviado ?? token, lectorDe(slug, s))
    else if (vigente() && err?.data?.code !== 'CUSTOMER_SESSION_CHANGED') c.value = { ...c.value, leyendo: false, falla: err?.status ? 'generico' : 'sinRed' }
    return null
  }
}

/** Sólo para pruebas: un documento nuevo. */
export function cuentasNuevasParaPruebas(): void {
  cuentas.clear()
  turnos.clear()
}
