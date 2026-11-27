import { h } from 'preact'
import { useMemo, useState } from 'preact/hooks'
import type { PublicClassSessionSlot } from '../types'
import type { TFunction } from '../i18n'
import { encabezadoDeDia } from '../lib/fechas'
import { Icono } from './ui/Icono'

/**
 * Piezas del horario de clases (diseño 27-nov, `portada-v3`): la lista con tira de días y lo que comparte con la semana
 * (`CalendarView`): hora, duración de la sesión, coach, lugares y la marca de «Reservada».
 */

/** ¿Un paquete de la clienta cubre esta sesión? Por default, no. */
export type CubreSesion = (slot: PublicClassSessionSlot) => boolean
/** La reserva de la clienta en esta sesión, si la tiene. Por default, ninguna. */
export type MiReserva = (slot: PublicClassSessionSlot) => { lugar: string | null } | null

export type Idioma = 'es' | 'en'
export const idiomaDe = (t: TFunction): Idioma => (t('cuenta.intl').startsWith('en') ? 'en' : 'es')

/** «YYYY-MM-DD» del inicio de la sesión en la zona del negocio. */
export function diaDeLaSesion(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone })
}

/**
 * Sesiones por día del negocio, en el orden en que llegan. Una sesión sin fecha válida se salta: no debe tumbar el horario
 * entero (los formateadores de fecha lanzan `RangeError` con una fecha inválida).
 */
export function agruparPorDia(slots: PublicClassSessionSlot[], timeZone: string): Map<string, PublicClassSessionSlot[]> {
  const m = new Map<string, PublicClassSessionSlot[]>()
  for (const s of slots) {
    if (!Number.isFinite(new Date(s.startsAt).getTime())) continue
    const k = diaDeLaSesion(s.startsAt, timeZone)
    const lista = m.get(k)
    if (lista) lista.push(s)
    else m.set(k, [s])
  }
  return m
}

/** Suma días a un «YYYY-MM-DD». Es un día de calendario: no depende de la zona. */
export function sumarDias(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n, 12)).toISOString().slice(0, 10)
}

export function horaDeLaSesion(iso: string, timeZone: string, idioma: Idioma): string {
  return new Date(iso).toLocaleTimeString(idioma === 'en' ? 'en-US' : 'es-MX', {
    hour: 'numeric', minute: '2-digit', hour12: idioma === 'en', timeZone,
  })
}

/** Minutos reales de la sesión (fin − inicio), no la duración del producto. */
export function minutosDeLaSesion(slot: PublicClassSessionSlot): number {
  return Math.round((new Date(slot.endsAt).getTime() - new Date(slot.startsAt).getTime()) / 60000)
}

/** «50 min», «1 h», «1 h 45 min»; vacío si no hay duración. */
export function duracion(min: number): string {
  if (!(min > 0)) return ''
  const horas = Math.floor(min / 60)
  const resto = min % 60
  if (horas === 0) return `${resto} min`
  return resto === 0 ? `${horas} h` : `${horas} h ${resto} min`
}

const DIAS: Record<Idioma, string[]> = {
  es: ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'],
  en: ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'],
}
const fechaUtc = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12))
}
/** «SÁB», «VIE»… del día de calendario. */
export const diaCorto = (ymd: string, idioma: Idioma) => DIAS[idioma][fechaUtc(ymd).getUTCDay()]
/** «28» */
export const numeroDelDia = (ymd: string) => String(fechaUtc(ymd).getUTCDate())

/** «Fer Ruiz», o «Fer R.» en lo angosto (las tarjetas de la semana). */
export function nombreDeCoach(slot: PublicClassSessionSlot, corto = false): string | null {
  const c = slot.instructor
  if (!c) return null
  const nombre = (c.firstName ?? '').trim()
  const apellido = (c.lastName ?? '').trim()
  if (!corto || !apellido) return `${nombre} ${apellido}`.trim() || null
  return `${nombre} ${apellido.charAt(0).toLocaleUpperCase()}.`.trim()
}

/** Con 3 lugares o menos la clase está por llenarse («pocos»). */
const POCOS = 3
export type EstadoDeLugares = 'libres' | 'pocos' | 'llena' | 'sin-dato'
export function lugaresDeLaSesion(slot: PublicClassSessionSlot): { estado: EstadoDeLugares; restantes: number | null } {
  const restantes = slot.remaining != null
    ? Math.max(0, slot.remaining)
    : slot.capacity != null ? Math.max(0, slot.capacity - (slot.enrolled ?? 0)) : null
  if (slot.available === false || restantes === 0) return { estado: 'llena', restantes: 0 }
  if (restantes == null) return { estado: 'sin-dato', restantes: null }
  return { estado: restantes <= POCOS ? 'pocos' : 'libres', restantes }
}

