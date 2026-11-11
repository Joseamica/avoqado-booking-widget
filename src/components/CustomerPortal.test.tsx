import { h } from 'preact'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CustomerPortal } from './CustomerPortal'
import * as api from '../api/booking'
import * as state from '../state/booking'
import { createT } from '../i18n'
import { borrarSesion, guardarSesion, leerSesion } from '../lib/sesionDeCliente'

vi.mock('../api/booking', async importOriginal => {
  const real = await importOriginal<typeof import('../api/booking')>()
  return { ...real, requestOtp: vi.fn(), verifyOtp: vi.fn(), customerLogin: vi.fn(), getCustomerPortal: vi.fn(), getCreditPacks: vi.fn() }
})

function renderPortal(locale: 'es' | 'en' = 'es') {
  return render(
    <CustomerPortal venueSlug="testarudo" timezone="America/Mexico_City" t={createT(locale)} onBack={() => {}} onManageBooking={() => {}} />,
  )
}
function escribir(el: HTMLElement, value: string) {
  fireEvent.input(el, { target: { value } })
}
const CLIENTE = { id: 'c1', firstName: 'Ana', lastName: null, email: null, phone: '+525544422262' }
const TEL = { tipo: 'PHONE' as const, valor: '+525544422262', metodo: 'WHATSAPP' as const, probadoEn: 1 }

beforeEach(() => {
  localStorage.clear()
  borrarSesion('testarudo')
  state.bindCustomerSessionToVenue('testarudo')
  state.customerToken.value = null
  state.customerInfo.value = null
  state.portalData.value = null
  state.portalLoading.value = false
  state.bookingAccess.value = null
  vi.mocked(api.requestOtp).mockResolvedValue({ ok: true })
  vi.mocked(api.verifyOtp).mockResolvedValue({ token: 'tok', customer: CLIENTE, contactos: [TEL], otraFicha: null })
  // La prueba se queda en la entrada: el portal ya cargado no es lo que se mide aquí.
  vi.mocked(api.getCustomerPortal).mockRejectedValue(new Error('la prueba no carga el portal'))
  vi.mocked(api.getCreditPacks).mockResolvedValue([])
})
afterEach(() => cleanup())

