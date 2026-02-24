import { h } from 'preact'
import { useMemo } from 'preact/hooks'
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
      <div class="flex items-center justify-center gap-2 py-12 text-[var(--avq-muted-fg,#6b7280)]">
        <Spinner size={20} />
        <span>{t('time.loading')}</span>
      </div>
    )
  }

  if (slots.length === 0) {
    return <p class="py-8 text-center text-[var(--avq-muted-fg,#6b7280)]">{t('time.noSlots')}</p>
  }

  return (
    <div class="space-y-4">
      <h2 class="text-lg font-semibold text-[var(--avq-fg,#111827)]">{t('time.title')}</h2>
      <div class="space-y-3">
        {Object.entries(slotsByHour).map(([hour, hourSlots]) => (
          <div key={hour} class="flex items-start gap-3">
            <span class="w-12 flex-shrink-0 pt-2 text-sm text-[var(--avq-muted-fg,#6b7280)]">{hour}</span>
            <div class="flex flex-wrap gap-2">
              {hourSlots.map(slot => {
                const time = new Date(slot.startsAt).toLocaleTimeString('en-US', {
                  hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timezone,
                })
                const isSelected = selectedSlot?.startsAt === slot.startsAt
                return (
                  <button
                    key={slot.startsAt}
                    type="button"
                    onClick={() => onSelect(slot)}
                    class={`h-11 min-w-[72px] rounded-full border text-sm font-medium transition-all ${
                      isSelected
                        ? 'border-[var(--avq-accent,#6366f1)] bg-[var(--avq-accent,#6366f1)] text-white'
                        : 'border-[var(--avq-border,#e5e7eb)] text-[var(--avq-fg,#111827)] hover:border-[var(--avq-accent,#6366f1)]'
                    }`}
                  >
                    {time}
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
