import { h } from 'preact'
import { cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return { ...actual, getInfo: vi.fn(), getMenu: vi.fn() }
})
import { MenuScreen } from './MenuScreen'
import { infoOf, makeStore, menuOf, product, withStore } from './testKit'
import type { MenuProduct } from '../types'

beforeEach(() => sessionStorage.clear())
afterEach(cleanup)

const withSalsa = (): MenuProduct => product({
  modifierGroups: [{
    id: 'g1', name: 'Salsa', required: true, allowMultiple: false, minSelections: 1, maxSelections: 1,
    modifiers: [{ id: 'm1', name: 'Verde', price: 0 }, { id: 'm2', name: 'Queso extra', price: 12.5 }],
  }],
})
function open(p: MenuProduct, info = infoOf()) {
  const s = makeStore(info, menuOf(p))
  s.productId.value = p.id
  render(withStore(s, <MenuScreen />))
  return s
}
const addBtn = () => screen.getByRole('button', { name: /^Agregar/ }) as HTMLButtonElement

describe('ficha del producto', () => {
  it('grupo obligatorio sin elegir deshabilita Agregar; al elegir se habilita', () => {
    open(withSalsa())
    expect(addBtn().disabled).toBe(true)
    fireEvent.click(screen.getByLabelText('Verde'))
    expect(addBtn().disabled).toBe(false)
    expect(addBtn().textContent).toBe('Agregar · $85')
  })
  it('modificador de 12.5 se ve +$12.50 y suma al botón; sin llaves crudas', () => {
    open(withSalsa())
    expect(screen.getByText('+$12.50')).toBeTruthy()
    expect(screen.getByText(/Requerido/)).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/modifiers\.|sheet\.|menu\./)
    fireEvent.click(screen.getByLabelText(/Queso extra/))
    expect(addBtn().textContent).toBe('Agregar · $97.50')
  })
  it('agregar guarda el renglón, cierra la ficha y actualiza CartBar', () => {
    const s = open(withSalsa())
    fireEvent.click(screen.getByLabelText(/Queso extra/))
    fireEvent.click(screen.getByRole('button', { name: 'Más' }))
    fireEvent.input(screen.getByLabelText('Nota para la cocina'), { target: { value: 'sin cebolla' } })
    fireEvent.click(addBtn())
    expect(s.productId.value).toBeNull()
    expect(s.cart.value).toHaveLength(1)
    expect(s.cart.value[0]).toMatchObject({ productId: 'p1', quantity: 2, note: 'sin cebolla', modifiers: [{ modifierId: 'm2', name: 'Queso extra', price: 12.5, quantity: 1 }] })
    expect(screen.getByRole('button', { name: 'Ver pedido · 2 · $195' })).toBeTruthy()
  })
  it('cantidad entre 1 y 20, nota con maxlength 300', () => {
    open(product())
    const minus = screen.getByRole('button', { name: 'Menos' }) as HTMLButtonElement
    expect(minus.disabled).toBe(true)
    for (let i = 0; i < 25; i++) fireEvent.click(screen.getByRole('button', { name: 'Más' }))
    expect(addBtn().textContent).toBe('Agregar · $1,700')
    expect((screen.getByLabelText('Nota para la cocina') as HTMLTextAreaElement).maxLength).toBe(300)
  })
  it('si el carrito topa en 20 avisa «Máximo 20 por producto»', () => {
    const s = makeStore(infoOf(), menuOf(product()))
    s.cart.value = [{ lineId: 'l', productId: 'p1', name: 'F', unitPrice: 85, quantity: 19, modifiers: [], note: null }]
    s.productId.value = 'p1'
    render(withStore(s, <MenuScreen />))
    fireEvent.click(screen.getByRole('button', { name: 'Más' }))
    fireEvent.click(addBtn())
    expect(s.cart.value[0].quantity).toBe(20)
    expect(s.notice.value).toBe('Máximo 20 por producto')
  })
  it('con 50 renglones distintos Agregar queda deshabilitado con su explicación', () => {
    const s = makeStore(infoOf(), menuOf(product()))
    s.cart.value = Array.from({ length: 50 }, (_, i) => ({ lineId: `l${i}`, productId: `x${i}`, name: 'X', unitPrice: 1, quantity: 1, modifiers: [], note: null }))
    s.productId.value = 'p1'
    render(withStore(s, <MenuScreen />))
    expect(addBtn().disabled).toBe(true)
    expect(screen.getByText('Tu pedido llegó al máximo de 50 productos distintos')).toBeTruthy()
  })
  it('con la tienda cerrada no se puede agregar aunque la ficha esté abierta', () => {
    open(product(), infoOf({ status: 'CLOSED' }))
    expect(addBtn().disabled).toBe(true)
  })
  it('producto agotado no se agrega', () => {
    open(product({ soldOut: true }))
    expect(addBtn().disabled).toBe(true)
  })
  it('W4: grupo de varias con mínimo 2 y sin máximo, con una sola opción: se piden 2 de esa opción (tope 20 por opción)', () => {
    const s = open(product({
      modifierGroups: [{
        id: 'g2', name: 'Tortillas', required: true, allowMultiple: true, minSelections: 2, maxSelections: null,
        modifiers: [{ id: 'm9', name: 'Maíz', price: 0 }],
      }],
    }))
    fireEvent.click(screen.getByRole('checkbox'))
    expect(addBtn().disabled).toBe(true)
    const qty = screen.getByRole('spinbutton') as HTMLInputElement
    expect(qty.max).toBe('20')
    fireEvent.input(qty, { target: { value: '2' } })
    expect(addBtn().disabled).toBe(false)
    fireEvent.input(qty, { target: { value: '25' } })
    fireEvent.click(addBtn())
    expect(s.cart.value[0].modifiers).toEqual([{ modifierId: 'm9', name: 'Maíz', price: 0, quantity: 20 }])
  })
  it('Cerrar regresa a la carta', () => {
    const s = open(product())
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }))
    expect(s.productId.value).toBeNull()
  })
})
