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

export function TimeSlotPicker({ slots, selectedSlot, onSelect, timezone, isLoading, t }: TimeSlotPickerProps) {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null)

  const slotsByHour = useMemo(() => {
    const grouped: Record<string, PublicSlot[]> = {}
    for (const slot of slots) {
      const time = new Date(slot.startsAt).toLocaleTimeString('en-US', {
        hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timezone,
      })
      const hourKey = time.split(':')[0] + ':00'
      if (!grouped[hourKey]) grouped[hourKey] = []
      grouped[hourKey].push(slot)
    }
    return grouped
  }, [slots, timezone])

  if (isLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '10px', padding: '48px 0', color: 'var(--avq-muted-fg, #6b7280)' }}>
        <Spinner size={24} />
        <span style={{ fontSize: '13px' }}>{t('time.loading')}</span>
      </div>
    )
  }

  if (slots.length === 0) {
    return (
      <div style={{ padding: '48px 0', textAlign: 'center' }}>
        <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'var(--avq-muted, #f8f9fb)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--avq-muted-fg, #9ca3af)" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        </div>
        <p style={{ fontSize: '14px', color: 'var(--avq-muted-fg, #6b7280)' }}>{t('time.noSlots')}</p>
      </div>
    )
  }

  return (
    <div>
      <h2 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '16px', color: 'var(--avq-fg, #111827)' }}>
        {t('time.title')}
      </h2>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {Object.entries(slotsByHour).map(([hour, hourSlots]) => (
          <div key={hour}>
            <div style={{
              fontSize: '11px', fontWeight: '600', color: 'var(--avq-muted-fg, #9ca3af)',
              textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '10px',
            }}>
              {hour}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {hourSlots.map(slot => {
                const key = slot.startsAt
                const time = new Date(slot.startsAt).toLocaleTimeString('en-US', {
                  hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timezone,
                })
                const isSelected = selectedSlot?.startsAt === key
                const isHov = hoveredKey === key
                const isClass = slot.classSessionId != null
                const isFull = slot.available === false || (isClass && (slot.remaining ?? 0) <= 0)

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
                    {isClass && (
                      <span style={{
                        fontSize: '11px',
                        fontWeight: '500',
                        color: isFull
                          ? 'var(--avq-muted-fg, #9ca3af)'
                          : isSelected
                            ? 'var(--avq-accent, #6366f1)'
                            : (slot.remaining ?? 0) <= 3
                              ? '#f59e0b'
                              : '#10b981',
                      }}>
                        {isFull
                          ? t('time.full')
                          : t((slot.remaining ?? 0) === 1 ? 'time.spotsLeft_one' : 'time.spotsLeft', { count: slot.remaining ?? 0 })}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
