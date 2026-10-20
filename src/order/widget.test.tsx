import { act } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Reservas sin red: toda llamada se queda pendiente (la tienda no debe tocar nada de esto).
const { pendingModule } = vi.hoisted(() => ({
  pendingModule: async (load: () => Promise<any>) =>
    Object.fromEntries(Object.entries(await load()).map(([k, v]) => [k, typeof v === 'function' && !/^[A-Z]/.test(k) ? vi.fn(() => new Promise(() => {})) : v])),
}))
vi.mock('../api/booking', () => pendingModule(() => vi.importActual('../api/booking')))
vi.mock('../api/venueChat', () => pendingModule(() => vi.importActual('../api/venueChat')))
vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api')
  return { ...actual, getInfo: vi.fn(), getMenu: vi.fn(), getTracking: vi.fn(), createOrder: vi.fn() }
})
import '../widget'
import * as booking from '../state/booking'
import { ApiError, createOrder, getInfo, getMenu, getTracking } from './api'
import { buildOrderBody, send } from './checkout'
import { saveSession } from './session'
import type { OrderStore } from './store'
import type { CreatedOrder, Tracking } from './types'
import { infoOf, menuOf, product } from './components/testKit'

const tr = (over: Partial<Tracking> = {}): Tracking => ({
  orderNumber: '42', status: 'PENDING_ACCEPTANCE', paymentMode: 'PAY_AT_PICKUP', venueName: 'Flautas', venueSlug: 'a',
  items: [], total: 170, paid: false, estimatedReadyAt: null, acceptDeadlineAt: '2026-10-17T19:05:00Z', rejectReason: null,
  createdAt: '2026-10-17T19:00:00Z', canCancel: false, venueTimezone: 'America/Mexico_City', ...over,
})
const line = { lineId: 'l', productId: 'p1', name: 'Flautas', unitPrice: 85, quantity: 2, modifiers: [], note: null }
const flush = () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve() })
async function mount(attrs: Record<string, string>, tag = 'avoqado-order') {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
  await act(async () => { document.body.appendChild(el) })
  await flush()
  return el
}
const storeOf = (el: Element) => (el as any).store as OrderStore
const text = (el: Element) => el.shadowRoot!.textContent ?? ''

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear()
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
  vi.mocked(getInfo).mockImplementation(async slug => infoOf({ venue: { slug, name: slug, timezone: 'America/Mexico_City', currency: 'MXN' } }))
  vi.mocked(getMenu).mockResolvedValue(menuOf(product()))
  vi.mocked(getTracking).mockResolvedValue(tr())
})
afterEach(async () => {
  await act(async () => { document.body.innerHTML = '' })
  vi.useRealTimers()
})

