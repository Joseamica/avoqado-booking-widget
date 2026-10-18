import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api')
  return { ...actual, getInfo: vi.fn(), getMenu: vi.fn() }
})
import { ApiError, getInfo, getMenu } from './api'
import { createOrderStore } from './store'
import type { StoreInfo } from './types'

const info = (status: StoreInfo['status']) => ({ status, reason: null, venue: { slug: 'a' } }) as unknown as StoreInfo
const setVisibility = (v: 'visible' | 'hidden') => Object.defineProperty(document, 'visibilityState', { value: v, configurable: true })

beforeEach(() => {
  sessionStorage.clear()
  vi.useFakeTimers()
  setVisibility('visible')
  vi.mocked(getInfo).mockResolvedValue(info('OPEN'))
  vi.mocked(getMenu).mockResolvedValue({ generatedAt: '', truncated: false, categories: [] })
})
afterEach(() => vi.useRealTimers())

describe('createOrderStore', () => {
  it('dos tiendas no comparten señales ni carrito', () => {
    const a = createOrderStore('a', { locale: 'es' })
    const b = createOrderStore('b', { locale: 'es' })
    expect(a.cart).not.toBe(b.cart)
    expect(a.screen).not.toBe(b.screen)
    a.go('cart')
    a.cart.value = [{ lineId: '1', productId: 'p', name: 'x', unitPrice: 1, quantity: 1, modifiers: [], note: null }]
    expect(b.screen.value).toBe('menu')
    expect(b.cart.value).toEqual([])
  })
  it('sin token pide info y menú', async () => {
    const s = createOrderStore('a', { locale: 'es' })
    await s.load()
    expect(getInfo).toHaveBeenCalledWith('a')
    expect(getMenu).toHaveBeenCalledWith('a')
    expect(s.info.value?.status).toBe('OPEN')
    expect(s.menu.value).not.toBeNull()
  })
  it('con trackingToken no pide menú y un /info que falla no cambia la pantalla', async () => {
    vi.mocked(getInfo).mockRejectedValue(new ApiError('plan vencido', 403))
    const s = createOrderStore('a', { locale: 'es', trackingToken: 'tok' })
    expect(s.screen.value).toBe('tracking')
    await s.load()
    expect(getMenu).not.toHaveBeenCalled()
    expect(s.screen.value).toBe('tracking')
    expect(s.infoError.value?.status).toBe(403)
  })
  it('con CLOSED vuelve a pedir /info a los 60 s; oculta no', async () => {
    vi.mocked(getInfo).mockResolvedValue(info('CLOSED'))
    const s = createOrderStore('a', { locale: 'es' })
    await s.load()
    expect(getInfo).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(getInfo).toHaveBeenCalledTimes(2)
    setVisibility('hidden')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(getInfo).toHaveBeenCalledTimes(2)
    setVisibility('visible')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(getInfo).toHaveBeenCalledTimes(3)
    s.dispose()
  })
  it('con OPEN no sondea', async () => {
    const s = createOrderStore('a', { locale: 'es' })
    await s.load()
    await vi.advanceTimersByTimeAsync(180_000)
    expect(getInfo).toHaveBeenCalledTimes(1)
  })
})
