import { signal, computed } from '@preact/signals'
import type { PublicVenueInfo, Product, PublicSlot, PublicBookingResult, CreditPackPublic, CustomerCreditBalance, CustomerPortalData, FlowType, ModifierSelection, ReservationBranding } from '../types'

/** Reservation branding defaults — used until the venue payload arrives (and as
 *  the fallback for older payloads that don't include `branding`). All toggles
 *  default to "show"; accentColor null = fall through to the accent-color attr /
 *  primaryColor. Mirrors DEFAULT_RESERVATION_BRANDING on the server. */
export const DEFAULT_BRANDING: ReservationBranding = {
  showLogo: true,
  accentColor: null,
  buttonShape: 'rounded',
  fontFamily: 'DM Sans',
  showHeroImage: true,
  showDescriptions: true,
  showDuration: true,
  showPrices: true,
}

/** Active reservation branding, populated from venueInfo.branding on load. */
export const branding = signal<ReservationBranding>(DEFAULT_BRANDING)

// Step: 0=loading, 1=service, 2=date, 3=time, 4=form, 5=confirmed, 6=manage
export const step = signal(0)

// Active flow variant. Set by BookingFlow's mount effect from props.flowType
// (which the host derives from the URL path segment). Default 'unified' keeps
// backwards compatibility for embeds that don't pass the attribute.
export const flowType = signal<FlowType>('unified')

export const venueInfo = signal<PublicVenueInfo | null>(null)
/** Single-product selection — used by the classes flow and any legacy embed
 *  that doesn't speak the multi-service protocol. The /appointments wizard
 *  reads selectedProducts (array, below); selectedProduct stays in sync as
 *  selectedProducts[0] when the appointments flow is active. */
export const selectedProduct = signal<Product | null>(null)
/** Multi-product selection for the Square-style /appointments wizard.
 *  Order matters — services run sequentially in the order they were added,
 *  so the sidebar Resumen and the eventual /reservations payload preserve it.
 *  Empty array = nothing picked yet, which gates the Siguiente CTA. */
export const selectedProducts = signal<Product[]>([])
/** Public Staff.id. null means "anyone" and lets the server auto-assign. */
export const selectedStaffId = signal<string | null>(null)
export const selectedDate = signal<string | null>(null)   // YYYY-MM-DD
export const selectedSlot = signal<PublicSlot | null>(null)
export const selectedSpotIds = signal<string[]>([])
/** Add-on / customization picks tied to a specific service in the multi-service
 *  appointment. Each entry has productId so a modifier group attached to two
 *  different services can be picked independently. Cleared on resetBooking,
 *  on removeSelectedProduct (for that product), and on replaceSelectedProduct. */
export const selectedModifiers = signal<ModifierSelection[]>([])
export const bookingResult = signal<PublicBookingResult | null>(null)

/** Hold token + expiry for the Square-style "Cita reservada durante 9:56" timer.
 *  Set when the customer enters the payment step and the backend hold endpoint
 *  succeeds. slotHoldExpiresAt is epoch milliseconds. */
export const slotHoldToken = signal<string | null>(null)
export const slotHoldExpiresAt = signal<number | null>(null)

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
/** True once the venue's credit pack list has resolved (or errored). Lets the
 *  landing-auto-skip effect distinguish "no packs configured" from "still
 *  loading" — both produce creditPacks.value.length === 0. */
export const creditPacksLoaded = signal(false)

// Customer session state (persisted in localStorage)
export interface CustomerInfo {
  id: string
  firstName: string | null
  lastName: string | null
  email: string | null
  phone: string | null
}
// ---------------------------------------------------------------------------
// Fase 0.B — the customer session is PER VENUE.
//
// A customer token is minted for ONE venue and the server now rejects it on any
// other (401 CUSTOMER_TOKEN_VENUE_MISMATCH). Before, the token lived under a
// single global localStorage key, so a visitor who logged in at venue A and
// then opened venue B's widget carried A's token into B (and B's 401 would
// wipe A's session). Now:
//   - localStorage keys are namespaced: `avq_customer_token:<slug>` /
//     `avq_customer_info:<slug>`;
//   - an in-memory Map keeps one session per slug;
//   - `bindCustomerSessionToVenue(slug)` (called by the mounting element)
//     loads that slug's session into the signals;
//   - the legacy global keys are deleted on first load (one re-login, once).
//
// Known limit (declared, not hidden): the signals below are a module
// singleton, so TWO widgets of DIFFERENT venues mounted on the SAME page share
// the live signals — the last one bound wins the UI (data already loaded for
// one venue can be painted inside the other's widget). What IS isolated:
// `setCustomerSession(slug, …)` / `clearCustomerSession(slug)` take the
// caller's venue explicitly, so a login finished in A is stored under A's
// key (never B's) and a 401 raised in A never wipes B's stored session; the
// server also rejects any cross-venue token. True per-element UI isolation
// needs per-instance stores (follow-up); book.avoqado.io mounts one venue.
// ---------------------------------------------------------------------------
const STORAGE_TOKEN_PREFIX = 'avq_customer_token'
const STORAGE_CUSTOMER_PREFIX = 'avq_customer_info'
const LEGACY_GLOBAL_KEYS = ['avq_customer_token', 'avq_customer_info']

