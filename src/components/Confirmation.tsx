import { h } from 'preact'
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
  const startDate = new Date(booking.startsAt)
  const endDate = new Date(booking.endsAt)
  const dateStr = startDate.toLocaleDateString(undefined, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: venueInfo.timezone,
  })
  const timeStr = `${startDate.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', timeZone: venueInfo.timezone })} - ${endDate.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', timeZone: venueInfo.timezone })}`

  return (
    <div class="space-y-6 text-center">
      <div class="flex justify-center">
        <div class="flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 text-green-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        </div>
      </div>

      <h2 class="text-xl font-semibold text-[var(--avq-fg,#111827)]">{t('confirmation.title')}</h2>

      {/* Confirmation code */}
      <div class="rounded-xl bg-[var(--avq-muted,#f3f4f6)] p-4">
        <p class="text-sm text-[var(--avq-muted-fg,#6b7280)]">{t('confirmation.code')}</p>
        <p class="mt-1 text-3xl font-bold tracking-wider text-[var(--avq-fg,#111827)]">{booking.confirmationCode}</p>
      </div>

      {/* Date & time */}
      <div class="text-left border-b border-[var(--avq-border,#e5e7eb)] py-3">
        <div class="flex justify-between">
          <span class="text-[var(--avq-muted-fg,#6b7280)]">{t('confirmation.dateTime')}</span>
          <span class="text-right font-medium text-[var(--avq-fg,#111827)]">
            {dateStr}<br />{timeStr}
          </span>
        </div>
      </div>

      {/* Calendar actions */}
      <div class="flex gap-3">
        <button
          type="button"
          onClick={() => window.open(buildGoogleCalendarUrl(booking, venueInfo.name), '_blank')}
          class="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-[var(--avq-border,#e5e7eb)] text-sm text-[var(--avq-fg,#111827)] hover:border-[var(--avq-accent,#6366f1)] hover:text-[var(--avq-accent,#6366f1)] transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          {t('confirmation.addToCalendar')}
        </button>
        <button
          type="button"
          onClick={() => downloadIcs(booking, venueInfo.name)}
          class="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-[var(--avq-border,#e5e7eb)] text-sm text-[var(--avq-fg,#111827)] hover:border-[var(--avq-accent,#6366f1)] hover:text-[var(--avq-accent,#6366f1)] transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          {t('confirmation.downloadIcs')}
        </button>
      </div>

      <button
        type="button"
        onClick={onManageBooking}
        class="h-11 w-full rounded-lg bg-[var(--avq-muted,#f3f4f6)] text-sm font-medium text-[var(--avq-fg,#111827)] hover:bg-[var(--avq-muted-hover,#e5e7eb)] transition-colors"
      >
        {t('confirmation.manageBooking')}
      </button>

      <button
        type="button"
        onClick={onNewBooking}
        class="h-11 w-full rounded-lg text-sm font-medium text-[var(--avq-muted-fg,#6b7280)] hover:text-[var(--avq-fg,#111827)] transition-colors"
      >
        {t('confirmation.newBooking')}
      </button>
    </div>
  )
}
