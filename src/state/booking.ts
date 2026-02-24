import { signal, computed } from '@preact/signals'
import type { PublicVenueInfo, Product, PublicSlot, PublicBookingResult } from '../types'

// Step: 0=loading, 1=service, 2=date, 3=time, 4=form, 5=confirmed, 6=manage
export const step = signal(0)

export const venueInfo = signal<PublicVenueInfo | null>(null)
export const selectedProduct = signal<Product | null>(null)
export const selectedDate = signal<string | null>(null)   // YYYY-MM-DD
export const selectedSlot = signal<PublicSlot | null>(null)
export const bookingResult = signal<PublicBookingResult | null>(null)

export const isLoading = signal(false)
export const apiError = signal<string | null>(null)
export const toastMessage = signal<{ text: string; type: 'success' | 'error' } | null>(null)

// Manage booking state
export const manageSecret = signal<string | null>(null)

export const hasServiceStep = computed(() => (venueInfo.value?.products.length ?? 0) > 1)

export function getStepConfig(hasService: boolean) {
  if (hasService) {
    return { totalSteps: 5, serviceStep: 1, dateStep: 2, timeStep: 3, formStep: 4, confirmStep: 5 }
  }
  return { totalSteps: 4, serviceStep: 0, dateStep: 1, timeStep: 2, formStep: 3, confirmStep: 4 }
}

export function resetBooking(venueData: PublicVenueInfo) {
  const config = getStepConfig((venueData.products.length) > 1)
  selectedSlot.value = null
  bookingResult.value = null
  selectedDate.value = null
  manageSecret.value = null
  if (venueData.products.length <= 1) {
    selectedProduct.value = venueData.products[0] ?? null
    step.value = config.dateStep
  } else {
    selectedProduct.value = null
    step.value = config.serviceStep
  }
}

export function showToast(text: string, type: 'success' | 'error' = 'success') {
  toastMessage.value = { text, type }
  setTimeout(() => { toastMessage.value = null }, 4000)
}