export function textoDeLugares(t: TFunction, l: { estado: EstadoDeLugares; restantes: number | null }): string | null {
  if (l.estado === 'llena') return t('reservaClases.horario.llena')
  if (l.restantes == null) return null
  return l.restantes === 1 ? t('reservaClases.horario.lugar') : t('reservaClases.horario.lugares', { n: l.restantes })
}

export function textoDeReserva(t: TFunction, r: { lugar: string | null }): string {
  return r.lugar ? t('reservaClases.horario.reservadaLugar', { lugar: r.lugar }) : t('reservaClases.horario.reservada')
}

/** «8 lugares» en verde, «2 lugares» en ámbar («pocos») o «Llena» en gris. */
export function Lugares({ slot, t, conIcono = false }: { slot: PublicClassSessionSlot; t: TFunction; conIcono?: boolean }) {
  const l = lugaresDeLaSesion(slot)
  const texto = textoDeLugares(t, l)
  if (!texto) return null
  return (
    <span class={`avq-lugares avq-lugares--${l.estado}`} data-lugares={l.estado}>
      {conIcono && l.estado !== 'llena' && <Icono nombre="asiento" size={13} />}
      {texto}
    </span>
  )
}

/** Lo que un lector de pantalla dice de la sesión: la clase primero, luego el día, la hora y lo demás. */
export function nombreDeLaSesion(partes: Array<string | null | undefined | false>): string {
  return partes.filter((p): p is string => Boolean(p)).join(', ')
}

/** Una clase llena sólo se puede tocar si es de ella (para abrir su clase). */
export const sePuedeTocar = (slot: PublicClassSessionSlot, reserva: { lugar: string | null } | null) =>
  reserva != null || lugaresDeLaSesion(slot).estado !== 'llena'

export type PrecioDeLaFila = { texto: string; incluida: boolean }

interface ListaDelHorarioProps {
  /** Sesiones ya filtradas y ordenadas por inicio (las da el SERVIDOR así). */
  slots: PublicClassSessionSlot[]
  timezone: string
  nowMs: number
  onSelect: (slot: PublicClassSessionSlot) => void
  /** «$325 · clase suelta», «Incluida en tu paquete» (`incluida`) o nada. */
  precioDe: (slot: PublicClassSessionSlot) => PrecioDeLaFila | null
  miReserva?: MiReserva
  mostrarDuracion: boolean
  /** Si quedan días por traer: «Más fechas» al final de la tira. */
  onMasFechas?: () => void
  cargando?: boolean
  t: TFunction
}

/**
 * Lista con tira de días (como la app de un estudio): arriba los días que tienen clases; abajo, las clases del día elegido
 * con su encabezado («Hoy», «Mañana», «Sábado, 28 de noviembre»). Abre en el primer día con clases.
 */
export function ListaDelHorario({
  slots, timezone, nowMs, onSelect, precioDe, miReserva, mostrarDuracion, onMasFechas, cargando, t,
}: ListaDelHorarioProps) {
  const idioma = idiomaDe(t)
  const hoy = diaDeLaSesion(new Date(nowMs).toISOString(), timezone)
  const porDia = useMemo(() => agruparPorDia(slots, timezone), [slots, timezone])
  const dias = useMemo(() => Array.from(porDia.keys()).sort(), [porDia])
  const [elegido, setElegido] = useState<string | null>(null)
  // Si un filtro deja fuera el día elegido, se vuelve al primero que tiene clases.
  const dia = elegido && porDia.has(elegido) ? elegido : dias[0]
  const encabezado = (ymd: string) => encabezadoDeDia(ymd, nowMs, timezone, idioma, t)

  if (!dia) {
    return <p class="avq-horario-vacio">{t('reservaClases.horario.sinResultados')}</p>
  }

  return (
    <div class="avq-lista-horario">
      <div class="avq-tira">
        <div class="avq-tira-dias" role="group" aria-label={t('reservaClases.horario.dias')}>
          {dias.map(d => (
            <button
              key={d}
              type="button"
              class="avq-tira-dia"
              aria-pressed={d === dia}
              aria-label={encabezado(d)}
              onClick={() => setElegido(d)}
            >
              <span class="avq-tira-semana">{d === hoy ? t('reservaClases.hoy').toLocaleUpperCase() : diaCorto(d, idioma)}</span>
              <span class="avq-tira-num">{numeroDelDia(d)}</span>
            </button>
          ))}
        </div>
        {onMasFechas && (
          <button type="button" class="avq-tira-mas" onClick={onMasFechas} disabled={cargando}>
            {t('reservaClases.horario.masFechas')}
          </button>
        )}
      </div>

      <h3 class="avq-dia-titulo">{encabezado(dia)}</h3>

      <div class="avq-filas">
        {(porDia.get(dia) ?? []).map(slot => (
          <FilaDeClase
            key={slot.classSessionId ?? slot.startsAt}
            slot={slot}
            dia={encabezado(dia)}
            hora={horaDeLaSesion(slot.startsAt, timezone, idioma)}
            precio={precioDe(slot)}
            reserva={miReserva ? miReserva(slot) : null}
            mostrarDuracion={mostrarDuracion}
            onSelect={onSelect}
            t={t}
          />
        ))}
      </div>
      <style>{ESTILOS}</style>
    </div>
  )
}

