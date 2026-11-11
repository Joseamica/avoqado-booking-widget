import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearLastOrder, clearSession, loadLastOrder, loadSession, samePhone, saveLastOrder, saveSession } from './session'
import { guardarSesion, leerSesion, type SesionDeCliente } from '../lib/sesionDeCliente'

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
  it('getItem que lanza o forma inválida ⇒ null', () => {
    localStorage.setItem('avq_order_last:a', JSON.stringify({ trackingToken: 1 }))
    expect(loadLastOrder('a')).toBeNull()
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqueado')
    })
    expect(loadSession('a')).toBeNull()
    expect(loadLastOrder('a')).toBeNull()
  })

  describe('W1: la sesión única y la de pedidos de hoy', () => {
    const nueva = (contactos: SesionDeCliente['contactos']): SesionDeCliente => ({
      token: 'nueva',
      customer: { id: 'c1', firstName: 'Ana', lastName: null, email: 'ana@correo.mx', phone: '+525511112222' },
      contactos,
      guardadaEn: Date.now(),
    })
    const tel = { tipo: 'PHONE' as const, valor: '+525511112222', metodo: 'WHATSAPP' as const, probadoEn: 1 }
    const correo = { tipo: 'EMAIL' as const, valor: 'ana@correo.mx', metodo: 'GOOGLE' as const, probadoEn: 1 }

    it('con la sesión de pedidos de hoy y sin la nueva, pedir sigue usando la de hoy', () => {
      saveSession('a', s)
      expect(loadSession('a')).toEqual(s)
    })
    it('con la nueva y su teléfono probado, pedir usa la nueva', () => {
      saveSession('a', s)
      guardarSesion('a', nueva([correo, tel]))
      expect(loadSession('a')).toEqual({ token: 'nueva', phone: '+525511112222', name: 'Ana', savedAt: expect.any(Number) })
    })
    it('una nueva sin teléfono probado no sirve para «Mi equipo»: se usa la de hoy (o se pide el código)', () => {
      guardarSesion('a', nueva([correo]))
      expect(loadSession('a')).toBeNull()
      saveSession('a', s)
      expect(loadSession('a')?.token).toBe('t')
    })
    it('un 401 con el token de la nueva la borra; con el de hoy, sólo borra el de hoy', () => {
      guardarSesion('a', nueva([correo]))
      saveSession('a', s)
      clearSession('a', 't')
      expect(loadSession('a')).toBeNull()
      expect(leerSesion('a')?.token).toBe('nueva')
      guardarSesion('a', nueva([tel]))
      clearSession('a', 'nueva')
      expect(leerSesion('a')).toBeNull()
    })
  })
})
