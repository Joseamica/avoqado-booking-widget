import { h } from 'preact'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return { ...actual, getTracking: vi.fn(), cancelOrder: vi.fn(), getInfo: vi.fn(), getMenu: vi.fn() }
})
import { ApiError, cancelOrder, getTracking } from '../api'
import { TrackingScreen } from './TrackingScreen'
import { makeStore, withStore } from './testKit'
import type { OnlineOrderStatus, Tracking } from '../types'

let visibility = 'visible'
beforeEach(() => {
  vi.useFakeTimers()
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
  vi.mocked(getTracking).mockReset()
  vi.mocked(cancelOrder).mockReset()
})
afterEach(() => { cleanup(); vi.useRealTimers() })

const tr = (over: Partial<Tracking> = {}): Tracking => ({
  orderNumber: '42', status: 'PENDING_ACCEPTANCE', paymentMode: 'PAY_AT_PICKUP', venueName: 'Flautas', venueSlug: 'a',
  items: [{ name: 'Flautas de pollo', quantity: 2, note: null, modifiers: [{ name: 'Crema', quantity: 1 }] }],
  total: 170, paid: false, estimatedReadyAt: null, acceptDeadlineAt: '2026-10-17T19:05:00Z', rejectReason: null,
  createdAt: '2026-10-17T19:00:00Z', canCancel: true, venueTimezone: 'America/Mexico_City',
  venueContact: { address: 'Calle 1, Coyoacán', phone: '555 123 4567' }, ...over,
})
const flush = () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve() })
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
async function show(t: Tracking | ApiError) {
  if (t instanceof ApiError) vi.mocked(getTracking).mockRejectedValue(t)
  else vi.mocked(getTracking).mockResolvedValue(t)
  const s = makeStore(null, null)
  s.trackingToken.value = 'T'.repeat(32)
  s.go('tracking')
  render(withStore(s, <TrackingScreen />))
  await flush()
  return s
}

describe('sondeo', () => {
  it('sondea cada 10 s, y para en un estado final', async () => {
    const s = await show(tr())
    expect(getTracking).toHaveBeenCalledTimes(1)
    expect(getTracking).toHaveBeenCalledWith(s.slug, 'T'.repeat(32))
    await tick(10_000)
    expect(getTracking).toHaveBeenCalledTimes(2)
    vi.mocked(getTracking).mockResolvedValue(tr({ status: 'COMPLETED', canCancel: false }))
    await tick(10_000)
    expect(getTracking).toHaveBeenCalledTimes(3)
    await tick(60_000)
    expect(getTracking).toHaveBeenCalledTimes(3)
    expect(screen.getByText('Entregado. ¡Gracias!')).toBeTruthy()
  })
  it('con la pestaña oculta no sondea; al volver a verse, refresca', async () => {
    await show(tr())
    visibility = 'hidden'
    await tick(40_000)
    expect(getTracking).toHaveBeenCalledTimes(1)
    visibility = 'visible'
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    await flush()
    expect(getTracking).toHaveBeenCalledTimes(2)
  })
  it('un fallo de red conserva lo último y avisa', async () => {
    await show(tr())
    vi.mocked(getTracking).mockRejectedValue(new ApiError('Sin conexión', 0, undefined, undefined, true))
    await tick(10_000)
    expect(screen.getByText('Sin conexión; reintentando…')).toBeTruthy()
    expect(screen.getByText(/Esperando que el restaurante acepte/)).toBeTruthy()
    vi.mocked(getTracking).mockResolvedValue(tr())
    await tick(10_000)
    expect(screen.queryByText('Sin conexión; reintentando…')).toBeNull()
  })
  it('un 500 no es «Sin conexión»: «No pudimos actualizar tu pedido; reintentando…» y sigue sondeando', async () => {
    await show(new ApiError('x', 500))
    expect(screen.getByText('No pudimos actualizar tu pedido; reintentando…')).toBeTruthy()
    expect(screen.queryByText('Sin conexión; reintentando…')).toBeNull()
    vi.mocked(getTracking).mockResolvedValue(tr())
    await tick(10_000)
    expect(getTracking).toHaveBeenCalledTimes(2)
    vi.mocked(getTracking).mockRejectedValue(new ApiError('x', 503))
    await tick(10_000)
    expect(screen.getByText('No pudimos actualizar tu pedido; reintentando…')).toBeTruthy()
    expect(screen.getByText(/Esperando que el restaurante acepte/)).toBeTruthy()
  })
  it('404: «No encontramos ese pedido.» y no sigue sondeando', async () => {
    await show(new ApiError('x', 404))
    expect(screen.getByText('No encontramos ese pedido.')).toBeTruthy()
    await tick(30_000)
    expect(getTracking).toHaveBeenCalledTimes(1)
  })
})

