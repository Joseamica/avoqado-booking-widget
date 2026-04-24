import { h } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import type { PublicReservationDetail, PublicSlot, PublicVenueInfo } from '../types'
import type { TFunction } from '../i18n'
import * as api from '../api/booking'
import { DatePicker } from './DatePicker'
import { TimeSlotPicker } from './TimeSlotPicker'
import { SeatPicker } from './SeatPicker'
import { Spinner } from './ui/Spinner'
import { Button } from './ui/Button'

interface RescheduleFlowProps {
  venueSlug: string
  cancelSecret: string
  reservation: PublicReservationDetail
  venueInfo: PublicVenueInfo
  t: TFunction
  onSuccess: () => void
  onCancel: () => void
}

/**
 * Inline reschedule mini-flow inside ManageBooking.
 *
 * Reuses the same DatePicker / TimeSlotPicker / SeatPicker the booking flow uses,
 * but pinned to the original product (no class swap in v1) so the slots query
 * returns sessions of the same class.
 *
 * Shows a context banner the whole way so the user knows what they're moving.
 */
export function RescheduleFlow({ venueSlug, cancelSecret, reservation, venueInfo, t, onSuccess, onCancel }: RescheduleFlowProps) {
  const productId = reservation.product?.id ?? reservation.reschedule?.productId ?? null
  const product = venueInfo.products?.find(p => p.id === productId)
  const hasLayout = !!product?.layoutConfig
  const seatCount = reservation.partySize

  const [step, setStep] = useState<'date' | 'time' | 'seat'>('date')
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [slots, setSlots] = useState<PublicSlot[]>([])
  const [slotsLoading, setSlotsLoading] = useState(false)
  const [selectedSlot, setSelectedSlot] = useState<PublicSlot | null>(null)
  const [selectedSpotIds, setSelectedSpotIds] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fetch slots when date changes
  useEffect(() => {
    if (!selectedDate || !productId) return
    setSlotsLoading(true)
    setSelectedSlot(null)
    api.getAvailability(venueSlug, {
      date: selectedDate,
      productId,
      duration: product?.duration ?? undefined,
      partySize: seatCount,
    })
      .then(res => {
        // Hide the slot the customer is already in — moving to the same one is a no-op
        const filtered = res.slots.filter(s => s.classSessionId !== (reservation as any).classSessionId)
        setSlots(filtered)
      })
      .catch(() => setSlots([]))
      .finally(() => setSlotsLoading(false))
  }, [selectedDate, productId])

  async function handleSubmit(spotIds?: string[]) {
    if (!selectedSlot?.classSessionId) return
    setSubmitting(true)
    setError(null)
    try {
      await api.rescheduleReservation(venueSlug, cancelSecret, {
        classSessionId: selectedSlot.classSessionId,
        spotIds: spotIds && spotIds.length > 0 ? spotIds : undefined,
      })
      onSuccess()
    } catch (err: any) {
      setError(err.data?.message ?? t('errors.generic'))
    } finally {
      setSubmitting(false)
    }
  }

  // Context banner shown the whole way: what's being rescheduled
  const oldDate = new Date(reservation.startsAt).toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: venueInfo.timezone,
  })
  const oldTime = new Date(reservation.startsAt).toLocaleTimeString(undefined, {
    hour: '2-digit', minute: '2-digit', timeZone: venueInfo.timezone,
  })

  return (
    <div class="avq-animate-in">
      {/* Context banner */}
      <div style={{
        marginBottom: '16px', padding: '12px 14px',
        borderRadius: '12px',
        background: 'color-mix(in srgb, var(--avq-accent, #6366f1) 6%, var(--avq-bg, #fff))',
        border: '1px solid color-mix(in srgb, var(--avq-accent, #6366f1) 18%, transparent)',
        fontSize: '13px', color: 'var(--avq-fg, #111827)',
      }}>
        <div style={{ fontWeight: '600', marginBottom: '2px' }}>
          {t('reschedule.title', { defaultValue: 'Cambiar horario' })}
        </div>
        <div style={{ color: 'var(--avq-muted-fg, #6b7280)', fontSize: '12px' }}>
          {t('reschedule.context', {
            defaultValue: '{{product}} · {{date}} {{time}}',
            product: reservation.product?.name ?? '',
            date: oldDate, time: oldTime,
          })}
        </div>
      </div>

      {/* Step indicator (text breadcrumb) */}
      <div style={{
        display: 'flex', gap: '4px', marginBottom: '12px',
        fontSize: '11px', color: 'var(--avq-muted-fg, #6b7280)',
        textTransform: 'uppercase', letterSpacing: '0.06em',
      }}>
        <span style={{ fontWeight: step === 'date' ? '700' : '500', color: step === 'date' ? 'var(--avq-fg)' : undefined }}>
          {t('reschedule.stepDate', { defaultValue: '1 · Fecha' })}
        </span>
        <span>›</span>
        <span style={{ fontWeight: step === 'time' ? '700' : '500', color: step === 'time' ? 'var(--avq-fg)' : undefined }}>
          {t('reschedule.stepTime', { defaultValue: '2 · Hora' })}
        </span>
        {hasLayout && (
          <>
            <span>›</span>
            <span style={{ fontWeight: step === 'seat' ? '700' : '500', color: step === 'seat' ? 'var(--avq-fg)' : undefined }}>
              {t('reschedule.stepSeat', { defaultValue: '3 · Lugar' })}
            </span>
          </>
        )}
      </div>

      {error && (
        <div role="alert" style={{
          marginBottom: '12px', padding: '10px 12px', borderRadius: '10px',
          background: 'var(--avq-danger-bg)', border: '1px solid var(--avq-danger-border)',
          color: 'var(--avq-danger-fg)', fontSize: '13px',
        }}>
          {error}
        </div>
      )}

      {step === 'date' && (
        <DatePicker
          selectedDate={selectedDate}
          onSelect={(d) => { setSelectedDate(d); setStep('time') }}
          maxAdvanceDays={30}
          timezone={venueInfo.timezone}
          operatingHours={venueInfo.operatingHours}
          t={t}
        />
      )}

      {step === 'time' && (
        <TimeSlotPicker
          slots={slots}
          selectedSlot={selectedSlot}
          onSelect={(slot) => {
            setSelectedSlot(slot)
            if (hasLayout && slot.classSessionId) {
              setSelectedSpotIds([])
              setStep('seat')
            } else {
              // No layout → submit immediately on time pick
              handleSubmit()
            }
          }}
          timezone={venueInfo.timezone}
          isLoading={slotsLoading}
          t={t}
        />
      )}

      {step === 'seat' && hasLayout && product?.layoutConfig && selectedSlot && (
        <SeatPicker
          layout={product.layoutConfig}
          takenSpotIds={selectedSlot.takenSpotIds ?? []}
          selectedSpotIds={selectedSpotIds}
          onToggleSpot={(spotId) => {
            const current = selectedSpotIds
            if (current.includes(spotId)) {
              setSelectedSpotIds(current.filter(id => id !== spotId))
            } else {
              if (current.length >= seatCount) return // can't select more than original
              setSelectedSpotIds([...current, spotId])
            }
          }}
          onConfirm={() => handleSubmit(selectedSpotIds)}
          t={t}
        />
      )}

      {/* Footer — back/cancel button, always visible */}
      <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
        <Button variant="ghost" onClick={onCancel} disabled={submitting}>
          {t('actions.goBack')}
        </Button>
        {submitting && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: 'var(--avq-muted-fg, #6b7280)' }}>
            <Spinner size={14} />
            {t('reschedule.applying', { defaultValue: 'Aplicando cambio…' })}
          </span>
        )}
      </div>
    </div>
  )
}
