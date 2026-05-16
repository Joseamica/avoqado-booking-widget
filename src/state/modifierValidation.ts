import type { ModifierGroup, ModifierSelection } from '../types'

/** True when every required (or min-bounded) ModifierGroup for the given product
 *  has enough selections. Single source of truth used by:
 *   - ServiceDetailView to disable the Añadir/Actualizar CTA
 *   - eventual server validator (already enforced in resolveModifierSelections) */
export function areRequiredModifiersSatisfied(
  groups: ModifierGroup[] | undefined,
  productId: string,
  selections: ModifierSelection[],
): boolean {
  if (!groups || groups.length === 0) return true
  for (const group of groups) {
    const totalQty = selections
      .filter(
        s => s.productId === productId && group.modifiers.some(m => m.id === s.modifierId),
      )
      .reduce((acc, s) => acc + s.quantity, 0)
    const minRequired = Math.max(group.required ? 1 : 0, group.minSelections)
    if (totalQty < minRequired) return false
  }
  return true
}
