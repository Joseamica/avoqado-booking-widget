import { h } from 'preact'
import { useMemo, useState } from 'preact/hooks'
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, format, isSameMonth, isSameDay,
  isToday, addMonths, subMonths, isBefore, isAfter, getDay, addDays,
} from 'date-fns'
import { es as esLocale } from 'date-fns/locale'
import type { OperatingHours, PublicSlot } from '../types'
import type { TFunction } from '../i18n'
import { Spinner } from './ui/Spinner'

const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const
const WEEKDAY_HEADERS_ES = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']
const WEEKDAY_HEADERS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

type Period = 'morning' | 'afternoon' | 'evening'

interface DateTimePickerSquareProps {
  selectedDate: string | null
  onSelectDate: (date: string) => void
  selectedSlot: PublicSlot | null
  onSelectSlot: (slot: PublicSlot) => void
  slots: PublicSlot[]
  slotsLoading: boolean
  timezone: string
  operatingHours?: OperatingHours
  maxAdvanceDays?: number
  /** When the venue exposes a real waitlist endpoint, route this somewhere
   *  meaningful. For now it's a stub — clicking shows a toast. */
  onJoinWaitlist?: () => void
  locale: 'en' | 'es'
  t: TFunction
}

/**
 * Square-style date + time chooser. Renders a calendar with greyed-out
 * unavailable days and the selected day pulled below as a header. When the
 * selected day has open slots they group as Mañana/Tarde/Noche; when it has
 * no slots a "Ir a la siguiente disponible" CTA appears. Waitlist signup
 * surfaces as a secondary action across both states.
 */
