import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { aplicarRenovacion, borrarSesion, guardarSesion, leerSesion, type SesionDeCliente } from './sesionDeCliente'
import { createOrder } from '../order/api'
import { getCustomerPortal } from '../api/booking'
import { loadSession } from '../order/session'
import * as estado from '../state/booking'

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
    // Sólo queda la marca «salió» (para que la otra página suelte su token de hoy), no la sesión.
    expect(dom.cookieJar.getCookiesSync('https://pedidos.avoqado.io/').map((c: any) => c.key)).toEqual(['avq_salio_mindform'])
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

  describe('codex-r1', () => {
    it('#1 «Salir» en book.avoqado.io también saca a pedidos.avoqado.io de su token de hoy (y al revés)', () => {
      irA('https://book.avoqado.io/mindform')
      guardarSesion('mindform', S)
      borrarSesion('mindform')
      // El localStorage de la OTRA página no se puede borrar desde aquí: lo que dejó ahí sigue (se simula escribiéndolo después).
      irA('https://pedidos.avoqado.io/mindform')
      localStorage.setItem('avq_order_session:mindform', JSON.stringify({ token: 'pedidos-de-hoy', phone: '+525512345678', name: 'Ana', savedAt: Date.now() }))
      expect(loadSession('mindform')).toBeNull()
      expect(localStorage.getItem('avq_order_session:mindform')).toBeNull()
      localStorage.setItem('avq_customer_token:mindform', 'reservas-de-hoy')
      estado.bindCustomerSessionToVenue('mindform-otra-vez')
      estado.bindCustomerSessionToVenue('mindform')
      expect(estado.customerToken.value).toBeNull()
      // Una entrada nueva después de salir sí cuenta.
      guardarSesion('mindform', S)
      expect(loadSession('mindform')?.token).toBe('tok-1')
    })

    it('#2 si no se puede guardar la ficha nueva, la vieja guardada no reaparece', () => {
      irA('https://www.mindform.mx/')
      guardarSesion('mindform', S)
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('cuota') })
      const B = { ...S, token: 'tok-B', customer: { ...S.customer, id: 'otra-ficha' } }
      guardarSesion('mindform', B)
      expect(leerSesion('mindform')).toEqual(B)
      vi.restoreAllMocks()
      irA('https://book.avoqado.io/')
      guardarSesion('mindform', S)
      vi.spyOn(Document.prototype, 'cookie', 'set').mockImplementation(() => {})
      guardarSesion('mindform', B)
      expect(leerSesion('mindform')).toEqual(B)
    })

    it('#3 un 401 tardío de la sesión A no borra la B que otra página guardó mientras: la pantalla adopta B', () => {
      estado.bindCustomerSessionToVenue('mindform')
      estado.setCustomerSession('mindform', 'tok-1', S.customer, null, S.contactos)
      guardarSesion('mindform', { ...S, token: 'tok-B' })
      estado.clearCustomerSession('mindform', 'tok-1')
      expect(leerSesion('mindform')?.token).toBe('tok-B')
      expect(estado.customerToken.value).toBe('tok-B')
      // El 401 de la que sí está guardada (o «Cerrar sesión», sin token) la borra.
      estado.clearCustomerSession('mindform', 'tok-B')
      expect(leerSesion('mindform')).toBeNull()
      expect(estado.customerToken.value).toBeNull()
    })

    it('#4 la renovación también cambia el token que usa la pantalla de reservas', async () => {
      estado.bindCustomerSessionToVenue('mindform')
      estado.setCustomerSession('mindform', 'tok-1', S.customer, null, S.contactos)
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ customer: S.customer }), { status: 200, headers: { 'x-customer-session': 'tok-2' } }),
      ))
      await getCustomerPortal('mindform', 'tok-1')
      expect(estado.customerToken.value).toBe('tok-2')
      expect(leerSesion('mindform')?.token).toBe('tok-2')
    })
  })
})
