// Carrito de la tienda, por negocio. Los precios son sólo para la ESTIMACIÓN en pantalla: al servidor viajan ids y cantidades
// (`toQuoteItems`), y el total que vale es el de su cotización.
import { toCents } from './money'
import type { QuoteItem } from './types'

export interface CartModifier { modifierId: string; name: string; price: number; quantity: number }
export interface CartLine {
  lineId: string
  productId: string
  name: string
  unitPrice: number
  quantity: number
  /** `quantity` de cada opción es por unidad del platillo, como en `/quote`. */
  modifiers: CartModifier[]
  note: string | null
}
export type Cart = CartLine[]

/** `MAX_LINE_QUANTITY` del servidor (online-ordering/constants.ts). */
const MAX_QTY = 20
/** `NaN`/`Infinity` ⇒ 0 (sin esto, `Math.max(NaN, 0)` deja NaN: «$NaN» en pantalla y `quantity:null` en el POST). */
const clampQty = (n: number) => (Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), 0), MAX_QTY) : 0)

const newLineId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10)

/** Mismo producto + mismas opciones (sin importar el orden) + misma nota ⇒ mismo renglón. */
const identity = (l: Omit<CartLine, 'lineId'>) =>
  JSON.stringify([
    l.productId,
    l.modifiers.map(m => `${m.modifierId}×${m.quantity}`).sort(),
    l.note,
  ])

export function addLine(cart: Cart, line: Omit<CartLine, 'lineId'>): Cart {
  if (clampQty(line.quantity) < 1) return cart
  const incoming = { ...line, note: line.note?.trim() || null }
  const id = identity(incoming)
  const same = cart.find(l => identity(l) === id)
  if (same) return cart.map(l => (l === same ? { ...l, quantity: clampQty(l.quantity + incoming.quantity) } : l))
  return [...cart, { ...incoming, quantity: clampQty(incoming.quantity), lineId: newLineId() }]
}

export function setQuantity(cart: Cart, lineId: string, quantity: number): Cart {
  const q = clampQty(quantity)
  if (q === 0) return removeLine(cart, lineId)
  return cart.map(l => (l.lineId === lineId ? { ...l, quantity: q } : l))
}

export const removeLine = (cart: Cart, lineId: string): Cart => cart.filter(l => l.lineId !== lineId)

export const estimateCents = (cart: Cart): number =>
  cart.reduce(
    (sum, l) => sum + (toCents(l.unitPrice) + l.modifiers.reduce((s, m) => s + toCents(m.price) * m.quantity, 0)) * l.quantity,
    0,
  )

export const toQuoteItems = (cart: Cart): QuoteItem[] =>
  cart.map(l => ({
    productId: l.productId,
    quantity: l.quantity,
    modifiers: l.modifiers.map(m => ({ modifierId: m.modifierId, quantity: m.quantity })),
    ...(l.note ? { note: l.note } : {}),
  }))

// sessionStorage puede no existir o lanzar (modo privado, cookies bloqueadas): entonces el carrito vive en memoria.
const memory = new Map<string, Cart>()
const storageKey = (slug: string) => `avq_order_cart:${slug}`

const isInt = (n: unknown, min: number, max = Infinity) => Number.isInteger(n) && (n as number) >= min && (n as number) <= max
/** Lo guardado se revisa renglón por renglón: uno malo (otra versión, editado a mano) se descarta y no tumba el total. */
const isValidLine = (l: any): l is CartLine =>
  !!l &&
  typeof l.lineId === 'string' &&
  typeof l.productId === 'string' &&
  Number.isFinite(l.unitPrice) &&
  isInt(l.quantity, 1, MAX_QTY) &&
  (l.note === null || typeof l.note === 'string') &&
  Array.isArray(l.modifiers) &&
  l.modifiers.every((m: any) => !!m && typeof m.modifierId === 'string' && isInt(m.quantity, 1) && Number.isFinite(m.price))

export function loadCart(slug: string): Cart {
  const inMemory = memory.get(slug)
  if (inMemory) return inMemory
  try {
    const parsed = JSON.parse(sessionStorage.getItem(storageKey(slug)) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter(isValidLine) : []
  } catch {
    return []
  }
}

export function saveCart(slug: string, cart: Cart): void {
  memory.set(slug, cart)
  try {
    sessionStorage.setItem(storageKey(slug), JSON.stringify(cart))
  } catch {
    /* se queda en memoria */
  }
}
