import { h } from 'preact'
import { useEffect, useMemo, useState } from 'preact/hooks'
import type { PublicClassSessionSlot } from '../types'
import type { TFunction } from '../i18n'
import * as api from '../api/booking'
import { Spinner } from './ui/Spinner'
import { CapacityBadge } from './CapacityBadge'
import { CalendarView } from './CalendarView'
import { InstructorAvatar } from './InstructorAvatar'

const VIEW_STORAGE_KEY = 'avq_classes_view'
type ClassesView = 'list' | 'calendar'

function getStoredView(): ClassesView {
  if (typeof window === 'undefined') return 'list'
  try {
    const v = localStorage.getItem(VIEW_STORAGE_KEY)
    return v === 'calendar' ? 'calendar' : 'list'
  } catch { return 'list' }
}
function setStoredView(v: ClassesView) {
  try { localStorage.setItem(VIEW_STORAGE_KEY, v) } catch { /* */ }
}

interface ClassSessionListProps {
  /** Venue slug — required to fetch the range. */
  venueSlug: string
  /** Venue timezone — used to label days in customer's expected zone. */
  timezone: string
  /** Called when the customer taps a session to book. */
  onSelect: (slot: PublicClassSessionSlot) => void
  /** Called when the customer wants to leave the class listing (e.g. on error). */
  onExit?: () => void
  /** Optional venue phone — surfaced as "Contactar al estudio" in the empty state. */
  venuePhone?: string | null
  /** Optional handler — when provided, the empty state shows a "Comprar paquete" CTA. */
  onBuyPack?: () => void
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
export function ClassSessionList({ venueSlug, timezone, onSelect, onExit, venuePhone, onBuyPack, t }: ClassSessionListProps) {
  const [slots, setSlots] = useState<PublicClassSessionSlot[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [windowDays, setWindowDays] = useState(INITIAL_DAYS)
  const [refetchKey, setRefetchKey] = useState(0)
  const [view, setView] = useState<ClassesView>(getStoredView)
  function pickView(v: ClassesView) { setView(v); setStoredView(v) }

  // Filter state — per-chip dropdown selection. Empty = "all".
  const [classFilter, setClassFilter] = useState<string>('')
  const [instructorFilter, setInstructorFilter] = useState<string>('')
  const [openChip, setOpenChip] = useState<null | 'class' | 'instructor' | 'rooms'>(null)

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

  // Available filter options — derived from the slots themselves so the
  // dropdowns only show what actually exists this week.
  const classOptions = useMemo(() => {
    return Array.from(new Set(slots.map(s => s.productName).filter((v): v is string => Boolean(v)))).sort()
  }, [slots])
  const instructorOptions = useMemo(() => {
    const names = slots
      .map(s => s.instructor ? `${s.instructor.firstName} ${s.instructor.lastName}`.trim() : null)
      .filter((v): v is string => Boolean(v))
    return Array.from(new Set(names)).sort()
  }, [slots])

  // Apply filters to the slot list before grouping. Empty filter = no constraint.
  const filteredSlots = useMemo(() => {
    return slots.filter(s => {
      if (classFilter && s.productName !== classFilter) return false
      if (instructorFilter) {
        const name = s.instructor ? `${s.instructor.firstName} ${s.instructor.lastName}`.trim() : ''
        if (name !== instructorFilter) return false
      }
      return true
    })
  }, [slots, classFilter, instructorFilter])

  // Group filtered slots by venue-local date. Server already sorts by startsAt,
  // so the groups + each group's items are pre-ordered.
  const groupedByDate = useMemo(() => {
    const map = new Map<string, PublicClassSessionSlot[]>()
    for (const slot of filteredSlots) {
      const dateKey = isoToVenueDate(slot.startsAt, timezone)
      const bucket = map.get(dateKey)
      if (bucket) bucket.push(slot)
      else map.set(dateKey, [slot])
    }
    return Array.from(map.entries())
  }, [filteredSlots, timezone])

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
      <div class="avq-animate-in" style={{ padding: '64px 24px', textAlign: 'center', maxWidth: '420px', margin: '0 auto' }}>
        <div style={{
          width: '64px', height: '64px', borderRadius: '50%',
          background: 'var(--avq-muted, #f8f9fb)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 20px',
        }}>
          <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--avq-muted-fg, #6b7280)" stroke-width="1.8">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </div>
        <h2 style={{ fontSize: '17px', fontWeight: '600', color: 'var(--avq-fg, #111827)', margin: '0 0 8px', letterSpacing: '-0.01em' }}>
          {t('classList.emptyTitle')}
        </h2>
        <p style={{ fontSize: '14px', lineHeight: '1.5', color: 'var(--avq-muted-fg, #6b7280)', margin: '0 0 24px' }}>
          {t('classList.emptySubtitle')}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'stretch' }}>
          {onBuyPack && (
            <button
              type="button"
              onClick={onBuyPack}
              style={{
                padding: '12px 20px', borderRadius: '10px',
                background: 'var(--avq-accent, #6366f1)',
                color: '#ffffff', border: 'none', cursor: 'pointer',
                fontSize: '14px', fontWeight: '600',
              }}
            >
              {t('classList.emptyBuyPack')}
            </button>
          )}
          {venuePhone && (
            <a
              href={`tel:${venuePhone}`}
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                padding: '12px 20px', borderRadius: '10px',
                background: 'transparent',
                color: 'var(--avq-fg, #111827)',
                border: '1px solid var(--avq-border, #e8eaed)',
                fontSize: '14px', fontWeight: '500', textDecoration: 'none',
              }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
              {t('classList.emptyContact')}
            </a>
          )}
          {onExit && (
            <button
              type="button"
              onClick={onExit}
              style={{
                marginTop: '4px',
                fontSize: '13px', color: 'var(--avq-muted-fg, #6b7280)', fontWeight: '500',
                background: 'none', border: 'none', cursor: 'pointer',
                padding: '8px',
              }}
            >
              {t('actions.goBack')}
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div class="avq-animate-in">
      {/* Section header — title + display toggle (List / Calendar) */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', marginBottom: '14px', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: '17px', fontWeight: '600', color: 'var(--avq-fg, #111827)', margin: '0 0 4px' }}>
            {t('classList.title')}
          </h2>
          <p style={{ fontSize: '13px', color: 'var(--avq-muted-fg, #6b7280)', margin: 0 }}>
            {t('classList.subtitle')}
          </p>
        </div>
        <div style={{
          display: 'inline-flex', padding: '3px',
          background: 'var(--avq-muted, #f3f4f6)',
          border: '1px solid var(--avq-border, #e8eaed)',
          borderRadius: '999px',
        }}>
          <ToggleBtn active={view === 'list'} onClick={() => pickView('list')} label={t('classList.viewList')}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
          </ToggleBtn>
          <ToggleBtn active={view === 'calendar'} onClick={() => pickView('calendar')} label={t('classList.viewCalendar')}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          </ToggleBtn>
        </div>
      </div>

      {/* Filter chips with dropdowns */}
      <div style={{ margin: '0 -16px 18px', overflowX: 'auto', WebkitOverflowScrolling: 'touch', position: 'relative' }}>
        <div style={{ display: 'flex', gap: '8px', padding: '0 16px 4px' }}>
          <FilterChip
            label={classFilter || t('classList.filterClasses')}
            active={Boolean(classFilter)}
            open={openChip === 'class'}
            onToggle={() => setOpenChip(openChip === 'class' ? null : 'class')}
            options={classOptions}
            allLabel={t('classList.filterClasses')}
            onPick={(v) => { setClassFilter(v); setOpenChip(null) }}
          />
          <FilterChip
            label={instructorFilter || t('classList.filterInstructors')}
            active={Boolean(instructorFilter)}
            open={openChip === 'instructor'}
            onToggle={() => setOpenChip(openChip === 'instructor' ? null : 'instructor')}
            options={instructorOptions}
            allLabel={t('classList.filterInstructors')}
            onPick={(v) => { setInstructorFilter(v); setOpenChip(null) }}
          />
          {/* Rooms filter stays placeholder until Venue.rooms is in the schema */}
          <span
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              padding: '7px 12px', borderRadius: '999px',
              background: 'var(--avq-bg, #ffffff)',
              border: '1px solid var(--avq-border, #e8eaed)',
              fontSize: '12px', fontWeight: '500',
              color: 'var(--avq-muted-fg, #9ca3af)',
              whiteSpace: 'nowrap', flexShrink: 0,
              cursor: 'not-allowed',
            }}
            title="Próximamente"
          >
            {t('classList.filterRooms')}
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
          </span>
        </div>
      </div>

      {view === 'calendar' ? (
        <CalendarView slots={filteredSlots} timezone={timezone} onSelect={onSelect} nowMs={nowMs} t={t} />
      ) : (
      /* Date-grouped list */
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

                    {/* Phase 7: product thumbnail when the venue uploaded one */}
                    {slot.productImageUrl && (
                      <img
                        src={slot.productImageUrl}
                        alt=""
                        style={{
                          width: '44px', height: '44px', borderRadius: '8px', flexShrink: 0,
                          objectFit: 'cover',
                          background: 'var(--avq-muted, #f8f9fb)',
                        }}
                        onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                      />
                    )}

                    {/* Class info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '14px', fontWeight: '600', color: 'var(--avq-fg, #111827)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {slot.productName}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
                        <InstructorAvatar instructor={slot.instructor} size={20} />
                        <span style={{ fontSize: '12px', color: 'var(--avq-muted-fg, #6b7280)' }}>
                          {instructorName
                            ? t('classList.withInstructor', { name: instructorName })
                            : t('classList.noInstructor')}
                        </span>
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
      )}

      {/* Load more — only when not already at the server cap, only on list view */}
      {view === 'list' && !atMaxWindow && (
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

function FilterChip({
  label,
  active,
  open,
  onToggle,
  options,
  allLabel,
  onPick,
}: {
  label: string
  active: boolean
  open: boolean
  onToggle: () => void
  options: string[]
  allLabel: string
  onPick: (value: string) => void
}) {
  return (
    <span style={{ position: 'relative', flexShrink: 0 }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: '6px',
          padding: '7px 12px', borderRadius: '999px',
          background: active ? 'var(--avq-fg, #111827)' : 'var(--avq-bg, #ffffff)',
          border: '1px solid ' + (active ? 'var(--avq-fg, #111827)' : 'var(--avq-border, #e8eaed)'),
          fontSize: '12px', fontWeight: active ? '600' : '500',
          color: active ? '#ffffff' : 'var(--avq-fg, #111827)',
          whiteSpace: 'nowrap', cursor: 'pointer',
        }}
      >
        {label}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div
          role="listbox"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            minWidth: '200px',
            maxHeight: '280px',
            overflowY: 'auto',
            background: 'var(--avq-bg, #ffffff)',
            border: '1px solid var(--avq-border, #e8eaed)',
            borderRadius: '12px',
            boxShadow: '0 8px 24px rgba(15,15,16,0.12)',
            padding: '6px',
            zIndex: 10,
          }}
        >
          <DropdownItem label={allLabel} active={!active} onClick={() => onPick('')} />
          {options.map(o => (
            <DropdownItem key={o} label={o} active={false} onClick={() => onPick(o)} />
          ))}
          {options.length === 0 && (
            <div style={{ padding: '10px 12px', fontSize: '12px', color: 'var(--avq-muted-fg, #9ca3af)' }}>—</div>
          )}
        </div>
      )}
    </span>
  )
}

function DropdownItem({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onClick={onClick}
      style={{
        width: '100%',
        textAlign: 'left',
        padding: '8px 10px',
        background: active ? 'var(--avq-muted, #f8f9fb)' : 'transparent',
        border: 0,
        borderRadius: '8px',
        fontSize: '13px',
        fontWeight: active ? '600' : '500',
        color: 'var(--avq-fg, #111827)',
        cursor: 'pointer',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--avq-muted, #f8f9fb)' }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLButtonElement).style.background = active ? 'var(--avq-muted, #f8f9fb)' : 'transparent'
      }}
    >
      {label}
    </button>
  )
}

function ToggleBtn({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean
  onClick: () => void
  label: string
  children: any
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        border: 0,
        background: active ? 'var(--avq-fg, #111827)' : 'transparent',
        color: active ? '#ffffff' : 'var(--avq-muted-fg, #6b7280)',
        padding: '6px 12px',
        fontSize: '12px',
        fontWeight: '600',
        cursor: 'pointer',
        borderRadius: '999px',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
      }}
    >
      {children}
      {label}
    </button>
  )
}
