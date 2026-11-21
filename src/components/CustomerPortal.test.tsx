import { h } from 'preact'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CustomerPortal } from './CustomerPortal'
import * as api from '../api/booking'
import * as state from '../state/booking'
import { createT } from '../i18n'
import { borrarSesion, guardarSesion, leerSesion, registrarSalida } from '../lib/sesionDeCliente'
import { cuentaDe, cuentasNuevasParaPruebas } from '../state/miCuenta'
/** «Mi cuenta» de reservas ya leída (lo anterior que la pantalla enseña al abrir). */
const sembrar = (data: any) => { cuentaDe('testarudo', 'reservas').value = { data, leyendo: false, falla: null } }

vi.mock('../api/booking', async importOriginal => {
  const real = await importOriginal<typeof import('../api/booking')>()
  return {
    ...real, requestOtp: vi.fn(), verifyOtp: vi.fn(), customerLogin: vi.fn(), getCustomerPortal: vi.fn(), getCreditPacks: vi.fn(),
    updateCustomerProfile: vi.fn(), listarMisPedidos: vi.fn(), listarMisTarjetas: vi.fn(), listarMisDescuentos: vi.fn(), guardarTarjeta: vi.fn(),
    pedirCambioDeNumero: vi.fn(), confirmarCambioDeNumero: vi.fn(), createPackCheckout: vi.fn(),
  }
})

function renderPortal(locale: 'es' | 'en' = 'es', extra: Record<string, unknown> = {}) {
  return render(
    <CustomerPortal venueSlug="testarudo" timezone="America/Mexico_City" t={createT(locale)} onBack={() => {}} onManageBooking={() => {}} {...extra} />,
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
  cuentasNuevasParaPruebas()
  state.comprandoPaquete.clear() // D656: una compra que una prueba dejó colgada no frena a la siguiente
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
    await screen.findByText(/^Pedimos tu código por WhatsApp/)
    escribir(screen.getAllByRole('textbox')[0], '123456')
    await waitFor(() => expect(api.getCustomerPortal).toHaveBeenCalledWith('testarudo', 'tok', 'reservas'))
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
    await screen.findByText(/^Pedimos tu código por WhatsApp/)
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
    sembrar({
      customer: { ...CLIENTE, loyaltyPoints: 0, totalVisits: 0 }, credits: { purchases: [] }, reservations: { upcoming: [], past: [] },
    })
    let responder: (r: any) => void = () => {}
    vi.mocked(api.updateCustomerProfile).mockImplementationOnce(() => new Promise(ok => { responder = ok }))
    renderPortal()
    fireEvent.click(screen.getByTitle('Editar Perfil'))
    escribir(screen.getByPlaceholderText('Nombre'), 'Anita')
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(api.updateCustomerProfile).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }))
    await act(async () => { responder({ customer: { ...CLIENTE, firstName: 'Anita' } }) })
    expect(leerSesion('testarudo')).toBeNull()
    expect(localStorage.getItem('avq_customer_token:testarudo')).toBeNull()
    expect(localStorage.getItem('avq_customer_info:testarudo')).toBeNull()
    expect(state.customerToken.value).toBeNull()
    // W4: «Mi cuenta» se lee al abrirla (1 vez); la respuesta tardía del perfil ya no la vuelve a pedir.
    expect(api.getCustomerPortal).toHaveBeenCalledTimes(1)
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
    sembrar({
      customer: { ...CLIENTE, loyaltyPoints: 0, totalVisits: 0 }, credits: { purchases: [] }, reservations: { upcoming: [], past: [] },
    })
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
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }))
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
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }))
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
    sembrar({
      customer: { ...CLIENTE, loyaltyPoints: 0, totalVisits: 0 }, credits: { purchases: [] }, reservations: { upcoming: [], past: [] },
    })
    renderPortal()
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }))
    expect(leerSesion('testarudo')).toBeNull()
    expect(localStorage.getItem('avq_order_session:testarudo')).toBeNull()
    expect(state.customerToken.value).toBeNull()
  })
})

// ───────────────────────── W4: «Mi cuenta», una sola y siempre leída de nuevo ─────────────────────────
const real = await vi.importActual<typeof import('../api/booking')>('../api/booking')
const PEDIDO = (n: number, over: Record<string, unknown> = {}) => ({
  folio: `W${String(n).padStart(4, '0')}`, estado: 'COMPLETED', pagado: true, total: 65, trackingToken: `tt-${n}`, creadoEl: '2026-11-02T18:00:00.000Z', ...over,
}) as any
const TARJETA = (n: number, over: Record<string, unknown> = {}) => ({
  id: `g${n}`, last4: `L${String(n).padStart(3, '0')}`, saldo: n, venceEl: '2027-11-30', codigo: `K7Q2-9DXM-4R8H-${String(n).padStart(4, '0')}-Q`,
  estado: 'ACTIVA', disponible: true, ...over,
}) as any
const PORTAL = (over: Record<string, unknown> = {}) => ({
  customer: { ...CLIENTE, loyaltyPoints: 340, totalVisits: 3 }, credits: { purchases: [] }, reservations: { upcoming: [], past: [] },
  stampCard: { enabled: true, stampsEarned: 10, stampsRequired: 10, rewardLabel: 'café gratis' },
  invitadaRequiereEntrar: false,
  puntos: { saldo: 340, valor: 34 },
  premioDisponible: { id: 'r1', etiqueta: 'café gratis' },
  descuentos: { items: [{ nombre: '10 % en shakes', tipo: 'PERCENTAGE', valor: 10, vigenteHasta: '2026-11-30T23:59:59.000Z' }], total: 1, nextCursor: null },
  saldoAFavor: { last4: 'Z9Z9', saldo: 120, codigo: null, venceEl: null, estado: 'ACTIVA', disponible: true },
  tarjetas: { items: [{ ...TARJETA(350), last4: 'HB7T', codigo: 'K7Q2-9DXM-4R8H-HB7T-Q' }], total: 1, nextCursor: null },
  pedidos: { items: [{ ...PEDIDO(1), folio: 'W2H6N' }], total: 1, nextCursor: null },
  otraFicha: null,
  ...over,
}) as any
/** La página ya tiene a Ana (tok-A) en reservas. */
function anaAdentro() {
  guardarSesion('testarudo', { token: 'tok-A', customer: CLIENTE, contactos: [TEL], guardadaEn: Date.now() })
  state.entroAqui('testarudo', leerSesion('testarudo')!)
}
const flushAll = () => act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve() })

describe('W4: se lee de nuevo al abrir, al volver a la pestaña y cuando cambia un folio', () => {
  it('al abrir enseña lo anterior con «Actualizando…» y lo vuelve a pedir; al llegar, lo nuevo y sin el aviso', async () => {
    anaAdentro()
    sembrar(PORTAL({ puntos: { saldo: 100, valor: 10 } }))
    let responder: (d: any) => void = () => {}
    vi.mocked(api.getCustomerPortal).mockImplementationOnce(() => new Promise(ok => { responder = ok }))
    renderPortal()
    expect(screen.getByText('100 puntos')).toBeTruthy()
    expect(screen.getByText('Actualizando…')).toBeTruthy()
    expect(api.getCustomerPortal).toHaveBeenCalledWith('testarudo', 'tok-A', 'reservas')
    await act(async () => { responder(PORTAL()) })
    expect(screen.getByText('340 puntos')).toBeTruthy()
    expect(screen.queryByText('Actualizando…')).toBeNull()
  })

  it('al volver a la pestaña se vuelve a pedir', async () => {
    anaAdentro()
    vi.mocked(api.getCustomerPortal).mockResolvedValue(PORTAL())
    renderPortal()
    await screen.findByText('340 puntos')
    expect(api.getCustomerPortal).toHaveBeenCalledTimes(1)
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(api.getCustomerPortal).toHaveBeenCalledTimes(2)
  })

  it('el seguimiento avisa que un folio de ESTE negocio cambió (avoqado:folio-cambio) ⇒ se relee; de otro negocio, no', async () => {
    anaAdentro()
    vi.mocked(api.getCustomerPortal).mockResolvedValue(PORTAL())
    renderPortal()
    await screen.findByText('340 puntos')
    await act(async () => {
      document.dispatchEvent(new CustomEvent('avoqado:folio-cambio', { detail: { slug: 'otro', trackingToken: 'x', status: 'EXPIRED', paid: false } }))
    })
    expect(api.getCustomerPortal).toHaveBeenCalledTimes(1)
    await act(async () => {
      document.dispatchEvent(new CustomEvent('avoqado:folio-cambio', { detail: { slug: 'testarudo', trackingToken: 'x', status: 'ACCEPTED', paid: true } }))
    })
    expect(api.getCustomerPortal).toHaveBeenCalledTimes(2)
  })

  it('sin red al releer: conserva lo último con «Sin conexión. Te enseñamos lo último que supimos.» y «Reintentar»', async () => {
    anaAdentro()
    sembrar(PORTAL())
    vi.mocked(api.getCustomerPortal).mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(PORTAL({ puntos: { saldo: 500, valor: 50 } }))
    renderPortal()
    expect(await screen.findByText('Sin conexión. Te enseñamos lo último que supimos.')).toBeTruthy()
    expect(screen.getByText('340 puntos')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText('500 puntos')).toBeTruthy()
    expect(screen.queryByText('Sin conexión. Te enseñamos lo último que supimos.')).toBeNull()
  })
})

