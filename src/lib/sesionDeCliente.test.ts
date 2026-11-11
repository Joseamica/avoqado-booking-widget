import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { aplicarRenovacion, borrarSesion, guardarSesion, leerSesion, type SesionDeCliente } from './sesionDeCliente'
import { createOrder } from '../order/api'
import { getCustomerPortal } from '../api/booking'

// La ventana de jsdom de vitest: cambiar de página sin perder las cookies (el mismo «navegador»).
const dom = (globalThis as any).jsdom as { reconfigure(o: { url: string }): void; cookieJar: any }
const irA = (url: string) => dom.reconfigure({ url })

const S: SesionDeCliente = {
  token: 'tok-1',
  customer: { id: 'ccust0000000000000000001', firstName: 'Ana', lastName: null, email: null, phone: '+525512345678' },
  contactos: [{ tipo: 'PHONE', valor: '+525512345678', metodo: 'WHATSAPP', probadoEn: 1_794_000_000 }],
  guardadaEn: Date.now(),
}

beforeEach(() => {
  irA('http://localhost:3000/')
  localStorage.clear()
  dom.cookieJar.removeAllCookiesSync()
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  borrarSesion('mindform')
})

describe('W1: una sola sesión de cliente por negocio', () => {
  it('en book.avoqado.io guarda la cookie de avoqado.io y pedidos.avoqado.io la lee', () => {
    irA('https://book.avoqado.io/mindform')
    guardarSesion('mindform', S)
    expect(localStorage.getItem('avq_sesion:mindform')).toBeNull()
    const [cookie] = dom.cookieJar.getCookiesSync('https://pedidos.avoqado.io/')
    expect(cookie).toMatchObject({ key: 'avq_sesion_mindform', domain: 'avoqado.io', path: '/', secure: true, sameSite: 'lax', maxAge: 2592000 })

    irA('https://pedidos.avoqado.io/mindform')
    expect(leerSesion('mindform')).toEqual(S)
    // Otro negocio no la ve.
    expect(leerSesion('flautas')).toBeNull()
  })

  it('incrustado en otro dominio usa localStorage (no deja cookie)', () => {
    irA('https://www.mindform.mx/reservar')
    guardarSesion('mindform', S)
    expect(JSON.parse(localStorage.getItem('avq_sesion:mindform')!)).toEqual(S)
    expect(document.cookie).toBe('')
    expect(leerSesion('mindform')).toEqual(S)
  })

  it('la cabecera de renovación reemplaza la sesión (sólo si la guardada es la que se mandó)', () => {
    irA('https://pedidos.avoqado.io/mindform')
    guardarSesion('mindform', S)
    aplicarRenovacion('mindform', new Headers({ 'x-customer-session': 'tok-2' }), 'tok-1')
    expect(leerSesion('mindform')).toMatchObject({ token: 'tok-2', customer: S.customer, contactos: S.contactos })
    // Una respuesta tardía de una sesión que ya cambió no la pisa (sería volver a otra ficha o a la versión vieja).
    aplicarRenovacion('mindform', new Headers({ 'x-customer-session': 'tok-viejo-renovado' }), 'tok-1')
    expect(leerSesion('mindform')!.token).toBe('tok-2')
    // Sin cabecera, nada.
    aplicarRenovacion('mindform', new Headers(), 'tok-2')
    expect(leerSesion('mindform')!.token).toBe('tok-2')
  })

  it('la renovación llega por las dos APIs: al pedir y en «Mi cuenta»', async () => {
    guardarSesion('mindform', S)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: false, code: 'PRICE_CHANGED', error: 'Cambió el precio' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json', 'x-customer-session': 'tok-2' },
      }),
    )
    const body = { items: [], paymentMode: 'PAY_AT_PICKUP', expectedTotal: '0.00', customer: { name: 'Ana' } } as any
    await createOrder('mindform', body, { idempotencyKey: 'k'.repeat(32), token: 'tok-1' }).catch(() => {})
    expect(leerSesion('mindform')!.token).toBe('tok-2')

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ customer: S.customer }), { status: 200, headers: { 'x-customer-session': 'tok-3' } }),
    )
    await getCustomerPortal('mindform', 'tok-2')
    expect(leerSesion('mindform')!.token).toBe('tok-3')
  })

  it('«Salir» borra la cookie y las dos llaves de hoy', () => {
    irA('https://book.avoqado.io/mindform')
    guardarSesion('mindform', S)
    localStorage.setItem('avq_order_session:mindform', '{"token":"pedidos-de-hoy"}')
    localStorage.setItem('avq_customer_token:mindform', 'reservas-de-hoy')
    localStorage.setItem('avq_customer_info:mindform', '{}')
    localStorage.setItem('avq_customer_token:flautas', 'otro-negocio')
    borrarSesion('mindform')
    expect(leerSesion('mindform')).toBeNull()
    expect(dom.cookieJar.getCookiesSync('https://pedidos.avoqado.io/')).toEqual([])
    expect(localStorage.getItem('avq_order_session:mindform')).toBeNull()
    expect(localStorage.getItem('avq_customer_token:mindform')).toBeNull()
    expect(localStorage.getItem('avq_customer_info:mindform')).toBeNull()
    expect(localStorage.getItem('avq_customer_token:flautas')).toBe('otro-negocio')
  })

  it('sin almacenamiento vive en memoria (y «Salir» también la borra de ahí)', () => {
    irA('https://www.mindform.mx/')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('bloqueado') })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('bloqueado') })
    guardarSesion('mindform', S)
    expect(leerSesion('mindform')).toEqual(S)
    borrarSesion('mindform')
    expect(leerSesion('mindform')).toBeNull()
  })

  it('una cookie que el navegador no guarda (bloqueada o muy grande) ⇒ en memoria', () => {
    irA('https://book.avoqado.io/')
    vi.spyOn(Document.prototype, 'cookie', 'set').mockImplementation(() => {})
    guardarSesion('mindform', S)
    expect(leerSesion('mindform')).toEqual(S)
  })

  it('basura o una sesión de más de 30 días ⇒ null', () => {
    localStorage.setItem('avq_sesion:mindform', '{no')
    expect(leerSesion('mindform')).toBeNull()
    guardarSesion('mindform', { ...S, guardadaEn: Date.now() - 30 * 24 * 60 * 60 * 1000 })
    expect(leerSesion('mindform')).toBeNull()
  })
})
