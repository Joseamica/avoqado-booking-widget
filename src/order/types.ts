// Espejo del contrato público de «Pedidos en línea» (avoqado-server, rutas /venues/:slug/ordering/* y /auth/otp/*).
// Nombres exactos del servidor; dinero en PESOS como `number`, salvo `expectedTotal` y `CreatedOrder.total` («206.00»).

export type StoreStatus = 'OPEN' | 'CLOSED' | 'PAUSED' | 'OFFLINE' | 'DISABLED'
export type StoreReason = null | 'NOT_ENABLED' | 'MANUAL_PAUSE' | 'OUTSIDE_HOURS' | 'NO_DEVICE' | 'TOO_BUSY'

export type Weekday = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday'
/** Hora local del negocio; una franja `22:00–02:00` cruza la medianoche. */
export interface HoursRange { open: string; close: string }
export interface DayHours { enabled: boolean; ranges: HoursRange[] }
/** `null` en `StoreInfo.hours` = sin restricción de horario. */
export type WeeklyHours = Record<Weekday, DayHours>

export interface VenueContact { address: string | null; phone: string | null }

export interface StoreInfo {
  venue: { slug: string; name: string | null; timezone: string | null; currency: string }
  brand: { logo: string | null; logoFull: string | null; primaryColor: string | null; secondaryColor: string | null }
  status: StoreStatus
  reason: StoreReason
  /** ISO; sólo en una pausa con hora vigente que NO es la del gerente. Aditivo: un servidor viejo no lo manda. */
  pausedUntil?: string | null
  hours: WeeklyHours | null
  paymentModes: { payAtPickup: boolean }
  minOrderAmount: number
  estimatedPrepMinutes: number
  acceptTimeoutMinutes: number
  contact?: VenueContact
  /** Relativa al API público (`/venues/<venueId>/privacy-notice`): se le antepone `API_BASE`. */
  privacyNoticePath?: string
}

export interface MenuModifier { id: string; name: string; price: number }
export interface MenuModifierGroup {
  id: string
  name: string
  description?: string | null
  required: boolean
  allowMultiple: boolean
  minSelections: number
  maxSelections: number | null
  modifiers: MenuModifier[]
}
export interface MenuProduct {
  id: string
  name: string
  description: string | null
  price: number
  imageUrl: string | null
  soldOut: boolean
  modifierGroups: MenuModifierGroup[]
}
export interface MenuCategory { id: string; name: string; productCount: number; products: MenuProduct[] }
export interface Menu { generatedAt: string; truncated: boolean; categories: MenuCategory[] }

/** Un renglón del carrito tal como lo reciben `/quote` y `/orders`. `modifiers[].quantity` es por unidad del platillo. */
export interface QuoteItem {
  productId: string
  quantity: number
  modifiers?: { modifierId: string; quantity?: number }[]
  note?: string
}
export interface QuoteLine {
  productId: string
  name: string
  quantity: number
  unitPrice: number
  modifiers: { modifierId: string; name: string; quantity: number; price: number }[]
  note: string | null
  lineTotal: number
}
export interface QuoteIssue {
  code:
    | 'EMPTY_CART'
    | 'TOO_MANY_LINES'
    | 'QUANTITY_INVALID'
    | 'PRODUCT_UNAVAILABLE'
    | 'MODIFIER_INVALID'
    | 'MODIFIER_GROUP_REQUIRED'
    | 'MODIFIER_GROUP_SINGLE'
    | 'MODIFIER_GROUP_MAX'
    | 'BELOW_MINIMUM'
  productId?: string
  groupId?: string
  /** Índice (desde 0) del renglón del carrito; falta en los avisos del pedido entero (p. ej. BELOW_MINIMUM). */
  lineIndex?: number
  message: string
}
export interface Quote {
  ok: boolean
  lines: QuoteLine[]
  subtotal: number
  total: number
  minOrderAmount: number
  issues: QuoteIssue[]
}

export interface CreateOrderBody {
  items: QuoteItem[]
  paymentMode: 'PAY_AT_PICKUP'
  /** El `total` de la última cotización con dos decimales: «206.00». */
  expectedTotal: string
  customer: { name: string; phone: string; email?: string }
  note?: string
  whatsappConsent?: boolean
}

export type OnlineOrderStatus =
  | 'PENDING_ACCEPTANCE'
  | 'ACCEPTED'
  | 'READY'
  | 'COMPLETED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'CANCELLED_BY_CUSTOMER'
  | 'CANCELLED_BY_STAFF'
const FINAL_STATUSES: OnlineOrderStatus[] = ['COMPLETED', 'REJECTED', 'EXPIRED', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_STAFF']
/** El pedido ya no cambia: el seguimiento deja de sondear y la tienda olvida «el pedido en curso». */
export const isFinalStatus = (s: OnlineOrderStatus): boolean => FINAL_STATUSES.includes(s)
export type RejectReason = 'OUT_OF_ITEMS' | 'CLOSED' | 'TOO_BUSY' | 'OTHER'

export interface CreatedOrder {
  orderId: string
  onlineOrderId: string
  trackingToken: string
  /** En una repetición (200), el estado vigente del pedido. */
  status: OnlineOrderStatus
  orderNumber: string
  total: string
  acceptDeadlineAt: string
  replay: boolean
}

export interface TrackingItem { name: string; quantity: number; note: string | null; modifiers: { name: string; quantity: number }[] }
export interface Tracking {
  orderNumber: string
  status: OnlineOrderStatus
  paymentMode: 'PAY_AT_PICKUP'
  venueName: string
  venueSlug: string
  items: TrackingItem[]
  total: number
  paid: boolean
  estimatedReadyAt: string | null
  acceptDeadlineAt: string
  rejectReason: RejectReason | null
  createdAt: string
  canCancel: boolean
  venueTimezone?: string
  venueContact?: VenueContact
}

export interface OrderingCustomer {
  id: string
  firstName: string | null
  lastName: string | null
  email: string | null
  phone: string | null
}
