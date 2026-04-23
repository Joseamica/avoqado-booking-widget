import { h } from 'preact'
import { useMemo, useState } from 'preact/hooks'
import type { PublicSlot } from '../types'
import type { TFunction } from '../i18n'
import { Spinner } from './ui/Spinner'

interface TimeSlotPickerProps {
  slots: PublicSlot[]
  selectedSlot: PublicSlot | null
  onSelect: (slot: PublicSlot) => void
  timezone: string
  isLoading?: boolean
  t: TFunction
}

type TimePeriod = 'morning' | 'afternoon' | 'evening'

function getTimePeriod(hour: number): TimePeriod {
  if (hour < 12) return 'morning'
  if (hour < 18) return 'afternoon'
  return 'evening'
}

/** Time period icons */
function PeriodIcon({ period }: { period: TimePeriod }) {
  if (period === 'morning') {
    // Sun rising
    return (
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 2v4" /><path d="m4.93 4.93 2.83 2.83" /><path d="M20 12h4" /><path d="m19.07 4.93-2.83 2.83" /><path d="M0 12h4" /><circle cx="12" cy="12" r="5" />
      </svg>
    )
  }
  if (period === 'afternoon') {
    // Full sun
    return (
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="4" /><path d="M12 2v2" /><path d="M12 20v2" /><path d="m4.93 4.93 1.41 1.41" /><path d="m17.66 17.66 1.41 1.41" /><path d="M2 12h2" /><path d="M20 12h2" /><path d="m6.34 17.66-1.41 1.41" /><path d="m19.07 4.93-1.41 1.41" />
      </svg>
    )
  }
  // Moon
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  )
}

/** Determine if remaining spots should be shown (smart threshold: < 30% capacity) */
function shouldShowRemaining(slot: PublicSlot): boolean {
  if (slot.remaining == null || slot.capacity == null) return false
  if (slot.capacity <= 0) return false
  return slot.remaining / slot.capacity < 0.3
}

