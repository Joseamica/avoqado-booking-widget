import { h } from 'preact'
import { useMemo, useState } from 'preact/hooks'
import type { PublicClassSessionSlot } from '../types'
import type { TFunction } from '../i18n'
import { InstructorAvatar } from './InstructorAvatar'

interface CalendarViewProps {
  /** Same slots the ClassSessionList consumes — already sorted by startsAt server-side. */
  slots: PublicClassSessionSlot[]
  /** Venue timezone — controls day-bucket assignment + HH:MM display. */
  timezone: string
  /** Forwarded to the parent when a session block is tapped. */
  onSelect: (slot: PublicClassSessionSlot) => void
  /** Reference "now" for testability. Defaults to Date.now() at render time. */
  nowMs?: number
  t: TFunction
}

const DAY_NAMES_ES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const DAY_NAMES_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Build the week starting Sunday containing the date. Returns array of YYYY-MM-DD strings. */
function buildWeek(centerDateStr: string, timezone: string): string[] {
  const center = new Date(`${centerDateStr}T12:00:00Z`)
  // Compute the day-of-week in venue tz to find Sunday offset.
  const dowName = center.toLocaleDateString('en-US', { weekday: 'short', timeZone: timezone })
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  const dow = dowMap[dowName] ?? 0
  const days: string[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(center)
    d.setUTCDate(d.getUTCDate() + (i - dow))
    days.push(d.toLocaleDateString('en-CA', { timeZone: timezone }))
  }
  return days
}

/** Convert ISO startsAt to a YYYY-MM-DD bucket key in the venue tz. */
function isoToVenueDate(iso: string, timezone: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: timezone })
}

function formatTimeOfDay(iso: string, timezone: string, locale: 'en' | 'es'): string {
  const d = new Date(iso)
  return d.toLocaleTimeString(locale === 'es' ? 'es-MX' : 'en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: locale === 'en',
    timeZone: timezone,
  })
}

/* Variant palette removed — Square's class calendar uses a single neutral
 * surface throughout. Capacity tier (full / low / open) is signaled via a
 * small dot in the card corner instead of bg color shifting. */

