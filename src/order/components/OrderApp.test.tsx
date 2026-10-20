// Al cambiar de pantalla hacia adelante (carrito, datos, código, seguimiento): la tienda sube a su inicio SÓLO si su borde de arriba
// quedó sobre la ventana, y el foco va al titular de la pantalla nueva (en el código, a su primera caja).
import { h } from 'preact'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return { ...actual, quote: vi.fn(), getInfo: vi.fn(), getMenu: vi.fn(), getTracking: vi.fn(), requestOrderingOtp: vi.fn() }
})
import { getTracking, quote, requestOrderingOtp } from '../api'
import { checkoutOf } from '../checkout'
import type { OrderStore, Screen } from '../store'
import type { Tracking } from '../types'
import { OrderApp } from './OrderApp'
import { infoOf, makeStore, menuOf, product, withStore } from './testKit'

const scrollIntoView = vi.fn()
beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  vi.useFakeTimers()
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }) // el seguimiento no sondea con la pestaña oculta
  Element.prototype.scrollIntoView = scrollIntoView
  vi.mocked(quote).mockReset()
  vi.mocked(quote).mockResolvedValue({ ok: true, lines: [], subtotal: 170, total: 170, minOrderAmount: 0, issues: [] })
  vi.mocked(requestOrderingOtp).mockReset()
  vi.mocked(requestOrderingOtp).mockResolvedValue(undefined)
  vi.mocked(getTracking).mockReset()
  vi.mocked(getTracking).mockResolvedValue({
    orderNumber: '42', status: 'PENDING_ACCEPTANCE', paymentMode: 'PAY_AT_PICKUP', venueName: 'Flautas', venueSlug: 'a',
    items: [{ name: 'Flautas de pollo', quantity: 2, note: null, modifiers: [] }], total: 170, paid: false, estimatedReadyAt: null,
    acceptDeadlineAt: '2026-10-17T19:05:00Z', rejectReason: null, createdAt: '2026-10-17T19:00:00Z', canCancel: true,
    venueTimezone: 'America/Mexico_City', venueContact: { address: 'Calle 1', phone: '555 123 4567' },
  } as Tracking)
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
  delete (Element.prototype as any).scrollIntoView
  scrollIntoView.mockReset()
})

/** Una tienda con un renglón en el carrito, lista para pasar por todas las pantallas (el código necesita el pedido a verificar). */
function setup() {
  const s = makeStore(infoOf(), menuOf(product()))
  s.cart.value = [{ lineId: 'a', productId: 'p1', name: 'Flautas', unitPrice: 85, quantity: 2, note: null, modifiers: [] }]
  checkoutOf(s).lastBody.value = {
    items: [{ productId: 'p1', quantity: 2, modifiers: [] }], paymentMode: 'PAY_AT_PICKUP', expectedTotal: '170.00',
    customer: { name: 'Ana', phone: '+525544422262' },
  }
  s.trackingToken.value = 'T'.repeat(32)
  return s
}
const flush = () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve() })
/** Cambia de pantalla (los efectos de la pantalla nueva corren al cerrar el primer `act`) y deja correr lo que ellos piden (el seguimiento). */
const go = async (s: OrderStore, to: Screen) => {
  await act(() => { s.go(to) })
  await flush()
}
// jsdom no maqueta: la prueba decide el `top` de la raíz de la tienda en la ventana (0 si no dice nada).
const placeRoot = (top: () => number) =>
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const y = this.matches('.avq-o-root') ? top() : 0
    return { top: y, bottom: y + 40, left: 0, right: 0, width: 0, height: 40, x: 0, y, toJSON: () => ({}) } as DOMRect
  })
const heading = (name: string) => screen.getByRole('heading', { name }) as HTMLElement

