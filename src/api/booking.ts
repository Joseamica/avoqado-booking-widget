import type {
  PublicVenueInfo,
  PublicAvailabilityResponse,
  PublicCreateReservationRequest,
  PublicBookingResult,
  PublicReservationDetail,
} from '../types'

const BASE = (import.meta.env?.VITE_API_URL as string | undefined)
  || 'https://api.avoqado.io/api/v1/public'

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } })
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
