import { h } from 'preact'
import { useState } from 'preact/hooks'
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  format,
  isSameMonth,
  isSameDay,
  isToday,
  addMonths,
  subMonths,
  isBefore,
  isAfter,
  getDay,
} from 'date-fns'
import type { OperatingHours } from '../types'
import type { TFunction } from '../i18n'

const DAY_MAP = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const

interface DatePickerProps {
  selectedDate: string | null  // YYYY-MM-DD
  onSelect: (date: string) => void
  maxAdvanceDays?: number
  timezone: string
  operatingHours?: OperatingHours
  t: TFunction
}

export function DatePicker({ selectedDate, onSelect, maxAdvanceDays = 30, timezone, operatingHours, t }: DatePickerProps) {
  // Get today in venue timezone
  const venueNow = new Date(new Date().toLocaleString('en-US', { timeZone: timezone }))
  const today = new Date(venueNow.getFullYear(), venueNow.getMonth(), venueNow.getDate())

  const maxDate = new Date(today)
  maxDate.setDate(maxDate.getDate() + maxAdvanceDays)

  const [viewMonth, setViewMonth] = useState(() => startOfMonth(today))

  const monthStart = startOfMonth(viewMonth)
  const monthEnd = endOfMonth(viewMonth)
  const calStart = startOfWeek(monthStart, { weekStartsOn: 0 })
  const calEnd = endOfWeek(monthEnd, { weekStartsOn: 0 })
  const days = eachDayOfInterval({ start: calStart, end: calEnd })

  // Closed weekdays from operating hours
  const closedDays = new Set<number>()
  if (operatingHours) {
    DAY_MAP.forEach((name, i) => {
      if (!operatingHours[name]?.enabled) closedDays.add(i)
    })
  }

  function isDisabled(day: Date): boolean {
    return isBefore(day, today) || isAfter(day, maxDate) || closedDays.has(getDay(day))
  }

  const selectedDateObj = selectedDate ? new Date(selectedDate + 'T00:00:00') : null

  const weekDays = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

  return (
    <div class="space-y-4">
      <h2 class="text-lg font-semibold text-[var(--avq-fg,#111827)]">{t('date.title')}</h2>
      <div class="rounded-xl border border-[var(--avq-border,#e5e7eb)] p-4">
        {/* Month header */}
        <div class="mb-4 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setViewMonth(m => subMonths(m, 1))}
            disabled={isBefore(subMonths(viewMonth, 1), startOfMonth(today))}
            class="rounded-lg p-1.5 hover:bg-[var(--avq-muted,#f3f4f6)] disabled:opacity-30 disabled:cursor-not-allowed text-[var(--avq-fg,#111827)]"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <span class="text-sm font-semibold text-[var(--avq-fg,#111827)]">
            {format(viewMonth, 'MMMM yyyy')}
          </span>
          <button
            type="button"
            onClick={() => setViewMonth(m => addMonths(m, 1))}
            class="rounded-lg p-1.5 hover:bg-[var(--avq-muted,#f3f4f6)] text-[var(--avq-fg,#111827)]"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>

        {/* Week day headers */}
        <div class="mb-2 grid grid-cols-7 text-center">
          {weekDays.map(d => (
            <div key={d} class="py-1 text-xs font-medium text-[var(--avq-muted-fg,#6b7280)]">{d}</div>
          ))}
        </div>

        {/* Days grid */}
        <div class="grid grid-cols-7">
          {days.map(day => {
            const disabled = isDisabled(day) || !isSameMonth(day, viewMonth)
            const isSelected = selectedDateObj ? isSameDay(day, selectedDateObj) : false
            const isT = isToday(day)
            const notThisMonth = !isSameMonth(day, viewMonth)

            return (
              <button
                key={day.toISOString()}
                type="button"
                disabled={disabled}
                onClick={() => !disabled && onSelect(format(day, 'yyyy-MM-dd'))}
                class={`relative m-0.5 rounded-lg py-2 text-sm transition-all ${
                  isSelected
                    ? 'bg-[var(--avq-accent,#6366f1)] text-white font-semibold'
                    : isT && !isSelected
                    ? 'border border-[var(--avq-accent,#6366f1)] text-[var(--avq-accent,#6366f1)] font-semibold'
                    : disabled
                    ? 'text-[var(--avq-muted-fg,#6b7280)] opacity-30 cursor-not-allowed'
                    : notThisMonth
                    ? 'invisible'
                    : 'text-[var(--avq-fg,#111827)] hover:bg-[var(--avq-muted,#f3f4f6)]'
                }`}
              >
                {format(day, 'd')}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
