import { h } from 'preact'
import { useEffect, useMemo, useState } from 'preact/hooks'
import type { PublicClassSessionSlot } from '../types'
import type { TFunction } from '../i18n'
import * as api from '../api/booking'
import { Spinner } from './ui/Spinner'
import { CapacityBadge } from './CapacityBadge'

interface ClassSessionListProps {
  /** Venue slug — required to fetch the range. */
  venueSlug: string
  /** Venue timezone — used to label days in customer's expected zone. */
  timezone: string
  /** Called when the customer taps a session to book. */
  onSelect: (slot: PublicClassSessionSlot) => void
  /** Called when the customer wants to leave the class listing (e.g. on error). */
  onExit?: () => void
  t: TFunction
}

/** Default lookahead window for the initial fetch. */
const INITIAL_DAYS = 30
/** How many additional days to fetch on each "Load more" click. */
const PAGE_DAYS = 30
/** Hard cap to match the server-side cap (60 days from today). */
const MAX_DAYS = 60

/**
 * Format a YYYY-MM-DD date string against today/tomorrow in the venue's TZ,
 * falling back to a localized weekday + month-day label.
 *
 * Pure: takes the customer's `now` (UTC ms), the date string to format, and
 * the timezone. Avoids hidden Date.now() reads so the component is testable.
 */
export function formatDateHeading(
  dateStr: string,
  nowMs: number,
  timezone: string,
  locale: 'en' | 'es',
  t: TFunction,
): string {
  // Normalize "today" + "tomorrow" in venue tz so the labels match what the
  // customer actually sees on their wall calendar.
  const todayStr = new Date(nowMs).toLocaleDateString('en-CA', { timeZone: timezone })
  const tmr = new Date(nowMs + 24 * 60 * 60 * 1000)
  const tmrStr = tmr.toLocaleDateString('en-CA', { timeZone: timezone })
  if (dateStr === todayStr) return t('classList.today')
  if (dateStr === tmrStr) return t('classList.tomorrow')
  // Mié 7 may
  const d = new Date(`${dateStr}T12:00:00Z`)
  const localeStr = locale === 'es' ? 'es-MX' : 'en-US'
  return d.toLocaleDateString(localeStr, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: timezone,
  }).replace(/^\w/, c => c.toUpperCase())
}

/** Format an HH:MM time stamp from an ISO string in the venue tz. */
function formatTimeOfDay(iso: string, timezone: string, locale: 'en' | 'es'): string {
  const d = new Date(iso)
  const localeStr = locale === 'es' ? 'es-MX' : 'en-US'
  return d.toLocaleTimeString(localeStr, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: locale === 'en',
    timeZone: timezone,
  })
}

/** Convert an ISO startsAt to a YYYY-MM-DD bucket key in the venue tz. */
function isoToVenueDate(iso: string, timezone: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: timezone })
}

/**
 * Date-first list of upcoming class sessions across all CLASS products of a venue.
 * Mirrors the Square Classes booking page — sticky day headers, capacity badges,
 * tap-to-book directly into the form step. Used when flowType=clases.
 */
