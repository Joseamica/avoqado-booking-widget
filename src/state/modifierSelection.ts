import type { ModifierSelection } from '../types'

// Sólo los campos que el picker lee: `ModifierGroup` de reservas y `MenuModifierGroup` de la tienda caben los dos.
export interface PickerGroup {
  id: string
  name: string
  description?: string | null
  required: boolean
  allowMultiple: boolean
  maxSelections: number | null
  modifiers: { id: string; name: string; price: number }[]
}

const isOption = (s: ModifierSelection, productId: string, modifierId: string) =>
  s.productId === productId && s.modifierId === modifierId

// Las líneas de ESTE producto que son opciones del grupo.
const inGroup = (productId: string, group: PickerGroup) => {
  const ids = new Set(group.modifiers.map(m => m.id))
  return (s: ModifierSelection) => s.productId === productId && ids.has(s.modifierId)
}

// Unidades ya elegidas en el grupo (cuenta cantidades, no opciones).
const unitsInGroup = (selections: ModifierSelection[], productId: string, group: PickerGroup) =>
  selections.filter(inGroup(productId, group)).reduce((acc, s) => acc + s.quantity, 0)

/** Unidades que admite UNA opción: el máximo del grupo y, si se dio, el tope por opción. Sin ninguno: Infinity (sin cantidad). */
export function optionCap(group: PickerGroup, maxPerOption?: number): number {
  return Math.min(group.maxSelections ?? Infinity, maxPerOption ?? Infinity)
}

/**
 * Tocar una opción. Grupo de una: la tocada reemplaza a la que hubiera y, si ya era la elegida, se quita. Grupo de varias:
 * se agrega con cantidad 1 o se quita; con el grupo lleno no cabe otra y devuelve la MISMA lista (nada cambió).
 */
export function toggleModifier(
  selections: ModifierSelection[],
  productId: string,
  group: PickerGroup,
  modifierId: string,
): ModifierSelection[] {
  const existing = selections.some(s => isOption(s, productId, modifierId))
  if (group.allowMultiple) {
    if (existing) return selections.filter(s => !isOption(s, productId, modifierId))
    if (group.maxSelections != null && unitsInGroup(selections, productId, group) >= group.maxSelections) return selections
    return [...selections, { productId, modifierId, quantity: 1 }]
  }
  // Una sola: se quita lo que hubiera en el grupo y, si no era ésta, entra ésta.
  const mine = inGroup(productId, group)
  const rest = selections.filter(s => !mine(s))
  return existing ? rest : [...rest, { productId, modifierId, quantity: 1 }]
}

/**
 * Cantidad de una opción. Con `maxPerOption` (la tienda) sólo hay enteros: 2.7 ⇒ 2, vacío o inválido ⇒ quitar, y no pasa del
 * tope. Reservas no lo pasa: igual que antes. En los dos casos manda el máximo del grupo menos lo que llevan las otras.
 */
export function setModifierQuantity(
  selections: ModifierSelection[],
  productId: string,
  group: PickerGroup,
  modifierId: string,
  qty: number,
  maxPerOption?: number,
): ModifierSelection[] {
  if (maxPerOption != null) qty = Math.trunc(qty) || 0
  if (qty < 1) return selections.filter(s => !isOption(s, productId, modifierId))
  const current = selections.find(s => isOption(s, productId, modifierId))
  if (group.maxSelections != null) {
    const others = unitsInGroup(selections, productId, group) - (current?.quantity ?? 0)
    const cap = group.maxSelections - others
    if (qty > cap) qty = cap
  }
  if (maxPerOption != null && qty > maxPerOption) qty = maxPerOption
  return current
    ? selections.map(s => (isOption(s, productId, modifierId) ? { ...s, quantity: qty } : s))
    : [...selections, { productId, modifierId, quantity: qty }]
}
