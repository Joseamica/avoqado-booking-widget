import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearLastOrder, loadLastOrder, loadSession, samePhone, saveLastOrder, saveSession } from './session'
import { abrirPagina, borrarSesion, guardarSesion, leerSesion, soltarLaPagina, tokenDeLaPagina, type SesionDeCliente } from '../lib/sesionDeCliente'

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
    borrarSesion('a')
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
      expect(loadSession('a')).toEqual({ ...s, identidad: 'hoy:pedidos|t' })
    })
    it('con la nueva y su teléfono probado, pedir usa la nueva', () => {
      saveSession('a', s)
      guardarSesion('a', nueva([correo, tel]))
      expect(loadSession('a')).toMatchObject({ token: 'nueva', phone: '+525511112222', name: 'Ana', savedAt: expect.any(Number) })
    })
    it('(d) una nueva que sólo probó correo o Google sirve (sin teléfono para «Mi equipo»); el token de hoy no se usa (codex-r2 #3)', () => {
      guardarSesion('a', nueva([correo]))
      saveSession('a', s)
      expect(loadSession('a')).toMatchObject({ token: 'nueva', phone: null, name: 'Ana' })
    })
    it('guardián: un 401 de la sesión de la página la borra; un 401 de un token ajeno no toca lo guardado', () => {
      guardarSesion('a', nueva([tel]))
      const leer = () => loadSession('a')
      abrirPagina('a', 'pedidos', leer)
      expect(tokenDeLaPagina('a', 'pedidos', leer)).toBe('nueva')
      soltarLaPagina('a', 'pedidos', 'de-otra-sesion', leer)
      expect(leerSesion('a')?.token).toBe('nueva')
      soltarLaPagina('a', 'pedidos', 'nueva', leer)
      expect(leerSesion('a')).toBeNull()
      expect(tokenDeLaPagina('a', 'pedidos', leer)).toBeNull()
    })
  })
})