describe('W4: secciones sólo con lo prendido', () => {
  it('W7: su número arriba se lee igual que en «Listo: tu número ahora es 55 1000 0999.» (antes salía +525510000999 y, en fichas viejas, 5510000777)', async () => {
    anaAdentro()
    vi.mocked(api.getCustomerPortal).mockResolvedValue(PORTAL({ customer: { ...CLIENTE, phone: '+525510000999', loyaltyPoints: 0, totalVisits: 0 } }))
    renderPortal()
    await screen.findByText('Hola, Ana')
    expect(screen.getByText('55 1000 0999')).toBeTruthy()
    expect(screen.queryByText('+525510000999')).toBeNull()
    cleanup()
    cuentasNuevasParaPruebas()
    vi.mocked(api.getCustomerPortal).mockResolvedValue(PORTAL({ customer: { ...CLIENTE, phone: '5510000777', loyaltyPoints: 0, totalVisits: 0 } }))
    renderPortal()
    await screen.findByText('Hola, Ana')
    expect(screen.getByText('55 1000 0777')).toBeTruthy()
  })
  it('todo prendido: sellos y premio con Wallet, puntos y su valor, descuentos con vigencia, tarjeta, saldo a favor y pedidos con «PAGADO»', async () => {
    anaAdentro()
    vi.mocked(api.getCustomerPortal).mockResolvedValue(PORTAL())
    renderPortal()
    await screen.findByText('Hola, Ana')
    expect(screen.getByText('Tu tarjeta de sellos')).toBeTruthy()
    expect(screen.getByText('Llevas 10 de 10 sellos')).toBeTruthy()
    expect(screen.getByText('Premio disponible: café gratis')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Guardar mi tarjeta' })).toBeTruthy()
    expect(screen.getByText('Mis puntos')).toBeTruthy()
    expect(screen.getByText('340 puntos')).toBeTruthy()
    expect(screen.getByText('Valen $34.00 · úsalos al pedir')).toBeTruthy()
    expect(screen.getByText('Descuentos para ti')).toBeTruthy()
    expect(screen.getByText('10 % en shakes')).toBeTruthy()
    expect(screen.getByText('Hasta el 30 nov')).toBeTruthy()
    expect(screen.getByText('Tarjeta de regalo')).toBeTruthy()
    expect(screen.getByText('Te quedan $350.00')).toBeTruthy()
    expect(screen.getByText('Termina en HB7T · Vence el 30 nov 2027')).toBeTruthy()
    expect(screen.getByText('Saldo a favor')).toBeTruthy()
    expect(screen.getByText('$120.00')).toBeTruthy()
    expect(screen.getByText('Se usa en caja: dale tu teléfono a la cajera.')).toBeTruthy()
    // R9: el saldo a favor nunca enseña su código ni lleva «Usar en caja»; sólo la tarjeta guardada lo lleva.
    expect(screen.getAllByRole('button', { name: 'Usar en caja' })).toHaveLength(1)
    expect(screen.getByText('Mis pedidos')).toBeTruthy()
    expect(screen.getByText('W2H6N · $65.00')).toBeTruthy()
    expect(screen.getByText('Entregado')).toBeTruthy()
    expect(screen.getByText('PAGADO')).toBeTruthy()
    expect(screen.getByText('Próximas reservaciones')).toBeTruthy()
    // «Cerrar sesión» al final, una sola vez (ya no arriba junto al título).
    expect(screen.getAllByRole('button', { name: 'Cerrar sesión' })).toHaveLength(1)
  })

  it('todo apagado: no sale ninguna de esas secciones (ni vacías)', async () => {
    anaAdentro()
    vi.mocked(api.getCustomerPortal).mockResolvedValue(PORTAL({
      stampCard: { enabled: false, stampsEarned: 0, stampsRequired: 0, rewardLabel: '' }, puntos: null, premioDisponible: null,
      descuentos: { items: [], total: 0, nextCursor: null }, saldoAFavor: null, tarjetas: { items: [], total: 0, nextCursor: null },
      pedidos: { items: [], total: 0, nextCursor: null },
    }))
    renderPortal()
    await screen.findByText('Hola, Ana')
    for (const t of ['Tu tarjeta de sellos', 'Mis puntos', 'Descuentos para ti', 'Tarjeta de regalo', 'Saldo a favor', 'Mis pedidos'])
      expect(screen.queryByText(t)).toBeNull()
  })

  it('un servidor viejo (sin los campos de S13) pinta lo de hoy sin reventar', async () => {
    anaAdentro()
    vi.mocked(api.getCustomerPortal).mockResolvedValue({
      customer: { ...CLIENTE, loyaltyPoints: 0, totalVisits: 0 }, credits: { purchases: [] }, reservations: { upcoming: [], past: [] },
    } as any)
    renderPortal()
    expect(await screen.findByText('Hola, Ana')).toBeTruthy()
    expect(screen.queryByText('Mis puntos')).toBeNull()
  })

  it('«Tu pedido de hoy» arriba: el folio de hoy por pagar, con «Ver» que abre su seguimiento', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-11T17:00:00.000Z'))
    anaAdentro()
    vi.mocked(api.getCustomerPortal).mockResolvedValue(PORTAL({
      pedidos: { items: [PEDIDO(7, { folio: 'W7K3P', estado: 'PENDING_ACCEPTANCE', pagado: false, creadoEl: '2026-11-11T16:50:00.000Z' })], total: 1, nextCursor: null },
    }))
    const onVerPedido = vi.fn()
    renderPortal('es', { onVerPedido })
    expect(await screen.findByText('Tu pedido de hoy')).toBeTruthy()
    expect(screen.getByText('W7K3P · por pagar')).toBeTruthy()
    expect(screen.getByText('Paga en caja para que lo preparen.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Ver' }))
    expect(onVerPedido).toHaveBeenCalledWith('tt-7')
    vi.useRealTimers()
  })

  it('una tarjeta sin código (sesión sin contacto probado) o bloqueada no se ofrece para usar: dice por qué', async () => {
    anaAdentro()
    vi.mocked(api.getCustomerPortal).mockResolvedValue(PORTAL({
      tarjetas: {
        items: [TARJETA(80, { last4: 'AAAA', codigo: null }), TARJETA(90, { last4: 'BBBB', codigo: null, estado: 'BLOQUEADA', disponible: false })],
        total: 2, nextCursor: null,
      },
    }))
    renderPortal()
    await screen.findByText('Hola, Ana')
    expect(screen.queryByRole('button', { name: 'Usar en caja' })).toBeNull()
    expect(screen.getByText('Entra otra vez con tu WhatsApp o tu correo para ver su código.')).toBeTruthy()
    expect(screen.getByText('Bloqueada: pregunta en caja.')).toBeTruthy()
    expect(screen.getByText('Saldo $90.00')).toBeTruthy() // el saldo se ve, pero no como algo que puede usar
    expect(screen.queryByText('Te quedan $90.00')).toBeNull()
  })

  it('«Usar en caja» enseña su saldo y su código para la cajera; «Listo» regresa a «Mi cuenta»', async () => {
    anaAdentro()
    vi.mocked(api.getCustomerPortal).mockResolvedValue(PORTAL())
    renderPortal()
    fireEvent.click(await screen.findByRole('button', { name: 'Usar en caja' }))
    expect(screen.getByRole('heading', { name: 'Tarjeta de regalo' })).toBeTruthy()
    expect(screen.getByText('$350.00')).toBeTruthy()
    expect(screen.getByText('K7Q2-9DXM-4R8H-HB7T-Q')).toBeTruthy()
    expect(screen.getByText('Enséñaselo a la cajera para que lo teclee. No lo compartas: con este código se paga.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Listo' }))
    expect(screen.getByText('Hola, Ana')).toBeTruthy()
  })

  it('invitada: «Entra otra vez para ver tus reservas como invitada» y «Entrar otra vez» abre la entrada', async () => {
    anaAdentro()
    vi.mocked(api.getCustomerPortal).mockResolvedValue(PORTAL({ invitadaRequiereEntrar: true }))
    renderPortal()
    expect(await screen.findByText('Entra otra vez para ver tus reservas como invitada.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Entrar otra vez' }))
    expect(screen.getByRole('heading', { name: 'Entra a tu cuenta' })).toBeTruthy()
  })

  it('otra ficha: «Tienes beneficios en otra ficha» con su contacto, y entrar con ese correo', async () => {
    anaAdentro()
    vi.mocked(api.getCustomerPortal).mockResolvedValue(PORTAL({ otraFicha: { contacto: 'EMAIL', enmascarado: 'a***@correo.mx' } }))
    renderPortal()
    expect(await screen.findByText('Tienes beneficios en otra ficha')).toBeTruthy()
    expect(screen.getByText('Con tu correo: entra con ese correo para usarlos.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Entrar con mi correo' }))
    expect(screen.getByRole('heading', { name: 'Entra a tu cuenta' })).toBeTruthy()
  })
})

describe('W4: paginación (codex-plan2-r1 #8 y r2 #4)', () => {
  it('con nextCursor, «Ver más pedidos» pide la página siguiente y el pedido 21 se ve y se abre', async () => {
    anaAdentro()
    vi.mocked(api.getCustomerPortal).mockResolvedValue(PORTAL({
      pedidos: { items: Array.from({ length: 20 }, (_, i) => PEDIDO(i + 1)), total: 21, nextCursor: 'cur-p' },
    }))
    vi.mocked(api.listarMisPedidos).mockResolvedValue({ items: [PEDIDO(21, { folio: 'W9D5F' })], total: 21, nextCursor: null })
    const onVerPedido = vi.fn()
    renderPortal('es', { onVerPedido })
    fireEvent.click(await screen.findByRole('button', { name: 'Ver más pedidos' }))
    expect(api.listarMisPedidos).toHaveBeenCalledWith('testarudo', 'tok-A', 'cur-p', 'reservas')
    const fila = await screen.findByRole('button', { name: /W9D5F/ })
    expect(screen.queryByRole('button', { name: 'Ver más pedidos' })).toBeNull()
    fireEvent.click(fila)
    expect(onVerPedido).toHaveBeenCalledWith('tt-21')
  })

  it('con nextCursor de tarjetas, «Ver más tarjetas» trae la 21 con su saldo y su código', async () => {
    anaAdentro()
    vi.mocked(api.getCustomerPortal).mockResolvedValue(PORTAL({
      tarjetas: { items: Array.from({ length: 20 }, (_, i) => TARJETA(i + 1)), total: 21, nextCursor: 'cur-t' },
    }))
    vi.mocked(api.listarMisTarjetas).mockResolvedValue({ items: [TARJETA(21, { last4: 'Z021', codigo: 'AAAA-BBBB-CCCC-Z021-Q' })], total: 21, nextCursor: null })
    renderPortal()
    fireEvent.click(await screen.findByRole('button', { name: 'Ver más tarjetas' }))
    expect(api.listarMisTarjetas).toHaveBeenCalledWith('testarudo', 'tok-A', 'cur-t', 'reservas')
    expect(await screen.findByText('Te quedan $21.00')).toBeTruthy()
    const usar = screen.getAllByRole('button', { name: 'Usar en caja' })
    fireEvent.click(usar[usar.length - 1])
    expect(screen.getByText('AAAA-BBBB-CCCC-Z021-Q')).toBeTruthy()
  })

  it('una página que llega después de «Cerrar sesión» no se pinta', async () => {
    anaAdentro()
    vi.mocked(api.getCustomerPortal).mockResolvedValue(PORTAL({ pedidos: { items: [PEDIDO(1)], total: 2, nextCursor: 'cur-p' } }))
    let responder: (d: any) => void = () => {}
    vi.mocked(api.listarMisPedidos).mockImplementationOnce(() => new Promise(ok => { responder = ok }))
    renderPortal()
    fireEvent.click(await screen.findByRole('button', { name: 'Ver más pedidos' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }))
    await act(async () => { responder({ items: [PEDIDO(2, { folio: 'W9D5F' })], total: 2, nextCursor: null }) })
    expect(screen.queryByText(/W9D5F/)).toBeNull()
    expect(screen.getByRole('heading', { name: 'Entra a tu cuenta' })).toBeTruthy()
  })
})

describe('W4: «Guardar en mi cuenta»', () => {
  const CODIGO = 'K7Q2-9DXM-4R8H-HB7T-Q'
  it('con el código guarda la tarjeta, lo dice y vuelve a leer «Mi cuenta»', async () => {
    anaAdentro()
    vi.mocked(api.getCustomerPortal).mockResolvedValue(PORTAL())
    vi.mocked(api.guardarTarjeta).mockResolvedValue({ giftCardId: 'g9', last4: 'HB7T', saldo: 350 })
    renderPortal()
    await screen.findByText('Hola, Ana')
    const boton = screen.getByRole('button', { name: 'Guardar en mi cuenta' }) as HTMLButtonElement
    expect(boton.disabled).toBe(true) // sin código, con su razón a la vista
    expect(screen.getByText('El código tiene 17 letras y números.')).toBeTruthy()
    escribir(screen.getByLabelText('Código de la tarjeta'), CODIGO)
    fireEvent.click(boton)
    await waitFor(() => expect(api.guardarTarjeta).toHaveBeenCalledWith('testarudo', 'tok-A', CODIGO, 'reservas'))
    expect(await screen.findByText('Listo: guardamos tu tarjeta.')).toBeTruthy()
    expect(api.getCustomerPortal).toHaveBeenCalledTimes(2)
  })

  it('409 GIFT_CARD_ALREADY_SAVED ⇒ «Esta tarjeta ya está guardada en otra cuenta.»', async () => {
    anaAdentro()
    vi.mocked(api.getCustomerPortal).mockResolvedValue(PORTAL())
    vi.mocked(api.guardarTarjeta).mockRejectedValue(Object.assign(new Error('x'), { status: 409, data: { code: 'GIFT_CARD_ALREADY_SAVED', message: 'x' } }))
    renderPortal()
    await screen.findByText('Hola, Ana')
    escribir(screen.getByLabelText('Código de la tarjeta'), CODIGO)
    fireEvent.click(screen.getByRole('button', { name: 'Guardar en mi cuenta' }))
    expect(await screen.findByText('Esta tarjeta ya está guardada en otra cuenta.')).toBeTruthy()
    expect(api.getCustomerPortal).toHaveBeenCalledTimes(1)
  })

  it('404 ⇒ «No encontramos esa tarjeta de regalo en este negocio. Revisa el código.»; sin red ⇒ «Sin conexión…»', async () => {
    anaAdentro()
    vi.mocked(api.getCustomerPortal).mockResolvedValue(PORTAL())
    vi.mocked(api.guardarTarjeta)
      .mockRejectedValueOnce(Object.assign(new Error('x'), { status: 404, data: { code: 'GIFT_CARD_NOT_FOUND', message: 'x' } }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    renderPortal()
    await screen.findByText('Hola, Ana')
    escribir(screen.getByLabelText('Código de la tarjeta'), CODIGO)
    fireEvent.click(screen.getByRole('button', { name: 'Guardar en mi cuenta' }))
    expect(await screen.findByText('No encontramos esa tarjeta de regalo en este negocio. Revisa el código.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Guardar en mi cuenta' }))
    expect(await screen.findByText('Sin conexión. Revisa tu internet y vuelve a intentar.')).toBeTruthy()
  })
})

describe('W4: reglas de sesión (A refinada, una sola lectura, época)', () => {
  const portalPorRed = () => {
    vi.mocked(api.getCustomerPortal).mockImplementation(real.getCustomerPortal)
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, headers: new Headers(), json: async () => PORTAL() }) as any)
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }
  afterEach(() => vi.unstubAllGlobals())

  it('otra pestaña salió y entró Bea: al volver a la pestaña no se manda nada y deja de enseñar a Ana, sin rojo', async () => {
    anaAdentro()
    const fetchMock = portalPorRed()
    renderPortal()
    await screen.findByText('Hola, Ana')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    borrarSesion('testarudo')
    guardarSesion('testarudo', { token: 'tok-B', customer: { ...CLIENTE, id: 'c2', firstName: 'Bea' }, contactos: [TEL], guardadaEn: Date.now() })
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    await flushAll()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Hola, Ana')).toBeNull()
    expect(screen.queryByText('Hola, Bea')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Entra a tu cuenta' })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(leerSesion('testarudo')?.token).toBe('tok-B') // la de Bea queda para la próxima carga
  })

  it('manda con la sesión de la página aunque otra superficie haya entrado con otra persona en el mismo documento (al recargar se entera)', async () => {
    anaAdentro()
    const fetchMock = portalPorRed()
    renderPortal()
    await screen.findByText('Hola, Ana')
    // La tienda entró como Bea en el mismo documento: reservas no la toma; su siguiente lectura ve que la suya ya no está guardada.
    guardarSesion('testarudo', { token: 'tok-B', customer: { ...CLIENTE, id: 'c2', firstName: 'Bea' }, contactos: [TEL], guardadaEn: Date.now() })
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    await flushAll()
    const conBea = (fetchMock.mock.calls as any[]).filter(c => JSON.stringify(c).includes('tok-B'))
    expect(conBea).toHaveLength(0)
    expect(screen.queryByText('Hola, Ana')).toBeNull()
  })
})

