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
 * Inline reschedule mini-flow inside ManageBooking. Branches on the reservation
 * kind the backend reports:
 *   - 'class':       swap to another session of the same class (existing v1).
 *   - 'appointment': pick a new date/time slot of the same service, hold it for
 *                    ~10 min, then confirm. No seat step.
 *
 * Older backends omit `reschedule.kind`; fall back to the reservation having a
 * classSessionId.
 */
export function RescheduleFlow(props: RescheduleFlowProps) {
  const kind = props.reservation.reschedule?.kind ?? ((props.reservation as any).classSessionId ? 'class' : 'appointment')
  return (
    <div class="avq-animate-in">
      <RescheduleContextBanner reservation={props.reservation} venueInfo={props.venueInfo} t={props.t} />
      {kind === 'class' ? <ClassRescheduleFlow {...props} /> : <AppointmentRescheduleFlow {...props} />}
    </div>
  )
}

/** Shared "what you're moving" banner shown above either flow. */
function RescheduleContextBanner({
  reservation,
  venueInfo,
  t,
}: {
  reservation: PublicReservationDetail
  venueInfo: PublicVenueInfo
  t: TFunction
}) {
  const oldDate = new Date(reservation.startsAt).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: venueInfo.timezone,
  })
  const oldTime = new Date(reservation.startsAt).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: venueInfo.timezone,
  })
  return (
    <div
      style={{
        marginBottom: '16px',
        padding: '12px 14px',
        borderRadius: '12px',
        background: 'color-mix(in srgb, var(--avq-accent, #6366f1) 6%, var(--avq-bg, #fff))',
        border: '1px solid color-mix(in srgb, var(--avq-accent, #6366f1) 18%, transparent)',
        fontSize: '13px',
        color: 'var(--avq-fg, #111827)',
      }}
    >
      <div style={{ fontWeight: '600', marginBottom: '2px' }}>{t('reschedule.title', { defaultValue: 'Cambiar horario' })}</div>
      <div style={{ color: 'var(--avq-muted-fg, #6b7280)', fontSize: '12px' }}>
        {t('reschedule.context', {
          defaultValue: '{{product}} · {{date}} {{time}}',
          product: reservation.product?.name ?? '',
          date: oldDate,
          time: oldTime,
        })}
      </div>
    </div>
  )
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      style={{
        marginBottom: '12px',
        padding: '10px 12px',
        borderRadius: '10px',
        background: 'var(--avq-danger-bg)',
        border: '1px solid var(--avq-danger-border)',
        color: 'var(--avq-danger-fg)',
        fontSize: '13px',
      }}
    >
      {message}
    </div>
  )
}

// ============================================================================
// CLASS reschedule (existing behavior — swap to another session)
// ============================================================================

