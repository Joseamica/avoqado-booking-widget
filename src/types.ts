export interface LayoutSpot {
  id: string
  row: number
  col: number
  label: string
  enabled: boolean
}

export interface LayoutConfig {
  iconType: 'circle' | 'bike' | 'mat' | 'reformer' | 'bed' | 'chair' | 'generic'
  rows: number
  cols: number
  showInstructor?: boolean
  spots: LayoutSpot[]
}

export interface Product {
  id: string
  name: string
  price: number | null
  duration: number | null
  eventCapacity: number | null
  type?: 'APPOINTMENTS_SERVICE' | 'EVENT' | 'CLASS'
  maxParticipants?: number | null
  layoutConfig?: LayoutConfig | null
  requireCreditForBooking?: boolean
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
  classSessionId?: string
  capacity?: number
  enrolled?: number
  remaining?: number
  takenSpotIds?: string[]
  instructor?: { firstName: string; lastName: string } | null
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
  classSessionId?: string
  spotIds?: string[]
  specialRequests?: string
  creditItemBalanceId?: string
}

export interface PublicBookingResult {
  confirmationCode: string
  cancelSecret: string
  startsAt: string
  endsAt: string
  status: string
  depositRequired: boolean
  depositAmount: number | null
  creditRedeemed?: boolean
}

// Credit Pack types for public widget
export interface CreditPackPublic {
  id: string
  name: string
  description?: string
  price: number
  currency: string
  validityDays?: number
  items: {
    id: string
    productId: string
    product: { id: string; name: string; type: string; price: number; imageUrl?: string; duration?: number }
    quantity: number
  }[]
}

export interface CustomerCreditBalance {
  customer: { id: string; firstName?: string; lastName?: string; email?: string; phone?: string } | null
  purchases: {
    id: string
    creditPack: { name: string }
    expiresAt?: string
    status: string
    itemBalances: {
      id: string
      productId: string
      product: { id: string; name: string; type: string; imageUrl?: string }
      originalQuantity: number
      remainingQuantity: number
    }[]
  }[]
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

// Customer Portal types
export interface CustomerPortalData {
  customer: {
    id: string
    firstName: string | null
    lastName: string | null
    email: string | null
    phone: string | null
    loyaltyPoints: number
    totalVisits: number
  } | null
  credits: {
    purchases: Array<{
      id: string
      creditPack: { name: string }
      purchasedAt: string
      expiresAt: string | null
      status: string
      amountPaid: number
      itemBalances: Array<{
        id: string
        productId: string
        product: { id: string; name: string; type: string; imageUrl: string | null }
        originalQuantity: number
        remainingQuantity: number
      }>
    }>
  }
  reservations: {
    upcoming: Array<{
      confirmationCode: string
      cancelSecret: string
      status: string
      startsAt: string
      endsAt: string
      duration: number
      partySize: number
      guestName: string | null
      product: { id: string; name: string; price: number | null } | null
      spotIds?: string[]
    }>
    past: Array<{
      confirmationCode: string
      status: string
      startsAt: string
      endsAt: string
      duration: number
      partySize: number
      guestName: string | null
      product: { id: string; name: string; price: number | null } | null
    }>
  }
}
