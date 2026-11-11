import { h } from 'preact'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CustomerPortal } from './CustomerPortal'
import * as api from '../api/booking'
import * as state from '../state/booking'
import { createT } from '../i18n'
import { borrarSesion, guardarSesion, leerSesion } from '../lib/sesionDeCliente'

vi.mock('../api/booking', async importOriginal => {
  const real = await importOriginal<typeof import('../api/booking')>()
  return {
    ...real, requestOtp: vi.fn(), verifyOtp: vi.fn(), customerLogin: vi.fn(), getCustomerPortal: vi.fn(), getCreditPacks: vi.fn(),
    updateCustomerProfile: vi.fn(),
  }
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
  state.clearCustomerSession('testarudo') // la página empieza sin sesión
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

  it('alcance A: un 401 tardío de A con B ya guardada deja la página sin sesión, sin rojo; B queda intacta para la próxima carga', async () => {
    guardarSesion('testarudo', { token: 'tok-A', customer: CLIENTE, contactos: [TEL], guardadaEn: Date.now() })
    state.entroAqui('testarudo', leerSesion('testarudo')!) // la página ya tiene la sesión guardada
    const BEA = { ...CLIENTE, id: 'c2', firstName: 'Bea' }
    vi.mocked(api.getCustomerPortal).mockImplementationOnce(async () => {
      guardarSesion('testarudo', { token: 'tok-B', customer: BEA, contactos: [TEL], guardadaEn: Date.now() })
      throw Object.assign(new Error('Sesión vieja'), { status: 401, data: { message: 'Sesión vieja' }, enviado: 'tok-A' })
    })
    renderPortal()
    expect(await screen.findByRole('heading', { name: 'Entra a tu cuenta' })).toBeTruthy()
    expect(vi.mocked(api.getCustomerPortal).mock.calls.map(c => c[1])).toEqual(['tok-A'])
    expect(screen.queryByText('Hola, Bea')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(leerSesion('testarudo')?.token).toBe('tok-B')
  })

  it('codex-r4 R4-2: el perfil que responde después de «Cerrar sesión» no revive la sesión', async () => {
    guardarSesion('testarudo', { token: 'tok-A', customer: CLIENTE, contactos: [TEL], guardadaEn: Date.now() })
    state.entroAqui('testarudo', leerSesion('testarudo')!) // la página ya tiene la sesión guardada
    state.portalData.value = {
      customer: { ...CLIENTE, loyaltyPoints: 0, totalVisits: 0 }, credits: { purchases: [] }, reservations: { upcoming: [], past: [] },
    } as any
    let responder: (r: any) => void = () => {}
    vi.mocked(api.updateCustomerProfile).mockImplementationOnce(() => new Promise(ok => { responder = ok }))
    renderPortal()
    fireEvent.click(screen.getByTitle('Editar Perfil'))
    escribir(screen.getByPlaceholderText('Nombre'), 'Anita')
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(api.updateCustomerProfile).toHaveBeenCalled())
    fireEvent.click(screen.getByTitle('Cerrar Sesión'))
    await act(async () => { responder({ customer: { ...CLIENTE, firstName: 'Anita' } }) })
    expect(leerSesion('testarudo')).toBeNull()
    expect(localStorage.getItem('avq_customer_token:testarudo')).toBeNull()
    expect(localStorage.getItem('avq_customer_info:testarudo')).toBeNull()
    expect(state.customerToken.value).toBeNull()
    expect(api.getCustomerPortal).not.toHaveBeenCalled()
  })

  it('codex-r3 H1: «Mi cuenta» de Ana que responde después de «Salir» no vuelve a aparecer', async () => {
    guardarSesion('testarudo', { token: 'tok-A', customer: CLIENTE, contactos: [TEL], guardadaEn: Date.now() })
    state.entroAqui('testarudo', leerSesion('testarudo')!) // la página ya tiene la sesión guardada
    let responder: (d: any) => void = () => {}
    vi.mocked(api.getCustomerPortal).mockImplementationOnce(() => new Promise(ok => { responder = ok }))
    renderPortal()
    await waitFor(() => expect(api.getCustomerPortal).toHaveBeenCalledTimes(1))
    await act(async () => { state.clearCustomerSession('testarudo') })
    await act(async () => {
      responder({ customer: { ...CLIENTE, loyaltyPoints: 0, totalVisits: 0 }, credits: { purchases: [] }, reservations: { upcoming: [], past: [] } })
    })
    expect(screen.queryByText('Hola, Ana')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Entra a tu cuenta' })).toBeTruthy()
  })

  it('codex-r3 H2: guardar el perfil de Ana mientras otra página entra como Bea no mezcla sus datos', async () => {
    guardarSesion('testarudo', { token: 'tok-A', customer: CLIENTE, contactos: [TEL], guardadaEn: Date.now() })
    state.entroAqui('testarudo', leerSesion('testarudo')!) // la página ya tiene la sesión guardada
    state.portalData.value = {
      customer: { ...CLIENTE, loyaltyPoints: 0, totalVisits: 0 }, credits: { purchases: [] }, reservations: { upcoming: [], past: [] },
    } as any
    const BEA = { ...CLIENTE, id: 'c2', firstName: 'Bea', phone: '+525599998888' }
    vi.mocked(api.updateCustomerProfile).mockImplementationOnce(async () => {
      guardarSesion('testarudo', { token: 'tok-B', customer: BEA, contactos: [TEL], guardadaEn: Date.now() })
      return { customer: { ...CLIENTE, firstName: 'Anita' } }
    })
    renderPortal()
    fireEvent.click(screen.getByTitle('Editar Perfil'))
    escribir(screen.getByPlaceholderText('Nombre'), 'Anita')
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(api.updateCustomerProfile).toHaveBeenCalled())
    await waitFor(() => expect(leerSesion('testarudo')?.token).toBe('tok-B'))
    expect(leerSesion('testarudo')?.customer).toEqual(BEA)
  })

  it('codex-r5 E7: un 401 al guardar el perfil tras entrar con contraseña deja «Entra a tu cuenta», sin rojo', async () => {
    vi.mocked(api.customerLogin).mockResolvedValue({ token: 'tok-pass', customer: CLIENTE })
    vi.mocked(api.getCustomerPortal).mockResolvedValue({
      customer: { ...CLIENTE, loyaltyPoints: 0, totalVisits: 0 }, credits: { purchases: [] }, reservations: { upcoming: [], past: [] },
    } as any)
    vi.mocked(api.updateCustomerProfile).mockImplementationOnce(async () => {
      state.clearCustomerSession('testarudo', 'tok-pass') // lo que hace `request` con el 401
      throw Object.assign(new Error('Token inválido o expirado'), { status: 401, data: { message: 'Token inválido o expirado' }, enviado: 'tok-pass' })
    })
    renderPortal()
    fireEvent.click(screen.getByRole('button', { name: 'o entra con correo y contraseña' }))
    escribir(screen.getByPlaceholderText('tucorreo@email.com'), 'ana@correo.mx')
    escribir(screen.getByPlaceholderText('••••••'), 'secreta')
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar Sesión' }))
    fireEvent.click(await screen.findByTitle('Editar Perfil'))
    escribir(screen.getByPlaceholderText('Nombre'), 'Anita')
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByRole('heading', { name: 'Entra a tu cuenta' })).toBeTruthy()
    expect(screen.queryByText('Token inválido o expirado')).toBeNull()
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
    state.entroAqui('testarudo', leerSesion('testarudo')!) // la página ya tiene la sesión guardada
    state.setCustomerSession('testarudo', 'tok-que-leyo-la-pantalla', { ...CLIENTE, firstName: 'Anita' })
    expect(leerSesion('testarudo')).toMatchObject({ token: 'tok-renovado', customer: { firstName: 'Anita' }, contactos: [TEL] })
    expect(localStorage.getItem('avq_customer_token:testarudo')).toBeNull()
  })

  it('«Cerrar sesión» borra la sesión única y las llaves de hoy', async () => {
    guardarSesion('testarudo', { token: 'tok', customer: CLIENTE, contactos: [TEL], guardadaEn: Date.now() })
    localStorage.setItem('avq_order_session:testarudo', '{"token":"pedidos-de-hoy"}')
    state.entroAqui('testarudo', leerSesion('testarudo')!) // la página tiene esa sesión (Cerrar sesión borra lo guardado sólo si sigue siendo la suya)
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