export function CalendarView({ slots, timezone, onSelect, nowMs, t }: CalendarViewProps) {
  const now = nowMs ?? Date.now()
  const locale: 'en' | 'es' = (t('classList.today') === 'Today' ? 'en' : 'es')
  const dayNames = locale === 'es' ? DAY_NAMES_ES : DAY_NAMES_EN
  const todayKey = new Date(now).toLocaleDateString('en-CA', { timeZone: timezone })

  // Track the "anchor" date the customer is viewing. Defaults to today; arrows
  // shift by 7 days. We don't refetch slots when shifting — slots come from the
  // parent's range fetch, which already covers ~30 days ahead. So this is purely
  // a viewport shift over the same data.
  const [anchorDate, setAnchorDate] = useState<string>(todayKey)
  const week = useMemo(() => buildWeek(anchorDate, timezone), [anchorDate, timezone])

  // Group slots by venue-local date once; cheap because slots are pre-sorted.
  const byDate = useMemo(() => {
    const map = new Map<string, PublicClassSessionSlot[]>()
    for (const s of slots) {
      const k = isoToVenueDate(s.startsAt, timezone)
      const bucket = map.get(k)
      if (bucket) bucket.push(s)
      else map.set(k, [s])
    }
    return map
  }, [slots, timezone])

  // Mobile: which day is "selected" for the day-list view. Defaults to today
  // if today is in the visible week; otherwise the first day of the week.
  const [selectedDay, setSelectedDay] = useState<string>(() => {
    return week.includes(todayKey) ? todayKey : week[0]
  })

  function shiftWeek(direction: -1 | 1) {
    const center = new Date(`${anchorDate}T12:00:00Z`)
    center.setUTCDate(center.getUTCDate() + direction * 7)
    const nextAnchor = center.toLocaleDateString('en-CA', { timeZone: timezone })
    setAnchorDate(nextAnchor)
    // If today is in the new week, prefer it; else first day.
    const newWeek = buildWeek(nextAnchor, timezone)
    setSelectedDay(newWeek.includes(todayKey) ? todayKey : newWeek[0])
  }

  // Month label from the first day of the visible week
  const monthLabel = useMemo(() => {
    const d = new Date(`${week[0]}T12:00:00Z`)
    const ml = d.toLocaleDateString(locale === 'es' ? 'es-MX' : 'en-US', { month: 'long', year: 'numeric', timeZone: timezone })
    return ml.charAt(0).toUpperCase() + ml.slice(1)
  }, [week, timezone, locale])

  return (
    <div class="avq-animate-in">
      {/* Month + week shifters — Square style: month label centered between
       * two minimal chevron buttons, no extra borders, no chunky pills. */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', gap: '8px' }}>
        <button
          type="button"
          onClick={() => shiftWeek(-1)}
          aria-label={t('actions.goBack')}
          style={navBtnStyle()}
        >
          <ChevronIcon dir="left" />
        </button>
        <div style={{
          fontSize: '17px',
          fontWeight: '700',
          color: 'var(--avq-fg, #111827)',
          letterSpacing: '-0.01em',
        }}>
          {monthLabel}
        </div>
        <button
          type="button"
          onClick={() => shiftWeek(1)}
          aria-label={t('classList.loadMore')}
          style={navBtnStyle()}
        >
          <ChevronIcon dir="right" />
        </button>
      </div>

      {/* DESKTOP: 7-col week grid. Scroll horizontally if container is too narrow
          to fit 7 × ~130px columns (e.g. when calendar opens inside the 560px
          shell on a screen that hasn't gotten the wider class-flow layout yet). */}
      <div class="avq-week-desktop" style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(7, minmax(130px, 1fr))',
        gap: '10px',
        overflowX: 'auto',
        WebkitOverflowScrolling: 'touch',
        paddingBottom: '8px',
      }}>
        {week.map((dayKey, idx) => {
          const isToday = dayKey === todayKey
          const daySlots = byDate.get(dayKey) ?? []
          const dayDate = new Date(`${dayKey}T12:00:00Z`).toLocaleDateString(locale === 'es' ? 'es-MX' : 'en-US', { day: 'numeric', timeZone: timezone })
          return (
            <div key={dayKey} style={{ display: 'flex', flexDirection: 'column', gap: '10px', minWidth: 0 }}>
              <div style={{
                padding: '0 2px 12px',
                borderBottom: '1px solid var(--avq-border, #f1f3f5)',
                textAlign: 'left',
              }}>
                <div style={{
                  fontSize: '12px', fontWeight: '500',
                  color: 'var(--avq-muted-fg, #6b7280)',
                  textTransform: 'capitalize',
                }}>
                  {isToday ? (locale === 'es' ? 'Hoy' : 'Today') : dayNames[idx]}
                </div>
                <div style={{
                  marginTop: '4px',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  minWidth: '34px', height: '34px',
                  borderRadius: isToday ? '50%' : 0,
                  background: isToday ? 'var(--avq-accent, #2563eb)' : 'transparent',
                  color: isToday ? '#ffffff' : 'var(--avq-fg, #111827)',
                  fontSize: '20px', fontWeight: '700',
                  letterSpacing: '-0.02em',
                  lineHeight: 1,
                }}>{dayDate}</div>
              </div>

              {daySlots.length === 0 ? (
                <div style={{ padding: '20px 8px', textAlign: 'center', fontSize: '11px', color: 'var(--avq-muted-fg, #cbd1d8)' }}>—</div>
              ) : daySlots.map(s => <SessionBlock key={s.classSessionId ?? s.startsAt} slot={s} timezone={timezone} locale={locale} t={t} onSelect={onSelect} />)}
            </div>
          )
        })}
      </div>

      {/* MOBILE: date strip + day list */}
      <div class="avq-week-mobile" style={{ display: 'none' }}>
        <div
          style={{
            margin: '0 -16px 16px',
            position: 'sticky',
            top: '64px',
            background: 'var(--avq-bg, #ffffff)',
            zIndex: 5,
            padding: '8px 0',
            borderBottom: '1px solid var(--avq-border, #e8eaed)',
          }}
        >
          <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', padding: '0 16px 4px', WebkitOverflowScrolling: 'touch' }}>
            {week.map((dayKey, idx) => {
              const isActive = dayKey === selectedDay
              const isToday = dayKey === todayKey
              const hasClasses = (byDate.get(dayKey)?.length ?? 0) > 0
              const dayDate = new Date(`${dayKey}T12:00:00Z`).toLocaleDateString(locale === 'es' ? 'es-MX' : 'en-US', { day: 'numeric', timeZone: timezone })
              return (
                <button
                  type="button"
                  key={dayKey}
                  onClick={() => setSelectedDay(dayKey)}
                  style={{
                    flexShrink: 0,
                    minWidth: '56px',
                    padding: '10px 8px',
                    borderRadius: '12px',
                    background: isActive ? 'var(--avq-fg, #111827)' : 'var(--avq-bg, #ffffff)',
                    border: '1px solid ' + (isActive ? 'var(--avq-fg, #111827)' : 'var(--avq-border, #e8eaed)'),
                    color: isActive ? '#ffffff' : 'var(--avq-fg, #111827)',
                    cursor: 'pointer',
                    textAlign: 'center',
                    position: 'relative',
                  }}
                >
                  <div style={{
                    fontSize: '10px', fontWeight: '600', letterSpacing: '0.5px', textTransform: 'uppercase',
                    color: isActive ? 'rgba(255,255,255,0.75)' : 'var(--avq-muted-fg, #6b7280)',
                  }}>{isToday ? (locale === 'es' ? 'Hoy' : 'Today') : dayNames[idx]}</div>
                  <div style={{ fontSize: '17px', fontWeight: '700', marginTop: '4px' }}>{dayDate}</div>
                  {hasClasses && (
                    <span style={{
                      position: 'absolute', bottom: '4px', left: '50%', transform: 'translateX(-50%)',
                      width: '4px', height: '4px', borderRadius: '50%',
                      background: isActive ? '#ffffff' : 'var(--avq-accent, #6366f1)',
                    }} />
                  )}
                </button>
              )
            })}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {(byDate.get(selectedDay) ?? []).length === 0 ? (
            <div style={{ padding: '32px 8px', textAlign: 'center', fontSize: '13px', color: 'var(--avq-muted-fg, #9ca3af)' }}>
              {t('classList.empty')}
            </div>
          ) : (
            (byDate.get(selectedDay) ?? []).map(s => <SessionRow key={s.classSessionId ?? s.startsAt} slot={s} timezone={timezone} locale={locale} t={t} onSelect={onSelect} />)
          )}
        </div>
      </div>

      <style>{`
        @media (max-width: 700px) {
          .avq-week-desktop { display: none !important; }
          .avq-week-mobile { display: block !important; }
        }
      `}</style>
    </div>
  )
}

