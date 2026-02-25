import { h } from 'preact'
import { useState } from 'preact/hooks'
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, format, isSameMonth, isSameDay,
  isToday, addMonths, subMonths, isBefore, isAfter, getDay,
} from 'date-fns'
import type { OperatingHours } from '../types'
import type { TFunction } from '../i18n'

const DAY_MAP = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const

interface DatePickerProps {
  selectedDate: string | null
  onSelect: (date: string) => void
  maxAdvanceDays?: number
  timezone: string
  operatingHours?: OperatingHours
  t: TFunction
}

export function DatePicker({ selectedDate, onSelect, maxAdvanceDays = 30, timezone, operatingHours, t }: DatePickerProps) {
  const venueNow = new Date(new Date().toLocaleString('en-US', { timeZone: timezone }))
  const today = new Date(venueNow.getFullYear(), venueNow.getMonth(), venueNow.getDate())
  const maxDate = new Date(today)
  maxDate.setDate(maxDate.getDate() + maxAdvanceDays)

  const [viewMonth, setViewMonth] = useState(() => startOfMonth(today))
  const [hoveredKey, setHoveredKey] = useState<string | null>(null)
  const [prevHovered, setPrevHovered] = useState(false)
  const [nextHovered, setNextHovered] = useState(false)

  const monthStart = startOfMonth(viewMonth)
  const monthEnd = endOfMonth(viewMonth)
  const days = eachDayOfInterval({
    start: startOfWeek(monthStart, { weekStartsOn: 0 }),
    end: endOfWeek(monthEnd, { weekStartsOn: 0 }),
  })

  const closedDays = new Set<number>()
  if (operatingHours) {
    DAY_MAP.forEach((name, i) => { if (!operatingHours[name]?.enabled) closedDays.add(i) })
  }

  function isDisabled(day: Date): boolean {
    return isBefore(day, today) || isAfter(day, maxDate) || closedDays.has(getDay(day))
  }

  const selectedDateObj = selectedDate ? new Date(selectedDate + 'T00:00:00') : null
  const canGoPrev = !isBefore(subMonths(viewMonth, 1), startOfMonth(today))
  const WEEK_HEADERS = ['D', 'L', 'M', 'X', 'J', 'V', 'S']

  return (
    <div>
      <h2 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '16px', color: 'var(--avq-fg, #111827)' }}>
        {t('date.title')}
      </h2>

      <div style={{
        borderRadius: '16px', border: '1px solid var(--avq-border, #e8eaed)',
        padding: '20px', background: 'var(--avq-bg, #fff)',
        boxShadow: 'var(--avq-card-shadow, 0 1px 3px rgba(0,0,0,0.04))',
      }}>
        {/* Month nav */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <button
            type="button"
            disabled={!canGoPrev}
            onClick={() => setViewMonth(m => subMonths(m, 1))}
            onMouseEnter={() => setPrevHovered(true)}
            onMouseLeave={() => setPrevHovered(false)}
            style={{
              width: '36px', height: '36px', borderRadius: '10px', border: 'none',
              background: prevHovered && canGoPrev ? 'var(--avq-muted, #f8f9fb)' : 'transparent',
              color: canGoPrev ? 'var(--avq-fg, #111827)' : 'var(--avq-border, #e8eaed)',
              cursor: canGoPrev ? 'pointer' : 'not-allowed',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'background 0.2s ease',
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>

          <span style={{ fontSize: '15px', fontWeight: '600', color: 'var(--avq-fg, #111827)', textTransform: 'capitalize' }}>
            {format(viewMonth, 'MMMM yyyy')}
          </span>

          <button
            type="button"
            onClick={() => setViewMonth(m => addMonths(m, 1))}
            onMouseEnter={() => setNextHovered(true)}
            onMouseLeave={() => setNextHovered(false)}
            style={{
              width: '36px', height: '36px', borderRadius: '10px', border: 'none',
              background: nextHovered ? 'var(--avq-muted, #f8f9fb)' : 'transparent',
              color: 'var(--avq-fg, #111827)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'background 0.2s ease',
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>

        {/* Week headers */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: '6px' }}>
          {WEEK_HEADERS.map(d => (
            <div key={d} style={{
              textAlign: 'center', fontSize: '12px', fontWeight: '600',
              color: 'var(--avq-muted-fg, #9ca3af)', padding: '4px 0',
              letterSpacing: '0.05em',
            }}>
              {d}
            </div>
          ))}
        </div>

        {/* Days grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px' }}>
          {days.map(day => {
            const key = format(day, 'yyyy-MM-dd')
            const notThisMonth = !isSameMonth(day, viewMonth)
            const disabled = isDisabled(day) || notThisMonth
            const isSelected = selectedDateObj ? isSameDay(day, selectedDateObj) : false
            const isTodayDate = isToday(day)
            const isHov = hoveredKey === key && !disabled

            if (notThisMonth) return <div key={key} style={{ height: '40px' }} />

            return (
              <div key={key} style={{ display: 'flex', justifyContent: 'center', padding: '1px 0' }}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onSelect(key)}
                  onMouseEnter={() => !disabled && setHoveredKey(key)}
                  onMouseLeave={() => setHoveredKey(null)}
                  style={{
                    width: '38px', height: '38px', borderRadius: '10px', padding: 0,
                    border: isTodayDate && !isSelected ? '1.5px solid var(--avq-accent, #6366f1)' : 'none',
                    background: isSelected
                      ? 'var(--avq-accent, #6366f1)'
                      : isHov ? 'var(--avq-muted, #f8f9fb)' : 'transparent',
                    color: isSelected ? '#ffffff'
                      : isTodayDate ? 'var(--avq-accent, #6366f1)'
                      : 'var(--avq-fg, #111827)',
                    fontSize: '14px',
                    fontWeight: isSelected || isTodayDate ? '600' : '400',
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    opacity: disabled ? 0.25 : 1,
                    transition: 'all 0.15s ease',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: isSelected ? '0 2px 8px color-mix(in srgb, var(--avq-accent, #6366f1) 30%, transparent)' : 'none',
                  }}
                >
                  {format(day, 'd')}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