function FilaDeClase({ slot, dia, hora, precio, reserva, mostrarDuracion, onSelect, t }: {
  slot: PublicClassSessionSlot
  dia: string
  hora: string
  precio: PrecioDeLaFila | null
  reserva: { lugar: string | null } | null
  mostrarDuracion: boolean
  onSelect: (slot: PublicClassSessionSlot) => void
  t: TFunction
}) {
  const lugares = lugaresDeLaSesion(slot)
  const llena = lugares.estado === 'llena'
  const tocable = sePuedeTocar(slot, reserva)
  const coach = nombreDeCoach(slot)
  const dur = mostrarDuracion ? duracion(minutosDeLaSesion(slot)) : ''
  const textoLugares = textoDeLugares(t, lugares)
  const textoReserva = reserva ? textoDeReserva(t, reserva) : null
  return (
    <button
      type="button"
      class="avq-fila"
      data-estado={reserva ? 'reservada' : lugares.estado}
      aria-label={nombreDeLaSesion([
        slot.productName, dia, hora, dur, coach && t('classList.withInstructor', { name: coach }),
        textoLugares, textoReserva, precio?.texto,
      ])}
      disabled={!tocable}
      onClick={() => { if (tocable) onSelect(slot) }}
    >
      <span class="avq-fila-hora">
        <strong>{hora}</strong>
        {dur && <small>{dur}</small>}
      </span>
      <span class="avq-fila-info">
        <span class="avq-fila-clase">{slot.productName}</span>
        <span class="avq-fila-meta">
          {coach && <span>{coach}</span>}
          {coach && textoLugares && <span aria-hidden="true"> · </span>}
          <Lugares slot={slot} t={t} />
        </span>
        {textoReserva && (
          <span class="avq-fila-reservada">
            <Icono nombre="check" size={15} />
            <span>{textoReserva}</span>
          </span>
        )}
        {precio && <span class={`avq-fila-precio${precio.incluida ? ' avq-fila-precio--incluida' : ''}`}>{precio.texto}</span>}
      </span>
      {/* Ya reservada: la marca de arriba lo dice; tocarla abre su clase, sin botón de «Reservar». */}
      {!reserva && (
        <span class={`avq-fila-accion${llena ? ' avq-fila-accion--llena' : ''}`}>
          {llena ? t('reservaClases.horario.llena') : t('reservaClases.horario.reservar')}
        </span>
      )}
    </button>
  )
}

/** Colores de los lugares, iguales en la lista y en la semana. */
export const ESTILOS_LUGARES = `
  .avq-lugares { display: inline-flex; align-items: center; gap: 4px; font-weight: 600; }
  .avq-lugares--libres { color: var(--avq-success-fg, #15803d); }
  .avq-lugares--pocos { color: var(--avq-warning-fg, #b45309); }
  .avq-lugares--llena { color: var(--avq-muted-fg, #a8a29e); font-weight: 500; }
`

