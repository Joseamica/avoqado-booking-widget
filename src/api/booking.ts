import type {
  PublicVenueInfo,
  PublicAvailabilityResponse,
  PublicCreateReservationRequest,
  PublicBookingResult,
  PublicReservationDetail,
  CreditPackPublic,
  CustomerCreditBalance,
  CustomerPortalData,
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
}): Promise<PublicAvailabilityResponse> {
  const q = new URLSearchParams({ date: params.date })
  if (params.duration) q.append('duration', String(params.duration))
  if (params.partySize) q.append('partySize', String(params.partySize))
  if (params.productId) q.append('productId', params.productId)
  return request(`${BASE}/venues/${slug}/availability?${q}`)
}

export function createReservation(slug: string, data: PublicCreateReservationRequest): Promise<PublicBookingResult> {
  return request(`${BASE}/venues/${slug}/reservations`, { method: 'POST', body: JSON.stringify(data) })
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

// ==================== Credit Packs ====================

export function getCreditPacks(slug: string, productId?: string): Promise<CreditPackPublic[]> {
  const q = new URLSearchParams()
  if (productId) q.append('productId', productId)
  const qs = q.toString()
  return request(`${BASE}/venues/${slug}/credit-packs${qs ? `?${qs}` : ''}`)
}

export function getCustomerCredits(slug: string, params: {
  email?: string
  phone?: string
  seats?: number
  productId?: string
}): Promise<CustomerCreditBalance> {
  const q = new URLSearchParams()
  if (params.email) q.append('email', params.email)
  if (params.phone) q.append('phone', params.phone)
  if (params.seats != null) q.append('seats', String(params.seats))
  if (params.productId) q.append('productId', params.productId)
  return request(`${BASE}/venues/${slug}/credit-packs/balance?${q}`)
}

export function createPackCheckout(slug: string, packId: string, data: {
  email?: string; phone: string; successUrl: string; cancelUrl: string
}): Promise<{ checkoutUrl: string }> {
  return request(`${BASE}/venues/${slug}/credit-packs/${packId}/checkout`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

// ==================== Customer Portal ====================

export interface AuthResponse {
  token: string
  customer: {
    id: string
    firstName: string | null
    lastName: string | null
    email: string | null
    phone: string | null
  }
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
