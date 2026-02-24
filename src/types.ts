export interface Product {
  id: string
  name: string
  price: number | null
  duration: number | null
  eventCapacity: number | null
}

export interface PublicVenueInfo {
  name: string
  slug: string
  logo: string | null
  type: string
  address: string | null
  phone: string | null
  timezone: string
  products: Product[]
  publicBooking: {
    enabled: boolean
    requirePhone: boolean
    requireEmail: boolean
  }
  operatingHours?: OperatingHours
}

export interface OperatingHours {
  monday?: DayHours
  tuesday?: DayHours
  wednesday?: DayHours
  thursday?: DayHours
  friday?: DayHours
  saturday?: DayHours
  sunday?: DayHours
}

export interface DayHours {
  enabled: boolean
  ranges?: Array<{ open: string; close: string }>
}

export interface PublicSlot {
  startsAt: string
  endsAt: string
  available: boolean
}

export interface PublicAvailabilityResponse {
  date: string
  slots: PublicSlot[]
}

export interface PublicCreateReservationRequest {
  startsAt: string
  endsAt: string
  duration: number
  guestName: string
  guestPhone: string
  guestEmail?: string
  partySize?: number
  productId?: string
  specialRequests?: string
}

export interface PublicBookingResult {
  confirmationCode: string
  cancelSecret: string
  startsAt: string
  endsAt: string
  status: string
  depositRequired: boolean
  depositAmount: number | null
}

export interface PublicReservationDetail {
  confirmationCode: string
  status: string
  startsAt: string
  endsAt: string
  duration: number
  partySize: number
  guestName: string | null
  product: { id: string; name: string; price: number | null } | null
  assignedStaff: { firstName: string; lastName: string } | null
  table: { number: string } | null
  specialRequests: string | null
  depositAmount: number | null
  depositStatus: string | null
}

export interface WidgetProps {
  venue: string
  locale: 'en' | 'es'
  theme: 'light' | 'dark' | 'auto'
  accentColor?: string
  mode: 'inline' | 'button' | 'popup'
  serviceId?: string
  buttonText?: string
  hostElement: HTMLElement
}
