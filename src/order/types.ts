// Espejo del contrato público de «Pedidos en línea» (avoqado-server, rutas /venues/:slug/ordering/* y /auth/otp/*).
// Nombres exactos del servidor; dinero en PESOS como `number`, salvo `expectedTotal` y `CreatedOrder.total` («206.00»).

export type StoreStatus = 'OPEN' | 'CLOSED' | 'PAUSED' | 'OFFLINE' | 'DISABLED'
/** `NO_PAYMENT_MODE` (fase 2): abierta, pero sin ningún medio de pago vivo; va con `PAUSED` y sin `pausedUntil`. */
export type StoreReason = null | 'NOT_ENABLED' | 'MANUAL_PAUSE' | 'OUTSIDE_HOURS' | 'NO_DEVICE' | 'TOO_BUSY' | 'NO_PAYMENT_MODE'

export type Weekday = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday'
/** Hora local del negocio; una franja `22:00–02:00` cruza la medianoche. */
export interface HoursRange { open: string; close: string }
export interface DayHours { enabled: boolean; ranges: HoursRange[] }
/** `null` en `StoreInfo.hours` = sin restricción de horario. */
export type WeeklyHours = Record<Weekday, DayHours>

export interface VenueContact { address: string | null; phone: string | null }

export interface StoreInfo {
  venue: { slug: string; name: string | null; timezone: string | null; currency: string }
  /** `heroImageUrl` (la portada) es aditivo: un servidor viejo no lo manda y la tienda sale sin foto. */
  brand: { logo: string | null; logoFull: string | null; primaryColor: string | null; secondaryColor: string | null; heroImageUrl?: string | null }
  status: StoreStatus
  reason: StoreReason
  /** ISO; sólo en una pausa con hora vigente que NO es la del gerente. Aditivo: un servidor viejo no lo manda. */
  pausedUntil?: string | null
  hours: WeeklyHours | null
  /** `cardOnline` (fase 2) es aditivo: un servidor viejo no lo manda y la tienda sólo ofrece pagar al recoger. */
  paymentModes: { payAtPickup: boolean; cardOnline?: boolean }
  minOrderAmount: number
  estimatedPrepMinutes: number
  acceptTimeoutMinutes: number
  contact?: VenueContact
  /** Relativa al API público (`/venues/<venueId>/privacy-notice`): se le antepone `API_BASE`. */
  privacyNoticePath?: string
  /**
   * Tienda híbrida (etapa 1), aditivo: `false` = «Nadie» (nadie confirma; se pide con el nombre y se paga en caja con un folio).
   * Falta en un servidor viejo: se lee como «Mi equipo» (`!== false`).
   */
  requiresAcceptance?: boolean
  /** ISO del cierre de la franja de ahora (el último pedido para pagar en caja es 10 min antes); `null` sin horario. Aditivo. */
  closesAt?: string | null
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

export type PaymentMode = 'PAY_AT_PICKUP' | 'CARD_ONLINE'
export interface CreateOrderBody {
  items: QuoteItem[]
  paymentMode: PaymentMode
  /** El `total` de la última cotización con dos decimales: «206.00». */
  expectedTotal: string
  /** `phone` falta en «Nadie» (sólo el nombre); con tarjeta en línea o en «Mi equipo» sigue siendo obligatorio. */
  customer: { name: string; phone?: string; email?: string }
  note?: string
  whatsappConsent?: boolean
  /** De dónde pidió la clienta (el QR del negocio o una liga); aditivo, lo llena la tarea de la liga. */
  channel?: 'QR' | 'LINK'
}

export type OnlineOrderStatus =
  /** Fase 2: el borrador de tarjeta espera el pago (todavía no es pedido ni tiene folio). */
  | 'AWAITING_PAYMENT'
  /** Fase 2: el pago no se completó (vencido o abandonado); final. */
  | 'PAYMENT_NOT_COMPLETED'
  | 'PENDING_ACCEPTANCE'
  | 'ACCEPTED'
  | 'READY'
  | 'COMPLETED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'CANCELLED_BY_CUSTOMER'
  | 'CANCELLED_BY_STAFF'
const FINAL_STATUSES: OnlineOrderStatus[] = ['COMPLETED', 'REJECTED', 'EXPIRED', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_STAFF', 'PAYMENT_NOT_COMPLETED']
/** El pedido ya no cambia: el seguimiento deja de sondear y la tienda olvida «el pedido en curso». */
export const isFinalStatus = (s: OnlineOrderStatus): boolean => FINAL_STATUSES.includes(s)
export type RejectReason = 'OUT_OF_ITEMS' | 'CLOSED' | 'TOO_BUSY' | 'OTHER' | 'PAYMENT_FAILED'
/** Fase 2: lo que el comensal ve de su tarjeta. `RELEASING` = liberación decidida, todavía sin confirmar. */
export type CardStatus = 'AUTHORIZED' | 'CONFIRMING' | 'CAPTURED' | 'RELEASING' | 'RELEASED'

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

/**
 * Fase 2: respuesta al pedir con tarjeta (201). En una repetición `status` es el vigente y `checkoutUrl` puede venir vacío (la
 * página de pago ya venció o el pago ya avanzó): sólo se abre Stripe con `AWAITING_PAYMENT` y una liga.
 */
export interface CreatedCardOrder {
  trackingToken: string
  checkoutUrl: string
  status: string
  total: string
  replay: boolean
}

export interface TrackingItem {
  name: string; quantity: number; note: string | null; modifiers: { name: string; quantity: number }[]
  /** R67, opcionales (PESOS): precio de una pieza y total del renglón. */
  unitPrice?: number; total?: number
}
export interface Tracking {
  orderNumber: string
  status: OnlineOrderStatus
  paymentMode: PaymentMode
  /** Fase 2: `null` al recoger; aditivo (un servidor viejo no lo manda). */
  cardStatus?: CardStatus | null
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
  /** Tienda híbrida (etapa 1), aditivos: un folio de «Nadie» tiene `requiresAcceptance: false`. */
  requiresAcceptance?: boolean
  channel?: 'QR' | 'LINK' | null
  /** R67, opcionales: el nombre con que se pidió y cuándo quedó pagada la cuenta (ISO). */
  customerName?: string | null
  paidAt?: string | null
}

export interface OrderingCustomer {
  id: string
  firstName: string | null
  lastName: string | null
  email: string | null
  phone: string | null
}
