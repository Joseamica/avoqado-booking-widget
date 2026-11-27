import { h } from 'preact'
import type { TFunction } from '../i18n'
import type { OpcionDePaquete } from '../lib/eleccionDePaquete'
import { unidad } from '../lib/palabras'

/** «11 dic» («Dec 11») en la zona del negocio; `null` si la fecha o la zona no se leen. */
export function fechaCorta(t: TFunction, iso: string, timeZone: string): string | null {
  try {
    const d = new Date(iso)
    if (!Number.isFinite(d.getTime())) return null
    return new Intl.DateTimeFormat(t('cuenta.intl'), { day: 'numeric', month: 'short', timeZone }).format(d).replace(/\.$/, '')
  } catch {
    return null
  }
}

const mayuscula = (s: string) => s.charAt(0).toLocaleUpperCase() + s.slice(1)

/**
 * Las tres partes de la franja: «Hola, Ana» · «tienes 4 sesiones de Lagree» · «vencen el 11 dic». Las sesiones son la suma de sus
 * paquetes que pagan la clase; un Ilimitado dice «Ilimitado», nunca su número interno. Si sus paquetes vencen en fechas distintas,
 * «las primeras vencen el …». `null` sin paquete.
 */
export function partesDeLaFranja(
  t: TFunction,
  a: { nombre: string | null; opciones: OpcionDePaquete[]; nombreClase: string; timeZone: string },
): { hola: string | null; tienes: string; vence: string | null } | null {
  if (a.opciones.length === 0) return null
  const hola = a.nombre?.trim() ? t('reservaClases.franja.hola', { nombre: a.nombre.trim() }) : null
  const fecha = (o: OpcionDePaquete) => (o.vence ? fechaCorta(t, o.vence, a.timeZone) : null)
  const ilimitado = a.opciones.find(o => o.ilimitado)
  if (ilimitado) {
    const f = fecha(ilimitado)
    return {
      hola,
      tienes: ilimitado.soloEstaClase
        ? t('reservaClases.franja.tienesIlimitadoDe', { clase: a.nombreClase })
        : t('reservaClases.franja.tienesIlimitado'),
      vence: f ? t('reservaClases.franja.vence', { fecha: f }) : null,
    }
  }
  const n = a.opciones.reduce((suma, o) => suma + o.restante, 0)
  const tienes = t('reservaClases.franja.tienes', {
    n,
    unidad: unidad(t, { cantidad: n, nombreClase: a.nombreClase, soloEstaClase: a.opciones.every(o => o.soloEstaClase) }),
  })
  // Las opciones llegan ordenadas: la primera es la que vence primero (sin vencimiento al final).
  const primera = fecha(a.opciones[0])
  if (!primera) return { hola, tienes, vence: null }
  const mismas = a.opciones.every(o => fecha(o) === primera)
  const vence = !mismas
    ? t('reservaClases.franja.primerasVencen', { fecha: primera })
    : t(n === 1 ? 'reservaClases.franja.vence' : 'reservaClases.franja.vencen', { fecha: primera })
  return { hola, tienes, vence }
}

/** La tarjeta del costado: «Tu paquete: 4 de 5 · vence el 11 dic» (o «Tu paquete: Ilimitado · …»). */
export function textoDeTuPaquete(t: TFunction, o: OpcionDePaquete, timeZone: string): string {
  const base = o.ilimitado
    ? t('reservaClases.tuPaquete.ilimitado')
    : t('reservaClases.tuPaquete.sesiones', { restante: o.restante, total: o.original })
  const f = o.vence ? fechaCorta(t, o.vence, timeZone) : null
  return f ? `${base} · ${t('reservaClases.tuPaquete.vence', { fecha: f })}` : base
}

/**
 * Arriba del horario, con sesión y un paquete que paga sus clases (diseño 27-nov, `recorrido`): «Hola, Ana · tienes 5 sesiones de
 * Lagree · vencen el 11 dic». Sin paquete no se pinta.
 */
export function TuPaqueteFranja({
  nombre,
  opciones,
  nombreClase,
  timeZone,
  t,
}: {
  nombre: string | null
  opciones: OpcionDePaquete[]
  nombreClase: string
  timeZone: string
  t: TFunction
}) {
  const p = partesDeLaFranja(t, { nombre, opciones, nombreClase, timeZone })
  if (!p) return null
  return (
    <div class="avq-franja-caja">
      <p class="avq-franja">
        {p.hola && <span>{p.hola}{' · '}</span>}
        <strong>{p.hola ? p.tienes : mayuscula(p.tienes)}</strong>
        {p.vence && <span>{' · '}{p.vence}</span>}
      </p>
      <style>{ESTILOS}</style>
    </div>
  )
}

const ESTILOS = `
  .avq-franja { margin: 0 0 16px; padding: 12px 14px; border-radius: 12px; font-size: 14px; line-height: 1.45;
    color: var(--avq-fg, #111827); background: var(--avq-muted, #f6f3f8);
    background: color-mix(in srgb, var(--avq-accent, #3b2a4a) 7%, var(--avq-bg, #ffffff)); }
  .avq-franja strong { color: var(--avq-accent, #3b2a4a); font-weight: 700; }
  /* Celular (≤ 640 px): letra para leer de 16 px y bloques separados 24 px. */
  @media (max-width: 640px) {
    .avq-franja { margin-bottom: 24px; padding: 14px 16px; font-size: 16px; }
  }
`
