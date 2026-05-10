import { h } from 'preact'
import type { PublicBookingResult, PublicVenueInfo, Product } from '../types'
import type { TFunction } from '../i18n'

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
  a.href = url
  a.download = `reservation-${booking.confirmationCode}.ics`
  a.click()
  URL.revokeObjectURL(url)
}

interface AppointmentConfirmationProps {
  booking: PublicBookingResult
  venueInfo: PublicVenueInfo
  selectedProducts: Product[]
  onReschedule: () => void
  onCancel: () => void
  onBookAgain: () => void
  locale: 'en' | 'es'
  t: TFunction
}

/**
 * Square-style confirmation page. Replaces the legacy Confirmation when the
 * customer is on the /appointments wizard. Renders 4 stacked cards: appointment
 * detail (with calendar export + reprogramar/cancelar/reservar de nuevo),
 * próximos pasos (callback note), pago (pill + body), and cancellation policy.
 */
export function AppointmentConfirmation({
  booking,
  venueInfo,
  selectedProducts,
  onReschedule,
  onCancel,
  onBookAgain,
  locale,
  t,
}: AppointmentConfirmationProps) {
  const startDate = new Date(booking.startsAt)
  const endDate = new Date(booking.endsAt)

  const dateHeading = startDate.toLocaleDateString(locale === 'en' ? 'en-US' : 'es-MX', {
    weekday: 'long', month: 'short', day: 'numeric', timeZone: venueInfo.timezone,
  })
  const timeRange = `${formatTime(startDate, venueInfo.timezone)}–${formatTime(endDate, venueInfo.timezone)}`

  // Compute per-service timeslots from selectedProducts durations. When backend
  // multi-service support lands, we'll prefer server-supplied per-service start
  // times if they're returned. Until then this is a faithful client-side guess.
  const serviceTimes = (() => {
    const times: Array<{ product: Product; startsAt: Date }> = []
    let cursor = startDate.getTime()
    for (const product of selectedProducts) {
      times.push({ product, startsAt: new Date(cursor) })
      cursor += (product.duration ?? 0) * 60 * 1000
    }
    return times
  })()

  const isPayAtVenue = booking.owesAtVenue || (!booking.creditRedeemed && booking.depositAmount == null)
  const hasVariablePrice = selectedProducts.some(p => p.price == null)

  const tx = locale === 'en'
    ? {
      thanks: 'Thanks for your reservation',
      almost: "You're almost ready for your appointment.",
      addCal: 'Add to calendar',
      reschedule: 'Reschedule',
      cancel: 'Cancel',
      bookAgain: 'Book again',
      nextSteps: 'Next steps',
      callBack: (p: string) => `We'll call you at ${p}.`,
      payment: 'Payment',
      payAtVenuePill: 'Due at venue',
      payAtVenueBody: 'You will pay at the appointment.',
      variableNote: 'This appointment includes a service with variable pricing. The amount will be set at the venue.',
      policyTitle: 'Cancellation policy',
      policyBody: 'You can cancel or reschedule your appointment before it starts.',
      readPolicy: 'Read the full policy',
    }
    : {
      thanks: 'Gracias por tu reserva',
      almost: 'Falta poco para tu cita.',
      addCal: 'Añadir al calendario',
      reschedule: 'Reprogramar',
      cancel: 'Cancelar',
      bookAgain: 'Reservar de nuevo',
      nextSteps: 'Próximos pasos',
      callBack: (p: string) => `Te llamaremos al ${p}.`,
      payment: 'Pago',
      payAtVenuePill: 'A pagar en la cita',
      payAtVenueBody: 'Abonarás el pago en la cita.',
      variableNote: 'Esta cita incluye un servicio con un precio variable. El importe se determinará en la cita.',
      policyTitle: 'Política de cancelación',
      policyBody: 'Puedes cancelar o reprogramar tu cita antes de que comience.',
      readPolicy: 'Lee la política completa',
    }

  return (
    <div style={{ maxWidth: '720px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '20px' }} class="avq-animate-in">
      {/* Heading */}
      <header>
        <h1 style={{
          margin: 0, fontSize: '26px', fontWeight: '700',
          color: 'var(--avq-fg, #111827)',
          letterSpacing: '-0.6px',
        }}>
          {tx.thanks}
        </h1>
        <p style={{
          margin: '4px 0 0', fontSize: '14px',
          color: 'var(--avq-muted-fg, #6b7280)',
        }}>
          {tx.almost}
        </p>
      </header>

      {/* Card 1 — appointment detail */}
      <Card>
        <div style={{ padding: '20px 22px 4px' }}>
          <h2 style={{
            margin: '0 0 4px', fontSize: '17px', fontWeight: '700',
            color: 'var(--avq-fg, #111827)',
            textTransform: 'capitalize',
          }}>
            {dateHeading}
          </h2>
          <p style={{
            margin: 0, fontSize: '13px',
            color: 'var(--avq-muted-fg, #6b7280)',
            fontVariantNumeric: 'tabular-nums',
          }}>
            {timeRange}
          </p>
        </div>

        <div style={{ padding: '16px 22px 20px' }}>
          {serviceTimes.map((entry, idx) => (
            <div key={entry.product.id + idx} style={{
              display: 'flex', alignItems: 'flex-start', gap: '12px',
              paddingTop: idx === 0 ? 0 : '14px',
              position: 'relative',
            }}>
              <div style={{
                position: 'relative',
                width: '32px', height: '32px', borderRadius: '50%',
                background: '#dbeafe',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0, color: '#2563eb',
              }}>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                  <circle cx="12" cy="7" r="4"/>
                </svg>
                {idx < serviceTimes.length - 1 && (
                  <span style={{
                    position: 'absolute',
                    top: '36px', left: '50%',
                    transform: 'translateX(-50%)',
                    width: '1px', height: '14px',
                    background: '#cbd5e1',
                  }} />
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '15px', fontWeight: '600', color: 'var(--avq-fg, #111827)', lineHeight: 1.35 }}>
                  {entry.product.name}
                </div>
                <div style={{ fontSize: '13px', color: 'var(--avq-muted-fg, #6b7280)', marginTop: '2px', fontVariantNumeric: 'tabular-nums' }}>
                  {formatTime(entry.startsAt, venueInfo.timezone)}
                  {' '}
                  {tzShortLabel(venueInfo.timezone)}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ padding: '0 22px 20px' }}>
          <button
            type="button"
            onClick={() => downloadIcs(booking, venueInfo.name)}
            style={{
              width: '100%', padding: '14px',
              background: '#2563eb', color: '#ffffff',
              border: 0, borderRadius: '12px',
              fontSize: '15px', fontWeight: '600',
              cursor: 'pointer',
              fontFamily: 'inherit',
              marginBottom: '12px',
            }}
          >
            {tx.addCal}
          </button>

          <div style={{ display: 'flex', gap: '8px' }}>
            <ActionButton icon={<ClockIcon />} label={tx.reschedule} onClick={onReschedule} />
            <ActionButton icon={<XCircleIcon />} label={tx.cancel} onClick={onCancel} />
            <ActionButton icon={<RepeatIcon />} label={tx.bookAgain} onClick={onBookAgain} />
          </div>
        </div>
      </Card>

      {/* Card 2 — Próximos pasos */}
      {venueInfo.phone && (
        <Card>
          <div style={{ padding: '20px 22px' }}>
            <h3 style={{
              margin: '0 0 8px', fontSize: '15px', fontWeight: '700',
              color: 'var(--avq-fg, #111827)',
            }}>
              {tx.nextSteps}
            </h3>
            <p style={{
              margin: 0, fontSize: '14px',
              color: 'var(--avq-fg, #111827)', lineHeight: 1.5,
            }}>
              {tx.callBack(venueInfo.phone)}
            </p>
          </div>
        </Card>
      )}

      {/* Card 3 — Pago */}
      {isPayAtVenue && (
        <Card>
          <div style={{ padding: '20px 22px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '8px' }}>
              <h3 style={{
                margin: 0, fontSize: '15px', fontWeight: '700',
                color: 'var(--avq-fg, #111827)',
              }}>
                {tx.payment}
              </h3>
              <span style={{
                fontSize: '12px', fontWeight: '600',
                color: 'var(--avq-muted-fg, #6b7280)',
                background: '#f3f4f6',
                padding: '4px 10px', borderRadius: '999px',
              }}>
                {tx.payAtVenuePill}
              </span>
            </div>
            <p style={{
              margin: 0, fontSize: '14px',
              color: 'var(--avq-fg, #111827)', lineHeight: 1.5,
            }}>
              {tx.payAtVenueBody}
            </p>
            {hasVariablePrice && (
              <p style={{
                margin: '8px 0 0', fontSize: '12px', lineHeight: 1.5,
                color: 'var(--avq-muted-fg, #6b7280)',
              }}>
                {tx.variableNote}
              </p>
            )}
          </div>
        </Card>
      )}

      {/* Card 4 — Política de cancelación */}
      <Card>
        <div style={{ padding: '20px 22px' }}>
          <h3 style={{
            margin: '0 0 8px', fontSize: '15px', fontWeight: '700',
            color: 'var(--avq-fg, #111827)',
          }}>
            {tx.policyTitle}
          </h3>
          <p style={{
            margin: '0 0 8px', fontSize: '14px',
            color: 'var(--avq-fg, #111827)', lineHeight: 1.5,
          }}>
            {tx.policyBody}
          </p>
          <a
            href="#"
            onClick={e => e.preventDefault()}
            style={{
              fontSize: '14px', color: '#2563eb', fontWeight: '500',
              textDecoration: 'none',
            }}
          >
            {tx.readPolicy}
          </a>
        </div>
      </Card>
    </div>
  )
}

function formatTime(date: Date, timezone: string): string {
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timezone,
  })
}

function tzShortLabel(timezone: string): string {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'shortOffset' })
    const parts = fmt.formatToParts(new Date())
    return parts.find(p => p.type === 'timeZoneName')?.value ?? ''
  } catch {
    return ''
  }
}

function Card({ children }: { children: any }) {
  return (
    <section style={{
      border: '1px solid var(--avq-border, #e8eaed)',
      borderRadius: '14px',
      background: 'var(--avq-bg, #ffffff)',
      overflow: 'hidden',
    }}>
      {children}
    </section>
  )
}

function ActionButton({ icon, label, onClick }: { icon: any; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', gap: '4px',
        padding: '12px 8px',
        background: '#f3f4f6',
        color: 'var(--avq-fg, #111827)',
        border: 0, borderRadius: '12px',
        fontSize: '12px', fontWeight: '500',
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}

function ClockIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
    </svg>
  )
}
function XCircleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
    </svg>
  )
}
function RepeatIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="17 1 21 5 17 9"/>
      <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
      <polyline points="7 23 3 19 7 15"/>
      <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
    </svg>
  )
}
