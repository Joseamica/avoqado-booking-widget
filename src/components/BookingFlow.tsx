import { h } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import type { WidgetProps } from '../types'
import type { PublicSlot } from '../types'
import { createT } from '../i18n'
import * as api from '../api/booking'
import {
  step, venueInfo, selectedProduct, selectedDate, selectedSlot,
  selectedSpotIds, bookingResult, isLoading, apiError, manageSecret,
  hasServiceStep, getStepConfig, resetBooking, showToast,
} from '../state/booking'
import { StepIndicator } from './StepIndicator'
import { ServiceSelector } from './ServiceSelector'
import { DatePicker } from './DatePicker'
import { TimeSlotPicker } from './TimeSlotPicker'
import { SeatPicker } from './SeatPicker'
import { GuestInfoForm } from './GuestInfoForm'
import { DepositStep } from './DepositStep'
import { Confirmation } from './Confirmation'
import { ManageBooking } from './ManageBooking'
import { Spinner } from './ui/Spinner'
import type { GuestFormData } from './GuestInfoForm'

interface BookingFlowProps {
  props: WidgetProps
}

const MANAGE_STEP = 99

/** Avoqado avocado icon — inline SVG for Shadow DOM */
function AvoqadoLogo() {
  return (
    <svg viewBox="0 0 732.5 893.3" width="16" height="20" style={{ flexShrink: 0 }}>
      <path
        fill="#69E185"
        d="M712.7,486.2c-3.3-83.5-37.8-157.2-99.8-213.1c-27.9-28.7-63.2-57.2-104.9-84.8c16-81.7,12.9-116.7-31.4-155.5
        l-2.4-2.1l-3.1-0.9c-33-9.4-58.6-7.7-78.1,5.1c-29.8,19.5-39.9,60.9-45.2,117.3c-131.6,12.1-242.1,95.5-296.3,224.2
        c-56.5,134-37,280.8,49.8,374.1c3.4,3.5,10.3,10.6,157,98l1.1,0.7l1.2,0.5c36,13.2,72.6,19.8,108.8,19.8
        c39.2,0,78.1-7.7,115.4-23.2c63.9-26.5,121.9-75.8,163.3-138.7C692.8,639.9,715.7,561.3,712.7,486.2z M580.3,507.4
        c-0.3,58-40.2,116.3-118.7,173.3C374.3,744.2,279.3,710,228,651.3c-43.8-50-65.3-119.8-56.1-182c4.8-32.5,20.5-77.7,68-108.3
        c64.6-41.7,110-56.7,144.4-56.7c45.6,0,71.8,26.4,97.4,52.4c10.4,10.5,20.2,20.4,31.3,28.6C545.7,409.4,580.5,454.2,580.3,507.4z"
      />
      <path
        fill="#C9712F"
        d="M362.2,412c-26.8,0-53.6,17.9-75.5,50.5c-18.4,27.3-30.3,61.1-30.3,86c0,49.5,47.4,89.7,105.7,89.7
        S468,598,468,548.5c0-24.9-11.9-58.7-30.3-86C415.8,430,389,412,362.2,412z"
      />
    </svg>
  )
}