describe('CustomerPortal: entrar con la sesión única (W2)', () => {
  it('el teléfono siempre sale con lada (quita el 52 que la persona repitió: antes salía +52525544422262)', async () => {
    renderPortal()
    fireEvent.click(screen.getByRole('button', { name: 'Seguir con WhatsApp' }))
    escribir(screen.getByPlaceholderText('Tu número de teléfono'), '52 55 4442 2262')
    fireEvent.click(screen.getByRole('button', { name: 'Enviar código' }))
    await waitFor(() => expect(api.requestOtp).toHaveBeenCalledWith('testarudo', { phone: '+525544422262' }))
  })

  it('al entrar, la cuenta queda en pantalla con ESA sesión y el portal se pide con su token', async () => {
    renderPortal()
    fireEvent.click(screen.getByRole('button', { name: 'Seguir con WhatsApp' }))
    escribir(screen.getByPlaceholderText('Tu número de teléfono'), '5544422262')
    fireEvent.click(screen.getByRole('button', { name: 'Enviar código' }))
    await screen.findByText('Te enviamos un código por WhatsApp')
    escribir(screen.getAllByRole('textbox')[0], '123456')
    await waitFor(() => expect(api.getCustomerPortal).toHaveBeenCalledWith('testarudo', 'tok'))
    expect(state.customerToken.value).toBe('tok')
    expect(state.customerInfo.value).toEqual(CLIENTE)
    expect(leerSesion('testarudo')).toMatchObject({ token: 'tok', contactos: [TEL] })
  })

  it('codex-r1 #5: ya entró pero el portal no carga (sin red) ⇒ lo dice y deja reintentar; no vuelve a «Entra a tu cuenta»', async () => {
    vi.mocked(api.getCustomerPortal).mockRejectedValueOnce(new TypeError('Failed to fetch'))
    renderPortal()
    fireEvent.click(screen.getByRole('button', { name: 'Seguir con WhatsApp' }))
    escribir(screen.getByPlaceholderText('Tu número de teléfono'), '5544422262')
    fireEvent.click(screen.getByRole('button', { name: 'Enviar código' }))
    await screen.findByText('Te enviamos un código por WhatsApp')
    escribir(screen.getAllByRole('textbox')[0], '123456')
    expect(await screen.findByText('Sin conexión. Revisa tu internet y vuelve a intentar.')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Entra a tu cuenta' })).toBeNull()
    expect(leerSesion('testarudo')?.token).toBe('tok')
    fireEvent.click(screen.getByRole('button', { name: 'Intentar de Nuevo' }))
    await waitFor(() => expect(api.getCustomerPortal).toHaveBeenCalledTimes(2))
  })

  it('codex-r2 #5: un 401 tardío que ya encuentra otra sesión guardada la adopta y carga su portal (no «Entra a tu cuenta»)', async () => {
    guardarSesion('testarudo', { token: 'tok-A', customer: CLIENTE, contactos: [TEL], guardadaEn: Date.now() })
    state.bindCustomerSessionToVenue('testarudo')
    const BEA = { ...CLIENTE, id: 'c2', firstName: 'Bea' }
    vi.mocked(api.getCustomerPortal)
      .mockImplementationOnce(async () => {
        // Mientras «Mi cuenta» de A espera, otra página entra como B; luego llega el 401 de A.
        guardarSesion('testarudo', { token: 'tok-B', customer: BEA, contactos: [TEL], guardadaEn: Date.now() })
        throw Object.assign(new Error('Sesión vieja'), { status: 401, data: { message: 'Sesión vieja' }, enviado: 'tok-A' })
      })
      .mockResolvedValueOnce({
        customer: { ...BEA, loyaltyPoints: 0, totalVisits: 0 }, credits: { purchases: [] }, reservations: { upcoming: [], past: [] },
      } as any)
    renderPortal()
    expect(await screen.findByText('Hola, Bea')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Entra a tu cuenta' })).toBeNull()
    expect(vi.mocked(api.getCustomerPortal).mock.calls.map(c => c[1])).toEqual(['tok-A', 'tok-B'])
    expect(leerSesion('testarudo')?.token).toBe('tok-B')
  })

  it('con contraseña (legado) también queda la sesión única, sin contactos probados', async () => {
    vi.mocked(api.customerLogin).mockResolvedValue({ token: 'tok-pass', customer: CLIENTE })
    renderPortal()
    fireEvent.click(screen.getByRole('button', { name: 'o entra con correo y contraseña' }))
    escribir(screen.getByPlaceholderText('tucorreo@email.com'), 'ana@correo.mx')
    escribir(screen.getByPlaceholderText('••••••'), 'secreta')
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar Sesión' }))
    await waitFor(() => expect(leerSesion('testarudo')).toMatchObject({ token: 'tok-pass', contactos: [] }))
    expect(localStorage.getItem('avq_customer_token:testarudo')).toBeNull()
  })

  it('los datos al día de la ficha (perfil, portal) no pisan un token que ya se renovó', () => {
    guardarSesion('testarudo', { token: 'tok-renovado', customer: CLIENTE, contactos: [TEL], guardadaEn: Date.now() })
    state.setCustomerSession('testarudo', 'tok-que-leyo-la-pantalla', { ...CLIENTE, firstName: 'Anita' })
    expect(leerSesion('testarudo')).toMatchObject({ token: 'tok-renovado', customer: { firstName: 'Anita' }, contactos: [TEL] })
    expect(localStorage.getItem('avq_customer_token:testarudo')).toBeNull()
  })

  it('«Cerrar sesión» borra la sesión única y las llaves de hoy', async () => {
    guardarSesion('testarudo', { token: 'tok', customer: CLIENTE, contactos: [TEL], guardadaEn: Date.now() })
    localStorage.setItem('avq_order_session:testarudo', '{"token":"pedidos-de-hoy"}')
    state.customerToken.value = 'tok'
    state.portalData.value = {
      customer: { ...CLIENTE, loyaltyPoints: 0, totalVisits: 0 }, credits: { purchases: [] }, reservations: { upcoming: [], past: [] },
    } as any
    renderPortal()
    fireEvent.click(screen.getByTitle('Cerrar Sesión'))
    expect(leerSesion('testarudo')).toBeNull()
    expect(localStorage.getItem('avq_order_session:testarudo')).toBeNull()
    expect(state.customerToken.value).toBeNull()
  })
})
