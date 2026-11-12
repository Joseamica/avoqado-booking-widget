// Al cambiar de pantalla hacia adelante (carrito, datos, código, seguimiento): la tienda sube a su inicio SÓLO si su borde de arriba
// quedó sobre la ventana, y el foco va al titular de la pantalla nueva (en el código, a su primera caja).
import { h } from 'preact'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return { ...actual, quote: vi.fn(), getInfo: vi.fn(), getMenu: vi.fn(), getTracking: vi.fn(), requestOrderingOtp: vi.fn() }
})
vi.mock('../../api/booking', async () => {
  const actual = await vi.importActual<typeof import('../../api/booking')>('../../api/booking')
  return { ...actual, getCustomerPortal: vi.fn(), getCreditPacks: vi.fn(), requestOtp: vi.fn(), verifyOtp: vi.fn() }
})
import * as bookingApi from '../../api/booking'
import { ApiError, getTracking, quote, requestOrderingOtp } from '../api'
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
  localStorage.clear() // el último pedido (avq_order_last:*) no se hereda entre pruebas
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
    const h = heading('Esperando que el negocio acepte')
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
    expect(screen.getByRole('heading', { name: 'Esperando que el negocio acepte' })).toBeTruthy()
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

describe('W3: el aviso del menú con un folio (volvió a abrir el QR)', () => {
  const folio = (over: Partial<Tracking> = {}) => ({
    orderNumber: 'W7K3P', status: 'PENDING_ACCEPTANCE', paymentMode: 'PAY_AT_PICKUP', venueName: 'Flautas', venueSlug: 'a',
    items: [], total: 134, paid: false, estimatedReadyAt: null, acceptDeadlineAt: '2026-10-17T19:42:00Z', rejectReason: null,
    createdAt: '2026-10-17T19:12:00Z', canCancel: true, venueTimezone: 'America/Mexico_City', requiresAcceptance: false, ...over,
  } as Tracking)
  const open = async () => {
    const s = makeStore(infoOf(), menuOf(product()))
    localStorage.setItem(`avq_order_last:${s.slug}`, JSON.stringify({ trackingToken: 'T'.repeat(32), orderNumber: 'W7K3P' }))
    render(withStore(s, <OrderApp />))
    await flush()
    return s
  }
  it('sin pagar: «Tu folio W7K3P» / «Paga en caja antes de las 13:42.» / «Ver», que lleva al seguimiento', async () => {
    vi.mocked(getTracking).mockResolvedValue(folio())
    const s = await open()
    expect(screen.getByText('Tu folio W7K3P')).toBeTruthy()
    expect(screen.getByText('Paga en caja antes de las 13:42.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Ver' }))
    expect(s.screen.value).toBe('tracking')
  })
  it('ya pagado: «Tu pedido W7K3P está pagado»', async () => {
    vi.mocked(getTracking).mockResolvedValue(folio({ status: 'ACCEPTED', paid: true, canCancel: false }))
    await open()
    expect(screen.getByText('Tu pedido W7K3P está pagado')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Ver' })).toBeTruthy()
  })
  it('«Mi equipo» sigue con «Tienes un pedido en curso»', async () => {
    vi.mocked(getTracking).mockResolvedValue(folio({ requiresAcceptance: true }))
    await open()
    expect(screen.getByText('Tienes un pedido en curso')).toBeTruthy()
  })
  it('m1: un folio vencido sin dinero NO borra el aviso: «Tu folio» y «Ver» llevan al seguimiento', async () => {
    vi.setSystemTime(new Date('2026-10-17T19:50:00Z'))
    vi.mocked(getTracking).mockResolvedValue(folio({ status: 'EXPIRED', canCancel: false }))
    const s = await open()
    expect(screen.getByText('Tu folio W7K3P')).toBeTruthy()
    expect(screen.getByText('Se canceló. Si ya pagaste en caja, ábrelo para ver si ya se registró.')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/Se venció|No se te cobró nada/)
    expect(localStorage.getItem(`avq_order_last:${s.slug}`)).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Ver' }))
    expect(s.screen.value).toBe('tracking')
  })
  it('m1: vencido pero con dinero llegado tarde: «Tu pedido W7K3P está pagado»', async () => {
    vi.setSystemTime(new Date('2026-10-17T20:30:00Z'))
    vi.mocked(getTracking).mockResolvedValue(folio({ status: 'EXPIRED', paid: true, canCancel: false }))
    await open()
    expect(screen.getByText('Tu pedido W7K3P está pagado')).toBeTruthy()
  })
  it('W3c: vencido y pagado se recuerda aunque pasen más de 2 h (el servidor lo revive)', async () => {
    vi.setSystemTime(new Date('2026-10-17T23:00:00Z'))
    vi.mocked(getTracking).mockResolvedValue(folio({ status: 'EXPIRED', paid: true, canCancel: false }))
    await open()
    expect(screen.getByText('Tu pedido W7K3P está pagado')).toBeTruthy()
  })
  it('m1: pasadas 2 h de su hora, el vencido sí se olvida', async () => {
    vi.setSystemTime(new Date('2026-10-17T21:45:00Z'))
    vi.mocked(getTracking).mockResolvedValue(folio({ status: 'EXPIRED', canCancel: false }))
    const s = await open()
    expect(screen.queryByRole('button', { name: 'Ver' })).toBeNull()
    expect(localStorage.getItem(`avq_order_last:${s.slug}`)).toBeNull()
  })
  it('R79 #2: cancelado por el negocio sin dinero se recuerda («Se canceló…»), no dice «pagado»', async () => {
    vi.setSystemTime(new Date('2026-10-17T19:50:00Z'))
    vi.mocked(getTracking).mockResolvedValue(folio({ status: 'CANCELLED_BY_STAFF', canCancel: false }))
    await open()
    expect(screen.getByText('Tu folio W7K3P')).toBeTruthy()
    expect(screen.getByText('Se canceló. Si ya pagaste en caja, ábrelo para ver si ya se registró.')).toBeTruthy()
  })
  it('R79 #4: con abono el aviso no promete que se cancela: «Ya pagaste $50 · Falta $84: págalo en caja»', async () => {
    vi.mocked(getTracking).mockResolvedValue(folio({ amountPaid: 50, remaining: 84 }))
    await open()
    expect(screen.getByText('Ya pagaste $50 · Falta $84: págalo en caja')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/antes de las/)
  })
  it('R82 #5: el aviso se relee cada 30 s; si la clienta abona mientras está en el menú, cambia al texto del abono (sin hora límite)', async () => {
    vi.mocked(getTracking).mockResolvedValue(folio())
    await open()
    expect(screen.getByText('Paga en caja antes de las 13:42.')).toBeTruthy()
    vi.mocked(getTracking).mockResolvedValue(folio({ amountPaid: 50, remaining: 84 }))
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(screen.getByText('Ya pagaste $50 · Falta $84: págalo en caja')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/antes de las/)
  })
  it('R82 #5: al volver a la pestaña se relee; si ya está pagado, lo dice, y al ser final deja de releer', async () => {
    vi.mocked(getTracking).mockResolvedValue(folio())
    await open()
    vi.mocked(getTracking).mockResolvedValue(folio({ status: 'ACCEPTED', paid: true, canCancel: false }))
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    await flush()
    expect(screen.getByText('Tu pedido W7K3P está pagado')).toBeTruthy()
    vi.mocked(getTracking).mockResolvedValue(folio({ status: 'COMPLETED', paid: true, canCancel: false }))
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(screen.queryByRole('button', { name: 'Ver' })).toBeNull()
    const n = vi.mocked(getTracking).mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000) })
    expect(getTracking).toHaveBeenCalledTimes(n)
  })
  it('Wc1-m1: un cancelado con `paid` se olvida pasadas 24 h de su hora', async () => {
    vi.setSystemTime(new Date('2026-10-18T20:00:00Z'))
    vi.mocked(getTracking).mockResolvedValue(folio({ status: 'CANCELLED_BY_STAFF', paid: true, canCancel: false }))
    const s = await open()
    expect(screen.queryByRole('button', { name: 'Ver' })).toBeNull()
    expect(localStorage.getItem(`avq_order_last:${s.slug}`)).toBeNull()
  })
  it('tope: un vencido con `paid` que nadie revive se olvida pasadas 24 h', async () => {
    vi.setSystemTime(new Date('2026-10-18T20:00:00Z'))
    vi.mocked(getTracking).mockResolvedValue(folio({ status: 'EXPIRED', paid: true, canCancel: false }))
    const s = await open()
    expect(screen.queryByRole('button', { name: 'Ver' })).toBeNull()
    expect(localStorage.getItem(`avq_order_last:${s.slug}`)).toBeNull()
  })
  it('una respuesta vieja no pisa a la nueva (lecturas que se traslapan)', async () => {
    let slow!: (t: Tracking) => void
    vi.mocked(getTracking).mockResolvedValue(folio())
    await open()
    vi.mocked(getTracking).mockReturnValueOnce(new Promise<Tracking>(r => { slow = r })) // la lenta sale primero
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    vi.mocked(getTracking).mockResolvedValue(folio({ status: 'ACCEPTED', paid: true, canCancel: false }))
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    await flush()
    expect(screen.getByText('Tu pedido W7K3P está pagado')).toBeTruthy()
    await act(async () => { slow(folio()) }) // llega tarde con el estado viejo
    await flush()
    expect(screen.getByText('Tu pedido W7K3P está pagado')).toBeTruthy()
  })
  it('R85 #4: el aviso de un EXPIRED pagado se borra al pasar las 24 h aunque las lecturas fallen', async () => {
    vi.setSystemTime(new Date('2026-10-18T12:30:00Z')) // 23 h después de la hora límite (19:42Z)... aún dentro
    vi.mocked(getTracking).mockResolvedValue(folio({ status: 'EXPIRED', paid: true, canCancel: false, acceptDeadlineAt: '2026-10-17T19:42:00Z' }))
    const s = await open()
    expect(screen.getByText('Tu pedido W7K3P está pagado')).toBeTruthy()
    vi.mocked(getTracking).mockRejectedValue(new ApiError('Sin conexión', 0, undefined, undefined, true))
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(screen.getByText('Tu pedido W7K3P está pagado')).toBeTruthy() // la red falla pero aún no vence
    vi.setSystemTime(new Date('2026-10-18T20:00:00Z'))
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(screen.queryByRole('button', { name: 'Ver' })).toBeNull()
    expect(localStorage.getItem(`avq_order_last:${s.slug}`)).toBeNull()
    const n = vi.mocked(getTracking).mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000) })
    expect(getTracking).toHaveBeenCalledTimes(n)
  })
})