export function BookingFlow({ props }: BookingFlowProps) {
  const t = createT(props.locale)
  const [slots, setSlots] = useState<PublicSlot[]>([])
  const [slotsLoading, setSlotsLoading] = useState(false)
  const [seatPickerActive, setSeatPickerActive] = useState(false)

  // Load venue info on mount
  useEffect(() => {
    if (!props.venue) return
    isLoading.value = true
    apiError.value = null
    api.getVenueInfo(props.venue)
      .then(info => {
        venueInfo.value = info
        resetBooking(info)
      })
      .catch((err) => {
        apiError.value = err.status === 404 ? t('errors.venueNotFound') : t('errors.generic')
      })
      .finally(() => { isLoading.value = false })
  }, [props.venue])

  // Fetch available slots for a date
  function fetchSlots() {
    const date = selectedDate.value
    const info = venueInfo.value
    if (!date || !info) return
    setSlotsLoading(true)
    api.getAvailability(props.venue, {
      date,
      productId: selectedProduct.value?.id,
      duration: selectedProduct.value?.duration ?? undefined,
    })
      .then(res => setSlots(res.slots))
      .catch(() => setSlots([]))
      .finally(() => setSlotsLoading(false))
  }

  // Load availability when date changes
  useEffect(() => {
    fetchSlots()
  }, [selectedDate.value, selectedProduct.value?.id])

  // Dispatch custom events on host element
  function dispatchEvent(name: string, detail: Record<string, unknown>) {
    props.hostElement.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true, detail }))
  }

  if (isLoading.value) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '64px 0', gap: '12px' }}>
        <Spinner size={28} />
        <p style={{ fontSize: '13px', color: 'var(--avq-muted-fg, #9ca3af)' }}>{t('time.loading')}</p>
      </div>
    )
  }

  if (apiError.value) {
    return (
      <div class="avq-animate-in" style={{ padding: '48px 0', textAlign: 'center' }}>
        <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'var(--avq-muted, #f8f9fb)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
          <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--avq-muted-fg, #6b7280)" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        </div>
        <p style={{ fontWeight: '600', color: 'var(--avq-fg, #111827)', marginBottom: '8px' }}>{apiError.value}</p>
        <button
          type="button"
          onClick={() => { apiError.value = null; isLoading.value = false }}
          style={{ fontSize: '14px', color: 'var(--avq-accent, #6366f1)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: '2px' }}
        >
          {t('actions.retry')}
        </button>
      </div>
    )
  }

  const info = venueInfo.value
  if (!info) return null

  if (!info.publicBooking.enabled) {
    return (
      <div class="avq-animate-in" style={{ padding: '48px 0', textAlign: 'center' }}>
        <div style={{ width: '56px', height: '56px', borderRadius: '50%', background: 'var(--avq-muted, #f8f9fb)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--avq-muted-fg, #6b7280)" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        </div>
        <h2 style={{ fontSize: '18px', fontWeight: '600', color: 'var(--avq-fg, #111827)', marginBottom: '6px' }}>{t('errors.bookingDisabled')}</h2>
        <p style={{ fontSize: '14px', color: 'var(--avq-muted-fg, #6b7280)', marginBottom: '20px' }}>{t('errors.bookingDisabledDescription')}</p>
        {info.phone && (
          <a
            href={`tel:${info.phone}`}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '8px',
              padding: '10px 20px', borderRadius: '10px',
              border: '1px solid var(--avq-border, #e8eaed)',
              fontSize: '14px', color: 'var(--avq-fg, #111827)',
              textDecoration: 'none', transition: 'border-color 0.2s ease',
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
            {t('errors.bookingDisabledContact', { phone: info.phone })}
          </a>
        )}
      </div>
    )
  }

  // Manage booking screen
  if (step.value === MANAGE_STEP) {
    return (
      <div>
        <ManageBooking
          venueSlug={props.venue}
          cancelSecret={manageSecret.value!}
          timezone={info.timezone}
          t={t}
          onBack={() => resetBooking(info)}
        />
        {/* Avoqado footer */}
        <div style={{ marginTop: '32px', textAlign: 'center', paddingBottom: '4px' }}>
          <a href="https://avoqado.io" target="_blank" rel="noopener noreferrer" class="avq-footer-link" style={{ fontSize: '12px', justifyContent: 'center' }}>
            <AvoqadoLogo />
            <span>{t('poweredBy')}</span>
          </a>
        </div>
      </div>
    )
  }

  const config = getStepConfig(hasServiceStep.value)
  const stepLabels = hasServiceStep.value
    ? [t('steps.service'), t('steps.date'), t('steps.time'), t('steps.info'), t('steps.confirmation')]
    : [t('steps.date'), t('steps.time'), t('steps.info'), t('steps.confirmation')]

  const showBack = (step.value > (hasServiceStep.value ? config.serviceStep : config.dateStep) && step.value < config.confirmStep)
    || (step.value === config.timeStep && seatPickerActive)

  function handleBack() {
    if (step.value === config.formStep) {
      // If product has layout, go back to seat picker
      if (selectedProduct.value?.layoutConfig && selectedSlot.value?.classSessionId) {
        setSeatPickerActive(true)
        step.value = config.timeStep
      } else {
        fetchSlots() // Refresh capacity data when going back to time picker
        step.value = config.timeStep
      }
    } else if (step.value === config.timeStep) {
      if (seatPickerActive) {
        // Going back from seat picker to time slot selection
        setSeatPickerActive(false)
        selectedSlot.value = null
        selectedSpotIds.value = []
      } else {
        step.value = config.dateStep
      }
    } else if (step.value === config.dateStep && hasServiceStep.value) step.value = config.serviceStep
  }

  async function handleFormSubmit(data: GuestFormData) {
    const slot = selectedSlot.value
    if (!slot) return
    isLoading.value = true
    try {
      const spots = selectedSpotIds.value
      const result = await api.createReservation(props.venue, {
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        duration: selectedProduct.value?.duration
          ?? Math.round((new Date(slot.endsAt).getTime() - new Date(slot.startsAt).getTime()) / 60000),
        guestName: data.guestName,
        guestPhone: data.guestPhone,
        guestEmail: data.guestEmail || undefined,
        partySize: spots.length > 0 ? spots.length : (data.partySize || undefined),
        productId: selectedProduct.value?.id,
        classSessionId: slot.classSessionId || undefined,
        spotIds: spots.length > 0 ? spots : undefined,
        specialRequests: data.specialRequests || undefined,
      })
      bookingResult.value = result
      step.value = config.confirmStep
      dispatchEvent('avoqado:confirmed', {
        confirmationCode: result.confirmationCode,
        startsAt: result.startsAt,
        endsAt: result.endsAt,
        productName: selectedProduct.value?.name,
      })
    } catch (err: any) {
      if (err.status === 409) {
        showToast(t('errors.slotTaken'), 'error')
        selectedSlot.value = null
        fetchSlots() // Refresh slots so user sees updated capacity
        step.value = config.timeStep
      } else {
        showToast(err.data?.message ?? t('errors.generic'), 'error')
      }
    } finally {
      isLoading.value = false
    }
  }

  return (
    <div>
      {/* Venue header */}
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px',
        marginBottom: '28px', paddingTop: '4px',
      }}>
        {info.logo ? (
          <img
            src={info.logo}
            alt={info.name}
            style={{
              width: '56px', height: '56px', borderRadius: '14px', objectFit: 'cover',
              boxShadow: 'var(--avq-card-shadow, 0 1px 3px rgba(0,0,0,0.04))',
              border: '1px solid var(--avq-border, #e8eaed)',
            }}
          />
        ) : (
          <div style={{
            width: '56px', height: '56px', borderRadius: '14px',
            background: 'var(--avq-accent, #6366f1)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '22px', fontWeight: '700', color: '#ffffff',
            boxShadow: '0 2px 8px rgba(99,102,241,0.25)',
          }}>
            {info.name.charAt(0).toUpperCase()}
          </div>
        )}
        <h1 style={{ fontSize: '18px', fontWeight: '700', color: 'var(--avq-fg, #111827)', margin: 0, letterSpacing: '-0.01em' }}>
          {info.name}
        </h1>
      </div>

      {/* Step indicator */}
      {step.value < config.confirmStep && (
        <StepIndicator
          currentStep={step.value}
          totalSteps={config.totalSteps}
          labels={stepLabels}
        />
      )}

      {/* Back button */}
      {showBack && (
        <button
          type="button"
          onClick={handleBack}
          style={{
            display: 'flex', alignItems: 'center', gap: '4px',
            marginBottom: '16px', padding: '4px 0',
            fontSize: '13px', fontWeight: '500',
            color: 'var(--avq-muted-fg, #6b7280)',
            background: 'none', border: 'none', cursor: 'pointer',
            transition: 'color 0.2s ease',
          }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
          {t('actions.goBack')}
        </button>
      )}

      {/* Steps */}
      <div class="avq-animate-in" key={step.value}>
        {step.value === config.serviceStep && hasServiceStep.value && (
          <ServiceSelector
            products={info.products}
            selectedProductId={selectedProduct.value?.id ?? null}
            onSelect={(product) => {
              selectedProduct.value = product
              step.value = config.dateStep
            }}
            t={t}
          />
        )}

        {step.value === config.dateStep && (
          <DatePicker
            selectedDate={selectedDate.value}
            onSelect={(date) => {
              selectedDate.value = date
              selectedSlot.value = null
              step.value = config.timeStep
            }}
            maxAdvanceDays={30}
            timezone={info.timezone}
            operatingHours={info.operatingHours}
            t={t}
          />
        )}

        {step.value === config.timeStep && !seatPickerActive && (
          <TimeSlotPicker
            slots={slots}
            selectedSlot={selectedSlot.value}
            onSelect={(slot) => {
              selectedSlot.value = slot
              selectedSpotIds.value = []
              // If CLASS with layout, show seat picker
              if (selectedProduct.value?.layoutConfig && slot.classSessionId) {
                setSeatPickerActive(true)
              } else {
                step.value = config.formStep
              }
            }}
            timezone={info.timezone}
            isLoading={slotsLoading}
            t={t}
          />
        )}

        {step.value === config.timeStep && seatPickerActive && selectedProduct.value?.layoutConfig && selectedSlot.value && (
          <SeatPicker
            layout={selectedProduct.value.layoutConfig}
            takenSpotIds={selectedSlot.value.takenSpotIds ?? []}
            selectedSpotIds={selectedSpotIds.value}
            onToggleSpot={(spotId) => {
              const current = selectedSpotIds.value
              if (current.includes(spotId)) {
                selectedSpotIds.value = current.filter(id => id !== spotId)
              } else {
                selectedSpotIds.value = [...current, spotId]
              }
            }}
            onConfirm={() => {
              setSeatPickerActive(false)
              step.value = config.formStep
            }}
            t={t}
          />
        )}

        {step.value === config.formStep && (
          <GuestInfoForm
            venueInfo={info}
            selectedSlot={selectedSlot.value}
            selectedSpotCount={selectedSpotIds.value.length}
            onSubmit={handleFormSubmit}
            isSubmitting={isLoading.value}
            t={t}
          />
        )}

        {step.value === config.confirmStep && bookingResult.value && !bookingResult.value.depositRequired && (
          <Confirmation
            booking={bookingResult.value}
            venueInfo={info}
            onManageBooking={() => {
              manageSecret.value = bookingResult.value!.cancelSecret
              step.value = MANAGE_STEP
            }}
            onNewBooking={() => resetBooking(info)}
            t={t}
          />
        )}

        {step.value === config.confirmStep && bookingResult.value?.depositRequired && (
          <DepositStep
            booking={bookingResult.value}
            t={t}
            onContinue={() => {
              // After acknowledging deposit, show confirmation
              const result = bookingResult.value!
              bookingResult.value = { ...result, depositRequired: false }
            }}
          />
        )}
      </div>

      {/* Avoqado footer */}
      <div style={{ marginTop: '32px', textAlign: 'center', paddingBottom: '4px' }}>
        <a href="https://avoqado.io" target="_blank" rel="noopener noreferrer" class="avq-footer-link" style={{ fontSize: '12px', justifyContent: 'center' }}>
          <AvoqadoLogo />
          <span>{t('poweredBy')}</span>
        </a>
      </div>
    </div>
  )
}
