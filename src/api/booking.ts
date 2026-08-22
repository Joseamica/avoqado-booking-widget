import type {
  PublicVenueInfo,
  PublicAvailabilityResponse,
  PublicClassSessionRangeResponse,
  PublicCreateReservationRequest,
  PublicBookingResult,
  PublicReservationDetail,
  CreditPackPublic,
  CustomerCreditBalance,
  CustomerPortalData,
  ModifierSelection,
} from '../types'

const BASE = (import.meta.env?.VITE_API_URL as string | undefined)
  || 'https://api.avoqado.io/api/v1/public'

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'ngrok-skip-browser-warning': '1',
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) {
    let err: any
    try { err = await res.json() } catch { err = { message: `HTTP ${res.status}` } }
    const e = Object.assign(new Error(err.message ?? 'Request failed'), { status: res.status, data: err })
    throw e
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

export function getVenueInfo(slug: string): Promise<PublicVenueInfo> {
  return request(`${BASE}/venues/${slug}/info`)
}

export function getAvailability(slug: string, params: {
  date: string
  duration?: number
  partySize?: number
  productId?: string
  productIds?: string[]
  staffId?: string
  windowSemantics?: 'base'
  /**
   * Optional flow filter. Server narrows the candidate products it considers
   * when computing slots. Useful when the customer is on /clases (only show
   * class sessions) vs /citas (only show appointments). Omit for the legacy
   * unified behavior.
   */
  type?: 'class' | 'appointment'
}): Promise<PublicAvailabilityResponse> {
  const q = new URLSearchParams({ date: params.date })
  if (params.duration) q.append('duration', String(params.duration))
  if (params.partySize) q.append('partySize', String(params.partySize))
  if (params.productId) q.append('productId', params.productId)
  if (params.productIds?.length) q.append('productIds', params.productIds.join(','))
  if (params.staffId) q.append('staffId', params.staffId)
  if (params.windowSemantics) q.append('windowSemantics', params.windowSemantics)
  if (params.type) q.append('type', params.type)
  return request(`${BASE}/venues/${slug}/availability?${q}`)
}

/**
 * Range-mode availability used by the date-first class-sessions listing.
 * Returns sessions across all CLASS products of the venue between dateFrom and
 * dateTo (server caps the window at +60 days). Designed for `/clases` host page.
 */
export function getClassSessionsRange(slug: string, params: {
  dateFrom: string  // YYYY-MM-DD
  dateTo?: string   // YYYY-MM-DD; defaults server-side to dateFrom + 30d
  productId?: string  // optional scope to one CLASS product
}): Promise<PublicClassSessionRangeResponse> {
  const q = new URLSearchParams({ dateFrom: params.dateFrom, type: 'class' })
  if (params.dateTo) q.append('dateTo', params.dateTo)
  if (params.productId) q.append('productId', params.productId)
  return request(`${BASE}/venues/${slug}/availability?${q}`)
}

export function createReservation(
  slug: string,
  data: PublicCreateReservationRequest,
  /** Optional Bearer JWT. When passed, the server stamps customerId on the
   *  reservation so the booking shows up in the customer's portal history.
   *  Anonymous reservations omit this and the row stays guest-only. */
  token?: string,
): Promise<PublicBookingResult> {
  return request(`${BASE}/venues/${slug}/reservations`, {
    method: 'POST',
    body: JSON.stringify(data),
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })
}

// ==================== Slot Hold (Square countdown UX) ====================

export interface CreateHoldRequest {
  startsAt: string  // ISO 8601
  endsAt: string    // ISO 8601
  productIds?: string[]
  classSessionId?: string
  partySize?: number
  fingerprint?: string
  staffId?: string
  modifierSelections?: ModifierSelection[]
  windowSemantics?: 'base'
}

export interface CreateHoldResponse {
  holdId: string
  expiresAt: string  // ISO 8601 — widget reads this to drive the countdown
  ttlSeconds: number
  /** Server-selected Staff.id when the customer chose "anyone". */
  staffId?: string
}

/** Creates a SlotHold and returns its id + expiry. The widget plumbs the
 *  holdId onto its createReservation call so the server can consume it
 *  transactionally on success. Falls back gracefully (no hold) if this 404s. */
export function createHold(slug: string, data: CreateHoldRequest): Promise<CreateHoldResponse> {
  return request(`${BASE}/venues/${slug}/reservations/hold`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

/** Releases a hold the customer no longer needs (e.g. went back to pick a
 *  different slot). Idempotent — missing hold returns 204. */
export function cancelHold(slug: string, holdId: string): Promise<void> {
  return request(`${BASE}/venues/${slug}/reservations/hold/${holdId}`, { method: 'DELETE' })
}

/** Absolute/configured endpoint for the unload-time keepalive cleanup. */
export function holdReleaseUrl(slug: string, holdId: string): string {
  return `${BASE}/venues/${encodeURIComponent(slug)}/reservations/hold/${encodeURIComponent(holdId)}`
}

export function getReservation(slug: string, cancelSecret: string): Promise<PublicReservationDetail> {
  return request(`${BASE}/venues/${slug}/reservations/${cancelSecret}`)
}

export function cancelReservation(slug: string, cancelSecret: string, reason?: string): Promise<{ confirmationCode: string; status: string; cancelledAt: string }> {
  return request(`${BASE}/venues/${slug}/reservations/${cancelSecret}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  })
}

export function rescheduleReservation(
  slug: string,
  cancelSecret: string,
  body: { classSessionId: string; spotIds?: string[] },
): Promise<{ confirmationCode: string; status: string; startsAt: string; endsAt: string; partySize: number; spotIds: string[] }> {
  return request(`${BASE}/venues/${slug}/reservations/${cancelSecret}/reschedule`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

// ---- Appointment reschedule (scoped by cancelSecret; excludes self server-side) ----

/** Offered slots of the SAME service for `date`, excluding the reservation being
 *  moved (so adjacent/overlapping slots show). */
export function getRescheduleAvailability(
  slug: string,
  cancelSecret: string,
  params: { date: string },
): Promise<PublicAvailabilityResponse> {
  const q = new URLSearchParams({ date: params.date })
  return request(`${BASE}/venues/${slug}/reservations/${cancelSecret}/reschedule/availability?${q}`)
}

/** Reserve the target appointment slot for ~10 min before confirming. */
export function createRescheduleHold(
  slug: string,
  cancelSecret: string,
  body: { startsAt: string; endsAt: string },
): Promise<CreateHoldResponse> {
  return request(`${BASE}/venues/${slug}/reservations/${cancelSecret}/reschedule/hold`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

/** Confirm an appointment reschedule to `startsAt` (consuming the hold). */
export function rescheduleAppointment(
  slug: string,
  cancelSecret: string,
  body: { startsAt: string; holdId?: string },
): Promise<{ confirmationCode: string; status: string; startsAt: string; endsAt: string }> {
  return request(`${BASE}/venues/${slug}/reservations/${cancelSecret}/reschedule`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

// ==================== Credit Packs ====================

export function getCreditPacks(slug: string, productId?: string): Promise<CreditPackPublic[]> {
  const q = new URLSearchParams()
  if (productId) q.append('productId', productId)
  const qs = q.toString()
  return request(`${BASE}/venues/${slug}/credit-packs${qs ? `?${qs}` : ''}`)
}

/**
 * Credit balance of the LOGGED-IN customer (Fase 0.B).
 *
 * The server now resolves the balance from the session token — never from
 * email/phone (knowing someone's email used to be enough to see and spend
 * their credits). Without a token the server answers 401
 * `CUSTOMER_AUTH_REQUIRED`; callers should skip the call for guests.
 */
export function getCustomerCredits(slug: string, params: {
  seats?: number
  productId?: string
  /** Multi-service /appointments: pass every selected productId so the server
   *  returns balances for any of them in a single round trip. Wins over
   *  `productId` when both are present. */
  productIds?: string[]
}, token: string): Promise<CustomerCreditBalance> {
  const q = new URLSearchParams()
  if (params.seats != null) q.append('seats', String(params.seats))
  if (params.productIds && params.productIds.length > 0) {
    q.append('productIds', params.productIds.join(','))
  } else if (params.productId) {
    q.append('productId', params.productId)
  }
  return request(`${BASE}/venues/${slug}/credit-packs/balance?${q}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

/**
 * Fase 0.B: with a session token the purchase is bound to THAT customer
 * (server puts `customerId` in the Stripe metadata and fulfills by id, never
 * by the email typed in the form). Guests (no token) still buy by contact.
 */
export function createPackCheckout(slug: string, packId: string, data: {
  email?: string; phone: string; successUrl: string; cancelUrl: string
}, token?: string | null): Promise<{ checkoutUrl: string }> {
  return request(`${BASE}/venues/${slug}/credit-packs/${packId}/checkout`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: JSON.stringify(data),
  })
}

// ==================== Customer Portal ====================

/**
 * Fase 0.B — "can this customer create a reservation here?" Composed by the
 * server in this order: PLAN (venue has RESERVATIONS·PRO) → PUBLIC_BOOKING_OFF
 * (venue turned public booking off) → APPROVAL (Fase 1: per-customer approval).
 * `blockedBy` is the FIRST one that fails. Present on login / register /
 * otp-verify / portal responses; optional because older servers omit it.
 */
export interface BookingAccess {
  status: 'APPROVED' | 'PENDING' | 'REJECTED'
  canCreateReservation: boolean
  blockedBy?: 'PLAN' | 'PUBLIC_BOOKING_OFF' | 'APPROVAL'
}

export interface AuthResponse {
  token: string
  customer: {
    id: string
    firstName: string | null
    lastName: string | null
    email: string | null
    phone: string | null
  }
  bookingAccess?: BookingAccess
}

export function customerRegister(slug: string, data: {
  email: string; password: string; phone?: string; firstName?: string; lastName?: string
}): Promise<AuthResponse> {
  return request(`${BASE}/venues/${slug}/customer/register`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export function customerLogin(slug: string, data: { email: string; password: string }): Promise<AuthResponse> {
  return request(`${BASE}/venues/${slug}/customer/login`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export function requestOtp(slug: string, data: { phone?: string; email?: string }): Promise<{ ok: true }> {
  return request(`${BASE}/venues/${slug}/auth/otp/request`, { method: 'POST', body: JSON.stringify(data) })
}

export function verifyOtp(slug: string, data: { phone?: string; email?: string; code: string }): Promise<AuthResponse> {
  return request(`${BASE}/venues/${slug}/auth/otp/verify`, { method: 'POST', body: JSON.stringify(data) })
}

export function getCustomerPortal(slug: string, token: string): Promise<CustomerPortalData> {
  return request(`${BASE}/venues/${slug}/customer/portal`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function updateCustomerProfile(slug: string, token: string, data: {
  firstName?: string; lastName?: string; phone?: string
}): Promise<{ customer: AuthResponse['customer'] }> {
  return request(`${BASE}/venues/${slug}/customer/profile`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  })
}
