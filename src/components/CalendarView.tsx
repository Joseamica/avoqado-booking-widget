import { h } from 'preact'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { PublicClassSessionSlot } from '../types'
import type { TFunction } from '../i18n'
import { encabezadoDeDia } from '../lib/fechas'
import { Icono } from './ui/Icono'
import {
  ESTILOS_LUGARES, Lugares, agruparPorDia, diaCorto, diaDeLaSesion, duracion, horaDeLaSesion, idiomaDe, lugaresDeLaSesion,
  minutosDeLaSesion, nombreDeCoach, nombreDeLaSesion, numeroDelDia, reservaPendiente, sePuedeTocar, sumarDias, textoDeLugares,
  textoDeReserva,
} from './ListaDelHorario'
import type { MiReserva, ReservaEnLaSesion } from './ListaDelHorario'

interface CalendarViewProps {
  /** Same slots the ClassSessionList consumes — already sorted by startsAt server-side. */
  slots: PublicClassSessionSlot[]
  /** Venue timezone — controls day-bucket assignment + HH:MM display. */
  timezone: string
  /** Forwarded to the parent when a session block is tapped. */
  onSelect: (slot: PublicClassSessionSlot) => void
  /** Reference "now" for testability. Defaults to Date.now() at render time. */
  nowMs?: number
  /** Su reserva en la sesión: la tarjeta dice «Reservada · lugar N» y, aunque la clase esté llena, se puede tocar. */
  miReserva?: MiReserva
  mostrarDuracion?: boolean
  /** Último día (YYYY-MM-DD, incluido) que YA LLEGÓ: sólo hasta aquí un día vacío puede decir «Sin clases». */
  ultimoDia?: string
  /** Último día pedido (puede no haber llegado todavía). Sin él, se toma `ultimoDia`. */
  pedidoHasta?: string
  /** Hay una lectura en camino: los días pedidos que no han llegado dicen «Cargando…». */
  cargando?: boolean
  /** Si quedan días por pedir: se piden al llegar a una semana que pasa de lo pedido. */
  onNecesitaMasDias?: () => void
  t: TFunction
}

/** Una columna de la semana mide al menos esto, con este hueco entre columnas (los mismos del CSS de abajo). */
const COLUMNA_MIN = 112
const HUECO = 8

/**
 * W3 (banco, 27-nov): cuántos días caben enteros en el ancho del contenedor (de 4 a 7). A 1440 px la semana medía 832 px en
 * 784: la séptima columna quedaba cortada y salía una barra para deslizar de lado. Sin medida (antes de pintarse), los 7 de siempre.
 */
export function diasQueCaben(ancho: number): number {
  if (!(ancho > 0)) return 7
  return Math.max(4, Math.min(7, Math.floor((ancho + HUECO) / (COLUMNA_MIN + HUECO))))
}

/**
 * Semana tipo calendario (diseño 27-nov, `portada-v3`): desde hoy, los días que caben en el contenedor (de 4 a 7), cada uno con su
 * día («HOY · JUE 26») y sus clases: hora, duración de la sesión, clase, coach y lugares. Las flechas mueven esos mismos días.
 */