const tokenKey = (slug: string) => `${STORAGE_TOKEN_PREFIX}:${slug}`
const customerKey = (slug: string) => `${STORAGE_CUSTOMER_PREFIX}:${slug}`

export interface BookingAccessState {
  status: 'APPROVED' | 'PENDING' | 'REJECTED'
  canCreateReservation: boolean
  blockedBy?: 'PLAN' | 'PUBLIC_BOOKING_OFF' | 'APPROVAL'
}

interface VenueSession {
  token: string | null
  info: CustomerInfo | null
  portalData: CustomerPortalData | null
  bookingAccess: BookingAccessState | null
}

const sessionByVenue = new Map<string, VenueSession>()

function dropLegacyGlobalKeys() {
  try { LEGACY_GLOBAL_KEYS.forEach(k => localStorage.removeItem(k)) } catch { /* storage blocked */ }
}

/** Read ONE venue's session from localStorage (synchronous — no race conditions). */
function hydrateCustomer(slug: string): VenueSession {
  try {
    const token = localStorage.getItem(tokenKey(slug))
    const raw = localStorage.getItem(customerKey(slug))
    const info = raw ? JSON.parse(raw) as CustomerInfo : null
    return { token, info, portalData: null, bookingAccess: null }
  } catch { return { token: null, info: null, portalData: null, bookingAccess: null } }
}

/** Slug whose session the signals currently reflect. */
export const activeVenueSlug = signal<string | null>(null)

export const customerToken = signal<string | null>(null)
export const customerInfo = signal<CustomerInfo | null>(null)

// Customer portal state (async, loaded after login)
export const portalData = signal<CustomerPortalData | null>(null)
export const portalLoading = signal(false)
export const showPortal = signal(false)

/** Fase 0.B — "¿puedo reservar aquí?", as the server computed it at login/portal. */
export const bookingAccess = signal<BookingAccessState | null>(null)

/**
 * Point the session signals at `slug`. Idempotent; call it from every element
 * that mounts with a `venue` attribute, BEFORE any authenticated request.
 */
export function bindCustomerSessionToVenue(slug: string) {
  if (!slug) return
  dropLegacyGlobalKeys()
  if (activeVenueSlug.value === slug) return
  // Park the outgoing venue's in-memory bits (portalData/bookingAccess aren't persisted).
  const prev = activeVenueSlug.value
  if (prev) {
    sessionByVenue.set(prev, {
      token: customerToken.value,
      info: customerInfo.value,
      portalData: portalData.value,
      bookingAccess: bookingAccess.value,
    })
  }
  const next = sessionByVenue.get(slug) ?? hydrateCustomer(slug)
  sessionByVenue.set(slug, next)
  activeVenueSlug.value = slug
  customerToken.value = next.token
  customerInfo.value = next.info
  portalData.value = next.portalData
  bookingAccess.value = next.bookingAccess
}

/**
 * Save a customer session FOR `slug` (the caller always knows its venue: `props.venue` /
 * `venueSlug`). Writes that venue's storage + Map entry; the live signals only change when
 * `slug` is the active one — so a login finished in venue A's portal can never be stored
 * under venue B's key, nor repaint B's UI (auditoría 4).
 */
export function setCustomerSession(slug: string, token: string, customer: CustomerInfo, access?: BookingAccessState | null) {
  const isActive = activeVenueSlug.value === slug
  const prev = sessionByVenue.get(slug)
  const next: VenueSession = {
    token,
    info: customer,
    portalData: isActive ? portalData.value : (prev?.portalData ?? null),
    bookingAccess: access !== undefined ? access : isActive ? bookingAccess.value : (prev?.bookingAccess ?? null),
  }
  sessionByVenue.set(slug, next)
  if (isActive) {
    customerToken.value = token
    customerInfo.value = customer
    if (access !== undefined) bookingAccess.value = access
  }
  try {
    localStorage.setItem(tokenKey(slug), token)
    localStorage.setItem(customerKey(slug), JSON.stringify(customer))
  } catch { /* storage blocked (3rd-party iframe) — session lives in memory */ }
}