const ESTILOS = `
  ${ESTILOS_LUGARES}
  .avq-tira { display: flex; align-items: stretch; gap: 8px; overflow-x: auto; -webkit-overflow-scrolling: touch;
    padding: 2px 2px 6px; margin: 0 0 20px; scrollbar-width: thin; }
  .avq-tira-dias { display: flex; gap: 8px; }
  .avq-tira-dia { flex-shrink: 0; min-width: 56px; min-height: 56px; padding: 6px 4px; border-radius: 12px;
    border: 1px solid var(--avq-border, #e8eaed); background: var(--avq-bg, #ffffff); color: var(--avq-muted-fg, #6b7280);
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; cursor: pointer;
    font: inherit; transition: background 0.15s ease, border-color 0.15s ease; }
  .avq-tira-dia:hover { border-color: var(--avq-fg, #111827); }
  .avq-tira-dia[aria-pressed="true"] { background: var(--avq-fg, #111827); border-color: var(--avq-fg, #111827); color: var(--avq-bg, #ffffff); }
  .avq-tira-semana { font-size: 11px; font-weight: 700; letter-spacing: 0.05em; }
  .avq-tira-num { font-size: 16px; font-weight: 700; color: var(--avq-fg, #111827); }
  .avq-tira-dia[aria-pressed="true"] .avq-tira-num { color: inherit; }
  .avq-tira-mas { flex-shrink: 0; min-height: 56px; padding: 0 14px; border-radius: 12px; border: 1px dashed var(--avq-border, #e8eaed);
    background: transparent; color: var(--avq-muted-fg, #6b7280); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap; }
  .avq-tira-mas:disabled { opacity: 0.6; cursor: progress; }
  .avq-dia-titulo { margin: 0 0 8px; font-size: 18px; font-weight: 700; color: var(--avq-fg, #111827); letter-spacing: -0.01em; }
  .avq-filas { display: flex; flex-direction: column; }
  .avq-fila { display: flex; align-items: center; gap: 14px; width: 100%; min-height: 56px; padding: 14px 4px; text-align: left;
    background: transparent; border: 0; border-bottom: 1px solid var(--avq-border, #ece9e6); font: inherit; color: var(--avq-fg, #111827);
    cursor: pointer; transition: background 0.15s ease; }
  .avq-fila:hover:not(:disabled) { background: var(--avq-muted, #f8f9fb); }
  .avq-fila:disabled { cursor: not-allowed; color: var(--avq-muted-fg, #a8a29e); }
  .avq-fila-hora { flex-shrink: 0; width: 64px; display: flex; flex-direction: column; gap: 2px; }
  .avq-fila-hora strong { font-size: 15px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .avq-fila-hora small { font-size: 12px; color: var(--avq-muted-fg, #6b7280); }
  .avq-fila-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .avq-fila-clase { font-size: 16px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .avq-fila-meta, .avq-fila-precio { font-size: 14px; color: var(--avq-muted-fg, #6b7280); }
  .avq-fila-precio--incluida { color: var(--avq-success-fg, #15803d); font-weight: 600; }
  .avq-fila-accion { flex-shrink: 0; display: inline-flex; align-items: center; gap: 5px; padding: 7px 14px; border-radius: 999px;
    border: 1px solid var(--avq-accent, #3b2a4a); color: var(--avq-accent, #3b2a4a); font-size: 13px; font-weight: 700; white-space: nowrap; }
  .avq-fila-accion--llena { border-color: var(--avq-border, #e7e5e4); color: var(--avq-muted-fg, #a8a29e); }
  .avq-fila-reservada { display: inline-flex; align-items: center; gap: 5px; font-size: 14px; font-weight: 600;
    color: var(--avq-success-fg, #15803d); }
  .avq-horario-vacio { padding: 32px 8px; text-align: center; font-size: 14px; color: var(--avq-muted-fg, #6b7280); }
  /* Celular (≤ 640 px): letra para leer de 16–17 px, filas y botones de 56 px, bloques separados 24 px. */
  @media (max-width: 640px) {
    .avq-tira { margin-bottom: 24px; }
    .avq-tira-semana { font-size: 12px; }
    .avq-tira-num { font-size: 17px; }
    .avq-dia-titulo { font-size: 20px; margin-bottom: 8px; }
    .avq-fila { min-height: 56px; padding: 16px 0; gap: 12px; }
    .avq-fila-hora { width: 60px; }
    .avq-fila-hora strong { font-size: 17px; }
    .avq-fila-hora small { font-size: 14px; }
    .avq-fila-clase { font-size: 17px; }
    .avq-fila-meta, .avq-fila-precio, .avq-fila-reservada { font-size: 16px; }
    .avq-fila-accion { font-size: 15px; padding: 8px 14px; }
    .avq-horario-vacio { font-size: 16px; }
  }
`
