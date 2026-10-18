import { h } from 'preact'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return { ...actual, quote: vi.fn(), getInfo: vi.fn(), getMenu: vi.fn() }
})
import { ApiError, quote } from '../api'
import { checkoutOf } from '../checkout'
import { CartScreen } from './CartScreen'
import { infoOf, makeStore, menuOf, withStore } from './testKit'
import type { CartLine } from '../cart'
import type { Quote, QuoteLine, StoreInfo } from '../types'

beforeEach(() => {
  sessionStorage.clear()
  vi.useFakeTimers()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})
/** La cotización espera ~300 ms (debounce): se adelanta el reloj falso y se dejan correr las promesas. */
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(300) })

const flautas: CartLine = { lineId: 'a', productId: 'p1', name: 'Flautas', unitPrice: 85, quantity: 2, note: null, modifiers: [] }
const tacos: CartLine = { lineId: 'b', productId: 'p2', name: 'Tacos', unitPrice: 30, quantity: 1, note: 'Sin cebolla', modifiers: [] }
const qline = (productId: string, lineTotal: number): QuoteLine =>
  ({ productId, name: '', quantity: 1, unitPrice: lineTotal, modifiers: [], note: null, lineTotal })
const quoteOf = (total: number, over: Partial<Quote> = {}): Quote =>
  ({ ok: true, lines: [qline('p1', total)], subtotal: total, total, minOrderAmount: 0, issues: [], ...over })

async function show(cart: CartLine[], q: Quote | ApiError, info: StoreInfo = infoOf()) {
  const s = makeStore(info, menuOf())
  s.cart.value = cart
  if (q instanceof ApiError) vi.mocked(quote).mockRejectedValue(q)
  else vi.mocked(quote).mockResolvedValue(q)
  s.go('cart')
  render(withStore(s, <CartScreen />))
  await flush()
  return s
}
const continueBtn = () => screen.getByRole('button', { name: 'Continuar' }) as HTMLButtonElement
const totalText = () => screen.getByText('Total (IVA incluido)').parentElement!.textContent

describe('carrito cotizado por el servidor', () => {
  it('al entrar cotiza los renglones del carrito; el total que se muestra es el de la cotización, no la estimación', async () => {
    const s = await show([flautas], quoteOf(180))
    expect(quote).toHaveBeenCalledWith(s.slug, [{ productId: 'p1', quantity: 2, modifiers: [] }])
    expect(totalText()).toContain('$180')
    expect(totalText()).not.toContain('$170')
    expect(s.quote.value?.total).toBe(180)
  })

  it('cada issue cuelga del renglón de su lineIndex; BELOW_MINIMUM va arriba del total', async () => {
    await show([flautas, tacos], quoteOf(170, {
      ok: false,
      issues: [
        { code: 'PRODUCT_UNAVAILABLE', productId: 'p2', lineIndex: 1, message: 'Un platillo de tu pedido ya no está disponible.' },
        { code: 'BELOW_MINIMUM', message: 'El pedido mínimo es de $200.00.' },
      ],
    }))
    const tacosRow = screen.getByRole('listitem', { name: 'Tacos' })
    expect(within(tacosRow).getByText('Un platillo de tu pedido ya no está disponible.')).toBeTruthy()
    expect(within(screen.getByRole('listitem', { name: 'Flautas' })).queryByText('Un platillo de tu pedido ya no está disponible.')).toBeNull()
    const minimum = screen.getByText('El pedido mínimo es de $200.00.')
    expect(tacosRow.contains(minimum)).toBe(false)
    expect(minimum.compareDocumentPosition(screen.getByText('Total (IVA incluido)')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('con quote.ok:false «Continuar» está deshabilitado; con ok:true lleva a tus datos', async () => {
    await show([flautas], quoteOf(170, { ok: false, issues: [{ code: 'BELOW_MINIMUM', message: 'El pedido mínimo es de $200.00.' }] }))
    expect(continueBtn().disabled).toBe(true)
    cleanup()
    const s = await show([flautas], quoteOf(170))
    expect(continueBtn().disabled).toBe(false)
    fireEvent.click(continueBtn())
    expect(s.screen.value).toBe('details')
  })

  it('con la tienda no abierta «Continuar» está deshabilitado aunque la cotización sea buena', async () => {
    await show([flautas], quoteOf(170), infoOf({ status: 'CLOSED' }))
    expect(continueBtn().disabled).toBe(true)
  })

  it('sin red al cotizar ⇒ «Sin conexión…», nada de total, «Continuar» deshabilitado y el carrito intacto; «Reintentar» cotiza otra vez', async () => {
    const s = await show([flautas], new ApiError('Sin conexión', 0, undefined, undefined, true))
    expect(screen.getByText('Sin conexión. Revisa tu internet y vuelve a intentar.')).toBeTruthy()
    expect(continueBtn().disabled).toBe(true)
    expect(s.cart.value).toEqual([flautas])
    vi.mocked(quote).mockResolvedValue(quoteOf(170))
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    await flush()
    expect(quote).toHaveBeenCalledTimes(2)
    expect(continueBtn().disabled).toBe(false)
  })

  it('cambiar la cantidad vuelve a cotizar; «Menos» no baja de 1 y «Quitar» quita el renglón', async () => {
    const s = await show([{ ...flautas, quantity: 1 }], quoteOf(85))
    const row = screen.getByRole('listitem', { name: 'Flautas' })
    expect((within(row).getByRole('button', { name: 'Menos' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(within(row).getByRole('button', { name: 'Más' }))
    await flush()
    expect(vi.mocked(quote).mock.lastCall![1]).toEqual([{ productId: 'p1', quantity: 2, modifiers: [] }])
    fireEvent.click(within(screen.getByRole('listitem', { name: 'Flautas' })).getByRole('button', { name: 'Quitar' }))
    expect(s.cart.value).toEqual([])
    expect(screen.getByText('Tu pedido está vacío.')).toBeTruthy()
  })

  it('texto fijo de pago y nota del pedido de hasta 300 caracteres', async () => {
    const s = await show([flautas], quoteOf(170))
    expect(screen.getByText('Pagas al recoger en el restaurante.')).toBeTruthy()
    const note = screen.getByLabelText('Nota del pedido') as HTMLTextAreaElement
    expect(note.maxLength).toBe(300)
    fireEvent.input(note, { target: { value: 'Paso a las 2' } })
    expect(checkoutOf(s).draft.value.note).toBe('Paso a las 2')
  })

  it('toques seguidos ⇒ UNA cotización nueva (~300 ms después del último): el límite es 60/min por IP', async () => {
    await show([{ ...flautas, quantity: 1 }], quoteOf(85))
    expect(quote).toHaveBeenCalledTimes(1)
    for (let i = 0; i < 3; i++) {
      fireEvent.click(within(screen.getByRole('listitem', { name: 'Flautas' })).getByRole('button', { name: 'Más' }))
      await act(async () => { await vi.advanceTimersByTimeAsync(100) })
    }
    expect(quote).toHaveBeenCalledTimes(1)
    await flush()
    expect(quote).toHaveBeenCalledTimes(2)
    expect(vi.mocked(quote).mock.lastCall![1]).toEqual([{ productId: 'p1', quantity: 4, modifiers: [] }])
  })
})