// ─── Subcomponents ────────────────────────────────────────────────────

function SessionBlock({
  slot,
  timezone,
  locale,
  t,
  onSelect,
}: {
  slot: PublicClassSessionSlot
  timezone: string
  locale: 'en' | 'es'
  t: TFunction
  onSelect: (s: PublicClassSessionSlot) => void
}) {
  const isFull = !slot.available || (slot.remaining ?? 0) === 0
  const remaining = slot.remaining ?? 0
  const lowStock = !isFull && remaining > 0 && remaining <= 3
  // Capacity dot — single visual cue instead of full-width colored card.
  // Open (green) → low (amber) → full (red). Subtle, top-right of the block.
  const dotColor = isFull ? '#ef4444' : lowStock ? '#f59e0b' : '#10b981'
  const instructorName = slot.instructor
    ? `${slot.instructor.firstName} ${slot.instructor.lastName}`.trim()
    : null

  return (
    <button
      type="button"
      onClick={() => { if (!isFull) onSelect(slot) }}
      disabled={isFull}
      style={{
        position: 'relative',
        textAlign: 'left',
        padding: '10px 12px',
        background: 'var(--avq-bg, #ffffff)',
        border: '1px solid var(--avq-border, #e8eaed)',
        borderRadius: '10px',
        cursor: isFull ? 'not-allowed' : 'pointer',
        opacity: isFull ? 0.5 : 1,
        transition: 'background 0.15s ease, border-color 0.15s ease',
      }}
      onMouseEnter={e => {
        if (!isFull) {
          (e.currentTarget as HTMLButtonElement).style.background = 'var(--avq-muted, #f8f9fb)'
          ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--avq-fg, #111827)'
        }
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLButtonElement).style.background = 'var(--avq-bg, #ffffff)'
        ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--avq-border, #e8eaed)'
      }}
    >
      {/* Capacity dot top-right */}
      <span
        aria-hidden="true"
        title={isFull ? t('classList.fullClass') : t('classList.spotsLeftBadge', { count: remaining })}
        style={{
          position: 'absolute', top: '8px', right: '8px',
          width: '6px', height: '6px', borderRadius: '50%',
          background: dotColor,
        }}
      />
      <div style={{
        fontSize: '12px', fontWeight: '700',
        color: 'var(--avq-fg, #111827)',
        fontVariantNumeric: 'tabular-nums',
        paddingRight: '12px',
      }}>
        {formatTimeOfDay(slot.startsAt, timezone, locale)}
      </div>
      <div style={{
        fontSize: '13px', fontWeight: '600',
        color: 'var(--avq-fg, #111827)',
        marginTop: '4px', lineHeight: 1.3,
        overflow: 'hidden', textOverflow: 'ellipsis',
        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any,
      }}>
        {slot.productName}
      </div>
      {instructorName && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '5px',
          marginTop: '6px',
          fontSize: '11px', color: 'var(--avq-muted-fg, #6b7280)',
        }}>
          <InstructorAvatar instructor={slot.instructor} size={16} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {instructorName}
          </span>
        </div>
      )}
    </button>
  )
}