describe('textos por estado', () => {
  const cases: [OnlineOrderStatus, Partial<Tracking>, string][] = [
    ['PENDING_ACCEPTANCE', {}, 'Esperando que el restaurante acepte tu pedido (hasta las 13:05).'],
    ['ACCEPTED', { estimatedReadyAt: '2026-10-17T19:30:00Z', canCancel: false }, 'En preparación. Listo aprox. a las 13:30.'],
    ['READY', { canCancel: false }, '¡Listo para recoger!'],
    ['COMPLETED', { canCancel: false }, 'Entregado. ¡Gracias!'],
    ['REJECTED', { rejectReason: 'OUT_OF_ITEMS', canCancel: false }, 'El restaurante no pudo aceptar tu pedido: Sin ingredientes. No se te cobró nada.'],
    ['EXPIRED', { canCancel: false }, 'El restaurante no contestó a tiempo. No se te cobró nada.'],
    ['CANCELLED_BY_CUSTOMER', { canCancel: false }, 'Cancelaste tu pedido.'],
    ['CANCELLED_BY_STAFF', { canCancel: false }, 'El restaurante canceló tu pedido.'],
  ]
  for (const [status, over, text] of cases)
    it(status, async () => {
      await show(tr({ status, ...over }))
      expect(screen.getByText(text)).toBeTruthy()
    })

  it('no depende de /info: sin info ni menú pinta el pedido completo', async () => {
    await show(tr({ status: 'ACCEPTED', estimatedReadyAt: '2026-10-17T19:30:00Z', canCancel: false }))
    expect(screen.getByText(/En preparación\./)).toBeTruthy()
    expect(screen.getByText('Folio 42')).toBeTruthy()
    expect(screen.getByText(/2 × Flautas de pollo/)).toBeTruthy()
    expect(screen.getByText(/Crema/)).toBeTruthy()
    expect(screen.getByText('Total (IVA incluido)').parentElement!.textContent).toContain('$170')
    expect(screen.getByText('Pagas al recoger')).toBeTruthy()
    expect(screen.getByText('Calle 1, Coyoacán')).toBeTruthy()
    expect(screen.getByText('555 123 4567')).toBeTruthy()
  })
  it('W12: cancelado, rechazado o vencido sin cobro no dice «Pagas al recoger»', async () => {
    for (const status of ['CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_STAFF', 'REJECTED', 'EXPIRED'] as const) {
      await show(tr({ status, canCancel: false }))
      expect(screen.getByText('Folio 42')).toBeTruthy()
      expect(screen.queryByText('Pagas al recoger')).toBeNull()
      cleanup()
    }
  })
  it('pagado dice «Pagado»', async () => {
    await show(tr({ paid: true, status: 'READY', canCancel: false }))
    expect(screen.getByText('Pagado')).toBeTruthy()
  })
  it('sin venueTimezone cae a la de /info', async () => {
    vi.mocked(getTracking).mockResolvedValue(tr({ venueTimezone: undefined, acceptDeadlineAt: '2026-10-17T19:05:00Z' }))
    const s = makeStore({ venue: { slug: 'a', name: 'F', timezone: 'America/Tijuana', currency: 'MXN' } } as any, null)
    s.trackingToken.value = 'T'.repeat(32)
    render(withStore(s, <TrackingScreen />))
    await flush()
    expect(screen.getByText(/hasta las 12:05/)).toBeTruthy()
  })
})

describe('cancelar', () => {
  it('sin canCancel no hay botón', async () => {
    await show(tr({ canCancel: false }))
    expect(screen.queryByRole('button', { name: 'Cancelar pedido' })).toBeNull()
  })
  it('pide confirmación, llama UNA vez y refresca', async () => {
    vi.mocked(cancelOrder).mockResolvedValue({ status: 'CANCELLED_BY_CUSTOMER' })
    await show(tr())
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar pedido' }))
    expect(cancelOrder).not.toHaveBeenCalled()
    vi.mocked(getTracking).mockResolvedValue(tr({ status: 'CANCELLED_BY_CUSTOMER', canCancel: false }))
    const yes = screen.getByRole('button', { name: 'Sí, cancelar' })
    fireEvent.click(yes); fireEvent.click(yes)
    await flush()
    expect(cancelOrder).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Cancelaste tu pedido.')).toBeTruthy()
  })
  it('409 ORDER_STATE_CHANGED: refresca y avisa', async () => {
    vi.mocked(cancelOrder).mockRejectedValue(new ApiError('x', 409, 'ORDER_STATE_CHANGED'))
    await show(tr())
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar pedido' }))
    vi.mocked(getTracking).mockResolvedValue(tr({ status: 'ACCEPTED', canCancel: false, estimatedReadyAt: '2026-10-17T19:30:00Z' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sí, cancelar' }))
    await flush()
    expect(screen.getByText('Tu pedido ya no se puede cancelar.')).toBeTruthy()
    expect(screen.getByText(/En preparación\./)).toBeTruthy()
  })
  it('409 ORDER_HAS_PAYMENTS: llama al restaurante', async () => {
    vi.mocked(cancelOrder).mockRejectedValue(new ApiError('x', 409, 'ORDER_HAS_PAYMENTS'))
    await show(tr())
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar pedido' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sí, cancelar' }))
    await flush()
    expect(screen.getByText('Este pedido ya tiene un pago; llama al restaurante.')).toBeTruthy()
  })
})
