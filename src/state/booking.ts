import { signal, computed } from '@preact/signals'
import {
  abrirPagina, alCambiarLaPagina, borrarSesion, entrarAqui, epocaDe as epocaDeLaPagina, fijarPagina, guardarSesion, identidadDe, lecturaDe,
  leerSesion, paginaDe, renovarLaPagina, salioEnOtraPagina, soltarLaPagina, tokenDeLaPagina, type ContactoProbado, type Lectura, type Pagina,
  type SesionDeCliente, type Superficie,
} from '../lib/sesionDeCliente'
import { loadSession } from '../order/session'
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

/** Lo de la UI de reservas que se estaciona al cambiar de negocio en la misma página. La SESIÓN no: ésa es del guardián. */
interface VenueUi {
  portalData: CustomerPortalData | null
  bookingAccess: BookingAccessState | null
}
const uiByVenue = new Map<string, VenueUi>()

function dropLegacyGlobalKeys() {
  try { LEGACY_GLOBAL_KEYS.forEach(k => localStorage.removeItem(k)) } catch { /* storage blocked */ }
}

/**
 * Lo que reservas lee AHORA de lo guardado (W1, rediseño codex-r2): la sesión única (cookie de avoqado.io, o `localStorage`
 * incrustado) manda. El token de reservas de hoy sólo cuenta si no hay sesión única ni marca de salida de la otra página.
 */
function vigente(slug: string): Lectura | null {
  const nueva = leerSesion(slug)
  if (nueva) return { token: nueva.token, identidad: identidadDe(nueva), datos: nueva.customer }
  if (salioEnOtraPagina(slug)) {
    borrarSesion(slug)
    return null
  }
  try {
    const token = localStorage.getItem(tokenKey(slug))
    const raw = localStorage.getItem(customerKey(slug))
    return token ? { token, identidad: `hoy:reservas|${token}`, datos: raw ? JSON.parse(raw) as CustomerInfo : null } : null
  } catch { return null }
}
const leer = (slug: string) => () => vigente(slug)
/** W4: lo que lee AHORA cada superficie («Mi cuenta» vive en las dos: reservas y la tienda). */
export const lectorDe = (slug: string, s: Superficie): (() => Lectura | null) => (s === 'reservas' ? leer(slug) : () => loadSession(slug))

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

/** Época de la sesión de reservas en la página (el guardián): una respuesta de otra época no se pinta. */
export const epocaDe = (slug: string): number => epocaDeLaPagina(slug, 'reservas')

/** La sesión de la página vista desde reservas: la única o su token de hoy (el de la tienda no es suyo). */
const mia = (slug: string): Pagina | null => paginaDe(slug, 'reservas')

/**
 * W1, alcance A: la sesión de la página es la del guardián (`lib/sesionDeCliente`), una por negocio y documento, compartida con la
 * tienda. Cada cambio repinta las señales del negocio a la vista; si cambió quién está adentro, se suelta lo cargado (portal, acceso,
 * créditos y su selección).
 */
alCambiarLaPagina((slug, afecta, misma) => {
  if (!afecta.includes('reservas')) return
  if (!misma) uiByVenue.delete(slug)
  if (activeVenueSlug.value !== slug) return
  const p = mia(slug)
  const info = (p?.datos as CustomerInfo | null | undefined) ?? null
  customerToken.value = p?.token ?? null
  if (JSON.stringify(customerInfo.value) !== JSON.stringify(info)) customerInfo.value = info
  if (!misma) {
    portalData.value = null
    bookingAccess.value = null
    customerCredits.value = null
    selectedCreditBalance.value = null
  }
})

/** El token con que esta página MANDA desde reservas (el guardián decide; nunca toma otra sesión). */
export function tokenParaMandar(slug: string, delLlamador?: string | null): string | null {
  return tokenDeLaPagina(slug, 'reservas', leer(slug), delLlamador)
}

/**
 * Entró en ESTA página por `EntrarConCuenta` (que ya la guardó): reservas adopta EXACTAMENTE esa sesión, sin releer lo guardado (r11:
 * otra pestaña pudo escribir otra justo después).
 */
