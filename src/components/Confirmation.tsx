import { h } from 'preact'
import { useState } from 'preact/hooks'
import type { PublicBookingResult, PublicVenueInfo } from '../types'
import type { TFunction } from '../i18n'

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
  const dateStr = startDate.toLocaleDateString(undefined, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: venueInfo.timezone,
  })
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
        <div style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          padding: '10px 14px', borderRadius: '10px',
          background: 'color-mix(in srgb, #22c55e 8%, var(--avq-bg, #ffffff))',
          border: '1px solid color-mix(in srgb, #22c55e 20%, transparent)',
          marginBottom: '16px',
        }}>
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
            <polyline points="22 4 12 14.01 9 11.01"/>
          </svg>
          <span style={{ fontSize: '13px', fontWeight: '500', color: '#15803d' }}>
            {t('creditPacks.creditUsed')} — {t('creditPacks.noCreditNeeded')}
          </span>
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
          <p style={{ margin: 0, fontSize: '14px', fontWeight: '500', color: 'var(--avq-fg, #111827)', textTransform: 'capitalize' }}>{dateStr}</p>
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
            borderRadius: '12px', border: '1px solid var(--avq-border, #e8eaed)',
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
            borderRadius: '12px', border: '1px solid var(--avq-border, #e8eaed)',
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
          width: '100%', height: '44px', borderRadius: '12px',
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