function ClassRescheduleFlow({ venueSlug, cancelSecret, reservation, venueInfo, t, onSuccess, onCancel }: RescheduleFlowProps) {
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

  useEffect(() => {
    if (!selectedDate || !productId) return
    setSlotsLoading(true)
    setSelectedSlot(null)
    api
      .getAvailability(venueSlug, { date: selectedDate, productId, duration: product?.duration ?? undefined, partySize: seatCount })
      .then(res => {
        // Hide the session the customer is already in — moving to it is a no-op.
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

  return (
    <div>
      <StepBreadcrumb
        t={t}
        steps={[
          { key: 'date', label: t('reschedule.stepDate', { defaultValue: '1 · Fecha' }), active: step === 'date' },
          { key: 'time', label: t('reschedule.stepTime', { defaultValue: '2 · Hora' }), active: step === 'time' },
          ...(hasLayout ? [{ key: 'seat', label: t('reschedule.stepSeat', { defaultValue: '3 · Lugar' }), active: step === 'seat' }] : []),
        ]}
      />

      {error && <ErrorBanner message={error} />}

      {step === 'date' && (
        <DatePicker
          selectedDate={selectedDate}
          onSelect={d => {
            setSelectedDate(d)
            setStep('time')
          }}
          maxAdvanceDays={venueInfo.scheduling?.maxAdvanceDays ?? 30}
          timezone={venueInfo.timezone}
          operatingHours={venueInfo.operatingHours}
          t={t}
        />
      )}

      {step === 'time' && (
        <TimeSlotPicker
          slots={slots}
          selectedSlot={selectedSlot}
          onSelect={slot => {
            setSelectedSlot(slot)
            if (hasLayout && slot.classSessionId) {
              setSelectedSpotIds([])
              setStep('seat')
            } else {
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
          onToggleSpot={spotId => {
            const current = selectedSpotIds
            if (current.includes(spotId)) {
              setSelectedSpotIds(current.filter(id => id !== spotId))
            } else {
              if (current.length >= seatCount) return
              setSelectedSpotIds([...current, spotId])
            }
          }}
          onConfirm={() => handleSubmit(selectedSpotIds)}
          t={t}
        />
      )}

      <RescheduleFooter t={t} onCancel={onCancel} submitting={submitting} />
    </div>
  )
}

// ============================================================================
// APPOINTMENT reschedule (pick new slot → hold 10 min → confirm)
// ============================================================================

function AppointmentRescheduleFlow({ venueSlug, cancelSecret, reservation, venueInfo, t, onSuccess, onCancel }: RescheduleFlowProps) {
  const [step, setStep] = useState<'date' | 'time' | 'confirm'>('date')
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [slots, setSlots] = useState<PublicSlot[]>([])
  const [slotsLoading, setSlotsLoading] = useState(false)
  const [selectedSlot, setSelectedSlot] = useState<PublicSlot | null>(null)
  const [holdId, setHoldId] = useState<string | null>(null)
  const [holdExpiresAt, setHoldExpiresAt] = useState<number | null>(null)
  const [remainingSec, setRemainingSec] = useState(0)
  const [holding, setHolding] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fetch offered slots (excludes this reservation server-side) when date changes.
  useEffect(() => {
    if (!selectedDate) return
    setSlotsLoading(true)
    setSelectedSlot(null)
    api
      .getRescheduleAvailability(venueSlug, cancelSecret, { date: selectedDate })
      .then(res => setSlots(res.slots))
      .catch(() => setSlots([]))
      .finally(() => setSlotsLoading(false))
  }, [selectedDate])

  // Hold countdown. When it hits zero, release + bounce back to date picking.
  useEffect(() => {
    if (!holdExpiresAt) return
    const tick = () => {
      const secs = Math.max(0, Math.round((holdExpiresAt - Date.now()) / 1000))
      setRemainingSec(secs)
      if (secs <= 0) {
        if (holdId) api.cancelHold(venueSlug, holdId).catch(() => {})
        setHoldId(null)
        setHoldExpiresAt(null)
        setSelectedSlot(null)
        setStep('date')
        setError(t('reschedule.holdExpired', { defaultValue: 'Se agotó el tiempo para confirmar. Elige el horario de nuevo.' }))
      }
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [holdExpiresAt])

  // Release any active hold on unmount.
  useEffect(() => {
    return () => {
      if (holdId) api.cancelHold(venueSlug, holdId).catch(() => {})
    }
  }, [holdId])

  async function pickTime(slot: PublicSlot) {
    setSelectedSlot(slot)
    setHolding(true)
    setError(null)
    try {
      const hold = await api.createRescheduleHold(venueSlug, cancelSecret, { startsAt: slot.startsAt, endsAt: slot.endsAt })
      setHoldId(hold.holdId)
      setHoldExpiresAt(new Date(hold.expiresAt).getTime())
      setStep('confirm')
    } catch (err: any) {
      setError(err.data?.message ?? t('reschedule.slotTakenError', { defaultValue: 'Ese horario ya no está disponible, elige otro.' }))
      setSelectedSlot(null)
    } finally {
      setHolding(false)
    }
  }

  async function confirm() {
    if (!selectedSlot) return
    setSubmitting(true)
    setError(null)
    try {
      await api.rescheduleAppointment(venueSlug, cancelSecret, { startsAt: selectedSlot.startsAt, holdId: holdId ?? undefined })
      onSuccess()
    } catch (err: any) {
      // Hold expired or slot taken → release + send back to pick again.
      if (holdId) api.cancelHold(venueSlug, holdId).catch(() => {})
      setHoldId(null)
      setHoldExpiresAt(null)
      setSelectedSlot(null)
      setStep('date')
      setError(err.data?.message ?? t('reschedule.slotTakenError', { defaultValue: 'Ese horario ya no está disponible, elige otro.' }))
    } finally {
      setSubmitting(false)
    }
  }

  function backFromConfirm() {
    if (holdId) api.cancelHold(venueSlug, holdId).catch(() => {})
    setHoldId(null)
    setHoldExpiresAt(null)
    setSelectedSlot(null)
    setStep('time')
  }

  const mm = Math.floor(remainingSec / 60)
  const ss = String(remainingSec % 60).padStart(2, '0')

  return (
    <div>
      <StepBreadcrumb
        t={t}
        steps={[
          { key: 'date', label: t('reschedule.stepDate', { defaultValue: '1 · Fecha' }), active: step === 'date' },
          { key: 'time', label: t('reschedule.stepTime', { defaultValue: '2 · Hora' }), active: step === 'time' },
          { key: 'confirm', label: t('reschedule.stepConfirm', { defaultValue: '3 · Confirmar' }), active: step === 'confirm' },
        ]}
      />

      {error && <ErrorBanner message={error} />}

      {step === 'date' && (
        <DatePicker
          selectedDate={selectedDate}
          onSelect={d => {
            setSelectedDate(d)
            setStep('time')
          }}
          maxAdvanceDays={venueInfo.scheduling?.maxAdvanceDays ?? 30}
          timezone={venueInfo.timezone}
          operatingHours={venueInfo.operatingHours}
          t={t}
        />
      )}

      {step === 'time' && (
        <TimeSlotPicker
          slots={slots}
          selectedSlot={selectedSlot}
          onSelect={slot => {
            if (!holding) pickTime(slot)
          }}
          timezone={venueInfo.timezone}
          isLoading={slotsLoading || holding}
          t={t}
        />
      )}

      {step === 'confirm' && selectedSlot && (
        <div>
          <div
            style={{
              padding: '16px',
              borderRadius: '12px',
              border: '1px solid var(--avq-border, #e5e7eb)',
              marginBottom: '12px',
            }}
          >
            <div style={{ fontSize: '12px', color: 'var(--avq-muted-fg, #6b7280)', marginBottom: '4px' }}>
              {t('reschedule.newTimeLabel', { defaultValue: 'Nuevo horario' })}
            </div>
            <div style={{ fontSize: '16px', fontWeight: '700', color: 'var(--avq-fg, #111827)' }}>
              {new Date(selectedSlot.startsAt).toLocaleString(undefined, {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                hour: '2-digit',
                minute: '2-digit',
                timeZone: venueInfo.timezone,
              })}
            </div>
            {remainingSec > 0 && (
              <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--avq-muted-fg, #6b7280)' }}>
                {t('reschedule.holdCountdown', { defaultValue: 'Horario reservado por {{time}}', time: `${mm}:${ss}` })}
              </div>
            )}
          </div>
          <Button fullWidth onClick={confirm} disabled={submitting}>
            {submitting ? <Spinner size={16} /> : t('reschedule.confirmButton', { defaultValue: 'Confirmar cambio' })}
          </Button>
          <div style={{ marginTop: '8px' }}>
            <Button variant="ghost" fullWidth onClick={backFromConfirm} disabled={submitting}>
              {t('reschedule.pickAnother', { defaultValue: 'Elegir otro horario' })}
            </Button>
          </div>
        </div>
      )}

      <RescheduleFooter t={t} onCancel={onCancel} submitting={submitting || holding} />
    </div>
  )
}

// ============================================================================
// Shared bits
// ============================================================================

function StepBreadcrumb({ steps }: { t: TFunction; steps: { key: string; label: string; active: boolean }[] }) {
  return (
    <div
      style={{
        display: 'flex',
        gap: '4px',
        marginBottom: '12px',
        fontSize: '11px',
        color: 'var(--avq-muted-fg, #6b7280)',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
      }}
    >
      {steps.map((s, i) => (
        <span key={s.key} style={{ display: 'inline-flex', gap: '4px' }}>
          {i > 0 && <span>›</span>}
          <span style={{ fontWeight: s.active ? '700' : '500', color: s.active ? 'var(--avq-fg)' : undefined }}>{s.label}</span>
        </span>
      ))}
    </div>
  )
}

function RescheduleFooter({ t, onCancel, submitting }: { t: TFunction; onCancel: () => void; submitting: boolean }) {
  return (
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
  )
}