// ───────────────────────── W4: «Entrar» / «Mi cuenta» dentro de la tienda ─────────────────────────
import { borrarSesion as borrarLaSesion, fijarPagina as fijarLaPagina, guardarSesion as guardarLaSesion, leerSesion as leerLaSesion, paginaDe as paginaDeLa } from '../../lib/sesionDeCliente'
import { desdeUnica } from '../session'
const ANA = { id: 'c1', firstName: 'Ana', lastName: null, email: null, phone: '+525544422262' }
const TEL_ANA = { tipo: 'PHONE' as const, valor: '+525544422262', metodo: 'WHATSAPP' as const, probadoEn: 1 }
const portalDeAna = () => ({
  customer: { ...ANA, loyaltyPoints: 340, totalVisits: 1 }, credits: { purchases: [] }, reservations: { upcoming: [], past: [] },
  puntos: { saldo: 340, valor: 34 }, pedidos: { items: [], total: 0, nextCursor: null }, tarjetas: { items: [], total: 0, nextCursor: null },
  descuentos: { items: [], total: 0, nextCursor: null }, saldoAFavor: null, premioDisponible: null, otraFicha: null, invitadaRequiereEntrar: false,
}) as any
/** La tienda con Ana adentro (su sesión guardada y adoptada por la superficie de la tienda). */
function tiendaConAna(info = infoOf({ requiresAcceptance: false })) {
  const s = makeStore(info, menuOf(product()))
  const sesion = { token: 'tok-A', customer: ANA, contactos: [TEL_ANA], guardadaEn: Date.now() }
  guardarLaSesion(s.slug, sesion)
  fijarLaPagina(s.slug, 'pedidos', desdeUnica(sesion))
  return s
}

