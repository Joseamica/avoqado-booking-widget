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

/**
 * Resolved payment-method policy per product. Server merges
 * Product.upfrontPolicy override with ReservationSettings type defaults
 * before sending — see resolveUpfrontPolicy() server-side. The widget never
 * receives 'inherit'; it's always one of the three concrete values.
 */
export type UpfrontPolicy = 'required' | 'at_venue' | 'optional'

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
  /**
   * Credits consumed per seat when redeeming a credit pack. null = legacy
   * default of 1 credit per seat. >0 = explicit (e.g. premium classes that
   * cost 2 credits). 0 = product never consumes credits.
   */
  creditCost?: number | null
  /** Resolved by the server — never 'inherit'. */
  upfrontPolicy?: UpfrontPolicy
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
    /** When true, the customer must log in or register before they can book.
     *  Surface a "log in to continue" gate before the form/landing CTAs. */
    requireAccount?: boolean
  }
  operatingHours?: OperatingHours
  /**
   * Type-aware upfront defaults the venue admin configured. Widget uses these
   * for messaging when a product itself has no override. (Resolved policy
   * already lives on each Product.upfrontPolicy.)
   */
  payments?: {
    appointmentUpfrontDefault: UpfrontPolicy
    classUpfrontDefault: UpfrontPolicy
  }
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

/**
 * Slot with extra fields populated by the range-mode availability endpoint.
 * `productId` + `productName` let the date-first listing UI label each card
 * without a separate product lookup.
 */
export interface PublicClassSessionSlot extends PublicSlot {
  productId: string
  productName: string
}

export interface PublicClassSessionRangeResponse {
  dateFrom: string
  dateTo: string
  slots: PublicClassSessionSlot[]
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
  creditsUsed?: number
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
      sufficient?: boolean
    }[]
  }[]
  requestedSeats?: number | null
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
  cancellation?: {
    allowed: boolean
    minHoursBeforeStart: number | null
    creditsUsed: number
    creditsRefundable: number
    refundPercent: number
    policyLabel: string
  }
  reschedule?: {
    allowed: boolean
    minHoursBeforeStart: number | null
    productId: string | null
  }
}

/**
 * Booking flow variant. Controls which products surface and how the flow is laid out.
 * - 'unified' (default): landing with two CTAs (appointments + classes).
 * - 'appointments': appointment-style flow. Filters products to APPOINTMENTS_SERVICE / SERVICE.
 * - 'classes':      class-style flow. Filters products to CLASS, surfaces a date-first listing
 *                   of pre-scheduled sessions (Square Classes pattern).
 *
 * Set via the `flow-type` HTML attribute on the host element OR derived from the URL path
 * segment by the index.html host page (`book.avoqado.io/<slug>/appointments`).
 */
export type FlowType = 'unified' | 'appointments' | 'classes'

export interface WidgetProps {
  venue: string
  locale: 'en' | 'es'
  theme: 'light' | 'dark' | 'auto'
  accentColor?: string
  mode: 'inline' | 'button' | 'popup'
  serviceId?: string
  buttonText?: string
  flowType?: FlowType
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
