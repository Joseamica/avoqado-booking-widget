import { signal, computed } from '@preact/signals'
import type { PublicVenueInfo, Product, PublicSlot, PublicBookingResult, CreditPackPublic, CustomerCreditBalance, CustomerPortalData, FlowType } from '../types'

// Step: 0=loading, 1=service, 2=date, 3=time, 4=form, 5=confirmed, 6=manage
export const step = signal(0)

// Active flow variant. Set by BookingFlow's mount effect from props.flowType
// (which the host derives from the URL path segment). Default 'unified' keeps
// backwards compatibility for embeds that don't pass the attribute.
export const flowType = signal<FlowType>('unified')

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

/**
 * Products that surface in the active flow.
 * - 'appointments':  APPOINTMENTS_SERVICE / SERVICE / EVENT — anything not class-based
 * - 'classes': CLASS only
 * - 'unified': everything (legacy behavior)
 *
 * Type fallbacks: products without a `type` field are treated as services
 * (existing behavior — many older venues don't tag types).
 */
export const visibleProducts = computed<Product[]>(() => {
  const all = venueInfo.value?.products ?? []
  const flow = flowType.value
  if (flow === 'unified') return all
  if (flow === 'classes') {
    return all.filter(p => p.type === 'CLASS')
  }
  // 'appointments' — exclude classes; include unspecified types as services
  return all.filter(p => p.type !== 'CLASS')
})

export const hasServiceStep = computed(() => visibleProducts.value.length > 1)

export function getStepConfig(hasService: boolean) {
  if (hasService) {
    return { totalSteps: 5, serviceStep: 1, dateStep: 2, timeStep: 3, formStep: 4, confirmStep: 5 }
  }
  return { totalSteps: 4, serviceStep: 0, dateStep: 1, timeStep: 2, formStep: 3, confirmStep: 4 }
}

export function resetBooking(venueData: PublicVenueInfo) {
  // Recompute visible products with the active flowType so single-product venues
  // skip the service step in flow-filtered scenarios too.
  const all = venueData.products
  const visible = flowType.value === 'unified'
    ? all
    : flowType.value === 'classes'
      ? all.filter(p => p.type === 'CLASS')
      : all.filter(p => p.type !== 'CLASS')
  const config = getStepConfig(visible.length > 1)
  selectedSlot.value = null
  selectedSpotIds.value = []
  bookingResult.value = null
  selectedDate.value = null
  manageSecret.value = null
  customerCredits.value = null
  selectedCreditBalance.value = null
  // Keep portalData & customerToken — they're session-level, not booking-level
  showPortal.value = false
  // Class flow always lands on the date-first listing regardless of how many
  // CLASS products the venue has — picking a session sets selectedProduct from
  // the slot's productId. We use dateStep as the sentinel for "show the list"
  // since it's the step the listing logically replaces.
  if (flowType.value === 'classes') {
    selectedProduct.value = null
    step.value = config.dateStep
  } else if (visible.length <= 1) {
    selectedProduct.value = visible[0] ?? null
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