describe('W4: «Entrar» / «Mi cuenta» en la tienda', () => {
  beforeEach(() => {
    vi.mocked(bookingApi.getCustomerPortal).mockReset()
    vi.mocked(bookingApi.getCustomerPortal).mockResolvedValue(portalDeAna())
    vi.mocked(bookingApi.getCreditPacks).mockResolvedValue([])
  })

  it('sin sesión: «Entrar» arriba del menú lleva a «Entra a tu cuenta»; «Pedir sin cuenta» regresa al menú', async () => {
    const s = makeStore(infoOf({ requiresAcceptance: false }), menuOf(product()))
    render(withStore(s, <OrderApp />))
    await flush()
    expect(screen.queryByRole('button', { name: 'Mi cuenta' })).toBeNull()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Entrar' })) })
    await flush()
    expect(s.screen.value).toBe('cuenta')
    expect(screen.getByRole('heading', { name: 'Entra a tu cuenta' })).toBeTruthy()
    expect(screen.getByText('Para pedir no necesitas cuenta: basta tu nombre.')).toBeTruthy()
    vi.advanceTimersByTime(500) // el guardia de doble toque
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Pedir sin cuenta' })) })
    expect(s.screen.value).toBe('menu')
    expect(bookingApi.getCustomerPortal).not.toHaveBeenCalled()
  })

  it('con sesión: «Mi cuenta» lee el portal con la sesión de la TIENDA; «Cerrar sesión» vuelve al menú con «Entrar» y sin «Tu sesión se cerró»', async () => {
    const s = tiendaConAna()
    render(withStore(s, <OrderApp />))
    await flush()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Mi cuenta' })) })
    await flush()
    expect(bookingApi.getCustomerPortal).toHaveBeenCalledWith(s.slug, 'tok-A', 'pedidos')
    expect(screen.getByText('Hola, Ana')).toBeTruthy()
    expect(screen.getByText('340 puntos')).toBeTruthy()
    vi.advanceTimersByTime(500)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' })) })
    await flush()
    expect(s.screen.value).toBe('menu')
    expect(screen.getByRole('button', { name: 'Entrar' })).toBeTruthy()
    expect(leerLaSesion(s.slug)).toBeNull()
    expect(paginaDeLa(s.slug, 'pedidos')).toBeNull()
    expect(checkoutOf(s).sesionCerrada.value).toBe(false)
  })

  it('«Mi cuenta» de la tienda nunca toma la sesión que otra superficie guardó después: se queda sin sesión y lo dice con calma', async () => {
    const s = tiendaConAna()
    render(withStore(s, <OrderApp />))
    await flush()
    // Otra superficie del documento (o otra pestaña) entró como Bea.
    borrarLaSesion(s.slug)
    guardarLaSesion(s.slug, { token: 'tok-B', customer: { ...ANA, id: 'c2', firstName: 'Bea' }, contactos: [TEL_ANA], guardadaEn: Date.now() })
    vi.mocked(bookingApi.getCustomerPortal).mockImplementation((await vi.importActual<typeof import('../../api/booking')>('../../api/booking')).getCustomerPortal)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Mi cuenta' })) })
    await flush()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.queryByText('Hola, Bea')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Entra a tu cuenta' })).toBeTruthy()
    vi.unstubAllGlobals()
  })

  it('«Nadie» sin sesión: «Tus datos» ofrece «¿Tienes premios en Flautas?» y «Entrar» lleva a la pantalla de entrar; con sesión, no sale', async () => {
    const s = makeStore(infoOf({ requiresAcceptance: false }), menuOf(product()))
    s.cart.value = [{ lineId: 'a', productId: 'p1', name: 'Flautas', unitPrice: 85, quantity: 1, note: null, modifiers: [] }]
    s.go('details')
    render(withStore(s, <OrderApp />))
    await flush()
    expect(screen.getByText('¿Tienes premios en Flautas?')).toBeTruthy()
    expect(screen.getByText('Entra para usarlos en este pedido.')).toBeTruthy()
    vi.advanceTimersByTime(500)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Entrar' })) })
    expect(s.screen.value).toBe('entrar')
    cleanup()
    const conAna = tiendaConAna()
    conAna.cart.value = s.cart.value
    conAna.go('details')
    render(withStore(conAna, <OrderApp />))
    await flush()
    expect(screen.queryByText('¿Tienes premios en Flautas?')).toBeNull()
  })

  // D16: el SERVIDOR dice si el negocio tiene algo de cuenta (sellos, puntos, descuentos, cupones, tarjetas, saldo a favor, paquetes).
  it('D16: sin nada de cuenta (`cuentaConBeneficios: false`) no sale «Entrar», ni «Mi cuenta» con sesión, ni «¿Tienes premios?»', async () => {
    const sinCuenta = infoOf({ requiresAcceptance: false, cuentaConBeneficios: false })
    const s = makeStore(sinCuenta, menuOf(product()))
    render(withStore(s, <OrderApp />))
    await flush()
    expect(screen.getByRole('heading', { name: 'Flautas' })).toBeTruthy() // la cabecera sí está; sólo falta el botón
    expect(screen.queryByRole('button', { name: 'Entrar' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Mi cuenta' })).toBeNull()
    cleanup()
    render(withStore(tiendaConAna(sinCuenta), <OrderApp />))
    await flush()
    expect(screen.queryByRole('button', { name: 'Mi cuenta' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Entrar' })).toBeNull()
    cleanup()
    const d = makeStore(sinCuenta, menuOf(product()))
    d.cart.value = [{ lineId: 'a', productId: 'p1', name: 'Flautas', unitPrice: 85, quantity: 1, note: null, modifiers: [] }]
    d.go('details')
    render(withStore(d, <OrderApp />))
    await flush()
    expect(screen.queryByText('¿Tienes premios en Flautas?')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Entrar' })).toBeNull()
  })

  it('D16: con algo de cuenta (`true`) sale «Entrar» y «¿Tienes premios?», igual que sin el campo (SERVIDOR viejo)', async () => {
    const conCuenta = infoOf({ requiresAcceptance: false, cuentaConBeneficios: true })
    render(withStore(makeStore(conCuenta, menuOf(product())), <OrderApp />))
    await flush()
    expect(screen.getByRole('button', { name: 'Entrar' })).toBeTruthy()
    cleanup()
    render(withStore(tiendaConAna(conCuenta), <OrderApp />))
    await flush()
    expect(screen.getByRole('button', { name: 'Mi cuenta' })).toBeTruthy()
    cleanup()
    const d = makeStore(conCuenta, menuOf(product()))
    d.cart.value = [{ lineId: 'a', productId: 'p1', name: 'Flautas', unitPrice: 85, quantity: 1, note: null, modifiers: [] }]
    d.go('details')
    render(withStore(d, <OrderApp />))
    await flush()
    expect(screen.getByText('¿Tienes premios en Flautas?')).toBeTruthy()
  })

  it('el aviso del menú ve cambiar su folio (pagado) ⇒ avisa avoqado:folio-cambio con su negocio', async () => {
    const folioPorPagar = {
      orderNumber: 'W7K3P', status: 'PENDING_ACCEPTANCE', paymentMode: 'PAY_AT_PICKUP', venueName: 'Flautas', venueSlug: 'a', items: [], total: 134,
      paid: false, estimatedReadyAt: null, acceptDeadlineAt: '2026-10-17T19:42:00Z', rejectReason: null, createdAt: '2026-10-17T19:12:00Z',
      canCancel: true, venueTimezone: 'America/Mexico_City', requiresAcceptance: false,
    } as Tracking
    vi.mocked(getTracking).mockResolvedValue(folioPorPagar)
    const s = makeStore(infoOf(), menuOf(product()))
    localStorage.setItem(`avq_order_last:${s.slug}`, JSON.stringify({ trackingToken: 'T'.repeat(32), orderNumber: 'W7K3P' }))
    const oido = vi.fn()
    document.addEventListener('avoqado:folio-cambio', oido)
    render(withStore(s, <OrderApp />))
    await flush()
    expect(oido).not.toHaveBeenCalled() // la primera lectura no es un cambio
    vi.mocked(getTracking).mockResolvedValue({ ...folioPorPagar, status: 'ACCEPTED', paid: true, canCancel: false })
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(oido).toHaveBeenCalledTimes(1)
    expect(oido.mock.calls[0][0].detail).toMatchObject({ slug: s.slug, trackingToken: 'T'.repeat(32), status: 'ACCEPTED', paid: true })
    document.removeEventListener('avoqado:folio-cambio', oido)
  })
})

describe('W4: «Mi cuenta» de la tienda al volver a abrirla', () => {
  beforeEach(() => {
    vi.mocked(bookingApi.getCustomerPortal).mockReset()
    vi.mocked(bookingApi.getCreditPacks).mockResolvedValue([])
  })

  it('enseña lo anterior de ESA sesión con «Actualizando…» mientras relee', async () => {
    const s = tiendaConAna()
    vi.mocked(bookingApi.getCustomerPortal).mockResolvedValueOnce(portalDeAna()).mockImplementationOnce(() => new Promise(() => {}))
    render(withStore(s, <OrderApp />))
    await flush()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Mi cuenta' })) })
    await flush()
    expect(screen.getByText('340 puntos')).toBeTruthy()
    vi.advanceTimersByTime(500)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Volver al menú' })) })
    vi.advanceTimersByTime(500)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Mi cuenta' })) })
    await flush()
    expect(screen.getByText('340 puntos')).toBeTruthy()
    expect(screen.getByText('Actualizando…')).toBeTruthy()
    expect(bookingApi.getCustomerPortal).toHaveBeenCalledTimes(2)
  })

  it('sin sesión, la entrada dice el nombre del negocio de la tienda', async () => {
    const s = makeStore(infoOf({ requiresAcceptance: false }), menuOf(product()))
    s.go('cuenta')
    render(withStore(s, <OrderApp />))
    await flush()
    expect(screen.getByText(/en Flautas\./)).toBeTruthy()
  })
})

describe('W4 codex-w4-r3 #1: dos tiendas del mismo negocio en una página', () => {
  it('la que enseña «Usar en caja» lo cierra cuando la otra ya leyó la tarjeta bloqueada', async () => {
    const { createOrderStore } = await import('../store')
    const slug = `doble${Date.now()}`
    const sesion = { token: 'tok-A', customer: ANA, contactos: [TEL_ANA], guardadaEn: Date.now() }
    guardarLaSesion(slug, sesion)
    const [a, b] = [createOrderStore(slug, { locale: 'es' }), createOrderStore(slug, { locale: 'es' })]
    for (const s of [a, b]) { s.info.value = infoOf({ requiresAcceptance: false }); s.menu.value = menuOf(product()) }
    const viva = { ...portalDeAna(), tarjetas: { items: [{ id: 'g1', last4: 'HB7T', saldo: 350, venceEl: null, codigo: 'K7Q2-9DXM-4R8H-HB7T-Q', estado: 'ACTIVA', disponible: true }], total: 1, nextCursor: null } }
    const bloqueada = { ...portalDeAna(), tarjetas: { items: [{ id: 'g1', last4: 'HB7T', saldo: 0, venceEl: null, codigo: null, estado: 'BLOQUEADA', disponible: false }], total: 1, nextCursor: null } }
    vi.mocked(bookingApi.getCustomerPortal).mockReset()
    vi.mocked(bookingApi.getCustomerPortal).mockResolvedValueOnce(viva).mockResolvedValueOnce(bloqueada)
    vi.mocked(bookingApi.getCreditPacks).mockResolvedValue([])
    const [ca, cb] = [document.body.appendChild(document.createElement('div')), document.body.appendChild(document.createElement('div'))]
    render(withStore(a, <OrderApp />), { container: ca })
    render(withStore(b, <OrderApp />), { container: cb })
    await flush()
    await act(async () => { fireEvent.click(within(ca).getByRole('button', { name: 'Mi cuenta' })) })
    await flush()
    vi.advanceTimersByTime(500)
    await act(async () => { fireEvent.click(within(ca).getByRole('button', { name: 'Usar en caja' })) })
    expect(within(ca).getByText('K7Q2-9DXM-4R8H-HB7T-Q')).toBeTruthy()
    await act(async () => { fireEvent.click(within(cb).getByRole('button', { name: 'Mi cuenta' })) })
    await flush()
    expect(within(cb).getByText('Bloqueada: pregunta en caja.')).toBeTruthy()
    expect(within(ca).queryByText('K7Q2-9DXM-4R8H-HB7T-Q')).toBeNull()
    expect(within(ca).queryByText('$350.00')).toBeNull()
    expect(within(ca).getByText('Bloqueada: pregunta en caja.')).toBeTruthy()
  })
})
