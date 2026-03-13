import { signal, computed } from '@preact/signals'
import type { PublicVenueInfo, Product, PublicSlot, PublicBookingResult, CreditPackPublic, CustomerCreditBalance, CustomerPortalData } from '../types'

// Step: 0=loading, 1=service, 2=date, 3=time, 4=form, 5=confirmed, 6=manage
export const step = signal(0)

export const venueInfo = signal<PublicVenueInfo | null>(null)
export const selectedProduct = signal<Product | null>(null)
export const selectedDate = signal<string | null>(null)   // YYYY-MM-DD
export const selectedSlot = signal<PublicSlot | null>(null)
export const selectedSpotIds = signal<string[]>([])
export const bookingResult = signal<PublicBookingResult | null>(null)

export const isLoading = signal(false)
export const apiError = signal<string | null>(null)
export const toastMessage = signal<{ text: string; type: 'success' | 'error' } | null>(null)

// Manage booking state
export const manageSecret = signal<string | null>(null)

// Credit pack state
export const creditPacks = signal<CreditPackPublic[]>([])
export const customerCredits = signal<CustomerCreditBalance | null>(null)
export const selectedCreditBalance = signal<{ balanceId: string; productId: string } | null>(null)
export const creditPacksLoading = signal(false)

// Customer session state (persisted in localStorage)
export interface CustomerInfo {
  id: string
  firstName: string | null
  lastName: string | null
  email: string | null
  phone: string | null
}
const STORAGE_TOKEN = 'avq_customer_token'
const STORAGE_CUSTOMER = 'avq_customer_info'

// Hydrate from localStorage immediately (synchronous — no race conditions)
function hydrateCustomer(): { token: string | null; info: CustomerInfo | null } {
  try {
    const token = localStorage.getItem(STORAGE_TOKEN)
    const raw = localStorage.getItem(STORAGE_CUSTOMER)
    const info = raw ? JSON.parse(raw) as CustomerInfo : null
    return { token, info }
  } catch { return { token: null, info: null } }
}
const _hydrated = hydrateCustomer()

export const customerToken = signal<string | null>(_hydrated.token)
export const customerInfo = signal<CustomerInfo | null>(_hydrated.info)

// Customer portal state (async, loaded after login)
export const portalData = signal<CustomerPortalData | null>(null)
export const portalLoading = signal(false)
export const showPortal = signal(false)

/** Save customer session to localStorage + signals */
export function setCustomerSession(token: string, customer: CustomerInfo) {
  customerToken.value = token
  customerInfo.value = customer
  localStorage.setItem(STORAGE_TOKEN, token)
  localStorage.setItem(STORAGE_CUSTOMER, JSON.stringify(customer))
}

/** Clear customer session */
export function clearCustomerSession() {
  customerToken.value = null
  customerInfo.value = null
  portalData.value = null
  localStorage.removeItem(STORAGE_TOKEN)
  localStorage.removeItem(STORAGE_CUSTOMER)
}

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
  selectedSpotIds.value = []
  bookingResult.value = null
  selectedDate.value = null
  manageSecret.value = null
  customerCredits.value = null
  selectedCreditBalance.value = null
  // Keep portalData & customerToken — they're session-level, not booking-level
  showPortal.value = false
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