function SessionRow({
  slot,
  timezone,
  locale,
  t,
  onSelect,
}: {
  slot: PublicClassSessionSlot
  timezone: string
  locale: 'en' | 'es'
  t: TFunction
  onSelect: (s: PublicClassSessionSlot) => void
}) {
  const isFull = !slot.available || (slot.remaining ?? 0) === 0
  const remaining = slot.remaining ?? 0
  return (
    <button
      type="button"
      onClick={() => { if (!isFull) onSelect(slot) }}
      disabled={isFull}
      style={{
        display: 'grid',
        gridTemplateColumns: '56px 1fr auto',
        gap: '12px',
        alignItems: 'center',
        padding: '12px 14px',
        borderRadius: '12px',
        background: 'var(--avq-bg, #ffffff)',
        border: '1px solid var(--avq-border, #e8eaed)',
        cursor: isFull ? 'not-allowed' : 'pointer',
        opacity: isFull ? 0.55 : 1,
        textAlign: 'left',
        width: '100%',
      }}
    >
      <div style={{ fontSize: '14px', fontWeight: '700', color: 'var(--avq-fg, #111827)', fontVariantNumeric: 'tabular-nums' }}>
        {formatTimeOfDay(slot.startsAt, timezone, locale)}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: '14px', fontWeight: '600', color: 'var(--avq-fg, #111827)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {slot.productName}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '3px', fontSize: '11px', color: 'var(--avq-muted-fg, #6b7280)' }}>
          <InstructorAvatar instructor={slot.instructor} size={18} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {slot.instructor ? `${slot.instructor.firstName} ${slot.instructor.lastName}`.trim() : t('classList.noInstructor')}
          </span>
        </div>
      </div>
      <span style={{
        padding: '4px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: '600', whiteSpace: 'nowrap',
        background: isFull ? '#fee2e2' : '#dcfce7',
        color: isFull ? '#b91c1c' : '#166534',
      }}>
        {isFull ? t('classList.fullClass') : t('classList.spotsLeftBadge', { count: remaining })}
      </span>
    </button>
  )
}

function navBtnStyle(): h.JSX.CSSProperties {
  return {
    width: '36px',
    height: '36px',
    borderRadius: '50%',
    border: '1px solid var(--avq-border, #e8eaed)',
    background: 'var(--avq-bg, #ffffff)',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--avq-fg, #111827)',
  }
}

function ChevronIcon({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {dir === 'left' ? <polyline points="15 18 9 12 15 6" /> : <polyline points="9 18 15 12 9 6" />}
    </svg>
  )
}
