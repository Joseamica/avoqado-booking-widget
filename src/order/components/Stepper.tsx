import { h } from 'preact'

const MINUS = 'M5 12h14'
const PLUS = 'M12 5v14M5 12h14'
const TRASH = 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13'

const Icon = ({ d, size, width = 2.4 }: { d: string; size: number; width?: number }) => (
  <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={width} stroke-linecap="round" stroke-linejoin="round">
    <path d={d} />
  </svg>
)

/**
 * «− n +»: el de la ficha (52 px); con `small`, el de una opción (36 px dentro de 44 de toque); con `line`, el de un renglón del
 * carrito (40 px con borde, íconos de 16). Con `trash`, el «−» es un bote de basura (en el carrito, con cantidad 1: quita el
 * renglón; el que lo usa pone su etiqueta y su acción). Sin `onLess`/`onMore` su botón está en el tope: `aria-disabled` e ignora el
 * toque, pero NO `disabled`, que le quitaría el foco a quien llegó con el teclado.
 */
export function Stepper({ value, label, lessLabel, moreLabel, onLess, onMore, small, line, trash }: {
  value: number; label?: string; lessLabel: string; moreLabel: string; onLess?: () => void; onMore?: () => void
  small?: boolean; line?: boolean; trash?: boolean
}) {
  const size = small || line ? 16 : 18
  return (
    <div class={small ? 'avq-o-stepper avq-o-stepper--sm' : line ? 'avq-o-stepper avq-o-stepper--line' : 'avq-o-stepper'} role={label ? 'group' : undefined} aria-label={label}>
      <button type="button" aria-label={lessLabel} aria-disabled={onLess ? undefined : 'true'} onClick={onLess}>
        <Icon d={trash ? TRASH : MINUS} size={size} width={trash ? 2.2 : 2.4} />
      </button>
      <span aria-live="polite">{value}</span>
      <button type="button" aria-label={moreLabel} aria-disabled={onMore ? undefined : 'true'} onClick={onMore}><Icon d={PLUS} size={size} /></button>
    </div>
  )
}