describe('W4: «Mi cuenta» dentro de la tienda (superficie pedidos)', () => {
  it('sin sesión de la tienda: entrar sin contraseña ni «Volver a Reservar»; al entrar, la adopta la TIENDA (alEntrar) y reservas sigue igual', async () => {
    const alEntrar = vi.fn()
    const onBack = vi.fn()
    vi.mocked(api.getCustomerPortal).mockResolvedValue(PORTAL())
    renderPortal('es', { superficie: 'pedidos', alEntrar, onBack })
    expect(screen.queryByRole('button', { name: 'o entra con correo y contraseña' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Volver a Reservar' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Pedir sin cuenta' }))
    expect(onBack).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Seguir con WhatsApp' }))
    escribir(screen.getByPlaceholderText('Tu número de teléfono'), '5544422262')
    fireEvent.click(screen.getByRole('button', { name: 'Enviar código' }))
    await screen.findByText(/^Pedimos tu código por WhatsApp/)
    escribir(screen.getAllByRole('textbox')[0], '123456')
    await waitFor(() => expect(alEntrar).toHaveBeenCalledWith(expect.objectContaining({ token: 'tok' })))
    expect(state.customerToken.value).toBeNull() // reservas no la toma (A refinada)
  })

  it('con sesión de la tienda: lee con ESA sesión, sin perfil, paquetes ni «Hacer una reservación»; «Cerrar sesión» llama alSalir', async () => {
    const { fijarPagina } = await import('../lib/sesionDeCliente')
    const { desdeUnica } = await import('../order/session')
    const sesion = { token: 'tok-T', customer: CLIENTE, contactos: [TEL], guardadaEn: Date.now() }
    guardarSesion('testarudo', sesion)
    fijarPagina('testarudo', 'pedidos', desdeUnica(sesion))
    vi.mocked(api.getCustomerPortal).mockResolvedValue(PORTAL())
    const alSalir = vi.fn()
    renderPortal('es', { superficie: 'pedidos', alSalir })
    expect(await screen.findByText('Hola, Ana')).toBeTruthy()
    expect(api.getCustomerPortal).toHaveBeenCalledWith('testarudo', 'tok-T', 'pedidos')
    expect(screen.queryByTitle('Editar Perfil')).toBeNull()
    expect(screen.queryByText('Comprar créditos')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Hacer una Reservación' })).toBeNull()
    expect(api.getCreditPacks).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }))
    expect(alSalir).toHaveBeenCalled()
  })

  it('«Guardar en mi cuenta» que responde después de «Cerrar sesión» no dice «Listo» ni vuelve a leer', async () => {
    anaAdentro()
    vi.mocked(api.getCustomerPortal).mockResolvedValue(PORTAL())
    let responder: (d: any) => void = () => {}
    vi.mocked(api.guardarTarjeta).mockImplementationOnce(() => new Promise(ok => { responder = ok }))
    renderPortal()
    await screen.findByText('Hola, Ana')
    escribir(screen.getByLabelText('Código de la tarjeta'), 'K7Q2-9DXM-4R8H-HB7T-Q')
    fireEvent.click(screen.getByRole('button', { name: 'Guardar en mi cuenta' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }))
    await act(async () => { responder({ giftCardId: 'g9', last4: 'HB7T', saldo: 350 }) })
    expect(screen.queryByText('Listo: guardamos tu tarjeta.')).toBeNull()
    expect(api.getCustomerPortal).toHaveBeenCalledTimes(1)
  })
})

describe('W4 codex-w4-r1: nada de una clienta queda a la mano de la siguiente; «Usar en caja» y «Ver más» siguen los datos vigentes', () => {
  const BEA = { ...CLIENTE, id: 'c2', firstName: 'Bea' }
  const entraBea = () => {
    guardarSesion('testarudo', { token: 'tok-B', customer: BEA, contactos: [TEL], guardadaEn: Date.now() })
    state.entroAqui('testarudo', leerSesion('testarudo')!)
  }

  it('#1 el código que Ana escribió para guardar no se queda escrito cuando entra Bea', async () => {
    anaAdentro()
    vi.mocked(api.getCustomerPortal).mockImplementation(async (_s, tok) => PORTAL(tok === 'tok-B' ? { customer: { ...BEA, loyaltyPoints: 0, totalVisits: 0 } } : {}))
    renderPortal()
    await screen.findByText('Hola, Ana')
    escribir(screen.getByLabelText('Código de la tarjeta'), 'K7Q2-9DXM-4R8H-HB7T-Q')
    await act(async () => { entraBea() }) // otra instancia de reservas cambia directo de Ana a Bea
    await screen.findByText('Hola, Bea')
    expect((screen.getByLabelText('Código de la tarjeta') as HTMLInputElement).value).toBe('')
  })

  it('#1 «Usar en caja» de Ana no se queda abierto con su código cuando la página pasa a Bea', async () => {
    anaAdentro()
    vi.mocked(api.getCustomerPortal).mockImplementation(async (_s, tok) => PORTAL(tok === 'tok-B' ? { customer: { ...BEA, loyaltyPoints: 0, totalVisits: 0 } } : {}))
    renderPortal()
    fireEvent.click(await screen.findByRole('button', { name: 'Usar en caja' }))
    expect(screen.getByText('K7Q2-9DXM-4R8H-HB7T-Q')).toBeTruthy()
    await act(async () => { entraBea() })
    await screen.findByText('Hola, Bea')
    expect(screen.queryByText('K7Q2-9DXM-4R8H-HB7T-Q')).toBeNull()
  })

  it('#2 al releer, si la tarjeta ya está bloqueada, «Usar en caja» se cierra y ya no enseña el código ni el saldo viejo', async () => {
    anaAdentro()
    const conId = PORTAL()
    conId.tarjetas.items[0].id = 'g350'
    vi.mocked(api.getCustomerPortal).mockResolvedValueOnce(conId).mockResolvedValueOnce(PORTAL({
      tarjetas: { items: [{ ...TARJETA(0), last4: 'HB7T', id: 'g350', codigo: null, estado: 'BLOQUEADA', disponible: false }], total: 1, nextCursor: null },
    }))
    renderPortal()
    fireEvent.click(await screen.findByRole('button', { name: 'Usar en caja' }))
    expect(screen.getByText('K7Q2-9DXM-4R8H-HB7T-Q')).toBeTruthy()
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    await flushAll()
    expect(screen.queryByText('K7Q2-9DXM-4R8H-HB7T-Q')).toBeNull()
    expect(screen.queryByText('$350.00')).toBeNull()
    expect(screen.getByText('Bloqueada: pregunta en caja.')).toBeTruthy()
  })

  it('#3 «Ver más» tocado durante una relectura no salta páginas: la página vieja no se pega y el botón sigue con el cursor nuevo', async () => {
    anaAdentro()
    const pagina1 = PORTAL({ pedidos: { items: Array.from({ length: 20 }, (_, i) => PEDIDO(i + 1)), total: 60, nextCursor: 'cur-1' } })
    let relectura: (d: any) => void = () => {}
    vi.mocked(api.getCustomerPortal).mockResolvedValueOnce(pagina1).mockImplementationOnce(() => new Promise(ok => { relectura = ok }))
    let tercera: (d: any) => void = () => {}
    vi.mocked(api.listarMisPedidos)
      .mockResolvedValueOnce({ items: Array.from({ length: 20 }, (_, i) => PEDIDO(i + 21)), total: 60, nextCursor: 'cur-2' })
      .mockImplementationOnce(() => new Promise(ok => { tercera = ok }))
      .mockResolvedValueOnce({ items: [PEDIDO(21)], total: 60, nextCursor: null })
    renderPortal()
    fireEvent.click(await screen.findByRole('button', { name: 'Ver más pedidos' }))
    await screen.findByRole('button', { name: /W0040/ })
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) }) // empieza a releer
    fireEvent.click(screen.getByRole('button', { name: 'Ver más pedidos' })) // con el cursor viejo (cur-2)
    await act(async () => { relectura(pagina1) }) // la relectura regresa a la primera página
    await act(async () => { tercera({ items: Array.from({ length: 20 }, (_, i) => PEDIDO(i + 41)), total: 60, nextCursor: null }) })
    expect(screen.queryByRole('button', { name: /W0041/ })).toBeNull() // no se pegan 41–60 sobre 1–20
    fireEvent.click(screen.getByRole('button', { name: 'Ver más pedidos' }))
    await waitFor(() => expect(vi.mocked(api.listarMisPedidos).mock.lastCall?.[2]).toBe('cur-1'))
  })

  it('un doble toque en «Ver más» pide una sola página', async () => {
    anaAdentro()
    vi.mocked(api.getCustomerPortal).mockResolvedValue(PORTAL({ pedidos: { items: [PEDIDO(1)], total: 2, nextCursor: 'cur-p' } }))
    vi.mocked(api.listarMisPedidos).mockImplementation(() => new Promise(() => {}))
    renderPortal()
    const boton = await screen.findByRole('button', { name: 'Ver más pedidos' })
    fireEvent.click(boton)
    fireEvent.click(boton)
    expect(api.listarMisPedidos).toHaveBeenCalledTimes(1)
  })

  it('tienda: «Tu pedido de hoy» de este aparato sólo si es suyo; si no está en sus pedidos, no se presenta como suyo', async () => {
    const { fijarPagina } = await import('../lib/sesionDeCliente')
    const { desdeUnica } = await import('../order/session')
    const sesion = { token: 'tok-T', customer: CLIENTE, contactos: [TEL], guardadaEn: Date.now() }
    guardarSesion('testarudo', sesion)
    fijarPagina('testarudo', 'pedidos', desdeUnica(sesion))
    vi.mocked(api.getCustomerPortal).mockResolvedValue(PORTAL())
    renderPortal('es', {
      superficie: 'pedidos',
      pedidoDeHoy: { folio: 'W4R9T', estado: 'PENDING_ACCEPTANCE', pagado: false, linea: 'Paga en caja antes de las 10:42.', trackingToken: 'de-otra' },
    })
    await screen.findByText('Hola, Ana')
    expect(screen.queryByText('Tu pedido de hoy')).toBeNull()
    cleanup()
    vi.mocked(api.getCustomerPortal).mockResolvedValue(PORTAL({ pedidos: { items: [PEDIDO(9, { folio: 'W4R9T', trackingToken: 'mio', estado: 'PENDING_ACCEPTANCE', pagado: false })], total: 1, nextCursor: null } }))
    renderPortal('es', {
      superficie: 'pedidos',
      pedidoDeHoy: { folio: 'W4R9T', estado: 'PENDING_ACCEPTANCE', pagado: false, linea: 'Paga en caja antes de las 10:42.', trackingToken: 'mio' },
    })
    expect(await screen.findByText('Tu pedido de hoy')).toBeTruthy()
    expect(screen.getByText('Paga en caja antes de las 10:42.')).toBeTruthy()
  })
})

describe('W4 codex-w4-r2: lo recién leído manda (una lectura vieja, de otra apertura u otro elemento, ya no pinta)', () => {
  const bloqueada = () => {
    const d = PORTAL({ tarjetas: { items: [{ ...TARJETA(0), id: 'g350', last4: 'HB7T', codigo: null, estado: 'BLOQUEADA', disponible: false }], total: 1, nextCursor: null } })
    return d
  }
  const viva = () => {
    const d = PORTAL()
    d.tarjetas.items[0].id = 'g350'
    return d
  }

  it('#1 reservas: la lectura de una apertura anterior que llega tarde no regresa la tarjeta bloqueada a «Usar en caja»', async () => {
    anaAdentro()
    let vieja: (d: any) => void = () => {}
    vi.mocked(api.getCustomerPortal).mockImplementationOnce(() => new Promise(ok => { vieja = ok })).mockResolvedValueOnce(bloqueada())
    const primera = renderPortal()
    primera.unmount() // vuelve atrás antes de que conteste
    renderPortal() // abre otra vez
    expect(await screen.findByText('Bloqueada: pregunta en caja.')).toBeTruthy()
    await act(async () => { vieja(viva()) })
    await flushAll()
    expect(screen.getByText('Bloqueada: pregunta en caja.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Usar en caja' })).toBeNull()
  })

  it('#1 tienda: igual con la sesión de la tienda', async () => {
    const { fijarPagina } = await import('../lib/sesionDeCliente')
    const { desdeUnica } = await import('../order/session')
    const sesion = { token: 'tok-T', customer: CLIENTE, contactos: [TEL], guardadaEn: Date.now() }
    guardarSesion('testarudo', sesion)
    fijarPagina('testarudo', 'pedidos', desdeUnica(sesion))
    let vieja: (d: any) => void = () => {}
    vi.mocked(api.getCustomerPortal).mockImplementationOnce(() => new Promise(ok => { vieja = ok })).mockResolvedValueOnce(bloqueada())
    renderPortal('es', { superficie: 'pedidos' }).unmount()
    renderPortal('es', { superficie: 'pedidos' })
    expect(await screen.findByText('Bloqueada: pregunta en caja.')).toBeTruthy()
    await act(async () => { vieja(viva()) })
    await flushAll()
    cleanup()
    renderPortal('es', { superficie: 'pedidos' }) // lo que la tienda guardó para la siguiente apertura tampoco es lo viejo
    expect(screen.getByText('Bloqueada: pregunta en caja.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Usar en caja' })).toBeNull()
  })

  it('«Ver más» no pega una página sobre datos que otro elemento ya releyó', async () => {
    anaAdentro()
    vi.mocked(api.getCustomerPortal).mockResolvedValue(PORTAL({ pedidos: { items: [PEDIDO(1)], total: 3, nextCursor: 'cur-1' } }))
    let pagina: (d: any) => void = () => {}
    vi.mocked(api.listarMisPedidos).mockImplementationOnce(() => new Promise(ok => { pagina = ok }))
    renderPortal()
    fireEvent.click(await screen.findByRole('button', { name: 'Ver más pedidos' }))
    // Otro elemento de reservas releyó «Mi cuenta» (datos nuevos, otra primera página).
    await act(async () => { sembrar(PORTAL({ pedidos: { items: [PEDIDO(5)], total: 3, nextCursor: 'cur-5' } })) })
    await act(async () => { pagina({ items: [PEDIDO(2, { folio: 'W9D5F' })], total: 3, nextCursor: null }) })
    expect(screen.queryByRole('button', { name: /W9D5F/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Ver más pedidos' })).toBeTruthy()
  })

  it('#2 tienda: si la cuenta ya dice PAGADO, «Tu pedido de hoy» no pide pagar aunque el aviso del aparato siga viejo', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-11T17:00:00.000Z'))
    const { fijarPagina } = await import('../lib/sesionDeCliente')
    const { desdeUnica } = await import('../order/session')
    const sesion = { token: 'tok-T', customer: CLIENTE, contactos: [TEL], guardadaEn: Date.now() }
    guardarSesion('testarudo', sesion)
    fijarPagina('testarudo', 'pedidos', desdeUnica(sesion))
    vi.mocked(api.getCustomerPortal).mockResolvedValue(PORTAL({
      pedidos: { items: [PEDIDO(7, { folio: 'W7K3P', estado: 'ACCEPTED', pagado: true, trackingToken: 'mio', creadoEl: '2026-11-11T16:50:00.000Z' })], total: 1, nextCursor: null },
    }))
    renderPortal('es', {
      superficie: 'pedidos',
      pedidoDeHoy: { folio: 'W7K3P', estado: 'PENDING_ACCEPTANCE', pagado: false, linea: 'Paga en caja antes de las 10:42.', trackingToken: 'mio' },
    })
    expect(await screen.findByText('Tu pedido de hoy')).toBeTruthy()
    expect(screen.getByText('W7K3P · preparando')).toBeTruthy()
    expect(screen.getByText('Pagado: enseña tu folio al recoger.')).toBeTruthy()
    expect(screen.queryByText('Paga en caja antes de las 10:42.')).toBeNull()
    vi.useRealTimers()
  })
})