describe('<avoqado-order>', () => {
  it('junto a <avoqado-booking>: la sesión de reservas, la marca y los avisos no se cruzan', async () => {
    localStorage.setItem('avq_customer_token:a', 'tok-a')
    vi.mocked(getInfo).mockResolvedValue(infoOf({ brand: { logo: null, logoFull: null, primaryColor: '#112233', secondaryColor: null } }))
    const bk = await mount({ venue: 'a', 'accent-color': '#aa0000' }, 'avoqado-booking')
    const order = await mount({ venue: 'b' })
    expect(getInfo).toHaveBeenCalledWith('b')
    expect(text(order)).toContain('Flautas de pollo')
    // La sesión de reservas sigue en «a» (readCommonAttrs la habría movido a «b»).
    expect(booking.activeVenueSlug.value).toBe('a')
    expect(booking.customerToken.value).toBe('tok-a')
    // Marca: cada quien la suya.
    expect(booking.branding.value).toEqual(booking.DEFAULT_BRANDING)
    const orderRoot = order.shadowRoot!.querySelector('[data-avq-theme] > div') as HTMLElement
    expect(orderRoot.style.getPropertyValue('--avq-accent')).toBe('#112233')
    const bookingRoot = bk.shadowRoot!.querySelector('.avq-root') as HTMLElement
    expect(bookingRoot.style.getPropertyValue('--avq-accent')).toBe('#aa0000')
    // Avisos: el de la tienda no sale en reservas ni toca su toast, y al revés.
    await act(async () => { storeOf(order).notice.value = 'Aviso de la tienda' })
    expect(text(order)).toContain('Aviso de la tienda')
    expect(text(bk)).not.toContain('Aviso de la tienda')
    expect(booking.toastMessage.value).toBeNull()
    await act(async () => { booking.toastMessage.value = { text: 'Aviso de reservas', type: 'success' } })
    expect(text(bk)).toContain('Aviso de reservas')
    expect(text(order)).not.toContain('Aviso de reservas')
    await act(async () => { booking.toastMessage.value = null })
  })

  it('dos tiendas (a y b) no comparten carrito', async () => {
    const a = await mount({ venue: 'a' })
    const b = await mount({ venue: 'b' })
    expect(storeOf(a)).not.toBe(storeOf(b))
    await act(async () => { storeOf(a).cart.value = [line] })
    expect(storeOf(b).cart.value).toEqual([])
    expect(text(a)).toContain('2Ver pedido$170') // círculo con las 2 piezas, «Ver pedido» y el total
    expect(text(b)).not.toContain('Ver pedido')
  })

  it('tracking="<token>" abre el seguimiento sin pedir /menu', async () => {
    const el = await mount({ venue: 'a', tracking: 'T'.repeat(32) })
    expect(getMenu).not.toHaveBeenCalled()
    expect(getTracking).toHaveBeenCalledWith('a', 'T'.repeat(32))
    expect(text(el)).toContain('Folio 42')
  })

  it('tracking: pide /info UNA vez (la marca), sin /menu ni sondeo; y si /info falla el seguimiento se pinta', async () => {
    vi.useFakeTimers()
    vi.mocked(getInfo).mockResolvedValue(infoOf({ status: 'CLOSED', brand: { logo: null, logoFull: null, primaryColor: '#112233', secondaryColor: null } }))
    const el = await mount({ venue: 'a', tracking: 'T'.repeat(32) })
    await act(async () => { await vi.advanceTimersByTimeAsync(61_000) })
    expect(getInfo).toHaveBeenCalledTimes(1)
    expect(getMenu).not.toHaveBeenCalled()
    expect(text(el)).toContain('Folio 42')
    await act(async () => { el.remove() })
    vi.mocked(getInfo).mockRejectedValue(new ApiError('x', 403))
    const el2 = await mount({ venue: 'b', tracking: 'T'.repeat(32) })
    expect(text(el2)).toContain('Folio 42')
  })

  it('crear un pedido emite avoqado:pedido-creado UNA vez (también con doble toque), desde el elemento', async () => {
    const order: CreatedOrder = {
      orderId: 'o', onlineOrderId: 'oo', trackingToken: 'K'.repeat(32), status: 'PENDING_ACCEPTANCE', orderNumber: '7',
      total: '170.00', acceptDeadlineAt: '2026-10-17T19:05:00Z', replay: false,
    }
    vi.mocked(createOrder).mockResolvedValue(order)
    const el = await mount({ venue: 'flautas' })
    const s = storeOf(el)
    saveSession('flautas', { token: 'tok', phone: '+525512345678', name: 'Ana', savedAt: Date.now() })
    await act(async () => { s.cart.value = [line] })
    s.quote.value = { ok: true, lines: [], subtotal: 170, total: 170, minOrderAmount: 0, issues: [] }
    const body = buildOrderBody(s, { customer: { name: 'Ana', phone: '+525512345678' }, note: null })
    const seen: CustomEvent[] = []
    const onCreated = (e: Event) => seen.push(e as CustomEvent)
    document.addEventListener('avoqado:pedido-creado', onCreated)
    try {
      await act(async () => { await Promise.all([send(s, body), send(s, body)]) })
    } finally {
      document.removeEventListener('avoqado:pedido-creado', onCreated)
    }
    expect(createOrder).toHaveBeenCalledTimes(1)
    expect(seen).toHaveLength(1)
    expect(seen[0].detail).toEqual({
      orderNumber: '7', trackingToken: 'K'.repeat(32), trackingUrl: `https://pedidos.avoqado.io/flautas/pedido/${'K'.repeat(32)}`,
    })
    expect(seen[0].bubbles).toBe(true)
    expect(seen[0].composed).toBe(true)
    expect(seen[0].target).toBe(el)
  })

  it('W1: avisa a la página el nombre real del restaurante cuando llega /info (avoqado:tienda-cargada), una vez', async () => {
    vi.mocked(getInfo).mockResolvedValue(infoOf({ venue: { slug: 'flautas', name: 'Flautas Coyoacán', timezone: 'America/Mexico_City', currency: 'MXN' } }))
    const seen: CustomEvent[] = []
    const onLoaded = (e: Event) => seen.push(e as CustomEvent)
    document.addEventListener('avoqado:tienda-cargada', onLoaded)
    let el: Element
    try {
      el = await mount({ venue: 'flautas' })
      // Un cambio que no toca el nombre no repite el aviso.
      await act(async () => { storeOf(el).notice.value = 'x' })
    } finally {
      document.removeEventListener('avoqado:tienda-cargada', onLoaded)
    }
    expect(seen).toHaveLength(1)
    expect(seen[0].detail).toEqual({ slug: 'flautas', name: 'Flautas Coyoacán' })
    expect(seen[0].target).toBe(el!)
    expect(seen[0].composed).toBe(true)
  })

  it('al quitarlo de la página deja de sondear /info (dispose)', async () => {
    vi.useFakeTimers()
    vi.mocked(getInfo).mockImplementation(async slug => infoOf({ venue: { slug, name: slug, timezone: null, currency: 'MXN' }, status: 'CLOSED' }))
    const gone = await mount({ venue: 'c' })
    await mount({ venue: 'd' })
    await act(async () => { gone.remove() })
    await act(async () => { await vi.advanceTimersByTimeAsync(61_000) })
    const calls = (slug: string) => vi.mocked(getInfo).mock.calls.filter(c => c[0] === slug).length
    expect(calls('d')).toBe(2)
    expect(calls('c')).toBe(1)
  })
})