describe('cambio de pantalla hacia adelante: la tienda sube a su inicio sólo si hace falta', () => {
  it('con el borde de arriba a la vista no se mueve nada; sobre la ventana, sube la RAÍZ de la tienda a su inicio y nunca el host', async () => {
    let rootTop = 0
    placeRoot(() => rootTop)
    const host = document.body.appendChild(document.createElement('div'))
    const s = setup()
    render(withStore(s, <OrderApp />), { container: host })
    const root = host.querySelector('.avq-o-root')!
    // A la vista (la persona no se ha desplazado): ni al carrito ni a «Tus datos» se mueve la página.
    await go(s, 'cart')
    await go(s, 'details')
    expect(scrollIntoView).not.toHaveBeenCalled()
    // Se desplazó la ventana (el borde de arriba de la tienda quedó 120 px arriba): a cada pantalla de adelante sube, y SÓLO la tienda.
    rootTop = -120
    for (const to of ['cart', 'details', 'otp', 'tracking'] as const) {
      scrollIntoView.mockClear()
      await go(s, to)
      expect(scrollIntoView, to).toHaveBeenCalledTimes(1)
      expect(scrollIntoView.mock.contexts[0], to).toBe(root)
      expect(scrollIntoView.mock.calls[0][0], to).toEqual({ block: 'start' })
    }
    expect(scrollIntoView.mock.contexts).not.toContain(host)
    host.remove()
  })
  it('volver a la carta no cambia nada de hoy: ni sube la tienda ni mueve el foco', async () => {
    placeRoot(() => -300)
    const s = setup()
    render(withStore(s, <OrderApp />))
    await go(s, 'cart')
    scrollIntoView.mockClear()
    await go(s, 'menu')
    expect(scrollIntoView).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(document.body)
    expect(screen.queryByRole('heading', { name: 'Tu pedido' })).toBeNull()
  })
  it('al cargar la página no se mueve nada (no hay cambio de pantalla): ni la carta, ni el carrito, ni el seguimiento', async () => {
    const focus = vi.spyOn(HTMLElement.prototype, 'focus')
    placeRoot(() => -300)
    for (const first of ['menu', 'cart', 'tracking'] as const) {
      const s = setup()
      s.go(first)
      render(withStore(s, <OrderApp />))
      await act(async () => { await vi.advanceTimersByTimeAsync(0) })
      expect(scrollIntoView, first).not.toHaveBeenCalled()
      expect(focus.mock.contexts.filter(el => (el as HTMLElement).matches?.('.avq-o-title')), first).toEqual([])
      expect(document.activeElement, first).toBe(document.body)
      cleanup()
    }
  })
})

