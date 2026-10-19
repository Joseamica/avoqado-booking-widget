// Las reglas de elegir opciones, como funciones puras: las usan el selector compartido (reservas, sin `maxPerOption`)
// y la ficha de la tienda (con `maxPerOption` = 20). Una sola fuente de reglas para los dos.
import { describe, expect, it } from 'vitest'
import type { ModifierSelection } from '../types'
import { optionCap, setModifierQuantity, toggleModifier, type PickerGroup } from './modifierSelection'

const group = (over: Partial<PickerGroup> = {}): PickerGroup => ({
  id: 'g', name: 'Extras', required: false, allowMultiple: true, maxSelections: null,
  modifiers: [{ id: 'a', name: 'A', price: 0 }, { id: 'b', name: 'B', price: 0 }, { id: 'c', name: 'C', price: 0 }],
  ...over,
})
const sel = (modifierId: string, quantity = 1, productId = 'p'): ModifierSelection => ({ productId, modifierId, quantity })

describe('optionCap', () => {
  it('optionCap: sin topes es Infinity; con maxSelections 3 y maxPerOption 20 es 3', () => {
    expect(optionCap(group())).toBe(Infinity)
    expect(optionCap(group({ maxSelections: 3 }), 20)).toBe(3)
  })
  it('manda el tope más bajo: el de la opción cuando el grupo no tiene máximo o lo pasa, y el del grupo en reservas', () => {
    expect(optionCap(group(), 20)).toBe(20)
    expect(optionCap(group({ maxSelections: 30 }), 20)).toBe(20)
    expect(optionCap(group({ maxSelections: 5 }))).toBe(5)
  })
})

describe('toggleModifier', () => {
  it('una opción: reemplaza y, si se toca la misma, la quita', () => {
    const single = group({ allowMultiple: false })
    const a = toggleModifier([], 'p', single, 'a')
    expect(a).toEqual([sel('a')])
    const b = toggleModifier(a, 'p', single, 'b')
    expect(b).toEqual([sel('b')])
    expect(toggleModifier(b, 'p', single, 'b')).toEqual([])
  })

  it('una opción: sólo toca las líneas de su grupo y de su producto', () => {
    const single = group({ allowMultiple: false })
    const ajenas = [sel('x'), sel('a', 1, 'q')] // 'x' no es de este grupo; 'a' es de otro producto
    expect(toggleModifier([...ajenas, sel('a')], 'p', single, 'b')).toEqual([...ajenas, sel('b')])
    expect(toggleModifier([...ajenas, sel('a')], 'p', single, 'a')).toEqual(ajenas)
  })

  it('varias: agrega con cantidad 1 y quita la ya elegida', () => {
    const multi = group()
    const una = toggleModifier([], 'p', multi, 'a')
    expect(una).toEqual([sel('a')])
    expect(toggleModifier(una, 'p', multi, 'b')).toEqual([sel('a'), sel('b')])
    expect(toggleModifier([sel('a'), sel('b')], 'p', multi, 'a')).toEqual([sel('b')])
  })

  it('varias: no pasa de maxSelections (contando cantidades)', () => {
    const tope2 = group({ maxSelections: 2 })
    expect(toggleModifier([sel('a')], 'p', tope2, 'b')).toEqual([sel('a'), sel('b')]) // 1 de 2: cabe
    const lleno = [sel('a', 2)] // una sola opción, pero con 2 unidades: el grupo ya está lleno
    expect(toggleModifier(lleno, 'p', tope2, 'b')).toBe(lleno) // la MISMA lista: nada cambió
    expect(toggleModifier(lleno, 'p', tope2, 'a')).toEqual([]) // quitar sí se puede con el grupo lleno
    expect(toggleModifier([sel('a', 2, 'q')], 'p', tope2, 'b')).toEqual([sel('a', 2, 'q'), sel('b')]) // las de otro producto no cuentan
  })

  it('varias sin maxSelections: sin tope', () => {
    expect(toggleModifier([sel('a', 9), sel('b', 9)], 'p', group(), 'c')).toEqual([sel('a', 9), sel('b', 9), sel('c')])
  })
})

describe('setModifierQuantity', () => {
  it('setModifierQuantity: 2.7 ⇒ 2, 0 o NaN ⇒ quita, tope maxPerOption y tope del grupo menos las otras', () => {
    const uno = [sel('a')]
    // con maxPerOption la cantidad se trunca a entero
    expect(setModifierQuantity(uno, 'p', group(), 'a', 2.7, 20)).toEqual([sel('a', 2)])
    // menos de 1 (0, negativo, 0.9 o NaN) quita la opción
    for (const qty of [0, -3, 0.9, NaN]) {
      expect(setModifierQuantity([sel('a'), sel('b')], 'p', group(), 'a', qty, 20), `qty ${qty}`).toEqual([sel('b')])
    }
    // no pasa de maxPerOption
    expect(setModifierQuantity(uno, 'p', group(), 'a', 25, 20)).toEqual([sel('a', 20)])
    // ni del máximo del grupo menos lo que ya llevan las otras opciones
    const tope3 = group({ maxSelections: 3 })
    expect(setModifierQuantity([sel('a'), sel('b', 2)], 'p', tope3, 'a', 5, 20)).toEqual([sel('a'), sel('b', 2)]) // 3 − 2 = 1
    expect(setModifierQuantity([sel('a'), sel('b')], 'p', tope3, 'b', 5, 20)).toEqual([sel('a'), sel('b', 2)]) // 3 − 1 = 2
    expect(setModifierQuantity([sel('a'), sel('b', 2, 'q')], 'p', tope3, 'a', 5, 20)).toEqual([sel('a', 3), sel('b', 2, 'q')]) // otro producto no cuenta
  })

  it('reservas (sin maxPerOption): el máximo del grupo sigue mandando, 0 quita y no se trunca', () => {
    const tope3 = group({ maxSelections: 3 })
    expect(setModifierQuantity([sel('a')], 'p', tope3, 'a', 5)).toEqual([sel('a', 3)])
    expect(setModifierQuantity([sel('a')], 'p', tope3, 'a', 0)).toEqual([])
    expect(setModifierQuantity([sel('a')], 'p', tope3, 'a', 2.5)).toEqual([sel('a', 2.5)])
  })

  it('actualiza su línea en su sitio, agrega la opción si no estaba y no toca las demás', () => {
    const otras = [sel('b'), sel('a', 7, 'q')]
    expect(setModifierQuantity([sel('a'), ...otras], 'p', group(), 'a', 4, 20)).toEqual([sel('a', 4), ...otras])
    expect(setModifierQuantity(otras, 'p', group(), 'a', 2, 20)).toEqual([...otras, sel('a', 2)])
  })
})

describe('las tres funciones son puras', () => {
  it('no mutan lo que reciben', () => {
    const entrada = Object.freeze([Object.freeze(sel('a')), Object.freeze(sel('b', 2))]) as ModifierSelection[]
    const multi = group({ maxSelections: 5 })
    const single = group({ allowMultiple: false })
    expect(() => {
      toggleModifier(entrada, 'p', multi, 'c')
      toggleModifier(entrada, 'p', multi, 'a')
      toggleModifier(entrada, 'p', single, 'c')
      setModifierQuantity(entrada, 'p', multi, 'a', 3, 20)
      setModifierQuantity(entrada, 'p', multi, 'a', 0, 20)
      setModifierQuantity(entrada, 'p', multi, 'c', 1, 20)
    }).not.toThrow()
    expect(entrada).toEqual([sel('a'), sel('b', 2)])
  })
})
