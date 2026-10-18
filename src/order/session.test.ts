import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearLastOrder, clearSession, loadLastOrder, loadSession, samePhone, saveLastOrder, saveSession } from './session'

const s = { token: 't', phone: '+525512345678', name: 'Ana', savedAt: Date.now() }
beforeEach(() => localStorage.clear())
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('sesión de pedidos', () => {
  it('guarda por negocio y borra', () => {
    saveSession('a', s)
    expect(localStorage.getItem('avq_order_session:a')).toBeTruthy()
    expect(loadSession('a')?.token).toBe('t')
    expect(loadSession('b')).toBeNull()
    clearSession('a')
    expect(loadSession('a')).toBeNull()
  })
  it('vence a los 29 días', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-01T00:00:00Z'))
    saveSession('a', { ...s, savedAt: Date.now() })
    vi.setSystemTime(new Date('2026-10-29T23:00:00Z'))
    expect(loadSession('a')).not.toBeNull()
    vi.setSystemTime(new Date('2026-10-30T00:00:01Z'))
    expect(loadSession('a')).toBeNull()
  })
  it('basura o sin almacenamiento no truena', () => {
    localStorage.setItem('avq_order_session:a', '{no')
    expect(loadSession('a')).toBeNull()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('lleno')
    })
    expect(() => saveSession('a', s)).not.toThrow()
  })
  it('samePhone compara los últimos 10 dígitos', () => {
    expect(samePhone('+525512345678', '5512345678')).toBe(true)
    expect(samePhone('5512345678', '5512345679')).toBe(false)
    expect(samePhone('123', '123')).toBe(false)
  })
  it('último pedido por negocio', () => {
    saveLastOrder('a', { trackingToken: 'x', orderNumber: '12' })
    expect(loadLastOrder('a')).toEqual({ trackingToken: 'x', orderNumber: '12' })
    expect(loadLastOrder('b')).toBeNull()
    clearLastOrder('a')
    expect(loadLastOrder('a')).toBeNull()
  })
})