describe('W4 codex-w4-r3: lo leído y su estado son UNO por negocio y superficie; nada de la clienta anterior queda en el perfil', () => {
  it('#2 dos portales sin datos: falla la lectura nueva y llega la vieja ⇒ los dos dicen «Sin conexión» con «Reintentar», ninguno gira para siempre', async () => {
    anaAdentro()
    let vieja: (d: any) => void = () => {}
    vi.mocked(api.getCustomerPortal)
      .mockImplementationOnce(() => new Promise(ok => { vieja = ok }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    render(<div>
      <CustomerPortal venueSlug="testarudo" timezone="America/Mexico_City" t={createT('es')} onBack={() => {}} onManageBooking={() => {}} />
      <CustomerPortal venueSlug="testarudo" timezone="America/Mexico_City" t={createT('es')} onBack={() => {}} onManageBooking={() => {}} />
    </div>)
    await flushAll()
    await act(async () => { vieja(PORTAL()) })
    await flushAll()
    expect(screen.getAllByText('Sin conexión. Revisa tu internet y vuelve a intentar.')).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Intentar de Nuevo' })).toHaveLength(2)
    expect(screen.queryByRole('status', { name: 'Actualizando…' })).toBeNull()
  })

  it('#3 el formulario de perfil de Ana no se queda abierto con su nombre cuando la página pasa a Bea', async () => {
    anaAdentro()
    const BEA = { ...CLIENTE, id: 'c2', firstName: 'Bea' }
    vi.mocked(api.getCustomerPortal).mockImplementation(async (_s, tok) => PORTAL(tok === 'tok-B' ? { customer: { ...BEA, loyaltyPoints: 0, totalVisits: 0 } } : {}))
    renderPortal()
    await screen.findByText('Hola, Ana')
    fireEvent.click(screen.getByTitle('Editar Perfil'))
    escribir(screen.getByPlaceholderText('Nombre'), 'Anita')
    await act(async () => {
      guardarSesion('testarudo', { token: 'tok-B', customer: BEA, contactos: [TEL], guardadaEn: Date.now() })
      state.entroAqui('testarudo', leerSesion('testarudo')!) // otro elemento de reservas entró como Bea
    })
    await screen.findByText('Hola, Bea')
    expect(screen.queryByPlaceholderText('Nombre')).toBeNull()
    expect(screen.queryByDisplayValue('Anita')).toBeNull()
  })
})

describe('W6: «Cambiar mi número» (S8)', () => {
  const NUEVO = '+525598765432'
  const NUEVA = { token: 'tok-N', customer: { ...CLIENTE, phone: NUEVO }, contactos: [{ ...TEL, valor: NUEVO }], otraFicha: null }
  const falla = (status: number, code?: string, extra: Record<string, unknown> = {}) =>
    Object.assign(new Error('x'), { status, data: { message: 'del servidor', ...(code ? { code } : {}), ...extra }, enviado: 'tok-A' })
  beforeEach(() => {
    vi.mocked(api.pedirCambioDeNumero).mockResolvedValue({ ok: true })
    vi.mocked(api.confirmarCambioDeNumero).mockResolvedValue(NUEVA)
    vi.mocked(api.getCustomerPortal).mockImplementation(async (_s, tok) =>
      PORTAL(tok === 'tok-N' ? { customer: { ...CLIENTE, phone: NUEVO, loyaltyPoints: 340, totalVisits: 3 } } : {}))
  })
  async function abrir(locale: 'es' | 'en' = 'es', extra: Record<string, unknown> = {}) {
    renderPortal(locale, extra)
    await screen.findByText(locale === 'es' ? 'Hola, Ana' : 'Hello, Ana')
    fireEvent.click(screen.getByRole('button', { name: locale === 'es' ? 'Cambiar mi número' : 'Change my number' }))
  }
  async function pedir(numero = '5598765432') {
    escribir(screen.getByPlaceholderText('Tu número de teléfono'), numero)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Enviar código' })) })
  }
  const codigo = (c = '123456') => escribir(screen.getAllByRole('textbox')[0], c)

  it('pide el nuevo, manda el código y guarda la sesión de reemplazo; reservas la adopta y «Mi cuenta» se relee con ella', async () => {
    anaAdentro()
    await abrir()
    expect(screen.getByRole('heading', { name: 'Cambiar mi número' })).toBeTruthy()
    expect(screen.getByText('Te mandamos un código por WhatsApp a tu número nuevo. Desde que lo confirmes, entras con él.')).toBeTruthy()
    await pedir()
    expect(api.pedirCambioDeNumero).toHaveBeenCalledWith('testarudo', 'tok-A', NUEVO, 'reservas')
    expect(screen.getByText(/^Pedimos tu código por WhatsApp/)).toBeTruthy()
    expect(screen.getByText(/al 55 9876 5432\./)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Reenviar en 30s' }) as HTMLButtonElement).disabled).toBe(true)
    codigo()
    await waitFor(() => expect(api.confirmarCambioDeNumero).toHaveBeenCalledWith('testarudo', 'tok-A', NUEVO, '123456', 'reservas'))
    expect(await screen.findByText('Listo: tu número ahora es 55 9876 5432.')).toBeTruthy()
    expect(leerSesion('testarudo')).toMatchObject({ token: 'tok-N', contactos: NUEVA.contactos })
    expect(state.customerToken.value).toBe('tok-N')
    expect(api.getCustomerPortal).toHaveBeenLastCalledWith('testarudo', 'tok-N', 'reservas')
    // El aviso es de ESA sesión: si entra otra persona en la página, se va.
    await act(async () => { state.entroAqui('testarudo', { token: 'tok-B', customer: { ...CLIENTE, id: 'c2', firstName: 'Bea' }, contactos: [TEL] }) })
    expect(screen.queryByText(/tu número ahora es/)).toBeNull()
  })

  it('tienda: manda con la sesión de la TIENDA y la de reemplazo la adopta la tienda (alEntrar); reservas no la toma', async () => {
    const { fijarPagina } = await import('../lib/sesionDeCliente')
    const { desdeUnica } = await import('../order/session')
    const sesion = { token: 'tok-T', customer: CLIENTE, contactos: [TEL], guardadaEn: Date.now() }
    guardarSesion('testarudo', sesion)
    fijarPagina('testarudo', 'pedidos', desdeUnica(sesion))
    const alEntrar = vi.fn()
    await abrir('es', { superficie: 'pedidos', alEntrar })
    await pedir()
    expect(api.pedirCambioDeNumero).toHaveBeenCalledWith('testarudo', 'tok-T', NUEVO, 'pedidos')
    codigo()
    await waitFor(() => expect(alEntrar).toHaveBeenCalledWith(NUEVA))
    expect(leerSesion('testarudo')?.token).toBe('tok-N')
    expect(state.customerToken.value).toBeNull() // A refinada: reservas no la toma
  })

  it('401 CUSTOMER_REAUTH_REQUIRED ⇒ «Entra otra vez para cambiar tu número» con «Entrar otra vez»; la sesión NO se cierra', async () => {
    anaAdentro()
    vi.mocked(api.pedirCambioDeNumero).mockRejectedValueOnce(falla(401, 'CUSTOMER_REAUTH_REQUIRED'))
    await abrir()
    await pedir()
    expect(await screen.findByText('Entra otra vez para cambiar tu número')).toBeTruthy()
    expect(leerSesion('testarudo')?.token).toBe('tok-A')
    expect(state.customerToken.value).toBe('tok-A')
    fireEvent.click(screen.getByRole('button', { name: 'Entrar otra vez' }))
    expect(screen.getByRole('heading', { name: 'Entra a tu cuenta' })).toBeTruthy()
    expect(state.customerToken.value).toBe('tok-A')
  })

  it('otro 401 al confirmar (la sesión ya no vale) ⇒ se cierra como siempre: «Entra a tu cuenta», sin rojo', async () => {
    anaAdentro()
    vi.mocked(api.confirmarCambioDeNumero).mockRejectedValueOnce(falla(401, 'CUSTOMER_TOKEN_INVALID'))
    await abrir()
    await pedir()
    codigo()
    expect(await screen.findByRole('heading', { name: 'Entra a tu cuenta' })).toBeTruthy()
    expect(state.customerToken.value).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('409 TELEFONO_DE_OTRA_FICHA ⇒ el aviso de dos fichas y «Tu número no cambió.»; «Entrar con mi teléfono» abre la entrada', async () => {
    anaAdentro()
    vi.mocked(api.confirmarCambioDeNumero).mockRejectedValueOnce(
      falla(409, 'TELEFONO_DE_OTRA_FICHA', { details: { otraFicha: { contacto: 'PHONE', enmascarado: '•••• 5432' } } }))
    await abrir()
    await pedir()
    codigo()
    expect(await screen.findByText('Tienes beneficios en otra ficha')).toBeTruthy()
    expect(screen.getByText('Con tu teléfono: entra con ese teléfono para usarlos.')).toBeTruthy()
    expect(screen.getByText('Tu número no cambió.')).toBeTruthy()
    expect(leerSesion('testarudo')?.token).toBe('tok-A')
    fireEvent.click(screen.getByRole('button', { name: 'Entrar con mi teléfono' }))
    expect(screen.getByRole('heading', { name: 'Entra a tu cuenta' })).toBeTruthy()
  })

  it('D17: 503 OTP_SEND_FAILED ⇒ «No pudimos mandar el código por WhatsApp. Intenta en un momento.» y sigue en el número', async () => {
    anaAdentro()
    vi.mocked(api.pedirCambioDeNumero).mockRejectedValueOnce(falla(503, 'OTP_SEND_FAILED'))
    await abrir()
    await pedir()
    expect(await screen.findByText('No pudimos mandar el código por WhatsApp. Intenta en un momento.')).toBeTruthy()
    expect(screen.queryByText(/^Pedimos tu código/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Enviar código' })).toBeTruthy()
    // Se puede pedir otra vez enseguida (no salió nada que esperar).
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Enviar código' })) })
    expect(await screen.findByText(/^Pedimos tu código por WhatsApp/)).toBeTruthy()
  })

  it('D17 en inglés: «We couldn’t send…» con las mismas palabras', async () => {
    anaAdentro()
    vi.mocked(api.pedirCambioDeNumero).mockRejectedValueOnce(falla(503, 'OTP_SEND_FAILED'))
    await abrir('en')
    escribir(screen.getByPlaceholderText('Your phone number'), '5598765432')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send code' })) })
    expect(await screen.findByText("We couldn't send the code on WhatsApp. Try again in a moment.")).toBeTruthy()
  })

  it('el mismo número ⇒ «Ese ya es tu número.» y sigue en el paso del número', async () => {
    anaAdentro()
    vi.mocked(api.pedirCambioDeNumero).mockRejectedValueOnce(falla(400, 'CUSTOMER_PHONE_SAME'))
    await abrir()
    await pedir('5544422262')
    expect(await screen.findByText('Ese ya es tu número.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Enviar código' })).toBeTruthy()
  })

  it('sin red ⇒ «Sin conexión…» en ámbar, se conserva lo escrito y se puede volver a intentar; al confirmar, el código sigue', async () => {
    anaAdentro()
    vi.mocked(api.pedirCambioDeNumero).mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await abrir()
    await pedir()
    const aviso = await screen.findByText('Sin conexión. Revisa tu internet y vuelve a intentar.')
    expect(aviso.style.color).toBe('rgb(146, 64, 14)') // ámbar (#92400e), no rojo
    expect((screen.getByPlaceholderText('Tu número de teléfono') as HTMLInputElement).value).toContain('98765432')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Enviar código' })) })
    expect(await screen.findByText(/^Pedimos tu código por WhatsApp/)).toBeTruthy()
    vi.mocked(api.confirmarCambioDeNumero).mockRejectedValueOnce(new TypeError('Failed to fetch'))
    codigo()
    expect(await screen.findByText('Sin conexión. Revisa tu internet y vuelve a intentar.')).toBeTruthy()
    expect((screen.getAllByRole('textbox')[0] as HTMLInputElement).value).toBe('1')
  })

  it('un doble toque en «Enviar código» manda una sola petición', async () => {
    anaAdentro()
    let responder: (r: any) => void = () => {}
    vi.mocked(api.pedirCambioDeNumero).mockImplementationOnce(() => new Promise(ok => { responder = ok }))
    await abrir()
    escribir(screen.getByPlaceholderText('Tu número de teléfono'), '5598765432')
    const boton = screen.getByRole('button', { name: 'Enviar código' })
    fireEvent.click(boton)
    fireEvent.click(boton)
    await act(async () => { responder({ ok: true }) })
    expect(api.pedirCambioDeNumero).toHaveBeenCalledTimes(1)
  })

  it('la confirmación que llega después de «Cerrar sesión» no guarda ni adopta la sesión de reemplazo', async () => {
    anaAdentro()
    let responder: (r: any) => void = () => {}
    vi.mocked(api.confirmarCambioDeNumero).mockImplementationOnce(() => new Promise(ok => { responder = ok }))
    await abrir()
    await pedir()
    codigo()
    await waitFor(() => expect(api.confirmarCambioDeNumero).toHaveBeenCalled())
    await act(async () => { state.clearCustomerSession('testarudo') })
    await act(async () => { responder(NUEVA) })
    expect(leerSesion('testarudo')).toBeNull()
    expect(state.customerToken.value).toBeNull()
    expect(screen.queryByText(/tu número ahora es/)).toBeNull()
  })

  it('con la lada repetida («52 55 9876 5432») se lee y se manda como 55 9876 5432; el «Listo» dice el número que guardó el SERVIDOR', async () => {
    anaAdentro()
    await abrir()
    await pedir('52 55 9876 5432')
    expect(api.pedirCambioDeNumero).toHaveBeenCalledWith('testarudo', 'tok-A', NUEVO, 'reservas')
    expect(screen.getByText(/al 55 9876 5432\./)).toBeTruthy()
    codigo()
    expect(await screen.findByText('Listo: tu número ahora es 55 9876 5432.')).toBeTruthy()
  })

  it('codex-w5w6-r1 #2: el número que se verifica es el que se pidió, aunque lo editen mientras se mandaba', async () => {
    anaAdentro()
    let responder: (r: any) => void = () => {}
    vi.mocked(api.pedirCambioDeNumero).mockImplementationOnce(() => new Promise(ok => { responder = ok }))
    await abrir()
    escribir(screen.getByPlaceholderText('Tu número de teléfono'), '5598765432')
    fireEvent.click(screen.getByRole('button', { name: 'Enviar código' }))
    escribir(screen.getByPlaceholderText('Tu número de teléfono'), '5511112222') // la editó mientras iba
    await act(async () => { responder({ ok: true }) })
    expect(screen.getByText(/al 55 9876 5432\./)).toBeTruthy()
    codigo()
    await waitFor(() => expect(api.confirmarCambioDeNumero).toHaveBeenCalledWith('testarudo', 'tok-A', NUEVO, '123456', 'reservas'))
  })

  it('codex-w5w6-r1 #1: si mientras confirmaba otra pestaña guardó la sesión de otra persona, no la pisa ni la adopta; la página queda sin sesión', async () => {
    anaAdentro()
    let responder: (r: any) => void = () => {}
    vi.mocked(api.confirmarCambioDeNumero).mockImplementationOnce(() => new Promise(ok => { responder = ok }))
    await abrir()
    await pedir()
    codigo()
    await waitFor(() => expect(api.confirmarCambioDeNumero).toHaveBeenCalled())
    // Otra pestaña (no este documento: la época no cambia) entra como Bea.
    guardarSesion('testarudo', { token: 'tok-B', customer: { ...CLIENTE, id: 'c2', firstName: 'Bea' }, contactos: [TEL], guardadaEn: Date.now() })
    await act(async () => { responder(NUEVA) })
    expect(leerSesion('testarudo')?.token).toBe('tok-B')
    expect(state.customerToken.value).toBeNull()
    expect(await screen.findByRole('heading', { name: 'Entra a tu cuenta' })).toBeTruthy()
    expect(screen.queryByText(/tu número ahora es/)).toBeNull()
  })

  it('codex-w5w6-r1 #1: si otra pestaña salió mientras confirmaba, la salida gana: no se guarda la de reemplazo', async () => {
    anaAdentro()
    let responder: (r: any) => void = () => {}
    vi.mocked(api.confirmarCambioDeNumero).mockImplementationOnce(() => new Promise(ok => { responder = ok }))
    await abrir()
    await pedir()
    codigo()
    await waitFor(() => expect(api.confirmarCambioDeNumero).toHaveBeenCalled())
    // «Cerrar sesión» en otra pestaña: borra lo guardado y deja la marca de salida (lo que hace `soltarLaPagina` sin token allá).
    borrarSesion('testarudo')
    registrarSalida('testarudo')
    await act(async () => { responder(NUEVA) })
    expect(leerSesion('testarudo')).toBeNull()
    expect(state.customerToken.value).toBeNull()
    expect(screen.queryByText(/tu número ahora es/)).toBeNull()
  })

  it('codex-w5w6-r2 #1: «Mi cuenta» se relee con la sesión vieja mientras confirma ⇒ su 401 (la vieja ya no vale) no tira el cambio: se guarda y se adopta', async () => {
    anaAdentro()
    let responder: (r: any) => void = () => {}
    vi.mocked(api.confirmarCambioDeNumero).mockImplementationOnce(() => new Promise(ok => { responder = ok }))
    await abrir()
    await pedir()
    codigo()
    await waitFor(() => expect(api.confirmarCambioDeNumero).toHaveBeenCalled())
    // El SERVIDOR ya cambió el número (versión nueva): la relectura al volver a la pestaña recibe 401 y suelta la sesión vieja.
    vi.mocked(api.getCustomerPortal).mockImplementationOnce(async () => {
      throw Object.assign(new Error('Token inválido o expirado'), { status: 401, data: { code: 'CUSTOMER_TOKEN_INVALID' }, enviado: 'tok-A' })
    })
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    await waitFor(() => expect(state.customerToken.value).toBeNull())
    await act(async () => { responder(NUEVA) })
    expect(leerSesion('testarudo')?.token).toBe('tok-N')
    expect(state.customerToken.value).toBe('tok-N')
    expect(await screen.findByText('Listo: tu número ahora es 55 9876 5432.')).toBeTruthy()
  })

  it('codex-w5w6-r2 #1: otra pestaña recibió el 401 de la sesión vieja (borró lo guardado, sin salir) ⇒ la de reemplazo sí se guarda', async () => {
    anaAdentro()
    let responder: (r: any) => void = () => {}
    vi.mocked(api.confirmarCambioDeNumero).mockImplementationOnce(() => new Promise(ok => { responder = ok }))
    await abrir()
    await pedir()
    codigo()
    await waitFor(() => expect(api.confirmarCambioDeNumero).toHaveBeenCalled())
    borrarSesion('testarudo') // el 401 de allá borra lo guardado; no es «Cerrar sesión»
    await act(async () => { responder(NUEVA) })
    expect(leerSesion('testarudo')?.token).toBe('tok-N')
    expect(state.customerToken.value).toBe('tok-N')
  })

  it('codex-w5w6-r2 #1 (tienda): la confirmación que llega con «Mi cuenta» ya cerrada igual queda guardada y la adopta la tienda', async () => {
    const { fijarPagina } = await import('../lib/sesionDeCliente')
    const { desdeUnica } = await import('../order/session')
    const sesion = { token: 'tok-T', customer: CLIENTE, contactos: [TEL], guardadaEn: Date.now() }
    guardarSesion('testarudo', sesion)
    fijarPagina('testarudo', 'pedidos', desdeUnica(sesion))
    let responder: (r: any) => void = () => {}
    vi.mocked(api.confirmarCambioDeNumero).mockImplementationOnce(() => new Promise(ok => { responder = ok }))
    const alEntrar = vi.fn()
    await abrir('es', { superficie: 'pedidos', alEntrar })
    await pedir()
    codigo()
    await waitFor(() => expect(api.confirmarCambioDeNumero).toHaveBeenCalled())
    cleanup() // salió de «Mi cuenta» (la tienda la desmonta)
    await act(async () => { responder(NUEVA) })
    expect(leerSesion('testarudo')?.token).toBe('tok-N')
    expect(alEntrar).toHaveBeenCalledWith(NUEVA)
  })

  it('codex-w5w6-r1 #1: si otra pestaña sólo RENOVÓ su sesión (la misma), la de reemplazo sí se guarda y se adopta', async () => {
    anaAdentro()
    let responder: (r: any) => void = () => {}
    vi.mocked(api.confirmarCambioDeNumero).mockImplementationOnce(() => new Promise(ok => { responder = ok }))
    await abrir()
    await pedir()
    codigo()
    await waitFor(() => expect(api.confirmarCambioDeNumero).toHaveBeenCalled())
    guardarSesion('testarudo', { token: 'tok-A2', customer: CLIENTE, contactos: [TEL], guardadaEn: Date.now() }) // la misma, renovada
    await act(async () => { responder(NUEVA) })
    expect(leerSesion('testarudo')?.token).toBe('tok-N')
    expect(state.customerToken.value).toBe('tok-N')
    expect(await screen.findByText('Listo: tu número ahora es 55 9876 5432.')).toBeTruthy()
  })

  // Un token como los del SERVIDOR: sólo importa su versión (`v`) en la parte del medio.
  const conVersion = (v: number, n: string) => `h.${btoa(JSON.stringify({ v, n })).replace(/=+$/, '')}.f`

  it('codex-w5w6-r3 #1: dos pestañas cambian el número; la respuesta v1 que llega tarde no pisa la v2 ya guardada', async () => {
    guardarSesion('testarudo', { token: conVersion(0, 'a'), customer: CLIENTE, contactos: [TEL], guardadaEn: Date.now() })
    state.entroAqui('testarudo', leerSesion('testarudo')!)
    let responder: (r: any) => void = () => {}
    vi.mocked(api.confirmarCambioDeNumero).mockImplementationOnce(() => new Promise(ok => { responder = ok }))
    await abrir()
    await pedir()
    codigo()
    await waitFor(() => expect(api.confirmarCambioDeNumero).toHaveBeenCalled())
    // En otra pestaña Ana confirmó OTRO cambio después: su sesión v2 es la válida.
    const v2 = conVersion(2, 'b')
    guardarSesion('testarudo', { token: v2, customer: { ...CLIENTE, phone: '+525511112222' }, contactos: [{ ...TEL, valor: '+525511112222' }], guardadaEn: Date.now() })
    await act(async () => { responder({ ...NUEVA, token: conVersion(1, 'n') }) })
    expect(leerSesion('testarudo')?.token).toBe(v2)
    expect(state.customerToken.value).toBeNull()
    expect(screen.queryByText(/tu número ahora es/)).toBeNull()
  })

  it('con versiones de verdad, el caso normal: la de reemplazo (v1) sí pisa a la que la pidió (v0)', async () => {
    guardarSesion('testarudo', { token: conVersion(0, 'a'), customer: CLIENTE, contactos: [TEL], guardadaEn: Date.now() })
    state.entroAqui('testarudo', leerSesion('testarudo')!)
    vi.mocked(api.confirmarCambioDeNumero).mockResolvedValueOnce({ ...NUEVA, token: conVersion(1, 'n') })
    vi.mocked(api.getCustomerPortal).mockResolvedValue(PORTAL({ customer: { ...CLIENTE, phone: NUEVO, loyaltyPoints: 340, totalVisits: 3 } }))
    await abrir()
    await pedir()
    codigo()
    expect(await screen.findByText('Listo: tu número ahora es 55 9876 5432.')).toBeTruthy()
    expect(leerSesion('testarudo')?.token).toBe(conVersion(1, 'n'))
  })

  it('D17: no promete que el código ya salió: «Pedimos tu código por WhatsApp al 55 9876 5432. Si no te llega en un minuto, revisa el número o pide otro.»', async () => {
    anaAdentro()
    await abrir()
    await pedir()
    expect(screen.getByText('Pedimos tu código por WhatsApp al 55 9876 5432. Si no te llega en un minuto, revisa el número o pide otro.')).toBeTruthy()
    expect(screen.queryByText(/Te enviamos/)).toBeNull()
  })

  it('una cuenta sin teléfono no ve «Cambiar mi número»', async () => {
    anaAdentro()
    vi.mocked(api.getCustomerPortal).mockResolvedValue(PORTAL({ customer: { ...CLIENTE, phone: null, email: 'ana@x.mx', loyaltyPoints: 0, totalVisits: 0 } }))
    renderPortal()
    await screen.findByText('Hola, Ana')
    expect(screen.queryByRole('button', { name: 'Cambiar mi número' })).toBeNull()
  })

  it('en inglés', async () => {
    anaAdentro()
    vi.mocked(api.pedirCambioDeNumero).mockRejectedValueOnce(falla(401, 'CUSTOMER_REAUTH_REQUIRED'))
    await abrir('en')
    expect(screen.getByRole('heading', { name: 'Change my number' })).toBeTruthy()
    escribir(screen.getByPlaceholderText('Your phone number'), '5598765432')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send code' })) })
    expect(await screen.findByText('Sign in again to change your number')).toBeTruthy()
  })
})

describe('pulido W8: «Mi cuenta» e «Iniciar sesión» en minúscula también en reservas', () => {
  it('es y en, en mayúscula de oración', () => {
    const es = createT('es')
    const en = createT('en')
    expect([es('portal.title'), es('portal.myAccount'), es('portal.login'), es('portal.loginButton')]).toEqual(['Mi cuenta', 'Mi cuenta', 'Iniciar sesión', 'Iniciar sesión'])
    expect([en('portal.title'), en('portal.myAccount'), en('portal.login'), en('portal.loginButton')]).toEqual(['My account', 'My account', 'Log in', 'Log in'])
  })
})

describe('D655: comprar un paquete desde «Mi cuenta»', () => {
  const PAQUETE = {
    id: 'pk1', name: 'Mega Pack', price: 900, currency: 'MXN', validityDays: 30,
    items: [{ id: 'i1', productId: 'p1', product: { id: 'p1', name: 'Clase', type: 'CLASS', price: 150 }, quantity: 10 }],
  }
  const SIN_TELEFONO = PORTAL({ customer: { ...CLIENTE, email: 'ana@x.com', phone: null, loyaltyPoints: 0, totalVisits: 0 } })

  it('quien entró con Google (sin teléfono) compra con su sesión y no se le inventa un teléfono', async () => {
    anaAdentro()
    vi.mocked(api.getCustomerPortal).mockResolvedValue(SIN_TELEFONO)
    vi.mocked(api.getCreditPacks).mockResolvedValue([PAQUETE] as any)
    vi.mocked(api.createPackCheckout).mockReturnValue(new Promise(() => {})) // se queda yendo a Stripe
    renderPortal()
    fireEvent.click(await screen.findByRole('button', { name: 'Comprar' }))
    await waitFor(() => expect(api.createPackCheckout).toHaveBeenCalled())
    const [slug, packId, body, token] = vi.mocked(api.createPackCheckout).mock.calls[0]
    expect([slug, packId, token]).toEqual(['testarudo', 'pk1', 'tok-A'])
    expect(body).toMatchObject({ email: 'ana@x.com' })
    expect(body.phone).toBeUndefined()
  })

  it('si el pago no se puede preparar, lo dice junto al botón (antes no pasaba nada)', async () => {
    anaAdentro()
    vi.mocked(api.getCustomerPortal).mockResolvedValue(SIN_TELEFONO)
    vi.mocked(api.getCreditPacks).mockResolvedValue([PAQUETE] as any)
    vi.mocked(api.createPackCheckout).mockRejectedValue({ status: 400, data: { message: 'Este negocio aún no tiene pagos en línea configurados para vender paquetes.' } })
    renderPortal()
    fireEvent.click(await screen.findByRole('button', { name: 'Comprar' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Este negocio aún no tiene pagos en línea configurados para vender paquetes.')
    expect((screen.getByRole('button', { name: 'Comprar' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('codex-r1: el aviso de Ana no se le enseña a Bea, que entra después en la misma página', async () => {
    anaAdentro()
    vi.mocked(api.getCustomerPortal).mockResolvedValue(SIN_TELEFONO)
    vi.mocked(api.getCreditPacks).mockResolvedValue([PAQUETE] as any)
    vi.mocked(api.createPackCheckout).mockRejectedValue({ status: 400, data: { message: 'Has alcanzado el limite de 1 compras para este paquete' } })
    renderPortal()
    fireEvent.click(await screen.findByRole('button', { name: 'Comprar' }))
    await screen.findByRole('alert')
    const BEA = { ...CLIENTE, id: 'c2', firstName: 'Bea', phone: '+525599998888' }
    vi.mocked(api.getCustomerPortal).mockResolvedValue(PORTAL({ customer: { ...BEA, loyaltyPoints: 0, totalVisits: 0 } }))
    await act(async () => {
      guardarSesion('testarudo', { token: 'tok-B', customer: BEA, contactos: [TEL], guardadaEn: Date.now() })
      state.entroAqui('testarudo', leerSesion('testarudo')!)
    })
    await screen.findByText('Hola, Bea')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('codex-r2 #1: la respuesta de Ana que llega cuando ya entró Bea no se le enseña a Bea', async () => {
    anaAdentro()
    vi.mocked(api.getCustomerPortal).mockResolvedValue(SIN_TELEFONO)
    vi.mocked(api.getCreditPacks).mockResolvedValue([PAQUETE] as any)
    let rechazar: (e: any) => void = () => {}
    vi.mocked(api.createPackCheckout).mockImplementationOnce(() => new Promise((_, no) => { rechazar = no }))
    renderPortal()
    fireEvent.click(await screen.findByRole('button', { name: 'Comprar' }))
    await waitFor(() => expect(api.createPackCheckout).toHaveBeenCalled())
    const BEA = { ...CLIENTE, id: 'c2', firstName: 'Bea', phone: '+525599998888' }
    vi.mocked(api.getCustomerPortal).mockResolvedValue(PORTAL({ customer: { ...BEA, loyaltyPoints: 0, totalVisits: 0 } }))
    await act(async () => {
      guardarSesion('testarudo', { token: 'tok-B', customer: BEA, contactos: [TEL], guardadaEn: Date.now() })
      state.entroAqui('testarudo', leerSesion('testarudo')!)
    })
    await screen.findByText('Hola, Bea')
    await act(async () => { rechazar({ status: 400, data: { message: 'Has alcanzado el limite de 1 compras para este paquete' } }) })
    await flushAll()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('codex-r2 #2: renovar la sesión de Ana (otro token, misma clienta) no borra su aviso', async () => {
    anaAdentro()
    vi.mocked(api.getCustomerPortal).mockResolvedValue(SIN_TELEFONO)
    vi.mocked(api.getCreditPacks).mockResolvedValue([PAQUETE] as any)
    vi.mocked(api.createPackCheckout).mockRejectedValue({ status: 400, data: { message: 'Has alcanzado el limite de 1 compras para este paquete' } })
    renderPortal()
    fireEvent.click(await screen.findByRole('button', { name: 'Comprar' }))
    await screen.findByRole('alert')
    await act(async () => {
      guardarSesion('testarudo', { token: 'tok-A2', customer: CLIENTE, contactos: [TEL], guardadaEn: Date.now() })
      state.entroAqui('testarudo', leerSesion('testarudo')!)
    })
    await flushAll()
    expect(screen.getByRole('alert').textContent).toBe('Has alcanzado el limite de 1 compras para este paquete')
  })
})

describe('D656: «Comprar» una sola vez, y sólo para quien sigue en sesión', () => {
  const PAQUETE = {
    id: 'pk1', name: 'Mega Pack', price: 900, currency: 'MXN', validityDays: 30,
    items: [{ id: 'i1', productId: 'p1', product: { id: 'p1', name: 'Clase', type: 'CLASS', price: 150 }, quantity: 10 }],
  }
  const BEA = { ...CLIENTE, id: 'c2', firstName: 'Bea', phone: '+525599998888' }
  // La navegación a Stripe se modela con un ancla: el navegador de pruebas sí la sigue y nadie sale de la página.
  beforeEach(() => { window.history.replaceState(null, '', '/') })
  async function anaCompraYEspera() {
    anaAdentro()
    vi.mocked(api.getCustomerPortal).mockResolvedValue(PORTAL())
    vi.mocked(api.getCreditPacks).mockResolvedValue([PAQUETE] as any)
    let resolver: (r: { checkoutUrl: string }) => void = () => {}
    vi.mocked(api.createPackCheckout).mockImplementationOnce(() => new Promise(si => { resolver = si }))
    renderPortal()
    fireEvent.click(await screen.findByRole('button', { name: 'Comprar' }))
    await waitFor(() => expect(api.createPackCheckout).toHaveBeenCalledTimes(1))
    return (r: { checkoutUrl: string }) => act(async () => { resolver(r) })
  }

  it('P2: Ana sale, entra Bea y llega tarde la respuesta EXITOSA de Ana ⇒ no se abre el pago de Ana', async () => {
    const llega = await anaCompraYEspera()
    vi.mocked(api.getCustomerPortal).mockResolvedValue(PORTAL({ customer: { ...BEA, loyaltyPoints: 0, totalVisits: 0 } }))
    await act(async () => {
      guardarSesion('testarudo', { token: 'tok-B', customer: BEA, contactos: [TEL], guardadaEn: Date.now() })
      state.entroAqui('testarudo', leerSesion('testarudo')!)
    })
    await screen.findByText('Hola, Bea')
    await llega({ checkoutUrl: '#pago-de-ana' })
    await flushAll()
    expect(window.location.hash).toBe('')
    expect((screen.getByRole('button', { name: 'Comprar' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('P2: Ana sale y la respuesta exitosa llega con la página sin nadie ⇒ no navega', async () => {
    const llega = await anaCompraYEspera()
    vi.mocked(api.getCustomerPortal).mockReturnValue(new Promise(() => {}))
    await act(async () => { state.clearCustomerSession('testarudo') })
    await llega({ checkoutUrl: '#pago-de-ana' })
    await flushAll()
    expect(window.location.hash).toBe('')
  })

  it('P2: renovar la sesión de Ana (otro token, misma clienta) no cancela su compra: sí va a pagar', async () => {
    const llega = await anaCompraYEspera()
    await act(async () => {
      guardarSesion('testarudo', { token: 'tok-A2', customer: CLIENTE, contactos: [TEL], guardadaEn: Date.now() })
      state.entroAqui('testarudo', leerSesion('testarudo')!)
    })
    await flushAll()
    await llega({ checkoutUrl: '#pago-de-ana' })
    await flushAll()
    expect(window.location.hash).toBe('#pago-de-ana')
  })

  it('P3: dos toques antes de que el botón se repinte ⇒ UNA sola petición de pago', async () => {
    anaAdentro()
    vi.mocked(api.getCustomerPortal).mockResolvedValue(PORTAL())
    vi.mocked(api.getCreditPacks).mockResolvedValue([PAQUETE] as any)
    vi.mocked(api.createPackCheckout).mockReturnValue(new Promise(() => {}))
    renderPortal()
    const boton = await screen.findByRole('button', { name: 'Comprar' })
    await act(async () => { boton.click(); boton.click() })
    await flushAll()
    expect(api.createPackCheckout).toHaveBeenCalledTimes(1)
  })

  it('P3: tras un fallo, el candado se suelta y el segundo toque sí prepara el pago', async () => {
    anaAdentro()
    vi.mocked(api.getCustomerPortal).mockResolvedValue(PORTAL())
    vi.mocked(api.getCreditPacks).mockResolvedValue([PAQUETE] as any)
    vi.mocked(api.createPackCheckout)
      .mockRejectedValueOnce({ status: 400, data: { message: 'Este negocio aún no tiene pagos en línea configurados para vender paquetes.' } })
      .mockResolvedValueOnce({ checkoutUrl: '#pago' })
    renderPortal()
    fireEvent.click(await screen.findByRole('button', { name: 'Comprar' }))
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: 'Comprar' }))
    await waitFor(() => expect(window.location.hash).toBe('#pago'))
    expect(api.createPackCheckout).toHaveBeenCalledTimes(2)
  })

  it('codex-r1 #1: dos «Mi cuenta» en la misma página ⇒ un toque en cada una prepara UN solo pago', async () => {
    anaAdentro()
    vi.mocked(api.getCustomerPortal).mockResolvedValue(PORTAL())
    vi.mocked(api.getCreditPacks).mockResolvedValue([PAQUETE] as any)
    vi.mocked(api.createPackCheckout).mockReturnValue(new Promise(() => {}))
    renderPortal()
    renderPortal()
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Comprar' })).toHaveLength(2))
    const [uno, otro] = screen.getAllByRole('button', { name: 'Comprar' })
    await act(async () => { uno.click(); otro.click() })
    await flushAll()
    expect(api.createPackCheckout).toHaveBeenCalledTimes(1)
  })

  it('codex-r1 #1: cerrar y volver a abrir «Mi cuenta» mientras se prepara el pago no prepara otro', async () => {
    anaAdentro()
    vi.mocked(api.getCustomerPortal).mockResolvedValue(PORTAL())
    vi.mocked(api.getCreditPacks).mockResolvedValue([PAQUETE] as any)
    vi.mocked(api.createPackCheckout).mockReturnValue(new Promise(() => {}))
    const primera = renderPortal()
    fireEvent.click(await screen.findByRole('button', { name: 'Comprar' }))
    await waitFor(() => expect(api.createPackCheckout).toHaveBeenCalledTimes(1))
    primera.unmount()
    renderPortal()
    fireEvent.click(await screen.findByRole('button', { name: 'Comprar' }))
    await flushAll()
    expect(api.createPackCheckout).toHaveBeenCalledTimes(1)
  })
})

describe('D657: sin cobro en línea, «Mi cuenta» no ofrece paquetes', () => {
  const PAQUETE = {
    id: 'pk1', name: 'Mega Pack', price: 900, currency: 'MXN', validityDays: 30,
    items: [{ id: 'i1', productId: 'p1', product: { id: 'p1', name: 'Clase', type: 'CLASS', price: 150 }, quantity: 10 }],
  }
  // Lo que Ana ya tiene: 3 de 10 clases de un paquete comprado antes.
  const CON_CREDITOS = PORTAL({
    credits: { purchases: [{ id: 'cp1', creditPack: { name: 'Paquete 10' }, status: 'ACTIVE', itemBalances: [
      { id: 'b1', productId: 'p1', product: { id: 'p1', name: 'Clase', type: 'CLASS' }, originalQuantity: 10, remainingQuantity: 3 },
    ] }] },
  })
  const negocio = (over: Record<string, unknown>) => { state.venueInfo.value = { slug: 'testarudo', name: 'Testarudo', ...over } as any }
  beforeEach(() => {
    anaAdentro()
    vi.mocked(api.getCustomerPortal).mockResolvedValue(CON_CREDITOS)
    vi.mocked(api.getCreditPacks).mockResolvedValue([PAQUETE] as any)
  })
  // `cobroPorNegocio` vive lo que la página: se deja a «testarudo» sin el dato, como un servidor viejo.
  afterEach(() => { negocio({}); state.venueInfo.value = null })

  it('canCharge false: ni «Comprar» ni la lista (no se pide); sí su saldo y «Contacta al negocio» (antes «Comprar» y un 400)', async () => {
    negocio({ canCharge: false })
    renderPortal()
    await screen.findByText('Hola, Ana')
    // Los efectos de Preact corren tras pintar (hasta ~100 ms sin rAF): se espera a que la carga de paquetes ya hubiera salido.
    await act(() => new Promise(ok => setTimeout(ok, 250)))
    expect(screen.queryByRole('button', { name: 'Comprar' })).toBeNull()
    expect(screen.queryByText('Mega Pack')).toBeNull()
    expect(api.getCreditPacks).not.toHaveBeenCalled()
    expect(screen.getByText('Paquete 10')).toBeTruthy()
    expect(screen.getByText('3/10')).toBeTruthy()
    expect(screen.getByText('No hay paquetes a la venta por ahora. Contacta al negocio.')).toBeTruthy()
  })

  it('canCharge true: «Comprar» como hoy', async () => {
    negocio({ canCharge: true })
    renderPortal()
    expect(await screen.findByRole('button', { name: 'Comprar' })).toBeTruthy()
    expect(screen.getByText('Mega Pack')).toBeTruthy()
  })

  it('servidor viejo sin canCharge: «Comprar» como hoy', async () => {
    negocio({})
    renderPortal()
    expect(await screen.findByRole('button', { name: 'Comprar' })).toBeTruthy()
  })

  it('con «Mi cuenta» abierta, el negocio se relee con canCharge false: «Comprar» se va aunque la lista ya estaba', async () => {
    negocio({ canCharge: true })
    renderPortal()
    await screen.findByRole('button', { name: 'Comprar' })
    await act(async () => { negocio({ canCharge: false }) })
    expect(screen.queryByRole('button', { name: 'Comprar' })).toBeNull()
    expect(screen.getByText('3/10')).toBeTruthy()
  })

  it('con «Mi cuenta» abierta, el negocio ya cobra: se trae la lista y sale «Comprar»', async () => {
    negocio({ canCharge: false })
    renderPortal()
    await screen.findByText('Hola, Ana')
    await act(() => new Promise(ok => setTimeout(ok, 250)))
    expect(api.getCreditPacks).not.toHaveBeenCalled()
    await act(async () => { negocio({ canCharge: true }) })
    expect(await screen.findByRole('button', { name: 'Comprar' })).toBeTruthy()
    expect(api.getCreditPacks).toHaveBeenCalledTimes(1)
  })

  it('codex-r1 #3: la lista todavía viene en camino y llega canCharge false: «Contacta al negocio» al momento, sin girar', async () => {
    vi.mocked(api.getCreditPacks).mockReturnValue(new Promise(() => {}))
    negocio({ canCharge: true })
    renderPortal()
    await screen.findByText('Hola, Ana')
    await waitFor(() => expect(api.getCreditPacks).toHaveBeenCalled())
    await act(async () => { negocio({ canCharge: false }) })
    expect(screen.getByText('No hay paquetes a la venta por ahora. Contacta al negocio.')).toBeTruthy()
  })

  it('codex-r1 #1: el canCharge de OTRO negocio de la misma página no decide: «Comprar» como hoy', async () => {
    negocio({ slug: 'otro-negocio', canCharge: false })
    renderPortal()
    expect(await screen.findByRole('button', { name: 'Comprar' })).toBeTruthy()
  })

  it('codex-r2: otro negocio pisa la señal después (con false o true): el «no cobra» de ESTE negocio se conserva', async () => {
    negocio({ canCharge: false })
    renderPortal()
    await screen.findByText('Hola, Ana')
    await act(async () => { negocio({ slug: 'otro-negocio', canCharge: false }) })
    await act(async () => { negocio({ slug: 'otro-negocio', canCharge: true }) })
    await act(() => new Promise(ok => setTimeout(ok, 250)))
    expect(screen.queryByRole('button', { name: 'Comprar' })).toBeNull()
    expect(api.getCreditPacks).not.toHaveBeenCalled()
    expect(screen.getByText('No hay paquetes a la venta por ahora. Contacta al negocio.')).toBeTruthy()
  })

  it('codex-r3: «Mi cuenta» se desmonta (otro widget carga) y vuelve con la señal del otro negocio: sigue sin «Comprar»', async () => {
    negocio({ canCharge: false })
    renderPortal()
    await screen.findByText('Hola, Ana')
    cleanup() // PortalApp la desmonta mientras carga el otro negocio
    negocio({ slug: 'otro-negocio', canCharge: true })
    renderPortal()
    await screen.findByText('Hola, Ana')
    await act(() => new Promise(ok => setTimeout(ok, 250)))
    expect(screen.queryByRole('button', { name: 'Comprar' })).toBeNull()
    expect(api.getCreditPacks).not.toHaveBeenCalled()
  })
})

describe('D661 ronda 2 #2 (Ruling 55): «Mi cuenta» nunca manda a pagar en caja un pedido con tarjeta, y el dinero sólo cuando es cierto', () => {
  const HOY = '2026-11-11T16:50:00.000Z'
  /** Un pedido pagado en línea con tarjeta, como lo manda el SERVIDOR nuevo. */
  const conTarjeta = (over: Record<string, unknown>) => PEDIDO(1, { folio: 'W7K3P', pagoEnLinea: true, ...over })
  const fila = () => screen.getByText(/^W7K3P · \$/).closest('button') as HTMLElement // la fila de «Mis pedidos» (folio · total)
  async function abrir(pedido: any, extra: Record<string, unknown> = {}) {
    anaAdentro()
    vi.mocked(api.getCustomerPortal).mockResolvedValue(PORTAL({ pedidos: { items: [pedido], total: 1, nextCursor: null } }))
    renderPortal('es', { negocio: 'Flautas', ...extra })
    await screen.findByText('Hola, Ana')
  }
  afterEach(() => vi.useRealTimers())

  it('cada estado en «Mis pedidos»: sus marcas mandan, luego la tarjeta; nunca «Por pagar», «Paga en caja» ni un «PAGADO» incierto', async () => {
    const NUNCA = ['Por pagar', 'Paga en caja para que lo preparen.', 'PAGADO']
    const casos: [string, Record<string, unknown>, string[], string[]][] = [
      ['apartada', { estado: 'PENDING_ACCEPTANCE', pagado: false, tarjeta: 'APARTADA' }, ['En curso', 'Tarjeta apartada'], []],
      ['cobrada', { estado: 'ACCEPTED', pagado: true, tarjeta: 'COBRADA' }, ['Preparando', 'Pagado con tarjeta'], []],
      ['devuelta', { estado: 'COMPLETED', pagado: true, tarjeta: 'COBRADA', refundedAt: HOY, refund: { status: 'DONE', medio: 'TARJETA' } },
        ['Devuelto'], ['Entregado', 'Pagado con tarjeta']],
      ['regresada por el banco', { estado: 'COMPLETED', pagado: true, tarjeta: 'COBRADA', refundedAt: HOY, refund: { status: 'REVERSED', medio: 'TARJETA' } },
        ['Tu banco regresó la devolución: Flautas todavía te la debe.'], ['Devuelto', 'Entregado', 'Pagado con tarjeta']],
      ['devolviéndose', { estado: 'ACCEPTED', pagado: true, tarjeta: 'COBRADA', refundRequestedAt: HOY }, ['Devolviendo…'], ['Preparando', 'Pagado con tarjeta']],
      ['no la recogió', { estado: 'COMPLETED', pagado: true, tarjeta: 'COBRADA', notPickedUpAt: HOY }, ['No lo recogiste'], ['Entregado', 'Pagado con tarjeta']],
      // Liberándose, liberada, en duda o un valor nuevo: su estado sin dinero (el seguimiento dice el resto).
      ['liberándose', { estado: 'PENDING_ACCEPTANCE', pagado: false, tarjeta: 'LIBERANDO' }, ['En curso'], ['Pagado con tarjeta', 'Tarjeta apartada']],
      ['liberada', { estado: 'EXPIRED', pagado: false, tarjeta: 'LIBERADA' }, ['Vencido'], ['Pagado con tarjeta']],
      ['en duda', { estado: 'ACCEPTED', pagado: true, tarjeta: null }, ['Preparando'], ['Pagado con tarjeta']],
    ]
    for (const [caso, over, salen, noSalen] of casos) {
      cuentasNuevasParaPruebas()
      const onVerPedido = vi.fn()
      await abrir(conTarjeta(over), { onVerPedido })
      for (const texto of salen) expect(within(fila()).getByText(texto), `${caso}: ${texto}`).toBeTruthy()
      for (const texto of [...NUNCA, ...noSalen]) expect(within(fila()).queryByText(texto), `${caso}: ${texto}`).toBeNull()
      fireEvent.click(fila()) // y la liga a su seguimiento, como siempre
      expect(onVerPedido, caso).toHaveBeenCalledWith('tt-1')
      cleanup()
    }
  })

  it('ronda 3: con su devolución en la lista (también en «Mi equipo», sin las marcas de «Nadie») no dice «Pagado con tarjeta»: dice cómo va', async () => {
    // Ronda 4 (Ruling 55, texto enmendado): la de «Mi equipo» puede ser parcial y la lista no trae el monto: nunca «Te devolvieron tu pago».
    const casos: [string, Record<string, unknown>, string][] = [
      ['hecha', { estado: 'COMPLETED', pagado: true, tarjeta: 'COBRADA', refund: { status: 'DONE', medio: 'TARJETA' } }, 'Te hicieron una devolución'],
      ['registrada', { estado: 'CANCELLED_BY_STAFF', pagado: true, tarjeta: 'COBRADA', refund: { status: 'RECORDED', medio: 'EFECTIVO' } }, 'Te hicieron una devolución'],
      ['en camino', { estado: 'CANCELLED_BY_STAFF', pagado: true, tarjeta: 'COBRADA', refund: { status: 'PENDING', medio: 'TARJETA' } }, 'Devolviendo…'],
      ['regresada por el banco', { estado: 'COMPLETED', pagado: true, tarjeta: 'COBRADA', refund: { status: 'REVERSED', medio: 'TARJETA' } },
        'Tu banco regresó la devolución: Flautas todavía te la debe.'],
    ]
    for (const [caso, over, texto] of casos) {
      cuentasNuevasParaPruebas()
      await abrir(conTarjeta(over))
      expect(within(fila()).getByText(texto), caso).toBeTruthy()
      for (const nunca of ['Pagado con tarjeta', 'PAGADO', 'Entregado', 'Cancelado'])
        expect(within(fila()).queryByText(nunca), `${caso}: ${nunca}`).toBeNull()
      cleanup()
    }
  })

  it('«Tu pedido de hoy» con la tarjeta apartada: «en curso» y la tarjeta, nunca «Paga en caja»', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-11T17:00:00.000Z'))
    await abrir(conTarjeta({ estado: 'PENDING_ACCEPTANCE', pagado: false, tarjeta: 'APARTADA', creadoEl: HOY }))
    expect(screen.getByText('Tu pedido de hoy')).toBeTruthy()
    expect(screen.getByText('W7K3P · en curso')).toBeTruthy()
    expect(screen.getAllByText('Tarjeta apartada').length).toBeGreaterThan(0)
    expect(screen.queryByText('Paga en caja para que lo preparen.')).toBeNull()
    expect(screen.queryByText(/por pagar/i)).toBeNull()
    cleanup()
    cuentasNuevasParaPruebas()
    // El de este aparato (la línea de su seguimiento) también dice «en curso» si la cuenta dice que es con tarjeta.
    await abrir(conTarjeta({ estado: 'PENDING_ACCEPTANCE', pagado: false, tarjeta: 'APARTADA', creadoEl: HOY, trackingToken: 'mio' }), {
      pedidoDeHoy: { folio: 'W7K3P', estado: 'PENDING_ACCEPTANCE', pagado: false, linea: 'Tu pedido está en curso.', trackingToken: 'mio' },
    })
    expect(screen.getByText('W7K3P · en curso')).toBeTruthy()
    expect(screen.getByText('Tu pedido está en curso.')).toBeTruthy()
  })

  it('pasada por familias (Ruling 86): la tarjeta apartada dice sólo «Tarjeta apartada», nunca cuándo se cobra (la respuesta no lo prueba)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-11T17:00:00.000Z'))
    // Los tres llegan IGUALES del SERVIDOR (`PENDING_ACCEPTANCE` + `APARTADA`; un cobro en curso, `CONFIRMING`, se publica como apartada):
    // la cuenta no puede saber si alguien ya lo abrió, si falta que lo acepten o si ya se está cobrando.
    for (const caso of ['«Mi equipo»: una cajera lo abrió y todavía no lo acepta', '«Nadie»: ninguna caja lo ha abierto', '«Nadie»: una caja lo abrió y Stripe está cobrando']) {
      cuentasNuevasParaPruebas()
      await abrir(conTarjeta({ estado: 'PENDING_ACCEPTANCE', pagado: false, tarjeta: 'APARTADA', creadoEl: HOY }))
      expect(within(fila()).getByText('Tarjeta apartada'), caso).toBeTruthy()
      expect(screen.getAllByText('Tarjeta apartada'), caso).toHaveLength(2) // la fila y «Tu pedido de hoy»
      expect(screen.queryByText(/se cobra|cuando lo abran|cuando (el negocio )?acepte/), caso).toBeNull()
      cleanup()
    }
  })

  describe('pasada por familias (Ruling 85): «Mi cuenta» relee sola una devolución a la vista, como el seguimiento', () => {
    let visible = true
    beforeEach(() => {
      visible = true
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (visible ? 'visible' : 'hidden') })
    })
    afterEach(() => { delete (document as any).visibilityState })
    const conPedido = (p: any) => PORTAL({ pedidos: { items: [p], total: 1, nextCursor: null } })
    const pasan = async (min: number) => {
      await act(async () => { vi.advanceTimersByTime(min * 60_000) })
      await flushAll()
    }
    async function abrirConReloj(primero: any, despues: any) {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-11-11T17:00:00.000Z')) // 11:00 en CDMX
      anaAdentro()
      vi.mocked(api.getCustomerPortal).mockResolvedValueOnce(conPedido(primero)).mockResolvedValue(conPedido(despues))
      renderPortal('es', { negocio: 'Flautas' })
      await flushAll()
    }

    it('sólo la cuenta a la vista: la devolución pasa de hecha a regresada por el banco y se ve en la siguiente relectura (10 min), con su hora', async () => {
      const REGRESADA = 'Tu banco regresó la devolución: Flautas todavía te la debe.'
      for (const [caso, hecha, marca] of [
        ['«Nadie», «Devuelto»', { estado: 'COMPLETED', pagado: true, tarjeta: 'COBRADA', refundedAt: HOY, refund: { status: 'DONE', medio: 'TARJETA' } }, 'Devuelto'],
        ['«Mi equipo», «Te hicieron una devolución»', { estado: 'COMPLETED', pagado: true, tarjeta: 'COBRADA', refund: { status: 'DONE', medio: 'TARJETA' } }, 'Te hicieron una devolución'],
      ] as const) {
        cuentasNuevasParaPruebas()
        const antes = conTarjeta(hecha)
        await abrirConReloj(antes, { ...antes, refund: { status: 'REVERSED', medio: 'TARJETA' } })
        expect(within(fila()).getByText(marca), caso).toBeTruthy()
        await pasan(9)
        expect(api.getCustomerPortal, caso).toHaveBeenCalledTimes(1)
        await pasan(1)
        expect(api.getCustomerPortal, caso).toHaveBeenCalledTimes(2)
        expect(within(fila()).getByText(REGRESADA), caso).toBeTruthy()
        expect(screen.getByText('Actualizado a las 11:10'), caso).toBeTruthy() // la hora de la última lectura buena
        cleanup()
        vi.mocked(api.getCustomerPortal).mockReset()
        vi.useRealTimers()
      }
    })

    it('limpieza final (2): la relectura sola no encoge «Ver más»: trae otra vez esas filas, y una devolución de ahí también se relee', async () => {
      const REGRESADA = 'Tu banco regresó la devolución: Flautas todavía te la debe.'
      const primera = Array.from({ length: 20 }, (_, i) => conTarjeta({
        folio: `W${String(i + 1).padStart(4, '0')}`, trackingToken: `tt-${i + 1}`, estado: 'COMPLETED', pagado: true, tarjeta: 'COBRADA',
      }))
      const devuelto = conTarjeta({
        folio: 'W0021', trackingToken: 'tt-21', estado: 'COMPLETED', pagado: true, tarjeta: 'COBRADA', refundedAt: HOY, refund: { status: 'DONE', medio: 'TARJETA' },
      })
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-11-11T17:00:00.000Z'))
      anaAdentro()
      vi.mocked(api.getCustomerPortal).mockResolvedValue(PORTAL({ pedidos: { items: primera, total: 21, nextCursor: 'cur-p' } }))
      vi.mocked(api.listarMisPedidos)
        .mockResolvedValueOnce({ items: [devuelto], total: 21, nextCursor: null })
        .mockResolvedValue({ items: [{ ...devuelto, refund: { status: 'REVERSED', medio: 'TARJETA' } }], total: 21, nextCursor: null })
      renderPortal('es', { negocio: 'Flautas' })
      await flushAll()
      fireEvent.click(screen.getByRole('button', { name: 'Ver más pedidos' }))
      await flushAll()
      const fila21 = () => screen.getByText(/^W0021 · \$/).closest('button') as HTMLElement
      expect(within(fila21()).getByText('Devuelto')).toBeTruthy()
      await pasan(10)
      expect(api.getCustomerPortal).toHaveBeenCalledTimes(2)
      expect(screen.getAllByRole('button', { name: /^W00\d\d · \$/ })).toHaveLength(21) // no se encogió
      expect(api.listarMisPedidos).toHaveBeenCalledTimes(2) // la página de «Ver más», otra vez, desde el cursor de la lectura nueva
      expect(vi.mocked(api.listarMisPedidos).mock.lastCall).toEqual(['testarudo', 'tok-A', 'cur-p', 'reservas'])
      expect(within(fila21()).getByText(REGRESADA)).toBeTruthy() // y su devolución se releyó
      expect(screen.getByText('Actualizado a las 11:10')).toBeTruthy()
      await pasan(10) // y sigue vigilando (la fila de «Ver más» no se cayó)
      expect(api.getCustomerPortal).toHaveBeenCalledTimes(3)
    })

    it('ajuste final (Ruling 112): mientras la página de «Ver más» no llega, sus filas conservan la hora de lo que enseñan', async () => {
      const REGRESADA = 'Tu banco regresó la devolución: Flautas todavía te la debe.'
      const primera = Array.from({ length: 20 }, (_, i) => conTarjeta({
        folio: `W${String(i + 1).padStart(4, '0')}`, trackingToken: `tt-${i + 1}`, estado: 'COMPLETED', pagado: true, tarjeta: 'COBRADA',
      }))
      const devuelto = conTarjeta({
        folio: 'W0021', trackingToken: 'tt-21', estado: 'COMPLETED', pagado: true, tarjeta: 'COBRADA', refundedAt: HOY, refund: { status: 'DONE', medio: 'TARJETA' },
      })
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-11-11T17:00:00.000Z'))
      anaAdentro()
      vi.mocked(api.getCustomerPortal).mockResolvedValue(PORTAL({ pedidos: { items: primera, total: 21, nextCursor: 'cur-p' } }))
      let llega!: (v: unknown) => void
      vi.mocked(api.listarMisPedidos)
        .mockResolvedValueOnce({ items: [devuelto], total: 21, nextCursor: null })
        .mockImplementationOnce(() => new Promise(r => { llega = r }) as any)
      renderPortal('es', { negocio: 'Flautas' })
      await flushAll()
      fireEvent.click(screen.getByRole('button', { name: 'Ver más pedidos' }))
      await flushAll()
      const fila21 = () => screen.getByText(/^W0021 · \$/).closest('button') as HTMLElement
      await pasan(10) // la primera página llegó; la de «Ver más» todavía no
      expect(api.getCustomerPortal).toHaveBeenCalledTimes(2)
      expect(within(fila21()).getByText('Devuelto')).toBeTruthy() // lo que se sabía a las 11:00…
      expect(screen.getByText('Actualizado a las 11:00')).toBeTruthy() // …con su hora, no la de la primera página
      expect(screen.queryByText('Actualizado a las 11:10')).toBeNull()
      await act(async () => { llega({ items: [{ ...devuelto, refund: { status: 'REVERSED', medio: 'TARJETA' } }], total: 21, nextCursor: null }) })
      await flushAll()
      expect(within(fila21()).getByText(REGRESADA)).toBeTruthy()
      expect(screen.getByText('Actualizado a las 11:10')).toBeTruthy() // ya con sus filas nuevas
    })

    it('con la pestaña oculta no relee (al volver, sí); a las 24 h deja de releer sola; sin devolución, nunca', async () => {
      const devuelto = conTarjeta({ estado: 'COMPLETED', pagado: true, tarjeta: 'COBRADA', refundedAt: HOY, refund: { status: 'DONE', medio: 'TARJETA' } })
      await abrirConReloj(devuelto, devuelto)
      visible = false
      await pasan(30)
      expect(api.getCustomerPortal).toHaveBeenCalledTimes(1)
      visible = true
      await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
      await flushAll()
      expect(api.getCustomerPortal).toHaveBeenCalledTimes(2)
      for (let i = 0; i < 6 * 24; i++) await pasan(10) // hasta pasar las 24 h desde que la vio
      const tope = vi.mocked(api.getCustomerPortal).mock.calls.length
      expect(tope).toBeLessThanOrEqual(2 + 6 * 24)
      await pasan(60)
      expect(api.getCustomerPortal).toHaveBeenCalledTimes(tope)
      cleanup()
      cuentasNuevasParaPruebas()
      vi.mocked(api.getCustomerPortal).mockReset()
      const cobrado = conTarjeta({ estado: 'ACCEPTED', pagado: true, tarjeta: 'COBRADA' })
      await abrirConReloj(cobrado, cobrado)
      await pasan(60)
      expect(api.getCustomerPortal).toHaveBeenCalledTimes(1)
      expect(screen.queryByText(/^Actualizado a las/)).toBeNull()
    })

    it('en inglés', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-11-11T17:00:00.000Z'))
      anaAdentro()
      vi.mocked(api.getCustomerPortal).mockResolvedValue(conPedido(conTarjeta({
        estado: 'COMPLETED', pagado: true, tarjeta: 'COBRADA', refundedAt: HOY, refund: { status: 'DONE', medio: 'TARJETA' },
      })))
      renderPortal('en', { negocio: 'Flautas' })
      await flushAll()
      expect(screen.getByText('Updated at 11:00 AM')).toBeTruthy()
    })
  })

  it('un servidor viejo (sin `pagoEnLinea` ni las marcas) pinta como hoy: «Por pagar», «Paga en caja…» y «PAGADO»', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-11T17:00:00.000Z'))
    await abrir(PEDIDO(1, { folio: 'W7K3P', estado: 'PENDING_ACCEPTANCE', pagado: false, creadoEl: HOY }))
    expect(screen.getByText('W7K3P · por pagar')).toBeTruthy()
    expect(screen.getByText('Paga en caja para que lo preparen.')).toBeTruthy()
    expect(within(fila()).getByText('Por pagar')).toBeTruthy()
    cleanup()
    cuentasNuevasParaPruebas()
    await abrir(PEDIDO(1, { folio: 'W7K3P' })) // COMPLETED y pagado
    expect(within(fila()).getByText('Entregado')).toBeTruthy()
    expect(within(fila()).getByText('PAGADO')).toBeTruthy()
  })

  it('en inglés', async () => {
    anaAdentro()
    vi.mocked(api.getCustomerPortal).mockResolvedValue(PORTAL({
      pedidos: { items: [conTarjeta({ estado: 'PENDING_ACCEPTANCE', pagado: false, tarjeta: 'APARTADA' })], total: 1, nextCursor: null },
    }))
    renderPortal('en', { negocio: 'Flautas' })
    await screen.findByText('Hello, Ana')
    expect(within(fila()).getByText('Card on hold')).toBeTruthy() // Ruling 86: nunca cuándo se cobra
    // Ronda 4: una devolución hecha (quizá parcial) también es cierta en inglés.
    cleanup()
    cuentasNuevasParaPruebas()
    anaAdentro()
    vi.mocked(api.getCustomerPortal).mockResolvedValue(PORTAL({
      pedidos: { items: [conTarjeta({ estado: 'COMPLETED', pagado: true, tarjeta: 'COBRADA', refund: { status: 'DONE', medio: 'TARJETA' } })], total: 1, nextCursor: null },
    }))
    renderPortal('en', { negocio: 'Flautas' })
    await screen.findByText('Hello, Ana')
    expect(within(fila()).getByText('You got a refund')).toBeTruthy()
  })
})
