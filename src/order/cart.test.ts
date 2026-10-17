import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addLine, estimateCents, loadCart, removeLine, saveCart, setQuantity, toQuoteItems, type Cart, type CartLine } from './cart'

const flauta = (over: Partial<Omit<CartLine, 'lineId'>> = {}): Omit<CartLine, 'lineId'> => ({
  productId: 'p-flauta',
  name: 'Flautas de pollo',
  unitPrice: 85.9,
  quantity: 1,
  modifiers: [],
  note: null,
  ...over,
})
const salsa = { modifierId: 'm-salsa', name: 'Salsa verde', price: 12.5, quantity: 2 }
const queso = { modifierId: 'm-queso', name: 'Queso extra', price: 15, quantity: 1 }

beforeEach(() => sessionStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('addLine', () => {
  it('agrega un renglón con su propio lineId', () => {
    const cart = addLine([], flauta())
    expect(cart).toHaveLength(1)
    expect(cart[0].lineId).toEqual(expect.any(String))
    expect(cart[0]).toMatchObject(flauta())
  })

  it('une con un renglón idéntico (mismas opciones en otro orden y misma nota) sumando la cantidad', () => {
    let cart = addLine([], flauta({ modifiers: [salsa, queso], note: 'sin cebolla', quantity: 2 }))
    cart = addLine(cart, flauta({ modifiers: [queso, salsa], note: '  sin cebolla ', quantity: 3 }))
    expect(cart).toHaveLength(1)
    expect(cart[0].quantity).toBe(5)
  })

  it('separa si cambia el producto, una opción, la cantidad de una opción o la nota', () => {
    let cart = addLine([], flauta())
    cart = addLine(cart, flauta({ productId: 'p-taco' }))
    cart = addLine(cart, flauta({ modifiers: [salsa] }))
    cart = addLine(cart, flauta({ modifiers: [{ ...salsa, quantity: 1 }] }))
    cart = addLine(cart, flauta({ note: 'bien doradas' }))
    expect(cart).toHaveLength(5)
    expect(new Set(cart.map(l => l.lineId)).size).toBe(5)
  })

  it('una nota vacía o de puros espacios es «sin nota»', () => {
    let cart = addLine([], flauta({ note: '   ' }))
    cart = addLine(cart, flauta())
    expect(cart).toHaveLength(1)
    expect(cart[0].note).toBeNull()
  })

  it('tope de 20 por renglón, también al unir', () => {
    let cart = addLine([], flauta({ quantity: 15 }))
    cart = addLine(cart, flauta({ quantity: 10 }))
    expect(cart[0].quantity).toBe(20)
    expect(addLine([], flauta({ quantity: 30 }))[0].quantity).toBe(20)
  })

  it('una cantidad menor a 1 no agrega nada', () => {
    expect(addLine([], flauta({ quantity: 0 }))).toEqual([])
  })

  it('no muta el carrito que recibe', () => {
    const before = addLine([], flauta())
    const snapshot = JSON.stringify(before)
    addLine(before, flauta())
    addLine(before, flauta({ productId: 'p-taco' }))
    expect(JSON.stringify(before)).toBe(snapshot)
  })
})

describe('setQuantity y removeLine', () => {
  it('setQuantity cambia la cantidad, con tope de 20', () => {
    const cart = addLine([], flauta())
    const id = cart[0].lineId
    expect(setQuantity(cart, id, 3)[0].quantity).toBe(3)
    expect(setQuantity(cart, id, 25)[0].quantity).toBe(20)
  })

  it('setQuantity(…, 0) quita el renglón', () => {
    const cart = addLine(addLine([], flauta()), flauta({ productId: 'p-taco' }))
    const rest = setQuantity(cart, cart[0].lineId, 0)
    expect(rest).toHaveLength(1)
    expect(rest[0].productId).toBe('p-taco')
  })

  it('removeLine quita sólo ése', () => {
    const cart = addLine(addLine([], flauta()), flauta({ productId: 'p-taco' }))
    expect(removeLine(cart, cart[1].lineId).map(l => l.productId)).toEqual(['p-flauta'])
  })
})

describe('estimateCents', () => {
  it('suma en centavos exactos: 0.1 + 0.2 = 30 centavos', () => {
    const cart = addLine(addLine([], flauta({ unitPrice: 0.1 })), flauta({ productId: 'p-2', unitPrice: 0.2 }))
    expect(estimateCents(cart)).toBe(30)
  })

  it('una opción de $12.50 × 2 por platillo, por 3 platillos', () => {
    // (8590 + 1250·2) · 3 = 33270
    expect(estimateCents(addLine([], flauta({ modifiers: [salsa], quantity: 3 })))).toBe(33270)
  })

  it('carrito vacío = 0', () => {
    expect(estimateCents([])).toBe(0)
  })
})

describe('toQuoteItems', () => {
  it('manda ids y cantidades (nunca precios); la nota sólo si hay', () => {
    let cart = addLine([], flauta({ modifiers: [salsa], quantity: 2, note: 'sin cebolla' }))
    cart = addLine(cart, flauta({ productId: 'p-taco' }))
    expect(toQuoteItems(cart)).toEqual([
      { productId: 'p-flauta', quantity: 2, modifiers: [{ modifierId: 'm-salsa', quantity: 2 }], note: 'sin cebolla' },
      { productId: 'p-taco', quantity: 1, modifiers: [] },
    ])
  })
})

describe('loadCart y saveCart', () => {
  it('guarda en sessionStorage `avq_order_cart:<slug>` y cada negocio tiene el suyo', () => {
    const cart = addLine([], flauta())
    saveCart('flautas-coyoacan', cart)
    expect(JSON.parse(sessionStorage.getItem('avq_order_cart:flautas-coyoacan')!)).toEqual(cart)
    expect(loadCart('flautas-coyoacan')).toEqual(cart)
    expect(loadCart('otro-negocio')).toEqual([])
  })

  it('sobrevive a recargar la página (módulo nuevo, misma sessionStorage)', async () => {
    const cart = addLine([], flauta({ modifiers: [salsa] }))
    saveCart('flautas-coyoacan', cart)
    vi.resetModules()
    const fresh = await import('./cart')
    expect(fresh.loadCart('flautas-coyoacan')).toEqual(cart)
  })

  it('un valor dañado en sessionStorage es un carrito vacío', () => {
    sessionStorage.setItem('avq_order_cart:roto', '{no es json')
    expect(loadCart('roto')).toEqual([])
    sessionStorage.setItem('avq_order_cart:roto2', '{"a":1}')
    expect(loadCart('roto2')).toEqual([])
  })

  it('si sessionStorage lanza, el carrito funciona en memoria', async () => {
    vi.resetModules()
    const fresh = await import('./cart')
    vi.spyOn(globalThis, 'sessionStorage', 'get').mockImplementation(() => {
      throw new DOMException('bloqueado', 'SecurityError')
    })
    const cart: Cart = fresh.addLine([], flauta())
    expect(() => fresh.saveCart('flautas-coyoacan', cart)).not.toThrow()
    expect(fresh.loadCart('flautas-coyoacan')).toEqual(cart)
    expect(fresh.loadCart('otro-negocio')).toEqual([])
  })
})
