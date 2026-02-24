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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', padding: '48px 0', color: 'var(--avq-muted-fg, #6b7280)' }}>
        <Spinner size={20} />
        <span style={{ fontSize: '14px' }}>{t('time.loading')}</span>
      </div>
    )
  }

  if (slots.length === 0) {
    return (
      <div style={{ padding: '48px 0', textAlign: 'center' }}>
        <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style={{ color: 'var(--avq-border, #e5e7eb)', margin: '0 auto 12px', display: 'block' }}>
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <p style={{ fontSize: '14px', color: 'var(--avq-muted-fg, #6b7280)' }}>{t('time.noSlots')}</p>
      </div>
    )
  }

  return (
    <div>
      <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '20px', color: 'var(--avq-fg, #111827)' }}>
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
                      height: isClass ? 'auto' : '44px',
                      minWidth: '80px',
                      padding: isClass ? '8px 18px' : '0 18px',
                      borderRadius: '22px',
                      border: isSelected
                        ? '2px solid var(--avq-accent, #6366f1)'
                        : `1.5px solid ${isHov && !isFull ? 'var(--avq-muted-fg, #9ca3af)' : 'var(--avq-border, #e5e7eb)'}`,
                      background: isFull
                        ? 'var(--avq-muted, #f3f4f6)'
                        : isSelected
                          ? 'var(--avq-accent, #6366f1)'
                          : isHov ? 'var(--avq-muted, #f3f4f6)' : 'transparent',
                      color: isFull
                        ? 'var(--avq-muted-fg, #9ca3af)'
                        : isSelected ? '#ffffff' : 'var(--avq-fg, #111827)',
                      fontSize: '14px', fontWeight: '500',
                      cursor: isFull ? 'not-allowed' : 'pointer',
                      opacity: isFull ? 0.6 : 1,
                      transition: 'all 150ms ease',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px',
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
                            ? 'rgba(255,255,255,0.8)'
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