export function CalendarView({
  slots, timezone, onSelect, nowMs, miReserva, mostrarDuracion = true, ultimoDia, pedidoHasta, cargando = false,
  onNecesitaMasDias, t,
}: CalendarViewProps) {
  const now = nowMs ?? Date.now()
  const idioma = idiomaDe(t)
  const hoy = diaDeLaSesion(new Date(now).toISOString(), timezone)

  // W3: el ancho del contenedor decide cuántos días se ven; se vuelve a medir si cambia (ResizeObserver, o el tamaño de la ventana).
  const caja = useRef<HTMLDivElement>(null)
  const [ancho, setAncho] = useState(0)
  useLayoutEffect(() => {
    const el = caja.current
    if (!el) return
    const medir = () => setAncho(el.clientWidth)
    medir()
    if (typeof ResizeObserver !== 'undefined') {
      const observador = new ResizeObserver(medir)
      observador.observe(el)
      return () => observador.disconnect()
    }
    window.addEventListener('resize', medir)
    return () => window.removeEventListener('resize', medir)
  }, [])
  const dias = diasQueCaben(ancho)

  // La semana empieza hoy (no el domingo pasado): no se gastan columnas en días que ya pasaron.
  const [ancla, setAncla] = useState<string>(hoy)
  const semana = useMemo(() => Array.from({ length: dias }, (_, i) => sumarDias(ancla, i)), [ancla, dias])

  const porDia = useMemo(() => agruparPorDia(slots, timezone), [slots, timezone])

  // Una semana que pasa de lo ya pedido pide los días que faltan (el horario trae 30 días y llega hasta 60).
  const pedido = pedidoHasta ?? ultimoDia
  const ultimoVisible = semana[dias - 1]
  useEffect(() => {
    if (pedido && onNecesitaMasDias && ultimoVisible > pedido) onNecesitaMasDias()
  }, [ultimoVisible, pedido])

  const puedeAtras = ancla > hoy
  const puedeAdelante = !(pedido && !onNecesitaMasDias && sumarDias(ancla, dias) > pedido)

  const mes = useMemo(() => {
    const [y, m, d] = semana[0].split('-').map(Number)
    const texto = new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString(idioma === 'en' ? 'en-US' : 'es-MX', {
      month: 'long', year: 'numeric', timeZone: 'UTC',
    })
    return texto.charAt(0).toLocaleUpperCase() + texto.slice(1)
  }, [semana, idioma])

  return (
    <div class="avq-semana avq-animate-in" ref={caja}>
      <div class="avq-semana-nav">
        <button
          type="button"
          class="avq-semana-flecha"
          aria-label={t('reservaClases.horario.semanaAnterior')}
          disabled={!puedeAtras}
          onClick={() => setAncla(a => {
            if (a <= hoy) return a
            const atras = sumarDias(a, -dias)
            return atras < hoy ? hoy : atras
          })}
        >
          <Icono nombre="anterior" size={18} />
        </button>
        <div class="avq-semana-mes">{mes}</div>
        <button
          type="button"
          class="avq-semana-flecha"
          aria-label={t('reservaClases.horario.semanaSiguiente')}
          disabled={!puedeAdelante}
          onClick={() => setAncla(a => sumarDias(a, dias))}
        >
          <Icono nombre="siguiente" size={18} />
        </button>
      </div>

      {/* Medida: las columnas reparten el ancho (ninguna pasa del contenedor); sin medida, las 7 de 112 px del CSS. */}
      <div
        class="avq-semana-dias"
        style={ancho > 0 ? { gridTemplateColumns: `repeat(${dias}, minmax(0, 1fr))`, overflowX: 'hidden' } : undefined}
      >
        {semana.map(dia => {
          const esHoy = dia === hoy
          const sesiones = porDia.get(dia) ?? []
          // «Sin clases» sólo en un día que ya llegó; uno pedido que no ha llegado dice «Cargando…»; si la lectura
          // falló, queda vacío (el aviso con «Intentar de Nuevo» va arriba, en el horario).
          const llego = !ultimoDia || dia <= ultimoDia
          const encabezado = encabezadoDeDia(dia, now, timezone, idioma, t)
          const corto = `${diaCorto(dia, idioma)} ${numeroDelDia(dia)}`
          return (
            <div key={dia} class="avq-semana-dia" role="group" aria-label={encabezado}>
              <div class={`avq-semana-cabeza${esHoy ? ' avq-semana-cabeza--hoy' : ''}`}>
                {esHoy ? `${t('reservaClases.hoy').toLocaleUpperCase()} · ${corto}` : corto}
              </div>
              {sesiones.length > 0
                ? sesiones.map(s => (
                  <TarjetaDeClase
                    key={s.classSessionId ?? s.startsAt}
                    slot={s}
                    dia={encabezado}
                    hora={horaDeLaSesion(s.startsAt, timezone, idioma)}
                    reserva={miReserva ? miReserva(s) : null}
                    mostrarDuracion={mostrarDuracion}
                    onSelect={onSelect}
                    t={t}
                  />
                ))
                : llego
                  ? <div class="avq-semana-vacio">{t('reservaClases.horario.sinClases')}</div>
                  : cargando && <div class="avq-semana-vacio avq-semana-cargando" aria-busy="true">{t('reservaClases.horario.cargando')}</div>}
            </div>
          )
        })}
      </div>
      <style>{ESTILOS}</style>
    </div>
  )
}

