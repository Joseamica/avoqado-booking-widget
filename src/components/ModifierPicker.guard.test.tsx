// El selector sólo avisa (`onChange`) cuando la selección de verdad cambió. En reservas `onChange` es `setSelectedModifiers`
// (src/state/booking.ts), que además pone en null el profesional, la fecha y el horario ya elegidos: avisar de un cambio que
// no ocurrió (tocar otra opción con el grupo lleno) se los borraría al cliente. Este archivo es aparte para que
// ModifierPicker.test.tsx, el de reservas, quede sin editar.
import { h } from 'preact'
import { cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModifierPicker, type PickerGroup } from './ModifierPicker'
import { createT } from '../i18n'

afterEach(cleanup)

// Grupo de varias con máximo 2 y una sola opción elegida con 2 unidades: el grupo está lleno.
const lleno: PickerGroup = {
  id: 'g', name: 'Extras', required: false, allowMultiple: true, maxSelections: 2,
  modifiers: [{ id: 'a', name: 'A', price: 0 }, { id: 'b', name: 'B', price: 0 }],
}
const draw = () => {
  const onChange = vi.fn()
  render(
    <ModifierPicker
      productId="p"
      group={lleno}
      selections={[{ productId: 'p', modifierId: 'a', quantity: 2 }]}
      onChange={onChange}
      t={createT('es')}
    />,
  )
  return onChange
}

describe('ModifierPicker sólo avisa cuando la selección cambió', () => {
  it('con el grupo lleno (maxSelections 2 y a×2), tocar la opción b NO llama onChange', () => {
    const onChange = draw()
    fireEvent.click(screen.getByLabelText('B'))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('con el grupo lleno, desmarcar la opción a sí avisa: una vez, y sin ella', () => {
    const onChange = draw()
    fireEvent.click(screen.getByLabelText('A'))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith([])
  })
})
