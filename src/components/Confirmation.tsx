import { h } from 'preact'
import { useId, useState } from 'preact/hooks'
import type { PublicBookingResult, PublicVenueInfo } from '../types'
import type { TFunction } from '../i18n'
import { precio as formatoDePrecio } from '../lib/precio'
import { fechaDeLaClase, horaDeLaClase } from './ClassDetailView'
import { idiomaDe } from './ListaDelHorario'
import { fechaCorta } from './TuPaqueteFranja'
import { Icono } from './ui/Icono'

const mayuscula = (s: string) => s.charAt(0).toLocaleUpperCase() + s.slice(1)

interface ConfirmationProps {
  booking: PublicBookingResult
  venueInfo: PublicVenueInfo
  onManageBooking: () => void
  onNewBooking: () => void
  t: TFunction
}

function buildGoogleCalendarUrl(booking: PublicBookingResult, venueName: string): string {
  const start = new Date(booking.startsAt).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const end = new Date(booking.endsAt).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `Reservation at ${venueName}`,
    dates: `${start}/${end}`,
    details: `Confirmation code: ${booking.confirmationCode}`,
  })
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

function buildIcsContent(booking: PublicBookingResult, venueName: string): string {
  const start = new Date(booking.startsAt).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const end = new Date(booking.endsAt).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT',
    `DTSTART:${start}`, `DTEND:${end}`,
    `SUMMARY:Reservation at ${venueName}`,
    `DESCRIPTION:Confirmation code: ${booking.confirmationCode}`,
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n')
}