function TarjetaDeClase({ slot, dia, hora, reserva, mostrarDuracion, onSelect, t }: {
  slot: PublicClassSessionSlot
  dia: string
  hora: string
  reserva: ReservaEnLaSesion | null
  mostrarDuracion: boolean
  onSelect: (slot: PublicClassSessionSlot) => void
  t: TFunction
}) {
  const lugares = lugaresDeLaSesion(slot)
  const tocable = sePuedeTocar(slot, reserva)
  const dur = mostrarDuracion ? duracion(minutosDeLaSesion(slot)) : ''
  const coach = nombreDeCoach(slot, true)
  const coachLargo = nombreDeCoach(slot)
  const textoReserva = reserva ? textoDeReserva(t, reserva) : null
  return (
    <button
      type="button"
      class="avq-tarjeta"
      data-estado={reserva ? 'reservada' : lugares.estado}
      aria-label={nombreDeLaSesion([
        slot.productName, dia, hora, dur, coachLargo && t('classList.withInstructor', { name: coachLargo }),
        textoDeLugares(t, lugares), textoReserva,
      ])}
      disabled={!tocable}
      onClick={() => { if (tocable) onSelect(slot) }}
    >
      <span class="avq-tarjeta-hora">{hora}</span>
      {dur && <span class="avq-tarjeta-dur">{dur}</span>}
      <span class="avq-tarjeta-clase">{slot.productName}</span>
      {coach && <span class="avq-tarjeta-coach">{coach}</span>}
      <span class="avq-tarjeta-lugares">
        {reserva && textoReserva ? (
          <span class={`avq-tarjeta-reservada${reservaPendiente(reserva) ? ' avq-tarjeta-reservada--pendiente' : ''}`}>
            <Icono nombre={reservaPendiente(reserva) ? 'reloj' : 'check'} size={13} />
            <span>{textoReserva}</span>
          </span>
        ) : <Lugares slot={slot} t={t} conIcono />}
      </span>
    </button>
  )
}

const ESTILOS = `
  ${ESTILOS_LUGARES}
  .avq-semana-nav { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 16px; }
  .avq-semana-mes { font-size: 16px; font-weight: 700; color: var(--avq-fg, #111827); letter-spacing: -0.01em; }
  .avq-semana-flecha { width: 40px; height: 40px; border-radius: 50%; border: 1px solid var(--avq-border, #e8eaed);
    background: var(--avq-bg, #ffffff); color: var(--avq-fg, #111827); display: inline-flex; align-items: center;
    justify-content: center; cursor: pointer; }
  .avq-semana-flecha:disabled { opacity: 0.35; cursor: default; }
  .avq-semana-dias { display: grid; grid-template-columns: repeat(7, minmax(112px, 1fr)); gap: 8px; overflow-x: auto;
    -webkit-overflow-scrolling: touch; padding-bottom: 8px; }
  .avq-semana-dia { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
  .avq-semana-cabeza { font-size: 11px; font-weight: 700; letter-spacing: 0.05em; color: var(--avq-muted-fg, #78716c);
    text-align: center; padding-bottom: 6px; border-bottom: 1px solid var(--avq-border, #ece9e6); white-space: nowrap; }
  .avq-semana-cabeza--hoy { color: var(--avq-accent, #3b2a4a); }
  .avq-semana-vacio { padding: 16px 4px; text-align: center; font-size: 12px; color: var(--avq-muted-fg, #a8a29e); }
  .avq-tarjeta { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; width: 100%; padding: 8px 10px;
    text-align: left; border: 1px solid var(--avq-border, #ece9e6); border-radius: 10px; background: var(--avq-bg, #ffffff);
    color: var(--avq-fg, #111827); font: inherit; cursor: pointer; transition: border-color 0.15s ease, background 0.15s ease; }
  .avq-tarjeta:hover:not(:disabled) { border-color: var(--avq-fg, #111827); }
  .avq-tarjeta:disabled { background: var(--avq-muted, #fafaf9); color: var(--avq-muted-fg, #a8a29e); cursor: not-allowed; }
  .avq-tarjeta-hora { font-size: 13px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .avq-tarjeta-dur, .avq-tarjeta-coach { font-size: 11px; color: var(--avq-muted-fg, #78716c); }
  .avq-tarjeta-clase { margin-top: 3px; font-size: 13px; font-weight: 600; line-height: 1.3; overflow: hidden;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  .avq-tarjeta-lugares { margin-top: 5px; font-size: 11px; }
  .avq-tarjeta-reservada { display: inline-flex; align-items: center; gap: 4px; font-weight: 600; color: var(--avq-success-fg, #15803d); }
  .avq-tarjeta-reservada--pendiente { color: var(--avq-warning-fg, #b45309); }
`
