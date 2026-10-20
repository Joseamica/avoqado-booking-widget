import { h } from 'preact'
import { useContext, useId } from 'preact/hooks'
import { OrderStoreContext } from '../store'
import { formatMXN } from '../money'
import type { OrderT } from '../i18n'
import type { ModifierSelection } from '../../types'
import type { MenuModifierGroup } from '../types'
import { optionCap, setModifierQuantity, toggleModifier } from '../../state/modifierSelection'
import { areRequiredModifiersSatisfied } from '../../state/modifierValidation'

const Icon = ({ d, size }: { d: string; size: number }) => (
  <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
    <path d={d} />
  </svg>
)
// La palomita va en el DOM (no como imagen `data:` en el CSS): un sitio con CSP estricta en `img-src` no la borra.
const Check = () => (
  <svg class="avq-o-opt__check" aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
    <path d="M5 12l5 5L20 7" />
  </svg>
)

/** «− n +»: el de la ficha (52 px) y, con `small`, el de una opción (36 px dentro de 44 de toque). Sin `onLess`/`onMore`, su botón queda deshabilitado. */
export function Stepper({ value, label, lessLabel, moreLabel, onLess, onMore, small }: {
  value: number; label?: string; lessLabel: string; moreLabel: string; onLess?: () => void; onMore?: () => void; small?: boolean
}) {
  const size = small ? 16 : 18
  return (
    <div class={small ? 'avq-o-stepper avq-o-stepper--sm' : 'avq-o-stepper'} role={label ? 'group' : undefined} aria-label={label}>
      <button type="button" aria-label={lessLabel} disabled={!onLess} onClick={onLess}><Icon d="M5 12h14" size={size} /></button>
      <span aria-live="polite">{value}</span>
      <button type="button" aria-label={moreLabel} disabled={!onMore} onClick={onMore}><Icon d="M12 5v14M5 12h14" size={size} /></button>
    </div>
  )
}

/**
 * Un grupo de opciones de la ficha: título, ayuda («Elige 1», «Elige hasta N»…) y pastilla «Obligatorio» → «Listo», u «Opcional».
 * Opciones de 56 px: radio si el grupo es de una, casilla si es de varias y, ya elegida una que admite cantidad, un stepper.
 * Las reglas son las de reservas (`state/modifierSelection` y `areRequiredModifiersSatisfied`); aquí sólo cambia la forma.
 */
export function OptionGroup({ productId, group, selections, onChange, t, maxPerOption }: {
  productId: string; group: MenuModifierGroup; selections: ModifierSelection[]; onChange: (s: ModifierSelection[]) => void; t: OrderT; maxPerOption: number
}) {
  const locale = useContext(OrderStoreContext)?.locale ?? 'es'
  const id = useId() // ids y `name` de los radios propios: no dependen de cómo vengan los ids del servidor
  const min = Math.max(group.required ? 1 : 0, group.minSelections) // el mínimo de `areRequiredModifiersSatisfied`
  const hint = !group.allowMultiple ? t('modifiers.chooseOne')
    : min > 1 ? t('modifiers.chooseAtLeast', { n: min })
    : group.maxSelections ? t('modifiers.chooseUpTo', { n: group.maxSelections })
    : min === 1 ? t('modifiers.chooseAtLeast', { n: 1 })
    : t('modifiers.chooseAny')
  const [pill, pillText] = min === 0 ? ['avq-o-pill', t('modifiers.optional')]
    : areRequiredModifiersSatisfied([group], productId, selections) ? ['avq-o-pill avq-o-pill--done', t('modifiers.done')]
    : ['avq-o-pill avq-o-pill--required', t('modifiers.mandatory')]
  const cap = optionCap(group, maxPerOption)
  const qtyIn = (list: ModifierSelection[], modifierId: string) =>
    list.find(s => s.productId === productId && s.modifierId === modifierId)?.quantity ?? 0

  return (
    <div class="avq-o-group">
      <div class="avq-o-group__head">
        <div class="avq-o-group__names">
          <h3 class="avq-o-group__title" id={`${id}-t`}>{group.name}</h3>
          <span class="avq-o-group__hint" id={`${id}-h`}>{hint}</span>
          {group.description && <span class="avq-o-group__hint">{group.description}</span>}
        </div>
        <span class={pill}>{pillText}</span>
      </div>
      <div class="avq-o-group__opts" role={group.allowMultiple ? 'group' : 'radiogroup'} aria-labelledby={`${id}-t`} aria-describedby={`${id}-h`}>
        {group.modifiers.map(m => {
          const qty = qtyIn(selections, m.id)
          // Con cantidad, el stepper toma el lugar del sobreprecio y éste pasa debajo del nombre, en gris (spec §9.4).
          const counted = group.allowMultiple && cap > 1 && qty > 0
          const price = m.price > 0 ? `+${formatMXN(m.price, locale)}` : null
          const setQty = (n: number) => onChange(setModifierQuantity(selections, productId, group, m.id, n, maxPerOption))
          // El tope (el de la opción, y el del grupo menos lo que llevan las otras) lo decide el mismo helper: si +1 no sube, no hay «+».
          const canMore = counted && qtyIn(setModifierQuantity(selections, productId, group, m.id, qty + 1, maxPerOption), m.id) > qty
          return (
            <div key={m.id} class="avq-o-opt">
              <label class="avq-o-opt__main">
                <span class="avq-o-opt__mark">
                  <input class="avq-o-opt__input" type={group.allowMultiple ? 'checkbox' : 'radio'} name={id} checked={qty > 0}
                    onClick={e => {
                      // `click` y no `change`: tocar el radio ya elegido no dispara `change`, y así se quita (igual que reservas).
                      const next = toggleModifier(selections, productId, group, m.id)
                      // Grupo lleno: nada cambió y no se avisa; el navegador ya había marcado la casilla y `preventDefault` la regresa.
                      if (next === selections) e.preventDefault()
                      else onChange(next)
                    }} />
                  {group.allowMultiple && qty > 0 && <Check />}
                </span>
                <span class="avq-o-opt__text">
                  {m.name}
                  {counted && price && <span class="avq-o-opt__sub">{price}</span>}
                </span>
                {!counted && price && <span class="avq-o-opt__extra">{price}</span>}
              </label>
              {counted && (
                <Stepper small value={qty} lessLabel={t('modifiers.less', { name: m.name })} moreLabel={t('modifiers.more', { name: m.name })}
                  onLess={qty > 1 ? () => setQty(qty - 1) : undefined} onMore={canMore ? () => setQty(qty + 1) : undefined} />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
