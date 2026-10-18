// M4: amarra el comportamiento de RESERVAS del selector compartido. Reservas no pasa `maxPerOption`: un grupo de varias
// sin máximo sigue sin campo de cantidad, y con máximo sigue con su tope. (La tienda pasa 20; eso vive en ProductSheet.test.)
import { h } from 'preact'
import { cleanup, render, screen } from '@testing-library/preact'
import { afterEach, describe, expect, it } from 'vitest'
import { ModifierPicker, type PickerGroup } from './ModifierPicker'
import { createT } from '../i18n'

afterEach(cleanup)

const group = (maxSelections: number | null): PickerGroup => ({
  id: 'g', name: 'Extras', required: false, allowMultiple: true, maxSelections, modifiers: [{ id: 'm', name: 'Toalla', price: 0 }],
})
const pick = (g: PickerGroup) =>
  render(<ModifierPicker productId="p" group={g} selections={[{ productId: 'p', modifierId: 'm', quantity: 1 }]} onChange={() => {}} t={createT('es')} />)

describe('ModifierPicker en reservas (sin maxPerOption)', () => {
  it('grupo de varias con maxSelections null ⇒ sin campo de cantidad', () => {
    pick(group(null))
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true)
    expect(screen.queryByRole('spinbutton')).toBeNull()
  })
  it('con maxSelections 3 ⇒ campo de cantidad con tope 3, como siempre', () => {
    pick(group(3))
    expect((screen.getByRole('spinbutton') as HTMLInputElement).max).toBe('3')
  })
})