/**
 * Clear the customer session OF `slug` only. A 401 raised by venue A's widget must never
 * wipe venue B's stored session (auditoría 4). Signals are cleared only if `slug` is active.
 */
export function clearCustomerSession(slug: string) {
  sessionByVenue.set(slug, { token: null, info: null, portalData: null, bookingAccess: null })
  if (activeVenueSlug.value === slug) {
    customerToken.value = null
    customerInfo.value = null
    portalData.value = null
    bookingAccess.value = null
  }
  try {
    localStorage.removeItem(tokenKey(slug))
    localStorage.removeItem(customerKey(slug))
  } catch { /* storage blocked */ }
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
export const hasStaffStep = computed(
  () => flowType.value === 'appointments' && venueInfo.value?.staffSelection?.enabled === true,
)

/** Combined duration of all selected products PLUS picked modifier duration deltas,
 *  in minutes. Used by the date/time picker to query availability for the full
 *  appointment span (Square pattern: if you pick a 45-min Iyashi + a 15-min
 *  recolección, we look for 60-min slots; if a modifier adds 20 min, 80-min slots). */
export const totalDuration = computed<number>(() => {
  const products = selectedProducts.value
  const baseDuration =
    products.length === 0 ? selectedProduct.value?.duration ?? 0 : products.reduce((sum, p) => sum + (p.duration ?? 0), 0)

  // Add modifier duration deltas. Skip picks whose modifier can't be resolved —
  // the server rejects those at booking time anyway.
  const mods = selectedModifiers.value
  if (mods.length === 0) return baseDuration
  const productById = new Map<string, Product>()
  const allProducts = venueInfo.value?.products ?? []
  for (const p of allProducts) productById.set(p.id, p)
  let durationDelta = 0
  for (const sel of mods) {
    const product = productById.get(sel.productId)
    if (!product?.modifierGroups) continue
    for (const group of product.modifierGroups) {
      const m = group.modifiers.find(mm => mm.id === sel.modifierId)
      if (m?.durationMin != null) durationDelta += m.durationMin * sel.quantity
    }
  }
  return baseDuration + durationDelta
})

/** Combined price of all selected products PLUS picked modifier deltas. Returns
 *  null when ANY product has variable pricing (price === null), so the sidebar
 *  can render "+$X" with the variable note instead of a misleading total. */
export const totalPrice = computed<number | null>(() => {
  const products = selectedProducts.value
  const mods = selectedModifiers.value

  let modifierTotal = 0
  if (mods.length > 0) {
    // Look up modifier prices via the venue payload (each product carries its
    // assigned modifierGroups). Skip picks whose modifier we can't resolve —
    // the server will reject those at booking time.
    const productById = new Map<string, Product>()
    const allProducts = venueInfo.value?.products ?? []
    for (const p of allProducts) productById.set(p.id, p)
    for (const sel of mods) {
      const product = productById.get(sel.productId)
      if (!product?.modifierGroups) continue
      for (const group of product.modifierGroups) {
        const m = group.modifiers.find(mm => mm.id === sel.modifierId)
        if (m) modifierTotal += m.price * sel.quantity
      }
    }
  }

  if (products.length === 0) {
    const p = selectedProduct.value
    if (p == null) return modifierTotal === 0 ? null : modifierTotal
    // Coerce: Prisma Decimal serializes as a string ("350"), so `+` would
    // string-concat with modifierTotal — gave "$3,500" on the /classes
    // checkout for a $350 class.
    return p.price == null ? null : Number(p.price) + modifierTotal
  }
  let sum = 0
  for (const p of products) {
    if (p.price == null) return null
    sum += Number(p.price)
  }
  return sum + modifierTotal
})

/** Push a product onto the multi-service selection. Idempotent — re-adding the
 *  same product replaces the existing entry (same identity, no duplicate row). */
export function addSelectedProduct(product: Product) {
  const current = selectedProducts.value
  const idx = current.findIndex(p => p.id === product.id)
  if (idx >= 0) {
    const next = [...current]
    next[idx] = product
    selectedProducts.value = next
  } else {
    selectedProducts.value = [...current, product]
  }
  // Keep the legacy single-product signal in sync for downstream consumers
  // (classes flow, time-slot query, etc.) that still read selectedProduct.
  selectedProduct.value = selectedProducts.value[0] ?? null
  selectedStaffId.value = null
  selectedDate.value = null
  selectedSlot.value = null
}

/** Remove a product from the multi-service selection by id. */
export function removeSelectedProduct(productId: string) {
  selectedProducts.value = selectedProducts.value.filter(p => p.id !== productId)
  selectedProduct.value = selectedProducts.value[0] ?? null
  selectedModifiers.value = selectedModifiers.value.filter(s => s.productId !== productId)
  selectedStaffId.value = null
  selectedDate.value = null
  selectedSlot.value = null
}

/** Replace one product with another (used by ServiceDetailView's Actualizar
 *  action — keeps the sidebar order stable when the customer swaps options). */
export function replaceSelectedProduct(oldId: string, next: Product) {
  const current = selectedProducts.value
  const idx = current.findIndex(p => p.id === oldId)
  if (idx < 0) {
    addSelectedProduct(next)
    return
  }
  const updated = [...current]
  updated[idx] = next
  selectedProducts.value = updated
  selectedProduct.value = updated[0] ?? null
  selectedModifiers.value = selectedModifiers.value.filter(s => s.productId !== oldId)
  selectedStaffId.value = null
  selectedDate.value = null
  selectedSlot.value = null
}

export function clearSelectedProducts() {
  selectedProducts.value = []
  selectedProduct.value = null
  selectedModifiers.value = []
  selectedStaffId.value = null
  selectedDate.value = null
  selectedSlot.value = null
}

/** Replace all modifier selections (used by the picker's onChange). */
export function setSelectedModifiers(next: ModifierSelection[]) {
  selectedModifiers.value = next
  selectedStaffId.value = null
  selectedDate.value = null
  selectedSlot.value = null
}

/** Drop modifier selections for a single product (used when a product is removed). */
export function clearModifiersForProduct(productId: string) {
  selectedModifiers.value = selectedModifiers.value.filter(s => s.productId !== productId)
  selectedStaffId.value = null
  selectedDate.value = null
  selectedSlot.value = null
}

/** Clear all modifier selections. */
export function clearAllModifiers() {
  selectedModifiers.value = []
  selectedStaffId.value = null
  selectedDate.value = null
  selectedSlot.value = null
}

export function getStepConfig(hasService: boolean, hasStaff: boolean = false) {
  let cursor = 1
  const serviceStep = hasService ? cursor++ : 0
  const staffStep = hasStaff ? cursor++ : 0
  const dateStep = cursor++
  const timeStep = cursor++
  const formStep = cursor++
  const confirmStep = cursor
  return { totalSteps: confirmStep, serviceStep, staffStep, dateStep, timeStep, formStep, confirmStep }
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
  const staffSelectionEnabled = flowType.value === 'appointments' && venueData.staffSelection?.enabled === true
  const config = getStepConfig(visible.length > 1, staffSelectionEnabled)
  selectedSlot.value = null
  selectedSpotIds.value = []
  selectedProducts.value = []
  selectedStaffId.value = null
  selectedModifiers.value = []
  bookingResult.value = null
  selectedDate.value = null
  manageSecret.value = null
  customerCredits.value = null
  selectedCreditBalance.value = null
  slotHoldToken.value = null
  slotHoldExpiresAt.value = null
  // Keep portalData & customerToken — they're session-level, not booking-level
  showPortal.value = false
  // Class flow always lands on the date-first listing regardless of how many
  // CLASS products the venue has — picking a session sets selectedProduct from
  // the slot's productId. We use dateStep as the sentinel for "show the list"
  // since it's the step the listing logically replaces.
  if (flowType.value === 'classes') {
    selectedProduct.value = null
    selectedProducts.value = []
    step.value = config.dateStep
  } else if (visible.length <= 1) {
    selectedProduct.value = visible[0] ?? null
    // Mirror to selectedProducts so the Square sidebar Resumen renders the
    // single product without forcing the user through the (skipped) service step.
    selectedProducts.value = visible[0] ? [visible[0]] : []
    step.value = config.staffStep || config.dateStep
  } else {
    selectedProduct.value = null
    selectedProducts.value = []
    step.value = config.serviceStep
  }
}

export function showToast(text: string, type: 'success' | 'error' = 'success') {
  toastMessage.value = { text, type }
  setTimeout(() => { toastMessage.value = null }, 4000)
}