export function DateTimePickerSquare({
  selectedDate,
  onSelectDate,
  selectedSlot,
  onSelectSlot,
  slots,
  slotsLoading,
  timezone,
  operatingHours,
  maxAdvanceDays = 30,
  onJoinWaitlist,
  locale,
  t,
}: DateTimePickerSquareProps) {
  const venueNow = new Date(new Date().toLocaleString('en-US', { timeZone: timezone }))
  const today = new Date(venueNow.getFullYear(), venueNow.getMonth(), venueNow.getDate())
  const maxDate = addDays(today, maxAdvanceDays)

  const [viewMonth, setViewMonth] = useState(() => startOfMonth(today))
  const [hoveredKey, setHoveredKey] = useState<string | null>(null)

  const monthStart = startOfMonth(viewMonth)
  const monthEnd = endOfMonth(viewMonth)
  const days = eachDayOfInterval({
    start: startOfWeek(monthStart, { weekStartsOn: 1 }),
    end: endOfWeek(monthEnd, { weekStartsOn: 1 }),
  })

  const closedWeekdays = useMemo(() => {
    const set = new Set<number>()
    if (operatingHours) {
      DAY_KEYS.forEach((name, i) => { if (!operatingHours[name]?.enabled) set.add(i) })
    }
    return set
  }, [operatingHours])

  function isUnavailable(day: Date): boolean {
    return isBefore(day, today) || isAfter(day, maxDate) || closedWeekdays.has(getDay(day))
  }

  const selectedDateObj = selectedDate ? new Date(selectedDate + 'T00:00:00') : null
  const canGoPrev = !isBefore(subMonths(viewMonth, 1), startOfMonth(today))
  const weekHeaders = locale === 'en' ? WEEKDAY_HEADERS_EN : WEEKDAY_HEADERS_ES
  // Reorder to start on Monday — Square calendar uses lun-dom
  const orderedHeaders = [...weekHeaders.slice(1), weekHeaders[0]]

  const dateFnsLocale = locale === 'es' ? esLocale : undefined

  // Group slots by period
  const slotsByPeriod = useMemo(() => {
    const groups: Record<Period, PublicSlot[]> = { morning: [], afternoon: [], evening: [] }
    const now = Date.now()
    for (const slot of slots) {
      const date = new Date(slot.startsAt)
      if (date.getTime() <= now) continue
      const hourStr = date.toLocaleTimeString('en-US', { hour: 'numeric', hour12: false, timeZone: timezone })
      const hour = parseInt(hourStr, 10)
      const period: Period = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'
      groups[period].push(slot)
    }
    return groups
  }, [slots, timezone])

  const hasAnySlot = slotsByPeriod.morning.length + slotsByPeriod.afternoon.length + slotsByPeriod.evening.length > 0

  // Find next available day with open hours (for "Ir a siguiente disponible")
  const nextAvailableDay = useMemo(() => {
    const start = selectedDateObj && isAfter(selectedDateObj, today) ? selectedDateObj : today
    let cursor = addDays(start, 1)
    for (let i = 0; i < 30; i++) {
      if (!isUnavailable(cursor)) return cursor
      cursor = addDays(cursor, 1)
    }
    return null
  }, [selectedDateObj, operatingHours])

  // Selected-day header label (Square: "Hoy, domingo, 10 de may de 2026")
  const selectedDateHeader = (() => {
    if (!selectedDateObj) return null
    const isTodayDate = isSameDay(selectedDateObj, today)
    const formatted = format(selectedDateObj, locale === 'en' ? 'EEEE, MMMM d, yyyy' : "EEEE, d 'de' MMM 'de' yyyy", {
      locale: dateFnsLocale,
    })
    if (isTodayDate) {
      return locale === 'en' ? `Today, ${formatted}` : `Hoy, ${formatted}`
    }
    return formatted
  })()

  const tzLabel = useMemo(() => {
    try {
      const fmt = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'shortOffset' })
      const parts = fmt.formatToParts(new Date())
      const offset = parts.find(p => p.type === 'timeZoneName')?.value
      return offset ?? timezone
    } catch {
      return timezone
    }
  }, [timezone])

  return (
    <div>
      {/* Calendar */}
      <div style={{ maxWidth: '560px', margin: '0 auto' }}>
        {/* Month nav */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: '20px',
        }}>
          <button
            type="button"
            disabled={!canGoPrev}
            onClick={() => setViewMonth(m => subMonths(m, 1))}
            aria-label="Previous month"
            style={{
              width: '40px', height: '40px', borderRadius: '10px',
              border: 0,
              background: canGoPrev ? '#f3f4f6' : 'transparent',
              color: canGoPrev ? 'var(--avq-fg, #111827)' : '#d1d5db',
              cursor: canGoPrev ? 'pointer' : 'not-allowed',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: 'inherit',
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
          </button>

          <span style={{
            fontSize: '17px', fontWeight: '700',
            color: 'var(--avq-fg, #111827)',
            letterSpacing: '-0.3px',
            textTransform: locale === 'es' ? 'lowercase' : 'capitalize',
          }}>
            {format(viewMonth, locale === 'en' ? 'MMM yyyy' : 'MMM yyyy', { locale: dateFnsLocale })}
          </span>

          <button
            type="button"
            onClick={() => setViewMonth(m => addMonths(m, 1))}
            aria-label="Next month"
            style={{
              width: '40px', height: '40px', borderRadius: '10px',
              border: 0,
              background: '#f3f4f6',
              color: 'var(--avq-fg, #111827)',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: 'inherit',
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
          </button>
        </div>

        {/* Weekday headers */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)',
          marginBottom: '12px',
        }}>
          {orderedHeaders.map(d => (
            <div key={d} style={{
              textAlign: 'center',
              fontSize: '13px', fontWeight: '500',
              color: 'var(--avq-muted-fg, #6b7280)',
              padding: '6px 0',
            }}>
              {d}
            </div>
          ))}
        </div>

        {/* Days grid — Square uses bigger gaps between days for breathing room */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', rowGap: '12px' }}>
          {days.map(day => {
            const key = format(day, 'yyyy-MM-dd')
            const notThisMonth = !isSameMonth(day, viewMonth)
            const unavailable = isUnavailable(day)
            const isSelected = selectedDateObj ? isSameDay(day, selectedDateObj) : false
            const isTodayDate = isToday(day)
            const isHov = hoveredKey === key && !unavailable && !notThisMonth

            if (notThisMonth) return <div key={key} style={{ height: '40px' }} />

            return (
              <div key={key} style={{ display: 'flex', justifyContent: 'center' }}>
                <button
                  type="button"
                  disabled={unavailable}
                  onClick={() => onSelectDate(key)}
                  onMouseEnter={() => !unavailable && setHoveredKey(key)}
                  onMouseLeave={() => setHoveredKey(null)}
                  aria-pressed={isSelected}
                  aria-label={format(day, 'PPP', { locale: dateFnsLocale })}
                  style={{
                    width: '40px', height: '40px',
                    borderRadius: '50%', padding: 0,
                    border: isSelected ? 'none' : (isTodayDate && !unavailable ? '1.5px solid var(--avq-fg, #111827)' : 'none'),
                    background: isSelected ? '#0f0f10' : isHov ? '#f3f4f6' : 'transparent',
                    color: isSelected
                      ? '#ffffff'
                      : unavailable
                        ? '#d1d5db'
                        : 'var(--avq-fg, #111827)',
                    fontSize: '15px',
                    fontWeight: isSelected ? '600' : isTodayDate ? '600' : '500',
                    cursor: unavailable ? 'not-allowed' : 'pointer',
                    textDecoration: unavailable ? 'line-through' : 'none',
                    transition: 'background 0.15s ease',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontFamily: 'inherit',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {format(day, 'd')}
                </button>
              </div>
            )
          })}
        </div>

        {/* Optional collapse-up chevron — Square has it but doesn't really do anything
            beyond animating the calendar open/closed. We render it visually for parity
            but it's a no-op (the calendar always shows on /appointments). */}
        <div style={{
          display: 'flex', justifyContent: 'center', marginTop: '8px',
        }}>
          <span style={{
            width: '36px', height: '24px', borderRadius: '50%',
            background: '#f3f4f6',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--avq-fg, #111827)' }}>
              <polyline points="18 15 12 9 6 15"/>
            </svg>
          </span>
        </div>

        {/* Timezone hint */}
        <p style={{
          margin: '24px 0 0',
          fontSize: '13px', textAlign: 'center',
          color: 'var(--avq-muted-fg, #6b7280)',
          borderTop: '1px solid var(--avq-border, #e8eaed)',
          paddingTop: '20px',
        }}>
          {locale === 'en' ? 'Times shown in timezone:' : 'Las horas corresponden a la siguiente zona horaria:'}
          {' '}
          <span style={{ color: 'var(--avq-accent, #2563eb)', fontWeight: '500' }}>{tzLabel}.</span>
        </p>
      </div>

      {/* Selected-day section */}
      {selectedDateObj && (
        <div style={{ marginTop: '32px' }}>
          <h3 style={{
            margin: '0 0 16px', fontSize: '17px', fontWeight: '700',
            color: 'var(--avq-fg, #111827)', letterSpacing: '-0.3px',
            textTransform: locale === 'es' ? 'lowercase' : 'none',
          }}>
            {selectedDateHeader}
          </h3>

          {slotsLoading ? (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              gap: '10px', padding: '32px 0', color: 'var(--avq-muted-fg, #6b7280)',
            }}>
              <Spinner size={20} />
              <span style={{ fontSize: '13px' }}>{t('time.loading')}</span>
            </div>
          ) : !hasAnySlot ? (
            <NoAvailabilityBlock
              nextAvailableDay={nextAvailableDay}
              onPickNext={(d) => onSelectDate(format(d, 'yyyy-MM-dd'))}
              onJoinWaitlist={onJoinWaitlist}
              locale={locale}
              dateFnsLocale={dateFnsLocale}
              t={t}
            />
          ) : (
            <PeriodGroups
              groups={slotsByPeriod}
              selectedSlot={selectedSlot}
              onSelectSlot={onSelectSlot}
              timezone={timezone}
              onJoinWaitlist={onJoinWaitlist}
              locale={locale}
              t={t}
            />
          )}
        </div>
      )}
    </div>
  )
}

function NoAvailabilityBlock({
  nextAvailableDay,
  onPickNext,
  onJoinWaitlist,
  locale,
  dateFnsLocale,
  t,
}: {
  nextAvailableDay: Date | null
  onPickNext: (d: Date) => void
  onJoinWaitlist?: () => void
  locale: 'en' | 'es'
  dateFnsLocale: any
  t: TFunction
}) {
  const nextLabel = nextAvailableDay
    ? format(nextAvailableDay, locale === 'en' ? "EEEE, MMMM d" : "EEEE, d 'de' MMMM", { locale: dateFnsLocale })
    : null

  return (
    <div>
      {nextLabel && (
        <p style={{
          margin: '0 0 16px', fontSize: '14px',
          color: 'var(--avq-fg, #111827)',
        }}>
          {locale === 'en'
            ? `No availability until ${nextLabel}.`
            : `No hay disponibilidad hasta el ${nextLabel}.`}
        </p>
      )}

      {nextAvailableDay && (
        <button
          type="button"
          onClick={() => onPickNext(nextAvailableDay)}
          style={{
            width: '100%', maxWidth: '560px',
            padding: '14px',
            background: 'var(--avq-accent, #2563eb)', color: '#ffffff',
            border: 0, borderRadius: '12px',
            fontSize: '15px', fontWeight: '600',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {locale === 'en' ? 'Go to next available' : 'Ir a la siguiente disponible'}
        </button>
      )}

      {onJoinWaitlist && (
        <>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '14px 0',
            color: 'var(--avq-muted-fg, #6b7280)', fontSize: '13px',
          }}>
            {locale === 'en' ? 'or' : 'o'}
          </div>
          <button
            type="button"
            onClick={onJoinWaitlist}
            style={{
              width: '100%', maxWidth: '560px',
              padding: '14px',
              background: '#f3f4f6', color: 'var(--avq-accent, #2563eb)',
              border: 0, borderRadius: '12px',
              fontSize: '15px', fontWeight: '600',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {locale === 'en' ? 'Join the waitlist' : 'Apúntate a la lista de espera'}
          </button>
        </>
      )}
    </div>
  )
}

function PeriodGroups({
  groups,
  selectedSlot,
  onSelectSlot,
  timezone,
  onJoinWaitlist,
  locale,
  t,
}: {
  groups: Record<Period, PublicSlot[]>
  selectedSlot: PublicSlot | null
  onSelectSlot: (slot: PublicSlot) => void
  timezone: string
  onJoinWaitlist?: () => void
  locale: 'en' | 'es'
  t: TFunction
}) {
  const periodOrder: Period[] = ['morning', 'afternoon', 'evening']
  const periodLabels: Record<Period, string> = {
    morning: t('time.morning'),
    afternoon: t('time.afternoon'),
    evening: t('time.evening'),
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {periodOrder.map(period => {
        const periodSlots = groups[period]
        return (
          <div key={period}>
            <div style={{
              fontSize: '15px', fontWeight: '600',
              color: 'var(--avq-fg, #111827)',
              marginBottom: '10px',
            }}>
              {periodLabels[period]}
            </div>
            {periodSlots.length === 0 ? (
              <div style={{
                fontSize: '14px', color: 'var(--avq-muted-fg, #6b7280)',
              }}>
                {locale === 'en' ? 'No availability' : 'No hay disponibilidad'}
              </div>
            ) : (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(116px, 1fr))',
                gap: '8px',
                maxWidth: '560px',
              }}>
                {periodSlots.map(slot => {
                  const time = new Date(slot.startsAt).toLocaleTimeString('en-US', {
                    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timezone,
                  })
                  const isSelected = selectedSlot?.startsAt === slot.startsAt
                  const isFull = slot.available === false
                  return (
                    <button
                      key={slot.startsAt}
                      type="button"
                      onClick={() => !isFull && onSelectSlot(slot)}
                      disabled={isFull}
                      style={{
                        padding: '14px 12px',
                        borderRadius: '10px',
                        border: isSelected ? '1.5px solid var(--avq-fg, #111827)' : '1px solid var(--avq-border, #e8eaed)',
                        background: isFull ? 'var(--avq-muted, #f8f9fb)' : 'var(--avq-bg, #ffffff)',
                        color: isFull ? 'var(--avq-muted-fg, #9ca3af)' : 'var(--avq-fg, #111827)',
                        fontSize: '14px', fontWeight: '500',
                        cursor: isFull ? 'not-allowed' : 'pointer',
                        fontFamily: 'inherit',
                        fontVariantNumeric: 'tabular-nums',
                        textDecoration: isFull ? 'line-through' : 'none',
                      }}
                    >
                      {time}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}

      {onJoinWaitlist && (
        <div>
          <p style={{
            margin: '8px 0 12px',
            fontSize: '14px', fontWeight: '600',
            color: 'var(--avq-fg, #111827)',
          }}>
            {locale === 'en' ? "Don't see your preferred option?" : '¿No encuentras tu opción preferida?'}
          </p>
          <button
            type="button"
            onClick={onJoinWaitlist}
            style={{
              width: '100%', maxWidth: '560px',
              padding: '14px',
              background: '#f3f4f6', color: 'var(--avq-accent, #2563eb)',
              border: 0, borderRadius: '12px',
              fontSize: '15px', fontWeight: '600',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {locale === 'en' ? 'Join the waitlist' : 'Apúntate a la lista de espera'}
          </button>
        </div>
      )}
    </div>
  )
}