export function TimeSlotPicker({ slots, selectedSlot, onSelect, timezone, isLoading, t }: TimeSlotPickerProps) {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null)

  const slotsByPeriod = useMemo(() => {
    const groups: Record<TimePeriod, PublicSlot[]> = { morning: [], afternoon: [], evening: [] }
    const now = Date.now()
    for (const slot of slots) {
      const date = new Date(slot.startsAt)
      if (date.getTime() <= now) continue
      // Get hour in venue timezone
      const hourStr = date.toLocaleTimeString('en-US', {
        hour: 'numeric', hour12: false, timeZone: timezone,
      })
      const hour = parseInt(hourStr, 10)
      groups[getTimePeriod(hour)].push(slot)
    }
    return groups
  }, [slots, timezone])

  if (isLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '10px', padding: '48px 0', color: 'var(--avq-muted-fg, #6b7280)' }}>
        <Spinner size={24} />
        <span style={{ fontSize: '13px' }}>{t('time.loading')}</span>
      </div>
    )
  }

  const hasAnySlot = slotsByPeriod.morning.length + slotsByPeriod.afternoon.length + slotsByPeriod.evening.length > 0

  if (!hasAnySlot) {
    return (
      <div style={{ padding: '48px 0', textAlign: 'center' }}>
        <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'var(--avq-muted, #f8f9fb)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--avq-muted-fg, #9ca3af)" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        </div>
        <p style={{ fontSize: '14px', color: 'var(--avq-muted-fg, #6b7280)' }}>{t('time.noSlots')}</p>
      </div>
    )
  }

  const periodOrder: TimePeriod[] = ['morning', 'afternoon', 'evening']
  const periodLabels: Record<TimePeriod, string> = {
    morning: t('time.morning'),
    afternoon: t('time.afternoon'),
    evening: t('time.evening'),
  }

  return (
    <div>
      <h2 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '16px', color: 'var(--avq-fg, #111827)' }}>
        {t('time.title')}
      </h2>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        {periodOrder.map(period => {
          const periodSlots = slotsByPeriod[period]
          if (periodSlots.length === 0) return null

          return (
            <div key={period}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                fontSize: '12px', fontWeight: '600', color: 'var(--avq-muted-fg, #9ca3af)',
                textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '10px',
              }}>
                <PeriodIcon period={period} />
                {periodLabels[period]}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {periodSlots.map(slot => {
                  const key = slot.startsAt
                  const time = new Date(slot.startsAt).toLocaleTimeString('en-US', {
                    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timezone,
                  })
                  const isSelected = selectedSlot?.startsAt === key
                  const isHov = hoveredKey === key
                  const isClass = slot.classSessionId != null
                  const isFull = slot.available === false || (isClass && (slot.remaining ?? 0) <= 0)
                  const showSpots = isClass && shouldShowRemaining(slot)

                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => !isFull && onSelect(slot)}
                      onMouseEnter={() => setHoveredKey(key)}
                      onMouseLeave={() => setHoveredKey(null)}
                      disabled={isFull}
                      style={{
                        height: isClass ? 'auto' : '42px',
                        minWidth: '80px',
                        padding: isClass ? '8px 16px' : '0 16px',
                        borderRadius: '12px',
                        border: isSelected
                          ? '2px solid var(--avq-accent, #6366f1)'
                          : `1.5px solid ${isFull ? 'var(--avq-border, #e8eaed)' : isHov ? 'var(--avq-muted-fg, #9ca3af)' : 'var(--avq-border, #e8eaed)'}`,
                        background: isFull
                          ? 'var(--avq-muted, #f8f9fb)'
                          : isSelected
                            ? 'color-mix(in srgb, var(--avq-accent, #6366f1) 6%, var(--avq-bg, #ffffff))'
                            : isHov ? 'var(--avq-muted, #f8f9fb)' : 'var(--avq-bg, #ffffff)',
                        color: isFull
                          ? 'var(--avq-muted-fg, #9ca3af)'
                          : isSelected ? 'var(--avq-accent, #6366f1)' : 'var(--avq-fg, #111827)',
                        fontSize: '14px', fontWeight: isSelected ? '600' : '500',
                        cursor: isFull ? 'not-allowed' : 'pointer',
                        opacity: isFull ? 0.55 : 1,
                        transition: 'all 0.15s ease',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px',
                        boxShadow: isSelected
                          ? '0 0 0 3px color-mix(in srgb, var(--avq-accent, #6366f1) 8%, transparent)'
                          : isHov && !isFull ? 'var(--avq-card-shadow, 0 1px 3px rgba(0,0,0,0.04))' : 'none',
                      }}
                    >
                      <span>{time}</span>
                      {isClass && slot.instructor && (
                        <span style={{
                          fontSize: '11px',
                          fontWeight: '500',
                          color: isFull
                            ? 'var(--avq-muted-fg, #9ca3af)'
                            : isSelected
                              ? 'var(--avq-accent, #6366f1)'
                              : 'var(--avq-muted-fg, #6b7280)',
                        }}>
                          {slot.instructor.firstName} {slot.instructor.lastName}
                        </span>
                      )}
                      {isClass && isFull && (
                        <span style={{
                          fontSize: '11px',
                          fontWeight: '600',
                          color: 'var(--avq-muted-fg, #9ca3af)',
                        }}>
                          {t('time.full')}
                        </span>
                      )}
                      {isClass && !isFull && showSpots && (
                        <span style={{
                          fontSize: '11px',
                          fontWeight: '500',
                          color: isSelected
                            ? 'var(--avq-accent, #6366f1)'
                            : (slot.remaining ?? 0) <= 3
                              ? '#f59e0b'
                              : '#10b981',
                        }}>
                          {t((slot.remaining ?? 0) === 1 ? 'time.spotsLeft_one' : 'time.spotsLeft', { count: slot.remaining ?? 0 })}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