export function entroAqui(slug: string, sesion: Pick<SesionDeCliente, 'token' | 'customer' | 'contactos'>): void {
  fijarPagina(slug, 'reservas', lecturaDe(sesion))
}

/** El SERVIDOR renovó (`x-customer-session`) el token que mandó esta página: sigue con el renovado (la misma sesión). */
export function adoptarRenovacion(slug: string, enviado: string): void {
  renovarLaPagina(slug, 'reservas', enviado, leer(slug))
}

/**
 * Point the session signals at `slug`. Idempotent; call it from every element
 * that mounts with a `venue` attribute, BEFORE any authenticated request.
 * W1 (alcance A): abrir la página lee la sesión guardada UNA vez por documento (`abrirPagina`); montar otro elemento del mismo
 * negocio, o recrearlo, nunca la relee.
 */
export function bindCustomerSessionToVenue(slug: string) {
  if (!slug) return
  dropLegacyGlobalKeys()
  const prev = activeVenueSlug.value
  // Park the outgoing venue's in-memory bits (portalData/bookingAccess aren't persisted).
  if (prev && prev !== slug) uiByVenue.set(prev, { portalData: portalData.value, bookingAccess: bookingAccess.value })
  activeVenueSlug.value = slug
  abrirPagina(slug, 'reservas', leer(slug))
  if (prev === slug) return
  const p = mia(slug)
  const ui = uiByVenue.get(slug)
  customerToken.value = p?.token ?? null
  customerInfo.value = (p?.datos as CustomerInfo | null | undefined) ?? null
  portalData.value = ui?.portalData ?? null
  bookingAccess.value = ui?.bookingAccess ?? null
}

/**
 * Save a customer session FOR `slug` (the caller always knows its venue: `props.venue` /
 * `venueSlug`). The live signals only change when `slug` is the active one — so a login
 * finished in venue A's portal can never be stored under venue B's key, nor repaint B's UI (auditoría 4).
 * W1: con `contactos` es una entrada en esta página (se guarda y la página la toma). Sin ellos son los datos al día de la ficha de
 * ESTA página (perfil, portal): sólo tocan lo guardado si sigue siendo su sesión; nunca otra ficha, nunca un token, y nada si la
 * página ya salió (codex-r3 H2, codex-r4 R4-2).
 */
export function setCustomerSession(
  slug: string,
  token: string,
  customer: CustomerInfo,
  access?: BookingAccessState | null,
  contactos?: ContactoProbado[],
): 'guardada' | 'memoria' | 'fallo' | undefined {
  const p = mia(slug)
  let guardada: ReturnType<typeof entrarAqui> | undefined
  if (contactos) {
    // r11: guarda y adopta EXACTAMENTE ésa, sin releer.
    guardada = entrarAqui(slug, 'reservas', { token, customer, contactos, guardadaEn: Date.now() })
  } else if (p && (p.token === token || (p.datos as CustomerInfo | null | undefined)?.id === customer.id)) {
    const nueva = leerSesion(slug)
    if (nueva) {
      if (identidadDe(nueva) === p.identidad) guardarSesion(slug, { ...nueva, customer })
    } else if (p.identidad.startsWith('hoy:')) {
      try { localStorage.setItem(customerKey(slug), JSON.stringify(customer)) } catch { /* storage blocked */ }
    }
    fijarPagina(slug, 'reservas', { token: p.token, identidad: p.identidad, datos: customer })
  }
  if (access === undefined) return guardada
  if (activeVenueSlug.value === slug) bookingAccess.value = access
  else if (mia(slug)) uiByVenue.set(slug, { portalData: uiByVenue.get(slug)?.portalData ?? null, bookingAccess: access })
  return guardada
}

/**
 * Clear the customer session OF `slug` only. A 401 raised by venue A's widget must never
 * wipe venue B's stored session (auditoría 4). Signals are cleared only if `slug` is active.
 * W1 (alcance A): «Cerrar sesión» (sin token) o un 401 (`tokenQueFallo`), por el guardián (`soltarLaPagina`).
 */
export function clearCustomerSession(slug: string, tokenQueFallo?: string) {
  soltarLaPagina(slug, 'reservas', tokenQueFallo, leer(slug))
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