describe('cambio de pantalla hacia adelante: el foco va al titular de la pantalla nueva', () => {
  it('«Tu pedido», «Tus datos» y el titular del seguimiento reciben el foco (tabindex -1, sin mover la página); en el código, su primera caja', async () => {
    const focus = vi.spyOn(HTMLElement.prototype, 'focus')
    const s = setup()
    render(withStore(s, <OrderApp />))
    const focusedWith = (el: HTMLElement) => focus.mock.calls[focus.mock.contexts.lastIndexOf(el)]?.[0]
    for (const [to, name] of [['cart', 'Tu pedido'], ['details', 'Tus datos']] as const) {
      await go(s, to)
      const h = heading(name)
      expect(document.activeElement, name).toBe(h)
      expect(h.getAttribute('tabindex'), name).toBe('-1')
      expect(focusedWith(h), name).toEqual({ preventScroll: true })
    }
    // El código: el foco va a la primera caja (ahí se escribe), no al titular.
    await go(s, 'otp')
    const boxes = screen.getAllByRole('textbox') as HTMLInputElement[]
    expect(document.activeElement).toBe(boxes[0])
    expect(document.activeElement).not.toBe(heading('Escribe tu código'))
    // El seguimiento carga sus datos al llegar: el titular aparece después y entonces recibe el foco.
    vi.mocked(getTracking).mockClear()
    await go(s, 'tracking')
    expect(getTracking).toHaveBeenCalled()
    const h = heading('Esperando que el restaurante acepte')
    expect(document.activeElement).toBe(h)
    expect(h.getAttribute('tabindex')).toBe('-1')
    expect(focusedWith(h)).toEqual({ preventScroll: true })
  })
  it('en el código, si la primera caja no puede tomar el foco (deshabilitada mientras algo se manda), lo toma su titular (tabindex -1), como en las demás', async () => {
    const s = setup()
    render(withStore(s, <OrderApp />))
    await go(s, 'details')
    await act(() => { checkoutOf(s).busy.value = true })
    await go(s, 'otp')
    expect((screen.getAllByRole('textbox') as HTMLInputElement[])[0].disabled).toBe(true)
    const h = heading('Escribe tu código')
    expect(h.getAttribute('tabindex')).toBe('-1')
    expect(document.activeElement).toBe(h)
  })
  it('también al regresar a una pantalla de adelante (de «Tus datos» al carrito)', async () => {
    const s = setup()
    render(withStore(s, <OrderApp />))
    await go(s, 'cart')
    await go(s, 'details')
    await go(s, 'cart')
    expect(document.activeElement).toBe(heading('Tu pedido'))
  })
  it('nunca jala el foco de otro lado: si la persona (o la página del sitio) ya tiene el foco en otro elemento, ahí se queda', async () => {
    const s = setup()
    render(withStore(s, <OrderApp />))
    const elsewhere = document.body.appendChild(document.createElement('input'))
    elsewhere.focus()
    await go(s, 'cart')
    expect(document.activeElement).toBe(elsewhere)
    await go(s, 'tracking') // el titular aparece más tarde: tampoco entonces
    expect(document.activeElement).toBe(elsewhere)
    elsewhere.remove()
  })
  it('si la persona toma el foco antes de que llegue el titular del seguimiento, no se lo quita', async () => {
    let arrive!: (t: Tracking) => void
    vi.mocked(getTracking).mockReturnValue(new Promise(resolve => { arrive = resolve }))
    const s = setup()
    render(withStore(s, <OrderApp />))
    await go(s, 'tracking')
    const elsewhere = document.body.appendChild(document.createElement('input'))
    elsewhere.focus()
    await act(async () => {
      arrive({
        orderNumber: '42', status: 'PENDING_ACCEPTANCE', paymentMode: 'PAY_AT_PICKUP', venueName: 'Flautas', venueSlug: 'a', items: [],
        total: 170, paid: false, estimatedReadyAt: null, acceptDeadlineAt: '2026-10-17T19:05:00Z', rejectReason: null,
        createdAt: '2026-10-17T19:00:00Z', canCancel: true,
      } as Tracking)
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByRole('heading', { name: 'Esperando que el restaurante acepte' })).toBeTruthy()
    expect(document.activeElement).toBe(elsewhere)
    elsewhere.remove()
  })
  it('dentro de la sombra de <avoqado-order>: el foco queda en el titular de la sombra y sólo se desplaza un elemento de la tienda (nunca el host)', async () => {
    placeRoot(() => -80)
    const host = document.body.appendChild(document.createElement('div'))
    const mount = host.attachShadow({ mode: 'open' }).appendChild(document.createElement('div'))
    const s = setup()
    render(withStore(s, <OrderApp />), { container: mount })
    await go(s, 'cart')
    // Desde el documento sólo se ve el host: lo que importa es shadowRoot.activeElement.
    expect(document.activeElement).toBe(host)
    expect(host.shadowRoot!.activeElement).toBe(within(mount).getByRole('heading', { name: 'Tu pedido' }))
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(mount.contains(scrollIntoView.mock.contexts[0] as Node)).toBe(true)
    expect(scrollIntoView.mock.contexts).not.toContain(host)
    host.remove()
  })
})

describe('un doble toque no cae en lo que aparece: tras cambiar la vista, la tienda ignora los clics de 400 ms', () => {
  // Salsa obligatoria, de una. «Queso extra» (+$12.50) es la opción que quedaría bajo el segundo toque de la fila.
  const withSalsa = () => product({
    modifierGroups: [{
      id: 'g1', name: 'Salsa', required: true, allowMultiple: false, minSelections: 1, maxSelections: 1,
      modifiers: [{ id: 'm1', name: 'Verde', price: 0 }, { id: 'm2', name: 'Queso extra', price: 12.5 }],
    }],
  })
  /** El reloj falso no avanza solo: la prueba dice cuánto tarda la persona entre un toque y otro. */
  const later = (ms: number) => act(() => { vi.advanceTimersByTime(ms) })
  const rowBtn = () => screen.getByRole('button', { name: 'Agregar Flautas de pollo' })
  const queso = () => screen.getByLabelText(/Queso extra/) as HTMLInputElement
  const addBtn = () => screen.getByRole('button', { name: /^Agregar \$/ }) as HTMLButtonElement
  const bar = () => screen.getByRole('button', { name: /^Ver pedido/ })

  it('fila → ficha: el primer toque abre la ficha y el segundo, que cae en una opción, no la marca; a los 401 ms sí', async () => {
    const s = makeStore(infoOf(), menuOf(withSalsa()))
    render(withStore(s, <OrderApp />))
    fireEvent.click(rowBtn()) // el primer toque pasa: antes no cambió nada
    expect(s.productId.value).toBe('p1')
    fireEvent.click(queso()) // el segundo, en el mismo instante
    expect(queso().checked).toBe(false)
    expect(addBtn().textContent).toBe('Agregar $85') // sin el sobreprecio que nadie eligió
    await later(399)
    fireEvent.click(queso()) // (cada toque se mira solo: dos toques en el radio lo marcarían y lo quitarían)
    expect(queso().checked).toBe(false)
    await later(2)
    fireEvent.click(queso()) // a los 401 ms ya es un toque de verdad
    expect(queso().checked).toBe(true)
    expect(addBtn().textContent).toBe('Agregar $97.50')
  })
  it('«Agregar» → «Ver pedido»: el segundo toque, que cae en la barra que aparece al cerrar, no abre el carrito; a los 401 ms sí', async () => {
    const s = makeStore(infoOf(), menuOf(product()))
    render(withStore(s, <OrderApp />))
    fireEvent.click(rowBtn())
    await later(1000) // la persona mira la ficha
    fireEvent.click(addBtn()) // el primer toque de «Agregar» pasa: agrega y cierra
    expect(s.cart.value).toHaveLength(1)
    expect(s.productId.value).toBeNull()
    fireEvent.click(bar())
    await later(399)
    fireEvent.click(bar())
    expect(s.screen.value).toBe('menu')
    await later(2)
    fireEvent.click(bar())
    expect(s.screen.value).toBe('cart')
  })
  it('cuenta la hora del TOQUE (timeStamp), no la de atenderlo: un segundo toque sellado a los 100 ms y atendido a los 600 (hilo trabado) tampoco pasa', async () => {
    const s = makeStore(infoOf(), menuOf(withSalsa()))
    render(withStore(s, <OrderApp />))
    const opened = performance.now()
    fireEvent.click(rowBtn())
    await later(600)
    const tap = new MouseEvent('click', { bubbles: true, cancelable: true })
    Object.defineProperty(tap, 'timeStamp', { value: opened + 100 })
    fireEvent(queso(), tap)
    expect(queso().checked).toBe(false)
    expect(s.productId.value).toBe('p1')
  })
  it('con teclado (Enter y Espacio dan clics con detail 0) también vale la regla, y dos teclas a más de 400 ms una de otra funcionan', async () => {
    const s = makeStore(infoOf(), menuOf(withSalsa()))
    render(withStore(s, <OrderApp />))
    fireEvent.click(rowBtn(), { detail: 0 }) // Enter en la fila
    expect(s.productId.value).toBe('p1')
    fireEvent.click(queso(), { detail: 0 }) // una tecla repetida al instante, no
    expect(queso().checked).toBe(false)
    await later(450)
    fireEvent.click(queso(), { detail: 0 }) // Espacio en la opción
    expect(queso().checked).toBe(true)
    await later(450)
    fireEvent.click(addBtn(), { detail: 0 }) // Enter en «Agregar»
    expect(s.cart.value).toHaveLength(1)
    await later(450)
    fireEvent.click(bar(), { detail: 0 }) // Enter en «Ver pedido»
    expect(s.screen.value).toBe('cart')
  })
})
