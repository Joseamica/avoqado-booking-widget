import type { ModifierSelection, Product, PublicBookingStaff, PublicSlot, PublicVenueInfo } from '../types'

/** Staff who can perform every selected service, preserving the first
 * service's deterministic server order. */
export function intersectEligibleStaff(
  staffByProductId: Record<string, PublicBookingStaff[]>,
  productIds: string[],
): PublicBookingStaff[] {
  if (productIds.length === 0) return []
  const first = staffByProductId[productIds[0]] ?? []
  if (productIds.length === 1) return first
  const remaining = productIds.slice(1).map(id => new Set((staffByProductId[id] ?? []).map(staff => staff.id)))
  return first.filter(staff => remaining.every(ids => ids.has(staff.id)))
}

export function modifierDurationDelta(
  products: Product[],
  selections: ModifierSelection[],
): number {
  const productById = new Map(products.map(product => [product.id, product]))
  let delta = 0
  for (const selection of selections) {
    const product = productById.get(selection.productId)
    const modifier = product?.modifierGroups
      ?.flatMap(group => group.modifiers)
      .find(candidate => candidate.id === selection.modifierId && candidate.active !== false)
    if (modifier?.durationMin != null) delta += modifier.durationMin * selection.quantity
  }
  return delta
}

/** Availability returns the final interval. `base` hold/create requests must
 * send the service-only end so the server can add modifier duration once. */
export function baseWindowForSlot(
  slot: PublicSlot,
  products: Product[],
  selections: ModifierSelection[],
): { endsAt: string; duration: number } {
  const startsAtMs = new Date(slot.startsAt).getTime()
  const finalEndsAtMs = new Date(slot.endsAt).getTime()
  const baseEndsAtMs = finalEndsAtMs - modifierDurationDelta(products, selections) * 60_000
  if (!Number.isFinite(startsAtMs) || !Number.isFinite(baseEndsAtMs) || baseEndsAtMs <= startsAtMs) {
    throw new Error('Invalid appointment base window')
  }
  return {
    endsAt: new Date(baseEndsAtMs).toISOString(),
    duration: Math.round((baseEndsAtMs - startsAtMs) / 60_000),
  }
}

/** Rebind selected catalog objects to a refreshed payload and discard
 * modifiers that no longer exist or are inactive. */
export function reconcileAppointmentSelection(
  previousProducts: Product[],
  previousModifiers: ModifierSelection[],
  fresh: PublicVenueInfo,
): { products: Product[]; modifiers: ModifierSelection[]; changed: boolean } {
  const freshById = new Map(fresh.products.filter(product => product.type !== 'CLASS').map(product => [product.id, product]))
  const products = previousProducts.flatMap(product => {
    const replacement = freshById.get(product.id)
    return replacement ? [replacement] : []
  })
  const validModifierKeys = new Set(
    products.flatMap(product =>
      (product.modifierGroups ?? []).flatMap(group =>
        group.modifiers.filter(modifier => modifier.active !== false).map(modifier => `${product.id}:${modifier.id}`),
      ),
    ),
  )
  const modifiers = previousModifiers.filter(selection => validModifierKeys.has(`${selection.productId}:${selection.modifierId}`))
  const productSignature = (product: Product) => JSON.stringify({
    id: product.id,
    name: product.name,
    duration: product.duration,
    price: product.price,
    modifierGroups: product.modifierGroups,
  })
  const changed =
    products.length !== previousProducts.length ||
    modifiers.length !== previousModifiers.length ||
    products.some((product, index) => productSignature(product) !== productSignature(previousProducts[index]))
  return { products, modifiers, changed }
}
