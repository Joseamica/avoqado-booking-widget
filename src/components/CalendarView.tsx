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

/**
 * Pick a color variant for a session block based on the underlying product.
 * Mirrors the v2-classes-calendar.html mockup palette so the live widget
 * matches the design exploration. Pure heuristic — no schema field for "tier"
 * yet, so we infer from price + creditCost + productName until we add a
 * `Product.colorTag` later.
 */
function variantFor(slot: PublicClassSessionSlot): 'normal' | 'free' | 'premium' | 'at-venue' {
  const name = (slot.productName ?? '').toLowerCase()
  if (name.includes('gratis') || name.includes('free') || name.includes('demo')) return 'free'
  if (name.includes('premium') || name.includes('workshop') || name.includes('lagree')) {
    // 'premium' = pink, 'at-venue' = orange. Disambiguate by trying name keywords.
    if (name.includes('lagree')) return 'premium'
    return 'premium'
  }
  if (name.includes('pilates') || name.includes('al llegar') || name.includes('at venue')) return 'at-venue'
  return 'normal'
}

const VARIANT_STYLES: Record<string, { bg: string; border: string; time: string }> = {
  normal: { bg: 'var(--avq-accent-soft, #eef2ff)', border: '#c7d2fe', time: 'var(--avq-accent-text, #4338ca)' },
  free: { bg: '#ecfdf5', border: '#6ee7b7', time: '#047857' },
  premium: { bg: '#fdf2f8', border: '#f9a8d4', time: '#9d174d' },
  'at-venue': { bg: '#fff7ed', border: '#fdba74', time: '#9a3412' },
}

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
      {/* Month + week shifters */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', gap: '8px' }}>
        <div style={{ fontSize: '15px', fontWeight: '600', color: 'var(--avq-fg, #111827)' }}>{monthLabel}</div>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button
            type="button"
            onClick={() => shiftWeek(-1)}
            aria-label={t('actions.goBack')}
            style={navBtnStyle()}
          >
            <ChevronIcon dir="left" />
          </button>
          <button
            type="button"
            onClick={() => shiftWeek(1)}
            aria-label={t('classList.loadMore')}
            style={navBtnStyle()}
          >
            <ChevronIcon dir="right" />
          </button>
        </div>
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
            <div key={dayKey} style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 }}>
              <div style={{
                padding: '8px 4px 10px',
                borderBottom: '1px solid var(--avq-border, #e8eaed)',
              }}>
                <div style={{
                  fontSize: '10px', fontWeight: '700', letterSpacing: '0.06em', textTransform: 'uppercase',
                  color: isToday ? 'var(--avq-accent-text, #4338ca)' : 'var(--avq-muted-fg, #6b7280)',
                }}>{isToday ? (locale === 'es' ? 'Hoy · ' : 'Today · ') : ''}{dayNames[idx]}</div>
                <div style={{
                  fontSize: '17px', fontWeight: '700',
                  color: isToday ? 'var(--avq-accent-text, #4338ca)' : 'var(--avq-fg, #111827)',
                  marginTop: '4px', lineHeight: 1,
                }}>{dayDate}</div>
              </div>

              {daySlots.length === 0 ? (
                <div style={{ padding: '20px 8px', textAlign: 'center', fontSize: '11px', color: 'var(--avq-muted-fg, #9ca3af)' }}>—</div>
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
  const variant = variantFor(slot)
  const styles = VARIANT_STYLES[variant]
  const isFull = !slot.available || (slot.remaining ?? 0) === 0
  const remaining = slot.remaining ?? 0
  const lowStock = !isFull && remaining > 0 && remaining <= 3
  const badgeStyle: h.JSX.CSSProperties = isFull
    ? { background: '#fee2e2', color: '#b91c1c' }
    : lowStock
      ? { background: '#fef3c7', color: '#92400e' }
      : { background: '#dcfce7', color: '#166534' }

  return (
    <button
      type="button"
      onClick={() => { if (!isFull) onSelect(slot) }}
      disabled={isFull}
      style={{
        textAlign: 'left',
        padding: '10px 12px',
        background: styles.bg,
        border: `1px solid ${styles.border}`,
        borderRadius: '10px',
        cursor: isFull ? 'not-allowed' : 'pointer',
        opacity: isFull ? 0.55 : 1,
        transition: 'transform 0.12s, box-shadow 0.12s',
      }}
      onMouseEnter={e => {
        if (!isFull) {
          (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)'
          ;(e.currentTarget as HTMLButtonElement).style.boxShadow = '0 6px 16px rgba(99,102,241,0.18)'
        }
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)'
        ;(e.currentTarget as HTMLButtonElement).style.boxShadow = 'none'
      }}
    >
      <div style={{ fontSize: '11px', fontWeight: '700', color: styles.time, fontVariantNumeric: 'tabular-nums' }}>
        {formatTimeOfDay(slot.startsAt, timezone, locale)}
      </div>
      <div style={{ fontSize: '12px', fontWeight: '600', color: '#111827', marginTop: '3px', lineHeight: 1.25 }}>
        {slot.productName}
      </div>
      {slot.instructor && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '4px', fontSize: '10px', color: '#6b7280' }}>
          <InstructorAvatar instructor={slot.instructor} size={16} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {`${slot.instructor.firstName} ${slot.instructor.lastName}`.trim()}
          </span>
        </div>
      )}
      <span style={{
        display: 'inline-block', marginTop: '6px',
        padding: '2px 7px', borderRadius: '999px',
        fontSize: '9px', fontWeight: '700', letterSpacing: '0.3px',
        ...badgeStyle,
      }}>
        {isFull ? t('classList.fullClass') : t('classList.spotsLeftBadge', { count: remaining })}
      </span>
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
    width: '32px',
    height: '32px',
    borderRadius: '8px',
    border: '1px solid var(--avq-border, #e8eaed)',
    background: 'var(--avq-bg, #ffffff)',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--avq-muted-fg, #6b7280)',
  }
}

function ChevronIcon({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {dir === 'left' ? <polyline points="15 18 9 12 15 6" /> : <polyline points="9 18 15 12 9 6" />}
    </svg>
  )
}
