import { h } from 'preact'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
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
    pedirCambioDeNumero: vi.fn(), confirmarCambioDeNumero: vi.fn(),
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