function downloadIcs(booking: PublicBookingResult, venueName: string) {
  const blob = new Blob([buildIcsContent(booking, venueName)], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `reservation-${booking.confirmationCode}.ics`; a.click()
  URL.revokeObjectURL(url)
}

export function Confirmation({ booking, venueInfo, onManageBooking, onNewBooking, t }: ConfirmationProps) {
  const [calHover, setCalHover] = useState(false)
  const [icsHover, setIcsHover] = useState(false)
  const [manageHover, setManageHover] = useState(false)
  const [newHover, setNewHover] = useState(false)

  const startDate = new Date(booking.startsAt)
  const endDate = new Date(booking.endsAt)
  // Sólo la primera letra en mayúscula: con `text-transform: capitalize` salía «Jueves, 8 De Octubre De 2026» (Task 14).
  const dateStr = mayuscula(startDate.toLocaleDateString(undefined, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: venueInfo.timezone,
  }))
  const timeStr = `${startDate.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', timeZone: venueInfo.timezone })} - ${endDate.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', timeZone: venueInfo.timezone })}`

  return (
    <div class="avq-animate-scale" style={{ textAlign: 'center' }}>
      {/* Success icon */}
      <div style={{
        width: '64px', height: '64px', borderRadius: '50%',
        background: 'linear-gradient(135deg, #dcfce7 0%, #bbf7d0 100%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        margin: '0 auto 20px',
        boxShadow: '0 4px 14px rgba(34, 197, 94, 0.15)',
      }}>
        <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
          <polyline points="22 4 12 14.01 9 11.01"/>
        </svg>
      </div>

      <h2 style={{ fontSize: '20px', fontWeight: '700', color: 'var(--avq-fg, #111827)', margin: '0 0 24px', letterSpacing: '-0.01em' }}>
        {t('confirmation.title')}
      </h2>

      {/* Credit redeemed notice */}
      {booking.creditRedeemed && (
        <div
          role="status"
          style={{
            display: 'flex', alignItems: 'center', gap: '10px',
            padding: '11px 14px', borderRadius: '12px',
            background: 'var(--avq-success-bg)',
            border: '1px solid var(--avq-success-border)',
            marginBottom: '16px',
          }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--avq-success-accent)" stroke-width="2" aria-hidden="true">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
            <polyline points="22 4 12 14.01 9 11.01"/>
          </svg>
          <span style={{ fontSize: '13px', fontWeight: '500', color: 'var(--avq-success-fg)' }}>
            {(booking.creditsUsed ?? 1) > 1
              ? t('creditPacks.creditsUsed', { count: booking.creditsUsed ?? 1 })
              : t('creditPacks.creditUsed')}
            {' — '}{t('creditPacks.noCreditNeeded')}
          </span>
        </div>
      )}

      {/* Owes-at-venue notice (policy=required but venue lacks Stripe yet) */}
      {booking.owesAtVenue && booking.depositAmount != null && (
        <div
          role="status"
          style={{
            display: 'flex', alignItems: 'flex-start', gap: '10px',
            padding: '12px 14px', borderRadius: '12px',
            background: 'var(--avq-warning-bg)',
            border: '1px solid var(--avq-warning-border)',
            marginBottom: '16px',
          }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--avq-warning-accent)" stroke-width="2" aria-hidden="true" style={{ flexShrink: 0, marginTop: '1px' }}>
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <div style={{ fontSize: '13px', color: 'var(--avq-warning-fg)' }}>
            <div style={{ fontWeight: '600', marginBottom: '2px' }}>
              Pagás al llegar al estudio
            </div>
            <div style={{ opacity: 0.9 }}>
              Total: ${Number(booking.depositAmount).toLocaleString('es-MX')}
            </div>
          </div>
        </div>
      )}

      {/* Confirmation code */}
      <div style={{
        borderRadius: '14px', padding: '18px',
        background: 'var(--avq-muted, #f8f9fb)',
        border: '1px solid var(--avq-border, #e8eaed)',
        marginBottom: '20px',
      }}>
        <p style={{ fontSize: '12px', color: 'var(--avq-muted-fg, #6b7280)', margin: '0 0 6px', fontWeight: '500', letterSpacing: '0.03em', textTransform: 'uppercase' }}>
          {t('confirmation.code')}
        </p>
        <p style={{ margin: 0, fontSize: '28px', fontWeight: '700', letterSpacing: '0.08em', color: 'var(--avq-fg, #111827)' }}>
          {booking.confirmationCode}
        </p>
      </div>

      {/* Date & time */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '12px',
        padding: '14px 16px', borderRadius: '12px',
        border: '1px solid var(--avq-border, #e8eaed)',
        marginBottom: '20px', textAlign: 'left',
      }}>
        <div style={{
          width: '40px', height: '40px', borderRadius: '10px',
          background: 'color-mix(in srgb, var(--avq-accent, #6366f1) 8%, transparent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--avq-accent, #6366f1)" stroke-width="2">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
          </svg>
        </div>
        <div style={{ minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: '14px', fontWeight: '500', color: 'var(--avq-fg, #111827)' }}>{dateStr}</p>
          <p style={{ margin: '2px 0 0', fontSize: '13px', color: 'var(--avq-muted-fg, #6b7280)' }}>{timeStr}</p>
        </div>
      </div>

      {/* Calendar actions */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
        <button
          type="button"
          onClick={() => window.open(buildGoogleCalendarUrl(booking, venueInfo.name), '_blank')}
          onMouseEnter={() => setCalHover(true)}
          onMouseLeave={() => setCalHover(false)}
          style={{
            flex: 1, height: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
            borderRadius: 'var(--avq-btn-radius, 12px)', border: '1px solid var(--avq-border, #e8eaed)',
            background: calHover ? 'var(--avq-muted, #f8f9fb)' : 'var(--avq-bg, #ffffff)',
            fontSize: '13px', fontWeight: '500', color: 'var(--avq-fg, #111827)',
            cursor: 'pointer', transition: 'all 0.15s ease',
          }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          {t('confirmation.addToCalendar')}
        </button>
        <button
          type="button"
          onClick={() => downloadIcs(booking, venueInfo.name)}
          onMouseEnter={() => setIcsHover(true)}
          onMouseLeave={() => setIcsHover(false)}
          style={{
            flex: 1, height: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
            borderRadius: 'var(--avq-btn-radius, 12px)', border: '1px solid var(--avq-border, #e8eaed)',
            background: icsHover ? 'var(--avq-muted, #f8f9fb)' : 'var(--avq-bg, #ffffff)',
            fontSize: '13px', fontWeight: '500', color: 'var(--avq-fg, #111827)',
            cursor: 'pointer', transition: 'all 0.15s ease',
          }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          {t('confirmation.downloadIcs')}
        </button>
      </div>

      <button
        type="button"
        onClick={onManageBooking}
        onMouseEnter={() => setManageHover(true)}
        onMouseLeave={() => setManageHover(false)}
        style={{
          width: '100%', height: '44px', borderRadius: 'var(--avq-btn-radius, 12px)',
          background: manageHover ? 'var(--avq-muted-hover, #eef0f4)' : 'var(--avq-muted, #f8f9fb)',
          border: 'none', fontSize: '14px', fontWeight: '500',
          color: 'var(--avq-fg, #111827)', cursor: 'pointer',
          transition: 'background 0.15s ease',
          marginBottom: '8px',
        }}
      >
        {t('confirmation.manageBooking')}
      </button>

      <button
        type="button"
        onClick={onNewBooking}
        onMouseEnter={() => setNewHover(true)}
        onMouseLeave={() => setNewHover(false)}
        style={{
          width: '100%', height: '40px', borderRadius: '10px',
          background: 'none', border: 'none',
          fontSize: '13px', fontWeight: '500',
          color: newHover ? 'var(--avq-fg, #111827)' : 'var(--avq-muted-fg, #6b7280)',
          cursor: 'pointer', transition: 'color 0.15s ease',
        }}
      >
        {t('confirmation.newBooking')}
      </button>
    </div>
  )
}

const L = 'reservaClases.listo'

/** El saldo del paquete canjeado DESPUÉS de canjear, como lo regresa el SERVIDOR (Task 1b). */
export type SaldoTrasElCanje = {
  packName: string
  remaining: number
  original: number
  unlimited: boolean
  expiresAt: string | null
}

/** Lo que se descontó de su paquete en esta reserva. */
export type CanjeDeLaReserva = {
  /** Las sesiones descontadas (`creditsUsed`: hoy, 1 por lugar). */
  usadas: number
  /** Sin él (SERVIDOR viejo, o tras «sí quedó»), sólo «Usaste N sesiones», sin saldo. */
  saldo?: SaldoTrasElCanje | null
  /** Se pagó con un Ilimitado, cuando no hay saldo que lo diga. */
  ilimitado?: boolean
  /** El paquete es sólo de esta clase («sesión») o de varias («crédito»); sin dato, «sesión». */
  soloEstaClase?: boolean | null
}

/** Cómo paga sin paquete: ya pagó con tarjeta (volvió de Stripe) o paga en el estudio. `monto: null` = sin precios a la vista. */
export type PagoDeLaClaseLista = { forma: 'tarjeta' | 'estudio'; monto: number | null }

interface ConfirmacionDeClaseProps {
  /** «Lagree». */
  clase: string
  startsAt: string
  endsAt: string
  /** La zona en que se enseña el horario. */
  timeZone: string
  /** «Fer Ruiz»; `null` sin coach. */
  coach: string | null
  /** Los lugares tal como quedaron guardados («3»): nunca se vuelven a buscar en el mapa de hoy. */
  lugares: string[]
  confirmationCode: string
  /** Quien reservó («Te esperamos, Ana»). */
  nombre?: string | null
  canje?: CanjeDeLaReserva | null
  pago?: PagoDeLaClaseLista | null
  /** La regla de cancelación (`lineaDePolitica`); `null` sin política del SERVIDOR: no hay línea. */
  politica: string | null
  /** El negocio y su dirección, para el calendario. */
  negocio: string
  direccion?: string | null
  /** El negocio recibe mensajes: «¿Dudas? Escríbenos». */
  puedeEscribir: boolean
  /** Con cuenta, «Ver mis reservas» (su «Mi cuenta»); sin cuenta, «Ver mi reserva» (esta, en «Gestionar»). */
  conCuenta: boolean
  onVerMisReservas: () => void
  /** Con cuenta, «Ver o cambiar esta reserva»: «Gestionar» de ESTA reserva (sin cuenta ya lo hace «Ver mi reserva»). */
  onVerEstaReserva?: () => void
  /** Con la última sesión gastada, invita a ver paquetes (sólo si el estudio vende alguno). */
  onVerPaquetes?: () => void
  /** «Reservar otra clase» (de vuelta al horario). */
  onOtraClase?: () => void
  /** La cuenta del estudio ya no es la que reservó (r5 #5): no se enseña ningún dato de la reserva. */
  cambioDeCuenta?: boolean
  onVerMiCuenta?: () => void
  t: TFunction
}

/** «20261008T210000Z». */
const utc = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
/** Texto de una línea del .ics (RFC 5545: `\`, `,`, `;` y saltos se escapan). */
const ics = (s: string) => s.replace(/\\/g, '\\\\').replace(/[,;]/g, m => `\\${m}`).replace(/\r?\n/g, '\\n')

/**
 * «¡Tu lugar está apartado!» de una clase (diseño 27-nov, `listo-y-paquetes-v2.html`, con las medidas de `pasos-con-aire-v7`): un
 * solo mensaje grande, el «boleto» de la clase (qué, cuándo, con quién, en qué lugar) y, debajo, lo que gastó de su paquete con el
 * saldo que regresó el SERVIDOR (nunca calculado aquí) y la regla de cancelación. La misma pantalla tras una reserva que respondió,
 * tras «sí quedó» (Task 13) y al volver de Stripe ya pagada.
 */
export function ConfirmacionDeClase({
  clase, startsAt, endsAt, timeZone, coach, lugares, confirmationCode, nombre, canje, pago, politica, negocio, direccion,
  puedeEscribir, conCuenta, onVerMisReservas, onVerEstaReserva, onVerPaquetes, onOtraClase, cambioDeCuenta = false, onVerMiCuenta, t,
}: ConfirmacionDeClaseProps) {
  const [conCalendario, setConCalendario] = useState(false)
  const idCalendario = useId()
  const idioma = idiomaDe(t)

  if (cambioDeCuenta) {
    // Ni la clase, ni el código, ni el nombre: quien está ahora frente a la página es otra cuenta.
    return (
      <div class="avq-listo avq-animate-in" aria-live="polite">
        <div class="avq-ls-ok avq-ls-ok--gris"><Icono nombre="alerta" size={28} /></div>
        <h1 class="avq-ls-titulo">{t('reservaClases.revisar.cambioDeCuenta')}</h1>
        <p class="avq-ls-sub">{t('reservaClases.revisar.cambioDeCuentaSub')}</p>
        <div class="avq-ls-acciones">
          <button type="button" class="avq-ls-btn" onClick={() => onVerMiCuenta?.()}>{t('reservaClases.revisar.verMiCuenta')}</button>
        </div>
        <style>{ESTILOS_LISTO}</style>
      </div>
    )
  }

  const plata = (monto: number) => formatoDePrecio(monto, 'MXN', idioma)
  const hora = (iso: string) => horaDeLaClase(iso, timeZone, idioma)
  const cuando = `${fechaDeLaClase(startsAt, timeZone, idioma)} · ${hora(startsAt)} – ${hora(endsAt)}`
  const primerNombre = nombre?.trim().split(/\s+/)[0] || null

  // Lo que gastó de su paquete: el saldo es el del SERVIDOR; un Ilimitado nunca enseña sus números internos.
  let usoDelPaquete: string | null = null
  let ultima = false
  const saldo = canje?.saldo ?? null
  // Regla global: un Ilimitado nunca enseña su ≈99,999, aunque el SERVIDOR y el pedido no coincidan en la marca (fix r1 #3).
  const esIlimitado = !!(saldo?.unlimited || canje?.ilimitado)
  if (canje) {
    const creditos = canje.soloEstaClase === false
    const u = (n: number) => t(creditos ? (n === 1 ? 'reservaClases.credito' : 'reservaClases.creditos') : (n === 1 ? `${L}.sesion` : `${L}.sesiones`))
    const usadas = Math.max(1, canje.usadas)
    const vence = saldo?.expiresAt ? fechaCorta(t, saldo.expiresAt, timeZone) : null
    if (esIlimitado) {
      usoDelPaquete = vence ? `${t(`${L}.ilimitado`)} ${t(`${L}.venceParen`, { fecha: vence })}` : t(`${L}.ilimitado`)
    } else if (saldo && saldo.remaining <= 0) {
      ultima = true
      usoDelPaquete = usadas === 1
        ? t(creditos ? `${L}.ultimoCredito` : `${L}.ultima`)
        : t(creditos ? `${L}.ultimosCreditos` : `${L}.ultimas`, { n: usadas })
    } else if (saldo) {
      const una = saldo.remaining === 1
      const fecha = vence ? ` ${t(una ? `${L}.venceParen` : `${L}.vencenParen`, { fecha: vence })}` : ''
      usoDelPaquete = `${t(`${L}.usaste`, { n: usadas, unidad: u(usadas) })} · ${t(una ? `${L}.teQueda` : `${L}.teQuedan`, { n: saldo.remaining, total: saldo.original })}${fecha}`
    } else {
      usoDelPaquete = t(`${L}.usaste`, { n: usadas, unidad: u(usadas) })
    }
  }
  const barra = saldo && !esIlimitado && saldo.original > 0
    ? Math.max(0, Math.min(100, Math.round((saldo.remaining / saldo.original) * 100)))
    : null
  const comoPaga = !canje && pago
    ? pago.forma === 'tarjeta'
      ? (pago.monto != null ? t(`${L}.pagaste`, { monto: plata(pago.monto) }) : t(`${L}.pagasteSinMonto`))
      : (pago.monto != null ? t(`${L}.enElEstudio`, { monto: plata(pago.monto) }) : t('reservaClases.confirmar.enElEstudio'))
    : null

  const titulo = `${clase} · ${negocio}`
  const detalles = [
    coach ? `${t('reservaClases.detalle.coach')}: ${coach}` : null,
    lugares.length > 1 ? t(`${L}.lugares`, { lugares: lugares.join(', ') }) : lugares[0] ? t(`${L}.lugar`, { lugar: lugares[0] }) : null,
    `${t(`${L}.codigo`)}: ${confirmationCode}`,
  ].filter(Boolean).join('\n')
  const google = (() => {
    const q = new URLSearchParams({ action: 'TEMPLATE', text: titulo, dates: `${utc(startsAt)}/${utc(endsAt)}`, details: detalles })
    if (direccion) q.set('location', direccion)
    return `https://calendar.google.com/calendar/render?${q.toString()}`
  })()
  const descargarIcs = () => {
    const lineas = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Avoqado//Reservas//ES', 'BEGIN:VEVENT',
      `UID:${confirmationCode}@avoqado.io`, `DTSTAMP:${utc(new Date().toISOString())}`,
      `DTSTART:${utc(startsAt)}`, `DTEND:${utc(endsAt)}`,
      `SUMMARY:${ics(titulo)}`, `DESCRIPTION:${ics(detalles)}`,
      ...(direccion ? [`LOCATION:${ics(direccion)}`] : []),
      'END:VEVENT', 'END:VCALENDAR',
    ]
    const url = URL.createObjectURL(new Blob([lineas.join('\r\n')], { type: 'text/calendar;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url; a.download = `reserva-${confirmationCode}.ics`; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div class="avq-listo avq-animate-scale">
      <div class="avq-ls-ok"><Icono nombre="check" size={30} /></div>
      <h1 class="avq-ls-titulo">{t(`${L}.titulo`)}</h1>
      {primerNombre && <p class="avq-ls-sub">{t(`${L}.teEsperamos`, { nombre: primerNombre })}</p>}

      <div class="avq-ls-boleto">
        <div class="avq-ls-t1">
          <p class="avq-ls-clase">{clase}</p>
          <p class="avq-ls-cuando">{cuando}</p>
          {(coach || lugares.length > 0) && (
            <div class="avq-ls-quien">
              {coach && (
                <>
                  <span class="avq-ls-av" aria-hidden="true">{coach.trim().charAt(0).toLocaleUpperCase()}</span>
                  <div class="avq-ls-coach"><strong>{coach}</strong><span>{t('reservaClases.detalle.coach')}</span></div>
                </>
              )}
              {lugares.length > 0 && (
                <span class="avq-ls-chip">
                  {lugares.length > 1 ? t(`${L}.lugares`, { lugares: lugares.join(', ') }) : t(`${L}.lugar`, { lugar: lugares[0] })}
                </span>
              )}
            </div>
          )}
        </div>

        {(usoDelPaquete || comoPaga || politica) && (
          <>
            <div class="avq-ls-corte" />
            <div class="avq-ls-t2">
              {saldo && !esIlimitado && <p class="avq-ls-lbl">{t(`${L}.tuPaquete`, { paquete: saldo.packName })}</p>}
              {usoDelPaquete && <p class="avq-ls-uso">{usoDelPaquete}</p>}
              {barra != null && <div class="avq-ls-barra" aria-hidden="true"><i style={{ width: `${barra}%` }} /></div>}
              {ultima && onVerPaquetes && (
                <button type="button" class="avq-ls-link avq-ls-paquetes" onClick={onVerPaquetes}>
                  <Icono nombre="paquete" size={20} />{t(`${L}.verPaquetes`)}
                </button>
              )}
              {comoPaga && (
                <p class="avq-ls-paga"><Icono nombre={pago!.forma === 'tarjeta' ? 'tarjeta' : 'tienda'} size={20} /><span>{comoPaga}</span></p>
              )}
              {politica && <p class="avq-ls-pol"><Icono nombre="reloj" size={20} /><span>{politica}</span></p>}
            </div>
          </>
        )}
        <p class="avq-ls-codigo">{t(`${L}.codigo`)} <span>{confirmationCode}</span></p>
      </div>

      <div class="avq-ls-acciones">
        <button
          type="button"
          class="avq-ls-btn"
          aria-expanded={conCalendario}
          aria-controls={idCalendario}
          onClick={() => setConCalendario(v => !v)}
        >
          <Icono nombre="calendario" size={20} />{t(`${L}.calendario`)}
        </button>
        {conCalendario && (
          <div id={idCalendario} class="avq-ls-cal">
            <a class="avq-ls-btn avq-ls-btn--sec" href={google} target="_blank" rel="noopener noreferrer">{t(`${L}.google`)}</a>
            <button type="button" class="avq-ls-btn avq-ls-btn--sec" onClick={descargarIcs}>{t(`${L}.ics`)}</button>
          </div>
        )}
        <button type="button" class="avq-ls-link" onClick={onVerMisReservas}>
          {t(conCuenta ? `${L}.verMisReservas` : `${L}.verMiReserva`)}
        </button>
        {conCuenta && onVerEstaReserva && (
          <button type="button" class="avq-ls-link avq-ls-link--sec" onClick={onVerEstaReserva}>{t(`${L}.verEstaReserva`)}</button>
        )}
        {puedeEscribir && (
          <button type="button" class="avq-ls-link" onClick={() => window.dispatchEvent(new CustomEvent('avoqado:open-chat'))}>
            <Icono nombre="chat" size={20} />{t(`${L}.dudas`)}
          </button>
        )}
        {onOtraClase && <button type="button" class="avq-ls-otra" onClick={onOtraClase}>{t(`${L}.otraClase`)}</button>}
      </div>

      <style>{ESTILOS_LISTO}</style>
    </div>
  )
}

const ESTILOS_LISTO = `
  .avq-listo { max-width: 480px; margin-inline: auto; padding: 8px 0 8px; }
  .avq-ls-ok {
    width: 64px; height: 64px; margin: 6px auto 14px; border-radius: 999px; display: flex; align-items: center; justify-content: center;
    background: color-mix(in srgb, var(--avq-accent, #2563eb) 12%, var(--avq-bg, #ffffff)); color: var(--avq-accent, #2563eb);
  }
  .avq-ls-ok--gris { background: var(--avq-muted, #f5f5f4); color: var(--avq-muted-fg, #6b7280); }
  .avq-ls-titulo {
    margin: 0 0 6px; text-align: center; font-size: 26px; font-weight: 700; line-height: 1.2; letter-spacing: -0.02em;
    color: var(--avq-fg, #111827);
  }
  .avq-ls-sub { margin: 0 0 22px; text-align: center; font-size: 16px; color: var(--avq-muted-fg, #6b7280); }
  .avq-ls-boleto {
    overflow: hidden; border-radius: 18px; background: var(--avq-bg, #ffffff); border: 1px solid var(--avq-border, #ece9e6);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04), 0 8px 24px rgba(0, 0, 0, 0.06);
  }
  .avq-ls-t1 { padding: 20px 20px 16px; }
  .avq-ls-clase { margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -0.01em; color: var(--avq-fg, #111827); overflow-wrap: anywhere; }
  .avq-ls-cuando { margin: 4px 0 0; font-size: 16px; color: var(--avq-fg, #111827); }
  .avq-ls-quien { display: flex; align-items: center; gap: 10px; margin-top: 14px; }
  .avq-ls-av {
    width: 40px; height: 40px; flex: none; border-radius: 999px; display: flex; align-items: center; justify-content: center;
    font-weight: 700; color: var(--avq-accent, #2563eb);
    background: color-mix(in srgb, var(--avq-accent, #2563eb) 16%, var(--avq-bg, #ffffff));
  }
  .avq-ls-coach { min-width: 0; display: flex; flex-direction: column; }
  .avq-ls-coach strong { font-size: 16px; font-weight: 600; color: var(--avq-fg, #111827); overflow-wrap: anywhere; }
  .avq-ls-coach span { font-size: 14px; color: var(--avq-muted-fg, #6b7280); }
  .avq-ls-chip {
    margin-left: auto; flex: none; padding: 6px 12px; border-radius: 999px; font-size: 14px; font-weight: 700;
    color: var(--avq-accent, #2563eb); background: color-mix(in srgb, var(--avq-accent, #2563eb) 12%, var(--avq-bg, #ffffff));
  }
  .avq-ls-corte { margin: 0 14px; border-top: 1.5px dashed var(--avq-border, #ece9e6); }
  .avq-ls-t2 { padding: 14px 20px 6px; }
  .avq-ls-lbl { margin: 0; font-size: 12px; letter-spacing: .06em; text-transform: uppercase; color: var(--avq-muted-fg, #6b7280); }
  .avq-ls-uso { margin: 4px 0 0; font-size: 16px; font-weight: 600; line-height: 1.45; color: var(--avq-fg, #111827); }
  .avq-ls-barra { height: 6px; margin-top: 8px; overflow: hidden; border-radius: 999px; background: var(--avq-muted, #eeeae6); }
  .avq-ls-barra i { display: block; height: 100%; border-radius: 999px; background: var(--avq-accent, #2563eb); }
  .avq-ls-paga, .avq-ls-pol {
    display: flex; align-items: flex-start; gap: 10px; margin: 14px 0 0; font-size: 15px; line-height: 1.5; color: var(--avq-muted-fg, #6b7280);
  }
  .avq-ls-paga { color: var(--avq-fg, #111827); }
  .avq-ls-codigo { margin: 0; padding: 12px 20px 16px; font-size: 13px; color: var(--avq-muted-fg, #6b7280); }
  .avq-ls-codigo span { font-weight: 600; letter-spacing: .04em; color: var(--avq-fg, #111827); }
  .avq-ls-acciones { display: flex; flex-direction: column; gap: 10px; margin-top: 22px; }
  .avq-ls-btn {
    display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%; min-height: 52px; padding: 0 16px;
    box-sizing: border-box; border: 0; border-radius: var(--avq-btn-radius, 14px); background: var(--avq-accent, #2563eb);
    color: #ffffff; font: inherit; font-size: 16px; font-weight: 600; text-decoration: none; cursor: pointer;
    transition: filter 0.15s ease;
  }
  .avq-ls-btn:hover { filter: brightness(0.94); }
  .avq-ls-btn--sec { background: var(--avq-bg, #ffffff); color: var(--avq-fg, #111827); border: 1px solid var(--avq-border, #dcd8d4); }
  .avq-ls-cal { display: flex; flex-direction: column; gap: 8px; }
  .avq-ls-link {
    display: flex; align-items: center; justify-content: center; gap: 10px; min-height: 48px; padding: 0 8px; background: none;
    border: 0; border-radius: 10px; font: inherit; font-size: 16px; font-weight: 600; color: var(--avq-accent, #2563eb); cursor: pointer;
  }
  .avq-ls-link--sec { color: var(--avq-fg, #111827); font-weight: 500; }
  .avq-ls-paquetes { justify-content: flex-start; min-height: 44px; margin-top: 6px; padding: 0; }
  .avq-ls-otra {
    min-height: 44px; background: none; border: 0; border-radius: 10px; font: inherit; font-size: 15px; font-weight: 500;
    color: var(--avq-muted-fg, #6b7280); cursor: pointer;
  }
  .avq-ls-btn:focus-visible, .avq-ls-link:focus-visible, .avq-ls-otra:focus-visible {
    outline: 2px solid var(--avq-accent, #2563eb); outline-offset: 2px;
  }
  /* Celular (≤ 640 px): el margen lo ponen la página (12 px) y el widget (16 px), 28 px por lado; «Listo» ya no suma 12 px más (W2). */
  @media (max-width: 640px) {
    .avq-ls-titulo { font-size: 28px; }
    .avq-ls-sub, .avq-ls-cuando, .avq-ls-uso, .avq-ls-coach strong { font-size: 17px; }
    .avq-ls-paga, .avq-ls-pol { font-size: 16px; }
    .avq-ls-btn { min-height: 56px; font-size: 17px; }
    .avq-ls-btn--sec { min-height: 54px; font-size: 16px; }
    .avq-ls-link { min-height: 52px; font-size: 17px; }
  }
`