export function ClassSessionList({ venueSlug, timezone, onSelect, onExit, t }: ClassSessionListProps) {
  const [slots, setSlots] = useState<PublicClassSessionSlot[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [windowDays, setWindowDays] = useState(INITIAL_DAYS)
  const [refetchKey, setRefetchKey] = useState(0)

  // Compute the date range based on the window. Today's date in the venue tz.
  const { dateFrom, dateTo, atMaxWindow } = useMemo(() => {
    const todayVenue = new Date().toLocaleDateString('en-CA', { timeZone: timezone })
    const fromDate = new Date(`${todayVenue}T00:00:00Z`)
    const toDate = new Date(fromDate)
    toDate.setUTCDate(toDate.getUTCDate() + Math.min(windowDays, MAX_DAYS))
    return {
      dateFrom: todayVenue,
      dateTo: toDate.toISOString().slice(0, 10),
      atMaxWindow: windowDays >= MAX_DAYS,
    }
  }, [timezone, windowDays])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    api.getClassSessionsRange(venueSlug, { dateFrom, dateTo })
      .then(res => {
        if (cancelled) return
        setSlots(res.slots)
      })
      .catch(err => {
        if (cancelled) return
        // Show a friendly message but keep the empty state visible.
        setError(err?.data?.message ?? 'Error')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [venueSlug, dateFrom, dateTo, refetchKey])

  // Group slots by venue-local date. Server already sorts by startsAt, so the
  // groups + each group's items are pre-ordered. Map preserves insertion order.
  const groupedByDate = useMemo(() => {
    const map = new Map<string, PublicClassSessionSlot[]>()
    for (const slot of slots) {
      const dateKey = isoToVenueDate(slot.startsAt, timezone)
      const bucket = map.get(dateKey)
      if (bucket) bucket.push(slot)
      else map.set(dateKey, [slot])
    }
    return Array.from(map.entries())
  }, [slots, timezone])

  const nowMs = Date.now()
  const locale: 'en' | 'es' = (t('classList.today') === 'Today' ? 'en' : 'es')

  if (loading && slots.length === 0) {
    return (
      <div style={{ padding: '64px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
        <Spinner size={28} />
        <p style={{ fontSize: '13px', color: 'var(--avq-muted-fg, #9ca3af)' }}>{t('classList.loading')}</p>
      </div>
    )
  }

  if (error && slots.length === 0) {
    return (
      <div class="avq-animate-in" style={{ padding: '48px 0', textAlign: 'center' }}>
        <p style={{ fontSize: '14px', color: 'var(--avq-muted-fg, #6b7280)', marginBottom: '12px' }}>{error}</p>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '20px' }}>
          <button
            type="button"
            onClick={() => setRefetchKey(k => k + 1)}
            style={{
              fontSize: '13px', color: 'var(--avq-accent, #6366f1)',
              background: 'none', border: 'none', cursor: 'pointer',
              textDecoration: 'underline', textUnderlineOffset: '2px',
            }}
          >
            {t('actions.retry')}
          </button>
          {onExit && (
            <button
              type="button"
              onClick={onExit}
              style={{
                fontSize: '13px', color: 'var(--avq-muted-fg, #6b7280)',
                background: 'none', border: 'none', cursor: 'pointer',
                textDecoration: 'underline', textUnderlineOffset: '2px',
              }}
            >
              {t('actions.goBack')}
            </button>
          )}
        </div>
      </div>
    )
  }

  if (slots.length === 0) {
    return (
      <div class="avq-animate-in" style={{ padding: '48px 24px', textAlign: 'center' }}>
        <div style={{
          width: '48px', height: '48px', borderRadius: '50%',
          background: 'var(--avq-muted, #f8f9fb)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 16px',
        }}>
          <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--avq-muted-fg, #6b7280)" stroke-width="2">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </div>
        <p style={{ fontSize: '14px', color: 'var(--avq-muted-fg, #6b7280)' }}>{t('classList.empty')}</p>
      </div>
    )
  }

  return (
    <div class="avq-animate-in">
      {/* Section title */}
      <div style={{ marginBottom: '20px' }}>
        <h2 style={{ fontSize: '17px', fontWeight: '600', color: 'var(--avq-fg, #111827)', margin: '0 0 4px' }}>
          {t('classList.title')}
        </h2>
        <p style={{ fontSize: '13px', color: 'var(--avq-muted-fg, #6b7280)', margin: 0 }}>
          {t('classList.subtitle')}
        </p>
      </div>

      {/* Date-grouped list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {groupedByDate.map(([dateKey, daySlots]) => (
          <div key={dateKey}>
            {/* Sticky header — uses position: sticky inside the scroll container */}
            <div style={{
              position: 'sticky',
              top: 0,
              background: 'var(--avq-bg, #ffffff)',
              padding: '6px 0',
              marginBottom: '8px',
              fontSize: '11px',
              fontWeight: '700',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--avq-muted-fg, #6b7280)',
              zIndex: 1,
            }}>
              {formatDateHeading(dateKey, nowMs, timezone, locale, t)}
            </div>

            {/* Sessions for that day */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {daySlots.map(slot => {
                const isFull = !slot.available || (slot.remaining ?? 0) === 0
                const instructorName = slot.instructor
                  ? `${slot.instructor.firstName} ${slot.instructor.lastName}`.trim()
                  : null
                const onClick = () => { if (!isFull) onSelect(slot) }
                return (
                  <button
                    key={slot.classSessionId ?? slot.startsAt}
                    type="button"
                    onClick={onClick}
                    disabled={isFull}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '14px',
                      padding: '14px',
                      borderRadius: '12px',
                      border: '1px solid var(--avq-border, #e8eaed)',
                      background: 'var(--avq-bg, #ffffff)',
                      cursor: isFull ? 'not-allowed' : 'pointer',
                      opacity: isFull ? 0.55 : 1,
                      textAlign: 'left',
                      width: '100%',
                      transition: 'border-color 0.15s ease, transform 0.15s ease',
                    }}
                    onMouseEnter={e => {
                      if (!isFull) (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--avq-accent, #6366f1)'
                    }}
                    onMouseLeave={e => {
                      if (!isFull) (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--avq-border, #e8eaed)'
                    }}
                  >
                    {/* Time block */}
                    <div style={{
                      flexShrink: 0,
                      width: '64px',
                      textAlign: 'center',
                      padding: '6px 4px',
                      borderRadius: '8px',
                      background: 'var(--avq-muted, #f8f9fb)',
                    }}>
                      <div style={{ fontSize: '14px', fontWeight: '700', color: 'var(--avq-fg, #111827)', lineHeight: 1.1 }}>
                        {formatTimeOfDay(slot.startsAt, timezone, locale)}
                      </div>
                    </div>

                    {/* Class info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '14px', fontWeight: '600', color: 'var(--avq-fg, #111827)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {slot.productName}
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--avq-muted-fg, #6b7280)', marginTop: '2px' }}>
                        {instructorName
                          ? t('classList.withInstructor', { name: instructorName })
                          : t('classList.noInstructor')}
                      </div>
                    </div>

                    {/* Capacity badge — uniform across the widget via CapacityBadge */}
                    <div style={{ flexShrink: 0 }}>
                      <CapacityBadge
                        capacity={slot.capacity}
                        enrolled={slot.enrolled}
                        size="sm"
                        t={t}
                      />
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Load more — only when not already at the server cap */}
      {!atMaxWindow && (
        <button
          type="button"
          onClick={() => setWindowDays(w => Math.min(w + PAGE_DAYS, MAX_DAYS))}
          disabled={loading}
          style={{
            width: '100%',
            marginTop: '20px',
            padding: '11px',
            borderRadius: '12px',
            border: '1px solid var(--avq-border, #e8eaed)',
            background: 'transparent',
            fontSize: '13px',
            fontWeight: '500',
            color: 'var(--avq-muted-fg, #6b7280)',
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.6 : 1,
            transition: 'background 0.15s ease, border-color 0.15s ease',
          }}
        >
          {loading ? t('classList.loading') : t('classList.loadMore')}
        </button>
      )}
    </div>
  )
}
