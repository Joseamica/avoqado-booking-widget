import { h } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import type { WidgetProps } from '../types'
import type { PublicSlot } from '../types'
import { createT } from '../i18n'
import * as api from '../api/booking'
import {
  step, venueInfo, selectedProduct, selectedDate, selectedSlot,
  bookingResult, isLoading, apiError, manageSecret, hasServiceStep,
  getStepConfig, resetBooking, showToast,
} from '../state/booking'
import { StepIndicator } from './StepIndicator'
import { ServiceSelector } from './ServiceSelector'
import { DatePicker } from './DatePicker'
import { TimeSlotPicker } from './TimeSlotPicker'
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

export function BookingFlow({ props }: BookingFlowProps) {
  const t = createT(props.locale)
  const [slots, setSlots] = useState<PublicSlot[]>([])
  const [slotsLoading, setSlotsLoading] = useState(false)

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
      <div class="flex items-center justify-center py-16">
        <Spinner size={32} />
      </div>
    )
  }

  if (apiError.value) {
    return (
      <div class="space-y-4 py-8 text-center">
        <p class="font-semibold text-[var(--avq-fg,#111827)]">{apiError.value}</p>
        <button
          type="button"
          onClick={() => { apiError.value = null; isLoading.value = false }}
          class="text-sm text-[var(--avq-accent,#6366f1)] underline"
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
      <div class="space-y-4 py-8 text-center">
        <h2 class="text-xl font-semibold text-[var(--avq-fg,#111827)]">{t('errors.bookingDisabled')}</h2>
        <p class="text-[var(--avq-muted-fg,#6b7280)]">{t('errors.bookingDisabledDescription')}</p>
        {info.phone && (
          <a
            href={`tel:${info.phone}`}
            class="inline-block rounded-lg border border-[var(--avq-border,#e5e7eb)] px-4 py-2.5 text-sm text-[var(--avq-fg,#111827)] hover:border-[var(--avq-accent,#6366f1)]"
          >
            {t('errors.bookingDisabledContact', { phone: info.phone })}
          </a>
        )}
      </div>
    )
  }

  // Manage booking screen
  if (step.value === MANAGE_STEP) {
    return (
      <ManageBooking
        venueSlug={props.venue}
        cancelSecret={manageSecret.value!}
        timezone={info.timezone}
        t={t}
        onBack={() => resetBooking(info)}
      />
    )
  }

  const config = getStepConfig(hasServiceStep.value)
  const stepLabels = hasServiceStep.value
    ? [t('steps.service'), t('steps.date'), t('steps.time'), t('steps.info'), t('steps.confirmation')]
    : [t('steps.date'), t('steps.time'), t('steps.info'), t('steps.confirmation')]

  const showBack = step.value > (hasServiceStep.value ? config.serviceStep : config.dateStep) && step.value < config.confirmStep

  function handleBack() {
    if (step.value === config.formStep) {
      fetchSlots() // Refresh capacity data when going back to time picker
      step.value = config.timeStep
    } else if (step.value === config.timeStep) step.value = config.dateStep
    else if (step.value === config.dateStep && hasServiceStep.value) step.value = config.serviceStep
  }

  async function handleFormSubmit(data: GuestFormData) {
    const slot = selectedSlot.value
    if (!slot) return
    isLoading.value = true
    try {
      const result = await api.createReservation(props.venue, {
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        duration: selectedProduct.value?.duration
          ?? Math.round((new Date(slot.endsAt).getTime() - new Date(slot.startsAt).getTime()) / 60000),
        guestName: data.guestName,
        guestPhone: data.guestPhone,
        guestEmail: data.guestEmail || undefined,
        partySize: data.partySize || undefined,
        productId: selectedProduct.value?.id,
        classSessionId: slot.classSessionId || undefined,
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
      <div class="mb-6 flex flex-col items-center gap-3">
        {info.logo ? (
          <img src={info.logo} alt={info.name} class="h-16 w-16 rounded-full object-cover" />
        ) : (
          <div class="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--avq-accent,#6366f1)] text-2xl font-bold text-white">
            {info.name.charAt(0).toUpperCase()}
          </div>
        )}
        <h1 class="text-xl font-semibold text-[var(--avq-fg,#111827)]">{info.name}</h1>
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
          class="mb-4 flex items-center gap-1 text-sm text-[var(--avq-muted-fg,#6b7280)] hover:text-[var(--avq-fg,#111827)] transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
          {t('actions.goBack')}
        </button>
      )}

      {/* Steps */}
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

      {step.value === config.timeStep && (
        <TimeSlotPicker
          slots={slots}
          selectedSlot={selectedSlot.value}
          onSelect={(slot) => {
            selectedSlot.value = slot
            step.value = config.formStep
          }}
          timezone={info.timezone}
          isLoading={slotsLoading}
          t={t}
        />
      )}

      {step.value === config.formStep && (
        <GuestInfoForm
          venueInfo={info}
          selectedSlot={selectedSlot.value}
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

      {/* Footer */}
      <div class="mt-8 text-center">
        <p class="text-xs text-[var(--avq-muted-fg,#6b7280)]">{t('poweredBy')}</p>
      </div>
    </div>
  )
}
