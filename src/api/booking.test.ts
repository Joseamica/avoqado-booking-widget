import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPackCheckout, getCustomerPortal, guardarTarjeta, listarMisPedidos, listarMisTarjetas } from './booking'
import { bindCustomerSessionToVenue, customerToken, tokenParaMandar } from '../state/booking'
import { abrirPagina, borrarSesion, documentoNuevoParaPruebas, guardarSesion, leerSesion, paginaDe } from '../lib/sesionDeCliente'
import { loadSession } from '../order/session'

const PHONE = '+525512345678'
const unica = { token: 'tok-A', customer: { id: 'c1', firstName: 'Ana', lastName: null, email: null, phone: PHONE },
  contactos: [{ tipo: 'PHONE' as const, valor: PHONE, metodo: 'WHATSAPP' as const, probadoEn: 1 }], guardadaEn: Date.now() }
const nunca = () => new Promise<never>(() => {})

beforeEach(() => { localStorage.clear() })
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('transporte autenticado de reservas y portal (codex-r7 H3)', () => {
  it('un 401 suelta la sesión ANTES de leer el cuerpo (aunque el cuerpo nunca llegue)', async () => {
    guardarSesion('m', { ...unica, guardadaEn: Date.now() })
    bindCustomerSessionToVenue('m')
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, headers: new Headers(), json: nunca }) as any))
    void createPackCheckout('m', 'pack1', { phone: PHONE, successUrl: 'x', cancelUrl: 'y' }, 'tok-A').catch(() => {})
    for (let i = 0; i < 5; i++) await Promise.resolve()
    expect(leerSesion('m')).toBeNull()
    expect(customerToken.value).toBeNull()
    expect(tokenParaMandar('m')).toBeNull()
  })

  it('lo autenticado no espera más de 20 s: la petición se corta y falla como sin red', async () => {
    vi.useFakeTimers()
    guardarSesion('m', { ...unica, guardadaEn: Date.now() })
    bindCustomerSessionToVenue('m')
    vi.stubGlobal('fetch', vi.fn((_u: string, init: RequestInit) => new Promise((_, rej) => {
      init.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    })))
    const p = createPackCheckout('m', 'pack1', { phone: PHONE, successUrl: 'x', cancelUrl: 'y' }, 'tok-A')
    const fin = vi.fn()
    p.then(fin, fin)
    await vi.advanceTimersByTimeAsync(19_000)
    expect(fin).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1_500)
    expect(fin).toHaveBeenCalled()
  })
})

describe('W4: «Mi cuenta» de la tienda manda con la sesión de la TIENDA (superficie pedidos)', () => {
  beforeEach(() => documentoNuevoParaPruebas())
  const ok = (body: unknown) => vi.fn(async () => ({ ok: true, status: 200, headers: new Headers(), json: async () => body }) as any)

  it('manda el token de la tienda; un 401 suelta la de la tienda y no toca la de reservas (A refinada)', async () => {
    guardarSesion('m', { ...unica, guardadaEn: Date.now() })
    bindCustomerSessionToVenue('m')
    abrirPagina('m', 'pedidos', () => loadSession('m'))
    const fetchMock = vi.fn(async () => ({ ok: false, status: 401, headers: new Headers(), json: async () => ({ message: 'x' }) }) as any)
    vi.stubGlobal('fetch', fetchMock)
    await expect(getCustomerPortal('m', 'tok-A', 'pedidos')).rejects.toMatchObject({ status: 401 })
    expect((fetchMock.mock.calls[0] as any)[1].headers.Authorization).toBe('Bearer tok-A')
    expect(paginaDe('m', 'pedidos')).toBeNull()
    expect(paginaDe('m', 'reservas')?.token).toBe('tok-A')
  })

  it('si la sesión de la tienda ya no está guardada, no sale nada: 401 sin tocar la red y la tienda queda sin sesión', async () => {
    guardarSesion('m', { ...unica, guardadaEn: Date.now() })
    abrirPagina('m', 'pedidos', () => loadSession('m'))
    borrarSesion('m')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(getCustomerPortal('m', 'tok-A', 'pedidos')).rejects.toMatchObject({ status: 401 })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(paginaDe('m', 'pedidos')).toBeNull()
  })

  it('las páginas y «Guardar en mi cuenta» van a sus rutas con el cursor y el código', async () => {
    guardarSesion('m', { ...unica, guardadaEn: Date.now() })
    bindCustomerSessionToVenue('m')
    const fetchMock = ok({ items: [], total: 0, nextCursor: null })
    vi.stubGlobal('fetch', fetchMock)
    await listarMisPedidos('m', 'tok-A', '2026-11-02T18:00:00.000Z_c1')
    await listarMisTarjetas('m', 'tok-A', 'cur-t')
    await guardarTarjeta('m', 'tok-A', 'K7Q2-9DXM-4R8H-HB7T-Q')
    const [pedidos, tarjetas, claim] = fetchMock.mock.calls as any[]
    expect(pedidos[0]).toMatch(/\/venues\/m\/customer\/orders\?cursor=2026-11-02T18%3A00%3A00.000Z_c1$/)
    expect(tarjetas[0]).toMatch(/\/venues\/m\/customer\/gift-cards\?cursor=cur-t$/)
    expect(claim[0]).toMatch(/\/venues\/m\/customer\/gift-cards\/claim$/)
    expect(claim[1]).toMatchObject({ method: 'POST', body: JSON.stringify({ code: 'K7Q2-9DXM-4R8H-HB7T-Q' }) })
    expect(claim[1].headers.Authorization).toBe('Bearer tok-A')
  })
})
