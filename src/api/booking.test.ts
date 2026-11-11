import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPackCheckout } from './booking'
import { bindCustomerSessionToVenue, customerToken, tokenParaMandar } from '../state/booking'
import { guardarSesion, leerSesion } from '../lib/sesionDeCliente'

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
