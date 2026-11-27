import { h } from 'preact'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BookingFlow } from './BookingFlow'
import * as api from '../api/booking'
import * as state from '../state/booking'
import { borrarSesion, fijarPagina, guardarSesion, leerSesion } from '../lib/sesionDeCliente'
import { resolveDepositReturn, savePendingReservation } from '../lib/depositReturn'
import type { CustomerCreditBalance, MiReservaDeClase, PublicVenueInfo, PublicReservationDetail, WidgetProps } from '../types'

vi.mock('../api/booking', () => ({
  getVenueInfo: vi.fn(), getCreditPacks: vi.fn(), getReservation: vi.fn(),
  getAvailability: vi.fn(), getClassSessionsRange: vi.fn(), createReservation: vi.fn(), createHold: vi.fn(), cancelHold: vi.fn(),
  getCustomerCredits: vi.fn(), getCustomerPortal: vi.fn(), createPackCheckout: vi.fn(), getMisReservasDeClase: vi.fn(),
  esAndroid: () => false, // D656: «Mi cuenta» lo lee al pintarse
}))
// «Entra a tu cuenta» de verdad pide un código o Google; aquí sólo importa que, al entrar, guarde la sesión y avise (como el real).
vi.mock('./EntrarConCuenta', async () => {
  const { h: hh } = await import('preact')
  const ses = await import('../lib/sesionDeCliente')
  return {
    EntrarConCuenta: (p: { slug: string; onEntro: (s: any) => void }) => (((globalThis as any).__onEntro = p.onEntro), hh('div', null,
      hh('h2', null, 'Entra a tu cuenta'),
      hh('button', {
        type: 'button',
        onClick: () => {
          const e = (globalThis as any).__entradaDePrueba
          ses.guardarSesion(p.slug, { ...e, guardadaEn: Date.now() })
          p.onEntro(e)
        },
      }, 'Simular entrar'),
    )),
  }
})
const venue: PublicVenueInfo = {
  slug: 'studio-a', name: 'Studio A', type: 'SALON', logo: null, address: null, phone: null,
  timezone: 'America/Mexico_City', canCharge: false,
  products: [{ id: 'service-a', name: 'Servicio propio', price: 500, duration: 60, eventCapacity: null, type: 'APPOINTMENTS_SERVICE', upfrontPolicy: 'required' }],
  publicBooking: { enabled: true, requireEmail: false, requirePhone: true },
}
const detail: PublicReservationDetail = {
  confirmationCode: 'OWN-A', status: 'CONFIRMED', startsAt: '2026-10-08T16:00:00Z', endsAt: '2026-10-08T17:00:00Z',
  duration: 60, partySize: 1, guestName: 'Ana', product: null, assignedStaff: null, table: null,
  specialRequests: null, depositAmount: 500, depositStatus: 'PAID',
}
const saved = { venue: 'studio-a', cancelSecret: 'stored-a', confirmationCode: 'OWN-A' }
function props(slug = 'studio-a', locale: 'en' | 'es' = 'es'): WidgetProps {
  return { venue: slug, locale, theme: 'light', mode: 'inline', flowType: 'appointments', hostElement: document.createElement('div') }
}
async function flush() { for (let i = 0; i < 4; i++) await act(async () => { for (let j = 0; j < 8; j++) await Promise.resolve() }) }
async function advance(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
function resetSignals() {
  state.resetBooking(venue); state.venueInfo.value = null; state.step.value = 0
  state.isLoading.value = false; state.apiError.value = null; state.manageSecret.value = null
  state.creditPacks.value = []; state.creditPacksLoaded.value = false; state.creditPacksLoading.value = false
  state.customerInfo.value = null; state.customerToken.value = null; state.portalData.value = null
  state.bookingAccess.value = null; state.showPortal.value = false; state.toastMessage.value = null
  state.branding.value = state.DEFAULT_BRANDING; state.flowType.value = 'unified'
  state.comprandoPaquete.clear() // D656: una compra que una prueba dejó colgada no frena a la siguiente
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-06T18:00:00Z')); vi.resetAllMocks()
  sessionStorage.clear(); localStorage.clear(); window.history.replaceState({}, '', '/studio-a/appointments'); resetSignals()
  vi.mocked(api.getVenueInfo).mockImplementation(async slug => ({ ...venue, slug, name: slug === 'studio-a' ? 'Studio A' : 'Studio B' }))
  vi.mocked(api.getCreditPacks).mockResolvedValue([]); vi.mocked(api.getReservation).mockResolvedValue(detail)
  vi.mocked(api.getAvailability).mockResolvedValue({ date: '2026-10-08',
    slots: [{ startsAt: detail.startsAt, endsAt: detail.endsAt, available: true }] })
  vi.mocked(api.createHold).mockRejectedValue(Object.assign(new Error('not deployed'), { status: 404 }))
  vi.mocked(api.createReservation).mockResolvedValue({ confirmationCode: 'NEW-A', cancelSecret: 'new-a',
    startsAt: detail.startsAt, endsAt: detail.endsAt, status: 'PENDING', depositRequired: true, depositAmount: 500,
    // Hash navigation models the browser handoff without contacting a provider.
    checkoutUrl: '#provider',
  })
})

async function openAppointmentForm(widgetProps = props()) {
  render(<BookingFlow props={widgetProps} />); await flush()
  fireEvent.click(screen.getByRole('button', { name: '8 de octubre de 2026' })); await flush()
  fireEvent.click(screen.getByRole('button', { name: /10:00/ })); await flush()
}

describe('BookingFlow booking repair', () => {
  it.each(['_avq_show_account', '_avq_show_manage'])('blocks the hosted %s event until the reservation POST resolves', async event => {
    let reject!: (reason: unknown) => void
    vi.mocked(api.createReservation).mockImplementationOnce(() => new Promise((_, fail) => { reject = fail }))
    const widgetProps = props()
    await openAppointmentForm(widgetProps)
    const name = screen.getByLabelText(/Nombre/) as HTMLInputElement
    fireEvent.input(name, { target: { value: 'Ana Hospedada' } })
    fireEvent.input(screen.getByLabelText(/Teléfono/), { target: { value: '5512345678' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reserva cita' })); await flush()
    try {
      await act(async () => { widgetProps.hostElement!.dispatchEvent(new CustomEvent(event, { detail: { cancelSecret: 'external-a' } })) }); await flush()
      expect(state.showPortal.value).toBe(false)
      expect(state.manageSecret.value).toBeNull()
      expect(screen.getByLabelText(/Nombre/)).toBe(name)
      expect(api.cancelHold).not.toHaveBeenCalled()
      expect(api.getReservation).not.toHaveBeenCalled()
      await act(async () => reject({ status: 400, data: { message: 'Corrige la reserva hospedada' } })); await flush()
      expect(screen.getByRole('alert').textContent).toContain('Corrige la reserva hospedada')
      expect(name.value).toBe('Ana Hospedada')
      expect(api.createReservation).toHaveBeenCalledTimes(1)
      await act(async () => { widgetProps.hostElement!.dispatchEvent(new CustomEvent(event, { detail: { cancelSecret: 'external-a' } })) }); await flush()
      if (event === '_avq_show_account') expect(state.showPortal.value).toBe(true)
      else expect(state.manageSecret.value).toBe('external-a')
    } finally {
      await act(async () => reject({ status: 400, data: { message: 'Fin del caso' } })); await flush()
    }
  })

  it.each(['_avq_show_account', '_avq_show_manage'])('blocks the hosted %s event during expiration-owned hold release', async event => {
    vi.mocked(api.createHold).mockResolvedValueOnce({ holdId: 'host-expiring', expiresAt: new Date(Date.now() + 2000).toISOString(), ttlSeconds: 2 })
    let release!: () => void
    vi.mocked(api.cancelHold).mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    const widgetProps = props()
    await openAppointmentForm(widgetProps)
    try {
      await advance(2000); await flush()
      await act(async () => { widgetProps.hostElement!.dispatchEvent(new CustomEvent(event, { detail: { cancelSecret: 'external-a' } })) }); await flush()
      expect(state.showPortal.value).toBe(false)
      expect(state.manageSecret.value).toBeNull()
      expect(state.selectedSlot.value).not.toBeNull()
      expect(api.cancelHold).toHaveBeenCalledTimes(1)
      expect(api.getReservation).not.toHaveBeenCalled()
      await act(async () => release()); await flush()
      expect(state.selectedSlot.value).toBeNull()
      await act(async () => { widgetProps.hostElement!.dispatchEvent(new CustomEvent(event, { detail: { cancelSecret: 'external-a' } })) }); await flush()
      if (event === '_avq_show_account') expect(state.showPortal.value).toBe(true)
      else expect(state.manageSecret.value).toBe('external-a')
      expect(api.createReservation).not.toHaveBeenCalled()
    } finally {
      if (release) { await act(async () => release()); await flush() }
    }
  })

  it('preserves fields written without submitting when an appointment hold expires', async () => {
    vi.mocked(api.createHold).mockResolvedValueOnce({ holdId: 'draft-expiring', expiresAt: new Date(Date.now() + 2000).toISOString(), ttlSeconds: 2 })
    vi.mocked(api.cancelHold).mockResolvedValue(undefined)
    await openAppointmentForm()
    fireEvent.input(screen.getByLabelText(/Nombre/), { target: { value: 'Ana Sin Enviar' } })
    fireEvent.input(screen.getByLabelText(/Teléfono/), { target: { value: '5512345678' } })
    fireEvent.input(screen.getByLabelText(/Correo/), { target: { value: 'correo-incompleto' } })
    fireEvent.input(screen.getByLabelText(/Peticiones/), { target: { value: 'Necesito acceso' } })
    await advance(2000); await flush()
    expect(state.selectedSlot.value).toBeNull()
    expect(api.createReservation).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /10:00/ })); await flush()
    expect((screen.getByLabelText(/Nombre/) as HTMLInputElement).value).toBe('Ana Sin Enviar')
    expect((screen.getByLabelText(/Teléfono/) as HTMLInputElement).value).toBe('5512345678')
    expect((screen.getByLabelText(/Correo/) as HTMLInputElement).value).toBe('correo-incompleto')
    expect((screen.getByLabelText(/Peticiones/) as HTMLTextAreaElement).value).toBe('Necesito acceso')
    fireEvent.click(screen.getByRole('button', { name: 'Reserva cita' })); await flush()
    expect(api.createReservation).not.toHaveBeenCalled()
    fireEvent.input(screen.getByLabelText(/Correo/), { target: { value: 'ana@example.test' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reserva cita' })); await flush()
    expect(api.createReservation).toHaveBeenCalledTimes(1)
    expect(vi.mocked(api.createReservation).mock.calls[0][1]).toMatchObject({ guestName: 'Ana Sin Enviar', guestEmail: 'ana@example.test' })
  })

  it('Task 13: una clase no se aparta ni vence (sin reloj): pasados 10 min, la confirmación sigue con lo escrito, sin apartado ni POST', async () => {
    vi.mocked(api.getVenueInfo).mockResolvedValue({ ...venue, products: [{ ...venue.products[0], id: 'class-a', name: 'Clase propia', type: 'CLASS' }] })
    vi.mocked(api.getClassSessionsRange).mockResolvedValue({ dateFrom: '2026-10-06', dateTo: '2026-11-05', slots: [{
      startsAt: '2026-10-08T17:00:00Z', endsAt: '2026-10-08T18:00:00Z', available: true,
      classSessionId: 'session-draft', productId: 'class-a', productName: 'Clase propia', remaining: 8, capacity: 10, enrolled: 2,
    }] })
    window.history.replaceState({}, '', '/studio-a/classes')
    render(<BookingFlow props={{ ...props(), flowType: 'classes' }} />); await flush()
    fireEvent.click(screen.getByRole('button', { name: /Clase propia.*11:00/ })); await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Reservar' })); await flush()
    fireEvent.input(screen.getByLabelText(/Nombre/), { target: { value: 'Ana Clase' } })
    fireEvent.input(screen.getByLabelText(/Teléfono/), { target: { value: '5512345678' } })
    fireEvent.click(screen.getByRole('button', { name: 'Agregar una nota para tu coach' }))
    fireEvent.input(screen.getByLabelText(/Algo que tu coach deba saber/), { target: { value: 'Clase sin perder borrador' } })
    expect(document.body.textContent).not.toMatch(/reservada durante/)
    await advance(601000); await flush()
    expect(state.selectedSlot.value?.classSessionId).toBe('session-draft')
    expect(state.slotHoldExpiresAt.value).toBeNull()
    expect((screen.getByLabelText(/Nombre/) as HTMLInputElement).value).toBe('Ana Clase')
    expect((screen.getByLabelText(/Teléfono/) as HTMLInputElement).value).toBe('5512345678')
    expect((screen.getByLabelText(/Algo que tu coach deba saber/) as HTMLTextAreaElement).value).toBe('Clase sin perder borrador')
    expect(api.createHold).not.toHaveBeenCalled()
    expect(api.cancelHold).not.toHaveBeenCalled()
    expect(api.createReservation).not.toHaveBeenCalled()
  })

  it('alcance A: una sesión que entró en otra pestaña no cambia la pestaña abierta ni reserva sola (se toma al recargar)', async () => {
    vi.mocked(api.getVenueInfo).mockResolvedValue({ ...venue, products: [{ ...venue.products[0], id: 'class-a', name: 'Clase propia', type: 'CLASS' }] })
    vi.mocked(api.getClassSessionsRange).mockResolvedValue({ dateFrom: '2026-10-06', dateTo: '2026-11-05', slots: [{
      startsAt: '2026-10-08T17:00:00Z', endsAt: '2026-10-08T18:00:00Z', available: true,
      classSessionId: 'session-otra', productId: 'class-a', productName: 'Clase propia', remaining: 8, capacity: 10, enrolled: 2,
    }] })
    vi.mocked(api.getCustomerCredits).mockResolvedValue({ purchases: [] } as any)
    vi.mocked(api.getCustomerPortal).mockReturnValue(new Promise(() => {}))
    window.history.replaceState({}, '', '/studio-a/classes')
    state.bindCustomerSessionToVenue('studio-a')
    render(<BookingFlow props={{ ...props(), flowType: 'classes' }} />); await flush()
    fireEvent.click(screen.getByRole('button', { name: /Clase propia.*11:00/ })); await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Reservar' })); await flush()
    guardarSesion('studio-a', {
      token: 'tok-otra', customer: { id: 'c9', firstName: 'Bea', lastName: null, email: 'bea@correo.mx', phone: '5511112222' },
      contactos: [{ tipo: 'PHONE', valor: '+525511112222', metodo: 'WHATSAPP', probadoEn: 1 }], guardadaEn: Date.now(),
    })
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) }); await flush()
    expect(state.customerInfo.value).toBeNull()
    expect(api.createReservation).not.toHaveBeenCalled()
    state.clearCustomerSession('studio-a')
  })

  it('alcance A (1): la sesión de la pestaña dejó de valer a media reserva ⇒ 401, «sin sesión» con calma, sin rojo, sin perder lo escrito ni reintentar', async () => {
    guardarSesion('studio-a', {
      token: 'tok-ana', customer: { id: 'c1', firstName: 'Ana', lastName: 'Ruiz', email: null, phone: '5512345678' },
      contactos: [{ tipo: 'PHONE', valor: '+525512345678', metodo: 'WHATSAPP', probadoEn: 1 }], guardadaEn: Date.now(),
    })
    state.bindCustomerSessionToVenue('studio-a')
    state.entroAqui('studio-a', leerSesion('studio-a')!) // la pestaña abrió con la sesión de Ana
    expect(state.customerToken.value).toBe('tok-ana')
    vi.mocked(api.getCustomerCredits).mockResolvedValue({ purchases: [] } as any)
    vi.mocked(api.getCustomerPortal).mockReturnValue(new Promise(() => {}))
    vi.mocked(api.createReservation).mockImplementationOnce(async () => {
      // Lo que hace `request` cuando otra pestaña salió o el SERVIDOR la rechazó: la página queda sin sesión.
      state.clearCustomerSession('studio-a', 'tok-ana')
      throw Object.assign(new Error('Tu sesión se cerró. Entra otra vez.'), {
        status: 401, data: { message: 'Tu sesión se cerró. Entra otra vez.', code: 'CUSTOMER_SESSION_CLOSED' }, enviado: 'tok-ana',
      })
    })
    await openAppointmentForm()
    expect(screen.getByText('Reservando como Ana Ruiz')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Reserva cita' })); await flush()
    expect(api.createReservation).toHaveBeenCalledTimes(1)
    expect(state.toastMessage.value).toEqual({ text: 'Tu sesión se cerró. Puedes seguir sin cuenta o entrar otra vez.', type: 'success' })
    expect(state.customerToken.value).toBeNull()
    // Ya sin sesión, el formulario enseña los campos con lo que traía: puede seguir sin cuenta sin volver a escribir.
    expect((screen.getByLabelText(/Nombre/) as HTMLInputElement).value).toBe('Ana Ruiz')
    expect((screen.getByLabelText(/Teléfono/) as HTMLInputElement).value).toBe('5512345678')
    expect(state.selectedSlot.value).not.toBeNull()
  })

  it('codex-r5 E6: el sondeo de créditos al volver de Stripe se detiene con un 401 (no sigue ni pasa a otra sesión)', async () => {
    guardarSesion('studio-a', {
      token: 'tok-ana', customer: { id: 'c1', firstName: 'Ana', lastName: null, email: null, phone: '5512345678' },
      contactos: [{ tipo: 'PHONE', valor: '+525512345678', metodo: 'WHATSAPP', probadoEn: 1 }], guardadaEn: Date.now(),
    })
    state.bindCustomerSessionToVenue('studio-a')
    state.entroAqui('studio-a', leerSesion('studio-a')!)
    vi.mocked(api.getCustomerPortal).mockReturnValue(new Promise(() => {}))
    vi.mocked(api.getCustomerCredits).mockRejectedValue(Object.assign(new Error('x'), { status: 401, data: { message: 'x' }, enviado: 'tok-ana' }))
    sessionStorage.setItem('avq:compraDe', JSON.stringify({ venue: 'studio-a', cliente: 'c1' })) // ella compró (codex r5 #5)
    window.history.replaceState({}, '', '/studio-a/appointments?avq_credits=success')
    render(<BookingFlow props={props()} />); await flush()
    await advance(10000); await flush()
    expect(api.getCustomerCredits).toHaveBeenCalledTimes(1)
    state.clearCustomerSession('studio-a')
  })

  it.each(['', '5512345678'])('optional phone %j reaches the public contract', async phone => {
    vi.mocked(api.getVenueInfo).mockResolvedValue({ ...venue, publicBooking: { ...venue.publicBooking, requirePhone: false } })
    await openAppointmentForm()
    fireEvent.input(screen.getByLabelText(/Nombre/), { target: { value: 'Ana Prueba' } })
    fireEvent.input(screen.getByLabelText(/Teléfono/), { target: { value: phone } })
    fireEvent.click(screen.getByRole('button', { name: 'Reserva cita' })); await flush()
    expect(api.createReservation).toHaveBeenCalledTimes(1)
    const body = JSON.parse(JSON.stringify(vi.mocked(api.createReservation).mock.calls[0][1]))
    if (phone) expect(body.guestPhone).toBe(phone)
    else expect(body).not.toHaveProperty('guestPhone')
  })

  it('required phone still blocks an empty submission', async () => {
    await openAppointmentForm()
    fireEvent.input(screen.getByLabelText(/Nombre/), { target: { value: 'Ana Prueba' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reserva cita' })); await flush()
    expect(api.createReservation).not.toHaveBeenCalled()
    expect(screen.getByText('El teléfono es requerido')).toBeTruthy()
  })

  it('an authoritative hold expires back to availability and cannot submit the old slot', async () => {
    vi.mocked(api.createHold).mockResolvedValue({ holdId: 'held-slot', expiresAt: new Date(Date.now() + 2000).toISOString(), ttlSeconds: 2 })
    vi.mocked(api.cancelHold).mockResolvedValue(undefined)
    await openAppointmentForm()
    expect(state.slotHoldToken.value).toBe('held-slot')
    await advance(2000); await flush()
    expect(api.cancelHold).toHaveBeenCalledWith('studio-a', 'held-slot')
    expect(state.selectedSlot.value).toBeNull()
    expect(state.slotHoldToken.value).toBeNull()
    expect(state.slotHoldExpiresAt.value).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reserva cita' })).toBeNull()
    expect(api.createReservation).not.toHaveBeenCalled()
  })

  it('transitions once after a fractional hold timestamp without renewal or POST', async () => {
    const expiry = Date.now() + 2500
    vi.mocked(api.createHold).mockResolvedValueOnce({ holdId: 'fractional-hold', expiresAt: new Date(expiry).toISOString(), ttlSeconds: 3 })
    vi.mocked(api.cancelHold).mockResolvedValue(undefined)
    await openAppointmentForm()
    const availabilityReads = vi.mocked(api.getAvailability).mock.calls.length
    await advance(2000); await flush()
    expect(api.cancelHold).not.toHaveBeenCalled()
    expect(state.selectedSlot.value).not.toBeNull()
    expect(state.slotHoldToken.value).toBe('fractional-hold')
    expect(state.slotHoldExpiresAt.value).toBe(expiry)
    await advance(1000); await flush()
    expect(api.cancelHold).toHaveBeenCalledTimes(1)
    expect(api.cancelHold).toHaveBeenCalledWith('studio-a', 'fractional-hold')
    expect(api.getAvailability).toHaveBeenCalledTimes(availabilityReads + 1)
    expect(state.selectedSlot.value).toBeNull()
    expect(state.slotHoldToken.value).toBeNull()
    expect(state.slotHoldExpiresAt.value).toBeNull()
    await advance(3000); await flush()
    expect(api.cancelHold).toHaveBeenCalledTimes(1)
    expect(api.createHold).toHaveBeenCalledTimes(1)
    expect(api.createReservation).not.toHaveBeenCalled()
  })

  it('preserves a POST error before fractional expiry and later expires once with its draft', async () => {
    let reject!: (reason: unknown) => void
    vi.mocked(api.createReservation).mockImplementationOnce(() => new Promise((_, fail) => { reject = fail }))
    const expiry = Date.now() + 2500
    vi.mocked(api.createHold).mockResolvedValueOnce({ holdId: 'fractional-error', expiresAt: new Date(expiry).toISOString(), ttlSeconds: 3 })
    vi.mocked(api.cancelHold).mockResolvedValue(undefined)
    await openAppointmentForm()
    const name = screen.getByLabelText(/Nombre/) as HTMLInputElement
    fireEvent.input(name, { target: { value: 'Ana Fracción' } })
    fireEvent.input(screen.getByLabelText(/Teléfono/), { target: { value: '5512345678' } })
    const availabilityReads = vi.mocked(api.getAvailability).mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Reserva cita' })); await flush()
    await advance(2100); await flush()
    expect(api.cancelHold).not.toHaveBeenCalled()
    expect(state.slotHoldExpiresAt.value).toBe(expiry)
    await act(async () => reject({ status: 400, data: { message: 'Error antes del vencimiento real' } })); await flush()
    expect(screen.getByLabelText(/Nombre/)).toBe(name)
    expect(name.value).toBe('Ana Fracción')
    expect(screen.getByRole('alert').textContent).toContain('Error antes del vencimiento real')
    expect(api.cancelHold).not.toHaveBeenCalled()
    expect(api.getAvailability).toHaveBeenCalledTimes(availabilityReads)
    expect(state.selectedSlot.value).not.toBeNull()
    expect(state.slotHoldExpiresAt.value).toBe(expiry)
    await advance(900); await flush()
    expect(api.cancelHold).toHaveBeenCalledTimes(1)
    expect(api.getAvailability).toHaveBeenCalledTimes(availabilityReads + 1)
    expect(state.selectedSlot.value).toBeNull()
    expect(screen.getByRole('alert').textContent).toContain('Error antes del vencimiento real')
    await advance(3000); await flush()
    expect(api.cancelHold).toHaveBeenCalledTimes(1)
    const freshExpiry = Date.now() + 600000
    vi.mocked(api.createHold).mockResolvedValueOnce({ holdId: 'fractional-fresh', expiresAt: new Date(freshExpiry).toISOString(), ttlSeconds: 600 })
    fireEvent.click(screen.getByRole('button', { name: /10:00/ })); await flush()
    expect((screen.getByLabelText(/Nombre/) as HTMLInputElement).value).toBe('Ana Fracción')
    expect((screen.getByLabelText(/Teléfono/) as HTMLInputElement).value).toBe('5512345678')
    expect(state.slotHoldExpiresAt.value).toBe(freshExpiry)
    expect(api.createReservation).toHaveBeenCalledTimes(1)
  })

  it('blocks navigation during timer-owned cancellation and enables it after completion', async () => {
    vi.mocked(api.createHold).mockResolvedValueOnce({ holdId: 'account-pending', expiresAt: new Date(Date.now() + 2000).toISOString(), ttlSeconds: 2 })
    let release!: () => void
    vi.mocked(api.cancelHold).mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    await openAppointmentForm()
    const account = screen.getByRole('button', { name: /Mi cuenta/i }) as HTMLButtonElement
    const back = screen.getByRole('button', { name: 'Atrás' }) as HTMLButtonElement
    expect(account.disabled).toBe(false)
    expect(back.disabled).toBe(false)
    try {
      await advance(2000); await flush()
      expect(api.cancelHold).toHaveBeenCalledTimes(1)
      expect(account.disabled).toBe(true)
      expect(back.disabled).toBe(true)
      fireEvent.click(account); fireEvent.click(back); await flush()
      expect(state.showPortal.value).toBe(false)
      expect(state.selectedSlot.value).not.toBeNull()
      expect(api.cancelHold).toHaveBeenCalledTimes(1)
      expect(api.createReservation).not.toHaveBeenCalled()
      await act(async () => release()); await flush()
      expect(state.selectedSlot.value).toBeNull()
      expect((screen.getByRole('button', { name: /Mi cuenta/i }) as HTMLButtonElement).disabled).toBe(false)
      expect((screen.getByRole('button', { name: 'Atrás' }) as HTMLButtonElement).disabled).toBe(false)
      await act(async () => (screen.getByRole('button', { name: /Mi cuenta/i }) as HTMLButtonElement).click()); await flush()
      expect(state.showPortal.value).toBe(true)
      expect(api.cancelHold).toHaveBeenCalledTimes(1)
      expect(api.createReservation).not.toHaveBeenCalled()
    } finally {
      if (release) { await act(async () => release()); await flush() }
    }
  })

  it.each(['Atrás', 'Mi cuenta'])('Task 13: en clases nada vence en la confirmación; «%s» funciona sin esperar a un reloj', async control => {
    vi.mocked(api.getVenueInfo).mockResolvedValue({ ...venue, products: [{ ...venue.products[0], id: 'class-a', name: 'Clase propia', type: 'CLASS' }] })
    vi.mocked(api.getClassSessionsRange).mockResolvedValue({ dateFrom: '2026-10-06', dateTo: '2026-11-05', slots: [{
      startsAt: '2026-10-08T17:00:00Z', endsAt: '2026-10-08T18:00:00Z', available: true,
      classSessionId: 'session-expiring', productId: 'class-a', productName: 'Clase propia', remaining: 8, capacity: 10, enrolled: 2,
    }] })
    window.history.replaceState({}, '', '/studio-a/classes')
    render(<BookingFlow props={{ ...props(), flowType: 'classes' }} />); await flush()
    fireEvent.click(screen.getByRole('button', { name: /Clase propia.*11:00/ })); await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Reservar' })); await flush()
    expect(screen.getByRole('heading', { name: 'Confirma tu reserva' })).toBeTruthy()
    expect(state.slotHoldToken.value).toBeNull()
    expect(state.slotHoldExpiresAt.value).toBeNull()
    await advance(11 * 60 * 1000); await flush()
    expect(screen.getByRole('heading', { name: 'Confirma tu reserva' })).toBeTruthy()
    expect(state.selectedSlot.value).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Reservar clase' })).toBeNull()
    expect((screen.getByRole('button', { name: /Mi cuenta/i }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByRole('button', { name: 'Atrás' }) as HTMLButtonElement).disabled).toBe(false)
    expect(api.createHold).not.toHaveBeenCalled()
    expect(api.cancelHold).not.toHaveBeenCalled()
    expect(api.createReservation).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: new RegExp(control, 'i') })); await flush()
    if (control === 'Mi cuenta') expect(state.showPortal.value).toBe(true)
    else {
      expect(screen.queryByRole('button', { name: 'Atrás' })).toBeNull()
      expect(screen.getByRole('button', { name: /Clase propia.*11:00/ })).toBeTruthy()
    }
  })

  it.each(['error', 'confirmation', 'checkout'] as const)('resolves a pending POST before expiry handling: %s', async outcome => {
    let resolve!: (result: Awaited<ReturnType<typeof api.createReservation>>) => void
    let reject!: (reason: unknown) => void
    vi.mocked(api.createReservation).mockImplementationOnce(() => new Promise((ok, fail) => { resolve = ok; reject = fail }))
    const expiry = Date.now() + 2000
    vi.mocked(api.createHold).mockResolvedValueOnce({ holdId: 'short-hold', expiresAt: new Date(expiry).toISOString(), ttlSeconds: 2 })
    vi.mocked(api.cancelHold).mockResolvedValue(undefined)
    const p = props(); const confirmed = vi.fn(); p.hostElement.addEventListener('avoqado:confirmed', confirmed)
    render(<BookingFlow props={p} />); await flush()
    fireEvent.click(screen.getByRole('button', { name: '8 de octubre de 2026' })); await flush()
    fireEvent.click(screen.getByRole('button', { name: /10:00/ })); await flush()
    const name = screen.getByLabelText(/Nombre/) as HTMLInputElement
    fireEvent.input(name, { target: { value: 'Ana Espera' } })
    fireEvent.input(screen.getByLabelText(/Teléfono/), { target: { value: '5512345678' } })
    fireEvent.input(screen.getByLabelText(/Correo/), { target: { value: 'espera@example.test' } })
    fireEvent.input(screen.getByLabelText(/Peticiones/), { target: { value: 'Conservar borrador' } })
    const availabilityReads = vi.mocked(api.getAvailability).mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Reserva cita' })); await flush()
    await advance(2000); await flush()
    expect(api.cancelHold).not.toHaveBeenCalled()
    expect(api.getAvailability).toHaveBeenCalledTimes(availabilityReads)
    expect(screen.getByLabelText(/Nombre/)).toBe(name)
    expect(state.selectedSlot.value).not.toBeNull()
    expect(state.slotHoldToken.value).toBe('short-hold')
    expect(state.slotHoldExpiresAt.value).toBe(expiry)
    expect(screen.getByText('Cita reservada durante 0:00')).toBeTruthy()
    fireEvent.submit(name.form!); await flush()
    expect(api.createReservation).toHaveBeenCalledTimes(1)
    const result = { confirmationCode: 'R1-RESULT', cancelSecret: 'r1-result', startsAt: detail.startsAt,
      endsAt: detail.endsAt, status: 'CONFIRMED', depositRequired: false, depositAmount: 0 }
    if (outcome === 'error') {
      await act(async () => reject({ status: 400, data: { message: 'Error después de esperar' } })); await flush()
      expect(api.cancelHold).toHaveBeenCalledTimes(1)
      expect(api.cancelHold).toHaveBeenCalledWith('studio-a', 'short-hold')
      expect(api.getAvailability).toHaveBeenCalledTimes(availabilityReads + 1)
      expect(state.selectedSlot.value).toBeNull()
      expect(state.slotHoldExpiresAt.value).toBeNull()
      expect(screen.getByRole('alert').textContent).toContain('Error después de esperar')
      await advance(5000)
      expect(screen.getByRole('alert').textContent).toContain('Error después de esperar')
      const freshExpiry = Date.now() + 600000
      vi.mocked(api.createHold).mockResolvedValueOnce({ holdId: 'fresh-hold', expiresAt: new Date(freshExpiry).toISOString(), ttlSeconds: 600 })
      fireEvent.click(screen.getByRole('button', { name: /10:00/ })); await flush()
      expect((screen.getByLabelText(/Nombre/) as HTMLInputElement).value).toBe('Ana Espera')
      expect((screen.getByLabelText(/Teléfono/) as HTMLInputElement).value).toBe('5512345678')
      expect((screen.getByLabelText(/Correo/) as HTMLInputElement).value).toBe('espera@example.test')
      expect((screen.getByLabelText(/Peticiones/) as HTMLTextAreaElement).value).toBe('Conservar borrador')
      expect(state.slotHoldExpiresAt.value).toBe(freshExpiry)
      expect(state.slotHoldToken.value).toBe('fresh-hold')
      fireEvent.click(screen.getByRole('button', { name: 'Reserva cita' })); await flush()
      expect(api.createReservation).toHaveBeenCalledTimes(2)
      expect(vi.mocked(api.createReservation).mock.calls[1][1]).toMatchObject({ holdId: 'fresh-hold', guestName: 'Ana Espera' })
    } else {
      await act(async () => resolve(outcome === 'checkout' ? { ...result, status: 'PENDING', depositRequired: true, depositAmount: 500, checkoutUrl: '#r1-checkout' } : result)); await flush()
      await advance(2000); await flush()
      expect(api.cancelHold).not.toHaveBeenCalled()
      expect(api.getAvailability).toHaveBeenCalledTimes(availabilityReads)
      expect(state.slotHoldToken.value).toBeNull()
      expect(state.slotHoldExpiresAt.value).toBeNull()
      expect(api.createReservation).toHaveBeenCalledTimes(1)
      if (outcome === 'confirmation') {
        expect(state.bookingResult.value).toEqual(result)
        expect(screen.getByRole('heading', { name: 'Gracias por tu reserva' })).toBeTruthy()
        expect(confirmed).toHaveBeenCalledTimes(1)
        expect((confirmed.mock.calls[0][0] as CustomEvent).detail.confirmationCode).toBe('R1-RESULT')
      } else {
        expect(window.location.hash).toBe('#r1-checkout')
        expect(JSON.parse(sessionStorage.getItem('avq:pendingReservation:studio-a')!)).toEqual({ venue: 'studio-a', cancelSecret: 'r1-result', confirmationCode: 'R1-RESULT', ref: expect.any(String) })
        expect(confirmed).not.toHaveBeenCalled()
      }
    }
  })

  it('blocks a first submit whose hold expired between timer ticks and restores its draft', async () => {
    const expiry = Date.now() + 2000
    vi.mocked(api.createHold).mockResolvedValueOnce({ holdId: 'already-expired', expiresAt: new Date(expiry).toISOString(), ttlSeconds: 2 })
    vi.mocked(api.cancelHold).mockResolvedValue(undefined)
    await openAppointmentForm()
    fireEvent.input(screen.getByLabelText(/Nombre/), { target: { value: 'Ana Vencida' } })
    fireEvent.input(screen.getByLabelText(/Teléfono/), { target: { value: '5512345678' } })
    vi.setSystemTime(expiry + 1) // no interval tick before the click
    fireEvent.click(screen.getByRole('button', { name: 'Reserva cita' })); await flush()
    expect(api.createReservation).not.toHaveBeenCalled()
    expect(api.cancelHold).toHaveBeenCalledTimes(1)
    expect(state.selectedSlot.value).toBeNull()
    const freshExpiry = Date.now() + 600000
    vi.mocked(api.createHold).mockResolvedValueOnce({ holdId: 'fresh-first', expiresAt: new Date(freshExpiry).toISOString(), ttlSeconds: 600 })
    fireEvent.click(screen.getByRole('button', { name: /10:00/ })); await flush()
    expect((screen.getByLabelText(/Nombre/) as HTMLInputElement).value).toBe('Ana Vencida')
    expect(state.slotHoldExpiresAt.value).toBe(freshExpiry)
    expect(api.createReservation).not.toHaveBeenCalled()
  })

  it('keeps an expired hold blocked when release fails and recovers through the existing retry', async () => {
    let reject!: (reason: unknown) => void
    vi.mocked(api.createReservation).mockImplementationOnce(() => new Promise((_, fail) => { reject = fail }))
    const expiry = Date.now() + 2000
    vi.mocked(api.createHold).mockResolvedValueOnce({ holdId: 'release-failure', expiresAt: new Date(expiry).toISOString(), ttlSeconds: 2 })
    vi.mocked(api.cancelHold).mockRejectedValueOnce(new TypeError('offline')).mockResolvedValue(undefined)
    await openAppointmentForm()
    fireEvent.input(screen.getByLabelText(/Nombre/), { target: { value: 'Ana Liberación' } })
    fireEvent.input(screen.getByLabelText(/Teléfono/), { target: { value: '5512345678' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reserva cita' })); await flush()
    await advance(2000); await flush()
    expect(api.cancelHold).not.toHaveBeenCalled()
    await act(async () => reject({ status: 400, data: { message: 'Datos incorrectos al vencer' } })); await flush()
    expect(api.cancelHold).toHaveBeenCalledTimes(1)
    expect(state.slotHoldToken.value).toBe('release-failure')
    expect(state.slotHoldExpiresAt.value).toBe(expiry)
    expect(state.selectedSlot.value).not.toBeNull()
    expect(screen.getByText('Datos incorrectos al vencer')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Reserva cita' }) as HTMLButtonElement).disabled).toBe(true)
    expect(api.createReservation).toHaveBeenCalledTimes(1)
    fireEvent.submit((screen.getByLabelText(/Nombre/) as HTMLInputElement).form!); await flush()
    expect(api.cancelHold).toHaveBeenCalledTimes(1)
    expect(api.createReservation).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Intentar de Nuevo' })); await flush()
    expect(api.cancelHold).toHaveBeenCalledTimes(2)
    expect(state.selectedSlot.value).toBeNull()
    expect(screen.getByRole('alert').textContent).toContain('Datos incorrectos al vencer')
    const freshExpiry = Date.now() + 600000
    vi.mocked(api.createHold).mockResolvedValueOnce({ holdId: 'release-recovered', expiresAt: new Date(freshExpiry).toISOString(), ttlSeconds: 600 })
    fireEvent.click(screen.getByRole('button', { name: /10:00/ })); await flush()
    expect((screen.getByLabelText(/Nombre/) as HTMLInputElement).value).toBe('Ana Liberación')
    expect(state.slotHoldToken.value).toBe('release-recovered')
  })

  it.each(['conflict', 'window', 'pending-approval', 'rejected-approval'] as const)('preserves the existing error transition after a pending expiry: %s', async kind => {
    let reject!: (reason: unknown) => void
    vi.mocked(api.createReservation).mockImplementationOnce(() => new Promise((_, fail) => { reject = fail }))
    vi.mocked(api.createHold).mockResolvedValueOnce({ holdId: 'special-error', expiresAt: new Date(Date.now() + 2000).toISOString(), ttlSeconds: 2 })
    vi.mocked(api.cancelHold).mockResolvedValue(undefined)
    await openAppointmentForm()
    fireEvent.input(screen.getByLabelText(/Nombre/), { target: { value: 'Ana Respuesta' } })
    fireEvent.input(screen.getByLabelText(/Teléfono/), { target: { value: '5512345678' } })
    const availabilityReads = vi.mocked(api.getAvailability).mock.calls.length
    const venueReads = vi.mocked(api.getVenueInfo).mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Reserva cita' })); await flush()
    await advance(2000); await flush()
    expect(api.cancelHold).not.toHaveBeenCalled()
    const code = kind === 'window' ? 'APPOINTMENT_WINDOW_CHANGED'
      : kind === 'pending-approval' ? 'CUSTOMER_APPROVAL_PENDING' : 'CUSTOMER_APPROVAL_REJECTED'
    await act(async () => reject(kind === 'conflict' ? { status: 409, data: {} } : { status: 403, data: { code } })); await flush()
    expect(api.createReservation).toHaveBeenCalledTimes(1)
    if (kind === 'conflict' || kind === 'window') {
      expect(api.cancelHold).toHaveBeenCalledTimes(1)
      expect(state.selectedSlot.value).toBeNull()
      expect(api.getAvailability).toHaveBeenCalledTimes(availabilityReads + 1)
      expect(api.getVenueInfo).toHaveBeenCalledTimes(venueReads + (kind === 'window' ? 1 : 0))
    } else {
      expect(api.cancelHold).not.toHaveBeenCalled()
      expect(api.getAvailability).toHaveBeenCalledTimes(availabilityReads)
      expect(state.bookingAccess.value).toMatchObject({ canCreateReservation: false, blockedBy: 'APPROVAL', status: kind === 'pending-approval' ? 'PENDING' : 'REJECTED' })
      expect(screen.queryByLabelText(/Nombre/)).toBeNull()
    }
  })

  it('coalesces expiration and an expired submit while releasing the hold', async () => {
    const expiry = Date.now() + 2000
    vi.mocked(api.createHold).mockResolvedValueOnce({ holdId: 'release-pending', expiresAt: new Date(expiry).toISOString(), ttlSeconds: 2 })
    let release!: () => void
    vi.mocked(api.cancelHold).mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    await openAppointmentForm()
    const name = screen.getByLabelText(/Nombre/) as HTMLInputElement
    fireEvent.input(name, { target: { value: 'Ana Sin Duplicar' } })
    fireEvent.input(screen.getByLabelText(/Teléfono/), { target: { value: '5512345678' } })
    const availabilityReads = vi.mocked(api.getAvailability).mock.calls.length
    await advance(2000); await flush()
    expect(api.cancelHold).toHaveBeenCalledTimes(1)
    fireEvent.submit(name.form!); await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Atrás' })); await flush()
    expect(api.cancelHold).toHaveBeenCalledTimes(1)
    expect(api.createReservation).not.toHaveBeenCalled()
    await act(async () => release()); await flush()
    expect(state.selectedSlot.value).toBeNull()
    expect(api.getAvailability).toHaveBeenCalledTimes(availabilityReads + 1)
  })

  it('D687: un rechazo del SERVIDOR sale UNA vez (el aviso que se queda, sin el toast repetido) y se lleva a la vista', async () => {
    const MSG = 'Ya tienes un lugar en esta clase con tu Ilimitado.'
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    try {
      vi.mocked(api.createReservation).mockRejectedValueOnce({ status: 400, data: { code: 'CREDIT_UNLIMITED_SAME_CLASS', message: MSG } })
      await openAppointmentForm()
      fireEvent.input(screen.getByLabelText(/Nombre/), { target: { value: 'Ana Prueba' } })
      fireEvent.input(screen.getByLabelText(/Teléfono/), { target: { value: '5512345678' } })
      fireEvent.click(screen.getByRole('button', { name: 'Reserva cita' })); await flush()
      expect(screen.getAllByText(MSG)).toHaveLength(1)
      expect(screen.getByRole('alert').textContent).toBe(MSG)
      expect(state.toastMessage.value).toBeNull()
      expect(scroll).toHaveBeenCalledTimes(1)
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
    }
  })

  it('retains the mounted draft during failure and retries once with the correction', async () => {
    let reject!: (reason: unknown) => void
    vi.mocked(api.createReservation).mockImplementationOnce(() => new Promise((_, fail) => { reject = fail }))
    await openAppointmentForm()
    const name = screen.getByLabelText(/Nombre/) as HTMLInputElement
    fireEvent.input(name, { target: { value: 'Ana Prueba' } })
    fireEvent.input(screen.getByLabelText(/Teléfono/), { target: { value: '5512345678' } })
    fireEvent.input(screen.getByLabelText(/Correo/), { target: { value: 'ana@example.test' } })
    fireEvent.input(screen.getByLabelText(/Peticiones/), { target: { value: 'Necesito acceso' } })
    const button = screen.getByRole('button', { name: 'Reserva cita' }) as HTMLButtonElement
    fireEvent.click(button); await flush()
    expect(screen.getByLabelText(/Nombre/)).toBe(name)
    expect(button.disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Atrás' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: /Mi cuenta/i }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.submit(name.form!); await flush()
    expect(api.createReservation).toHaveBeenCalledTimes(1)
    await act(async () => reject({ status: 400, data: { message: 'Corrige tus datos' } })); await flush()
    expect(screen.getByRole('alert').textContent).toContain('Corrige tus datos')
    await advance(5000)
    expect(screen.getByRole('alert').textContent).toContain('Corrige tus datos')
    expect((screen.getByRole('button', { name: 'Atrás' }) as HTMLButtonElement).disabled).toBe(false)
    expect(name.value).toBe('Ana Prueba')
    expect((screen.getByLabelText(/Correo/) as HTMLInputElement).value).toBe('ana@example.test')
    expect((screen.getByLabelText(/Peticiones/) as HTMLTextAreaElement).value).toBe('Necesito acceso')
    fireEvent.input(name, { target: { value: 'Ana Corregida' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reserva cita' })); await flush()
    expect(api.createReservation).toHaveBeenCalledTimes(2)
    expect(vi.mocked(api.createReservation).mock.calls[1][1]).toMatchObject({ guestName: 'Ana Corregida', guestEmail: 'ana@example.test', specialRequests: 'Necesito acceso' })
  })

  it('management → a new class opens «Confirma tu reserva» (no countdown) and submits without manage', async () => {
    vi.useRealTimers()
    const settle = () => new Promise(resolve => setTimeout(resolve, 150))
    const classVenue: PublicVenueInfo = { ...venue, products: [{ ...venue.products[0], id: 'class-a', name: 'Clase propia', type: 'CLASS' }, { ...venue.products[0], id: 'class-b', name: 'Otra clase', type: 'CLASS' }, venue.products[0]] }
    vi.mocked(api.getVenueInfo).mockResolvedValue(classVenue)
    vi.mocked(api.getReservation).mockResolvedValue({ ...detail, status: 'PENDING', depositStatus: 'PENDING' })
    vi.mocked(api.getClassSessionsRange).mockResolvedValue({ dateFrom: '2026-10-06', dateTo: '2026-11-05', slots: [{
      startsAt: '2026-10-08T17:00:00Z', endsAt: '2026-10-08T18:00:00Z', available: true,
      classSessionId: 'session-new', productId: 'class-a', productName: 'Clase propia', remaining: 8, capacity: 10, enrolled: 2,
    }] })
    window.history.replaceState({}, '', '/studio-a/classes?manage=url-secret&campaign=fall')
    // A previous form's visual retention is expired when opening management.
    state.slotHoldExpiresAt.value = Date.now() - 1000
    await import('../widget')
    const container = document.createElement('avoqado-booking')
    for (const [key, value] of Object.entries({ venue: 'studio-a', locale: 'es', theme: 'light', mode: 'inline', 'flow-type': 'classes', 'hide-chat-fab': 'true' })) container.setAttribute(key, value)
    document.body.append(container)
    const view = within(container.shadowRoot!.querySelector('.avq-root') as HTMLElement)
    try {
      await settle()
      expect(view.getByText('OWN-A')).toBeTruthy()
      ;(view.getByRole('button', { name: 'Hacer una Nueva Reservación' }) as HTMLButtonElement).click(); await settle()
      ;(view.getByRole('button', { name: /Clase propia.*11:00/ }) as HTMLButtonElement).click(); await settle()
      ;(view.getByRole('button', { name: 'Reservar' }) as HTMLButtonElement).click()
      await settle()
      // Una clase no se aparta: ni el reloj de antes ni el apartado vencido de un formulario anterior la frenan (Task 13).
      expect(view.getByRole('heading', { name: 'Confirma tu reserva' })).toBeTruthy()
      expect(container.shadowRoot!.textContent).not.toMatch(/reservada durante/)
      const button = view.getByRole('button', { name: 'Confirmar reserva' }) as HTMLButtonElement
      expect(button.disabled).toBe(false)
      ;(view.getByRole('button', { name: 'Atrás' }) as HTMLButtonElement).click(); await settle()
      ;(view.getByRole('button', { name: /Clase propia.*11:00/ }) as HTMLButtonElement).click(); await settle()
      ;(view.getByRole('button', { name: 'Reservar' }) as HTMLButtonElement).click(); await settle()
      expect(api.createReservation).not.toHaveBeenCalled()
      fireEvent.input(view.getByLabelText(/Nombre/), { target: { value: 'Ana Clase' } })
      fireEvent.input(view.getByLabelText(/Teléfono/), { target: { value: '5512345678' } })
      ;(view.getByRole('button', { name: 'Confirmar reserva' }) as HTMLButtonElement).click(); await settle()
      expect(api.createReservation).toHaveBeenCalledTimes(1)
      expect(api.createHold).not.toHaveBeenCalled()
      const body = vi.mocked(api.createReservation).mock.calls[0][1]
      expect(body.classSessionId).toBe('session-new')
      for (const url of [body.successUrl, body.cancelUrl]) {
        expect(new URL(url!).searchParams.has('manage')).toBe(false)
        expect(new URL(url!).searchParams.get('campaign')).toBe('fall')
      }
    } finally { container.remove() }
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); resetSignals() })

describe('BookingFlow deposit return through mounted components', () => {
  it.each([
    ['es', 'Jueves, 8 de octubre de 2026', '10:00 a.m. - 11:00 a.m.'],
    ['en', 'Thursday, October 8, 2026', '10:00 AM - 11:00 AM'],
  ] as const)('passes widget %s locale into the managed reservation', async (locale, date, time) => {
    window.history.replaceState({}, '', '?manage=url-secret')
    render(<BookingFlow props={props('studio-a', locale)} />); await flush()
    expect(screen.getByText('OWN-A')).toBeTruthy()
    expect(screen.getByText(date)).toBeTruthy()
    expect(screen.getByText(time)).toBeTruthy()
    expect(api.getReservation).toHaveBeenCalledTimes(1)
    expect(api.createReservation).not.toHaveBeenCalled()
  })

  it.each(['success', 'cancelled'])('recovers owned legacy storage on %s without confirming from URL', async flag => {
    sessionStorage.setItem('avq:pendingReservation', JSON.stringify(saved))
    window.history.replaceState({}, '', `?avq_payment=${flag}&publicCampaign=fall`)
    const p = props(); const confirmed = vi.fn(); p.hostElement.addEventListener('avoqado:confirmed', confirmed)
    render(<BookingFlow props={p} />); await flush()
    expect(api.getReservation).toHaveBeenCalledWith('studio-a', 'stored-a', expect.any(AbortSignal))
    expect(screen.getByText('OWN-A')).toBeTruthy(); expect(screen.getByText('Pago recibido')).toBeTruthy()
    // D683: la referencia pasa a su llave del negocio y recuerda cómo regresó de Stripe (para que recargar diga lo mismo).
    expect(JSON.parse(sessionStorage.getItem('avq:pendingReservation:studio-a')!)).toEqual({ ...saved, outcome: flag })
    expect(window.location.search).toBe('?publicCampaign=fall'); expect(confirmed).not.toHaveBeenCalled()
  })
  it('persists the saved reference across reload and clears only on an explicit back click', async () => {
    sessionStorage.setItem('avq:pendingReservation:studio-a', JSON.stringify(saved)); window.history.replaceState({}, '', '?avq_payment=success')
    const first = render(<BookingFlow props={props()} />); await flush(); first.unmount(); resetSignals()
    render(<BookingFlow props={props()} />); await flush()
    expect(screen.getByText('OWN-A')).toBeTruthy(); expect(api.getReservation).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: 'Hacer una Nueva Reservación' })); await flush()
    expect(sessionStorage.getItem('avq:pendingReservation:studio-a')).toBeNull()
    expect(screen.queryByText('OWN-A')).toBeNull()
  })
  it.each(['success', 'cancelled'])('a foreign legacy venue leaves storage and %s params untouched', async flag => {
    const other = JSON.stringify({ ...saved, venue: 'studio-b', cancelSecret: 'stored-b' })
    sessionStorage.setItem('avq:pendingReservation', other); window.history.replaceState({}, '', `?avq_payment=${flag}`)
    render(<BookingFlow props={props()} />); await flush()
    expect(api.getReservation).not.toHaveBeenCalled(); expect(sessionStorage.getItem('avq:pendingReservation')).toBe(other)
    expect(window.location.search).toBe(`?avq_payment=${flag}`)
    expect(screen.getByText('No pudimos recuperar esta reserva en este navegador. Consulta tu confirmación o contacta al negocio')).toBeTruthy()
  })
  it('another venue mounted first cannot consume or query the owner reference', async () => {
    sessionStorage.setItem('avq:pendingReservation', JSON.stringify(saved)); window.history.replaceState({}, '', '?avq_payment=success')
    const b = render(<BookingFlow props={props('studio-b')} />); await flush()
    expect(api.getReservation).not.toHaveBeenCalled(); expect(window.location.search).toBe('?avq_payment=success')
    const a = render(<BookingFlow props={props()} />); await flush()
    expect(within(a.container as HTMLElement).getByText('OWN-A')).toBeTruthy()
    expect(vi.mocked(api.getReservation).mock.calls.every(([slug, secret]) => slug === 'studio-a' && secret === 'stored-a')).toBe(true)
    expect(within(b.container as HTMLElement).queryByText('OWN-A')).toBeNull()
  })
  it.each(['missing', 'corrupt', 'corrupt-scoped', 'wrong-shape', 'blocked'])('%s storage keeps a persistent neutral notice and cannot use a URL secret', async mode => {
    if (mode === 'corrupt') sessionStorage.setItem('avq:pendingReservation', '{broken')
    if (mode === 'corrupt-scoped') sessionStorage.setItem('avq:pendingReservation:studio-a', '{broken')
    if (mode === 'wrong-shape') sessionStorage.setItem('avq:pendingReservation:studio-a', JSON.stringify({ venue: 'studio-a', cancelSecret: 123, confirmationCode: 'BAD' }))
    if (mode === 'blocked') vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('blocked') })
    window.history.replaceState({}, '', '?avq_payment=success&manage=url-secret')
    render(<BookingFlow props={props()} />); await flush(); await advance(5000)
    expect(screen.getByText('No pudimos recuperar esta reserva en este navegador. Consulta tu confirmación o contacta al negocio')).toBeTruthy()
    expect(api.getReservation).not.toHaveBeenCalled(); expect(window.location.search).toContain('avq_payment=success')
    expect(window.location.search).toContain('manage=url-secret')
    expect(screen.queryByText(/correo|WhatsApp|sin cargo|Pago recibido/i)).toBeNull()
  })
  it('a return whose first read fails shows neutral financial notice and retries with a real click', async () => {
    sessionStorage.setItem('avq:pendingReservation:studio-a', JSON.stringify(saved)); window.history.replaceState({}, '', '?avq_payment=cancelled')
    vi.mocked(api.getReservation).mockRejectedValueOnce(new TypeError('offline')).mockResolvedValue(detail)
    render(<BookingFlow props={props()} />); await flush()
    expect(screen.getByText('Volviste del pago; aún no pudimos consultar su resultado')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Consultar de nuevo' })); await flush()
    expect(screen.getByText('Pago recibido')).toBeTruthy()
  })
  it('venue load and unified auto-skip preserve recovery', async () => {
    sessionStorage.setItem('avq:pendingReservation:studio-a', JSON.stringify(saved)); window.history.replaceState({}, '', '/studio-a?avq_payment=success')
    render(<BookingFlow props={{ ...props(), flowType: 'unified' }} />); await flush()
    expect(screen.getByText('OWN-A')).toBeTruthy(); expect(api.getReservation).toHaveBeenCalledTimes(1)
  })
  it.each(['es', 'en'] as const)('financial notice uses %s catalog and does not infer administrative confirmation', async locale => {
    sessionStorage.setItem('avq:pendingReservation:studio-a', JSON.stringify(saved)); window.history.replaceState({}, '', '?avq_payment=success')
    vi.mocked(api.getReservation).mockResolvedValue({ ...detail, status: 'CONFIRMED', depositStatus: 'PENDING' })
    render(<BookingFlow props={props('studio-a', locale)} />); await flush()
    expect(screen.getByText(locale === 'es' ? 'Estamos confirmando el depósito' : 'We are confirming the deposit')).toBeTruthy()
    expect(screen.queryByText(locale === 'es' ? 'Pago recibido' : 'Payment received')).toBeNull()
  })
  it.each([false, true])('manage link → real submit strips provider URL secrets; storage write blocked=%s', async blockedWrite => {
    window.history.replaceState({}, '', '?manage=url-secret&avq_credits=old&campaign=fall#context')
    render(<BookingFlow props={props()} />); await flush()
    expect(screen.getByText('OWN-A')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Hacer una Nueva Reservación' })); await flush()
    fireEvent.click(screen.getByRole('button', { name: '8 de octubre de 2026' })); await flush()
    fireEvent.click(screen.getByRole('button', { name: /10:00/ })); await flush()
    fireEvent.input(screen.getByLabelText(/Nombre/), { target: { value: 'Ana Prueba' } })
    fireEvent.input(screen.getByLabelText(/Teléfono/), { target: { value: '5512345678' } })
    if (blockedWrite) vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('blocked') })
    fireEvent.click(screen.getByRole('button', { name: 'Reserva cita' })); await flush()
    expect(api.createReservation).toHaveBeenCalledTimes(1)
    const body = vi.mocked(api.createReservation).mock.calls[0][1]
    // D681: las dos ligas de regreso llevan la misma marca de esta reserva, y es la que se guarda con ella.
    const ref = new URL(body.successUrl!).searchParams.get('avq_ref')
    expect(ref).toMatch(/^[a-z0-9]{4,}$/); expect(new URL(body.cancelUrl!).searchParams.get('avq_ref')).toBe(ref)
    for (const [key, flag] of [['successUrl', 'success'], ['cancelUrl', 'cancelled']] as const) {
      const url = new URL(body[key]!); expect(url.searchParams.get('avq_payment')).toBe(flag)
      expect(url.searchParams.has('manage')).toBe(false); expect(url.searchParams.has('avq_credits')).toBe(false)
      expect(url.searchParams.get('campaign')).toBe('fall'); expect(url.hash).toBe('#context')
      expect(url.href).not.toContain('url-secret')
    }
    if (blockedWrite) expect(sessionStorage.getItem('avq:pendingReservation:studio-a')).toBeNull()
    else expect(JSON.parse(sessionStorage.getItem('avq:pendingReservation:studio-a')!)).toEqual({ venue: 'studio-a', cancelSecret: 'new-a', confirmationCode: 'NEW-A', ref })
    expect(sessionStorage.getItem('avq:pendingReservation')).toBeNull()
  })
})

const PAQUETE = {
  id: 'pk1', name: 'Mega Pack', price: 900, currency: 'MXN', validityDays: 30,
  items: [{ id: 'i1', productId: 'service-a', product: { id: 'service-a', name: 'Servicio propio', type: 'APPOINTMENTS_SERVICE', price: 500 }, quantity: 5 }],
}
const TEL = { tipo: 'PHONE' as const, valor: '+525544422262', metodo: 'WHATSAPP' as const, probadoEn: 1 }
const ANA = { id: 'c1', firstName: 'Ana', lastName: null, email: null as string | null, phone: '+525544422262' as string | null }
const BEA = { ...ANA, id: 'c2', firstName: 'Bea', phone: '+525599998888' }
const entra = (token: string, customer: typeof ANA) => act(async () => {
  state.bindCustomerSessionToVenue('studio-a') // lo hace `widget.ts` al montar el elemento
  guardarSesion('studio-a', { token, customer, contactos: [TEL], guardadaEn: Date.now() })
  state.entroAqui('studio-a', leerSesion('studio-a')!)
})
/** Abre la pestaña de paquetes y devuelve su «Comprar», sin tocarlo. */
async function abrirPaquetes() {
  vi.mocked(api.getVenueInfo).mockResolvedValue({ ...venue, canCharge: true })
  vi.mocked(api.getCreditPacks).mockResolvedValue([PAQUETE] as any)
  window.history.replaceState({}, '', '/studio-a')
  render(<BookingFlow props={{ ...props(), flowType: 'unified' }} />); await flush()
  fireEvent.click(screen.getByRole('tab', { name: 'Comprar paquetes' })); await flush()
  return screen.getByRole('button', { name: 'Comprar' })
}
/** Abre la pestaña de paquetes y toca «Comprar». */
async function comprar() {
  fireEvent.click(await abrirPaquetes()); await flush()
}

describe('Founder 18-nov («A», con WhatsApp, correo o Google): «Comprar» un paquete pide la cuenta, nunca un teléfono escrito', () => {
  afterEach(() => { cleanup(); borrarSesion('studio-a'); state.clearCustomerSession('studio-a'); delete (globalThis as any).__entradaDePrueba })

  it('sin sesión: «Comprar» enseña «Entra a tu cuenta» y no pide teléfono ni prepara el pago', async () => {
    await act(async () => { state.bindCustomerSessionToVenue('studio-a') })
    await comprar()
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Entra a tu cuenta' })).toBeTruthy()
    expect(screen.queryByLabelText(/Teléfono/)).toBeNull()
    expect(api.createPackCheckout).not.toHaveBeenCalled()
  })

  it('sin sesión: entra con Google (sin teléfono), ve con qué cuenta entró y SU toque en «Ir al pago» paga con su sesión', async () => {
    await act(async () => { state.bindCustomerSessionToVenue('studio-a') })
    ;(globalThis as any).__entradaDePrueba = {
      token: 'tok-G', customer: { ...ANA, phone: null, email: 'ana@gmail.com' },
      contactos: [{ tipo: 'EMAIL', valor: 'ana@gmail.com', metodo: 'GOOGLE', probadoEn: 1 }],
    }
    vi.mocked(api.createPackCheckout).mockResolvedValue({ checkoutUrl: '#pago-de-ana' })
    await comprar()
    fireEvent.click(screen.getByRole('button', { name: 'Simular entrar' })); await flush()
    expect(api.createPackCheckout).not.toHaveBeenCalled() // entrar no manda a pagar solo
    expect(screen.getByText('Entraste como Ana · ana@gmail.com')).toBeTruthy()
    expect(within(screen.getByRole('dialog')).getByText('Mega Pack')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Ir al pago' })); await flush()
    expect(api.createPackCheckout).toHaveBeenCalledTimes(1)
    const [, packId, data, token] = vi.mocked(api.createPackCheckout).mock.calls[0]
    expect(packId).toBe('pk1')
    expect(token).toBe('tok-G')
    expect(data.phone).toBeUndefined()
    expect(window.location.hash).toBe('#pago-de-ana')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('sin sesión: cerrar la ventana no prepara nada, y entrar después por otro lado tampoco compra solo', async () => {
    await act(async () => { state.bindCustomerSessionToVenue('studio-a') })
    await comprar()
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' })); await flush()
    expect(screen.queryByRole('dialog')).toBeNull()
    await entra('tok-A', ANA); await flush()
    expect(api.createPackCheckout).not.toHaveBeenCalled()
  })

  it('con sesión de Google sin teléfono: «Comprar» va directo al pago, sin ventana', async () => {
    await entra('tok-G', { ...ANA, phone: null, email: 'ana@gmail.com' })
    vi.mocked(api.createPackCheckout).mockResolvedValue({ checkoutUrl: '#pago-de-ana' })
    await comprar()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(api.createPackCheckout).toHaveBeenCalledTimes(1)
    expect(vi.mocked(api.createPackCheckout).mock.calls[0][3]).toBe('tok-G')
    expect(vi.mocked(api.createPackCheckout).mock.calls[0][2].phone).toBeUndefined()
    expect(window.location.hash).toBe('#pago-de-ana')
  })
})

const OTRO_PAGO = 'Ya estamos preparando un pago en esta página. Si no se abre, vuelve a tocar «Comprar» en un momento.'
describe('Codex r1 (paquete con cuenta): la ventana y el pago no se cruzan con otra elección, sesión o negocio', () => {
  const ENTRADA_G = {
    token: 'tok-G', customer: { ...ANA, phone: null, email: 'ana@gmail.com' },
    contactos: [{ tipo: 'EMAIL', valor: 'ana@gmail.com', metodo: 'GOOGLE', probadoEn: 1 }],
  }
  afterEach(() => {
    cleanup(); borrarSesion('studio-a'); state.clearCustomerSession('studio-a')
    delete (globalThis as any).__entradaDePrueba; delete (globalThis as any).__onEntro
  })

  it('#1: cerró la ventana mientras se validaba su código y eligió otra vez ⇒ la entrada tardía no compra ni cierra la nueva', async () => {
    await act(async () => { state.bindCustomerSessionToVenue('studio-a') })
    vi.mocked(api.createPackCheckout).mockResolvedValue({ checkoutUrl: '#pago' })
    await comprar()
    const entradaVieja = (globalThis as any).__onEntro
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' })); await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Comprar' })); await flush()
    expect(screen.getByRole('dialog')).toBeTruthy()
    await act(async () => {
      guardarSesion('studio-a', { ...ENTRADA_G, guardadaEn: Date.now() } as any)
      entradaVieja(ENTRADA_G)
    }); await flush()
    expect(api.createPackCheckout).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(state.customerToken.value).toBeNull()
  })

  it('#2: mientras se prepara el pago, otra pestaña del negocio cierra su sesión ⇒ no se abre el pago', async () => {
    await entra('tok-A', ANA)
    let resolver: (r: { checkoutUrl: string }) => void = () => {}
    vi.mocked(api.createPackCheckout).mockImplementationOnce(() => new Promise(si => { resolver = si }))
    await comprar()
    borrarSesion('studio-a') // la otra pestaña
    await act(async () => { resolver({ checkoutUrl: '#pago-de-ana' }) }); await flush()
    expect(window.location.hash).toBe('')
  })

  it('#3: el widget cambia de negocio con la ventana abierta ⇒ se cierra; y un pago en vuelo del otro negocio no se abre', async () => {
    await act(async () => { state.bindCustomerSessionToVenue('studio-a') })
    vi.mocked(api.getVenueInfo).mockResolvedValue({ ...venue, canCharge: true })
    vi.mocked(api.getCreditPacks).mockResolvedValue([PAQUETE] as any)
    window.history.replaceState({}, '', '/studio-a')
    const { rerender } = render(<BookingFlow props={{ ...props(), flowType: 'unified' }} />); await flush()
    fireEvent.click(screen.getByRole('tab', { name: 'Comprar paquetes' })); await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Comprar' })); await flush()
    expect(screen.getByRole('dialog')).toBeTruthy()
    rerender(<BookingFlow props={{ ...props('studio-b'), flowType: 'unified' }} />); await flush()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('#3: un pago en vuelo de A no se abre si el widget ya enseña B', async () => {
    await entra('tok-A', ANA)
    let resolver: (r: { checkoutUrl: string }) => void = () => {}
    vi.mocked(api.createPackCheckout).mockImplementationOnce(() => new Promise(si => { resolver = si }))
    vi.mocked(api.getVenueInfo).mockResolvedValue({ ...venue, canCharge: true })
    vi.mocked(api.getCreditPacks).mockResolvedValue([PAQUETE] as any)
    window.history.replaceState({}, '', '/studio-a')
    const { rerender } = render(<BookingFlow props={{ ...props(), flowType: 'unified' }} />); await flush()
    fireEvent.click(screen.getByRole('tab', { name: 'Comprar paquetes' })); await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Comprar' })); await flush()
    rerender(<BookingFlow props={{ ...props('studio-b'), flowType: 'unified' }} />); await flush()
    await act(async () => { resolver({ checkoutUrl: '#pago-de-a' }) }); await flush()
    expect(window.location.hash).toBe('')
  })

  it('#4: página con dos negocios (la sesión activa es la de B): entra en A desde la ventana y A sí va a pagar', async () => {
    await act(async () => { state.bindCustomerSessionToVenue('studio-a') })
    ;(globalThis as any).__entradaDePrueba = ENTRADA_G
    vi.mocked(api.createPackCheckout).mockResolvedValue({ checkoutUrl: '#pago-de-ana' })
    await comprar()
    await act(async () => { state.bindCustomerSessionToVenue('studio-b') }) // se montó el portal de B al final
    fireEvent.click(screen.getByRole('button', { name: 'Simular entrar' })); await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Ir al pago' })); await flush()
    expect(api.createPackCheckout).toHaveBeenCalledTimes(1)
    expect(vi.mocked(api.createPackCheckout).mock.calls[0][0]).toBe('studio-a')
    expect(vi.mocked(api.createPackCheckout).mock.calls[0][3]).toBe('tok-G')
    expect(window.location.hash).toBe('#pago-de-ana')
  })

  it('#5: entra mientras otro pago de la página sigue en vuelo ⇒ se le avisa, no se descarta en silencio', async () => {
    await act(async () => { state.bindCustomerSessionToVenue('studio-a') })
    ;(globalThis as any).__entradaDePrueba = ENTRADA_G
    await comprar()
    state.comprandoPaquete.add('studio-a') // el pago de la sesión anterior todavía no responde
    fireEvent.click(screen.getByRole('button', { name: 'Simular entrar' })); await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Ir al pago' })); await flush()
    expect(api.createPackCheckout).not.toHaveBeenCalled()
    expect(state.toastMessage.value?.text).toBe(OTRO_PAGO)
  })

  it('#6 y r2 #1: la sesión venció al comprar (401) ⇒ «Entra otra vez», sin «sigue sin cuenta» y sin abrir sola una ventana', async () => {
    await entra('tok-A', ANA)
    vi.mocked(api.createPackCheckout).mockImplementationOnce(async () => {
      state.clearCustomerSession('studio-a') // como la API real: suelta la sesión antes de lanzar el 401
      throw { status: 401, enviado: 'tok-A' }
    })
    await comprar()
    expect(state.toastMessage.value?.text).toBe('Tu sesión se cerró. Entra otra vez.')
    // Un 401 tardío no cambia el paquete de una ventana que la clienta ya abrió para otro: no abre ninguna.
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('r2 #3: el widget se retira de la página con el pago en vuelo ⇒ no se abre', async () => {
    await entra('tok-A', ANA)
    let resolver: (r: { checkoutUrl: string }) => void = () => {}
    vi.mocked(api.createPackCheckout).mockImplementationOnce(() => new Promise(si => { resolver = si }))
    await comprar()
    cleanup()
    await act(async () => { resolver({ checkoutUrl: '#pago-de-ana' }) }); await flush()
    expect(window.location.hash).toBe('')
  })

  it('r2 #4: cambia de Google a correo y responden las dos ⇒ la ventana enseña la última cuenta y paga con ésa', async () => {
    await act(async () => { state.bindCustomerSessionToVenue('studio-a') })
    vi.mocked(api.createPackCheckout).mockResolvedValue({ checkoutUrl: '#pago' })
    await comprar()
    const entrar = (globalThis as any).__onEntro
    const CORREO = { token: 'tok-C', customer: { ...ANA, firstName: 'Ana', phone: null, email: 'ana@correo.mx' },
      contactos: [{ tipo: 'EMAIL', valor: 'ana@correo.mx', metodo: 'CODIGO', probadoEn: 1 }] }
    await act(async () => {
      guardarSesion('studio-a', { ...CORREO, guardadaEn: Date.now() } as any); entrar(CORREO)
      guardarSesion('studio-a', { ...ENTRADA_G, guardadaEn: Date.now() } as any); entrar(ENTRADA_G) // Google respondió tarde
    }); await flush()
    expect(api.createPackCheckout).not.toHaveBeenCalled()
    expect(screen.getByText('Entraste como Ana · ana@gmail.com')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Ir al pago' })); await flush()
    expect(vi.mocked(api.createPackCheckout).mock.calls[0][3]).toBe('tok-G')
  })

  it('r2 #5: página con dos negocios y sesión en A (la activa es B) ⇒ «Comprar» de A va directo, sin pedir entrar', async () => {
    await entra('tok-A', ANA)
    vi.mocked(api.createPackCheckout).mockResolvedValue({ checkoutUrl: '#pago-de-ana' })
    const boton = await abrirPaquetes()
    await act(async () => { state.bindCustomerSessionToVenue('studio-b') })
    fireEvent.click(boton); await flush()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(vi.mocked(api.createPackCheckout).mock.calls[0][0]).toBe('studio-a')
    expect(vi.mocked(api.createPackCheckout).mock.calls[0][3]).toBe('tok-A')
  })

  it('r3 #1: con la confirmación del paquete 1 abierta elige el 2 por otro lado ⇒ la del 1 se cierra (no queda para pagarla después)', async () => {
    await act(async () => { state.bindCustomerSessionToVenue('studio-a') })
    ;(globalThis as any).__entradaDePrueba = ENTRADA_G
    vi.mocked(api.getVenueInfo).mockResolvedValue({ ...venue, canCharge: true })
    vi.mocked(api.getCreditPacks).mockResolvedValue([PAQUETE, { ...PAQUETE, id: 'pk2', name: 'Mini Pack' }] as any)
    window.history.replaceState({}, '', '/studio-a')
    render(<BookingFlow props={{ ...props(), flowType: 'unified' }} />); await flush()
    fireEvent.click(screen.getByRole('tab', { name: 'Comprar paquetes' })); await flush()
    fireEvent.click(screen.getAllByRole('button', { name: 'Comprar' })[0]); await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Simular entrar' })); await flush()
    expect(screen.getByRole('button', { name: 'Ir al pago' })).toBeTruthy()
    vi.mocked(api.createPackCheckout).mockRejectedValueOnce({ status: 400, data: { message: 'falló' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Comprar' })[1]); await flush() // el 2, p. ej. desde la cabecera
    expect(vi.mocked(api.createPackCheckout).mock.calls[0][1]).toBe('pk2')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Ir al pago' })).toBeNull()
  })

  it('r3 #2: «Usar otra cuenta» en la confirmación sale de esa cuenta y vuelve a «Entra a tu cuenta»', async () => {
    await act(async () => { state.bindCustomerSessionToVenue('studio-a') })
    ;(globalThis as any).__entradaDePrueba = ENTRADA_G
    await comprar()
    fireEvent.click(screen.getByRole('button', { name: 'Simular entrar' })); await flush()
    expect(state.customerToken.value).toBe('tok-G')
    fireEvent.click(screen.getByRole('button', { name: 'Usar otra cuenta' })); await flush()
    expect(state.customerToken.value).toBeNull()
    expect(screen.getByRole('heading', { name: 'Entra a tu cuenta' })).toBeTruthy()
    expect(api.createPackCheckout).not.toHaveBeenCalled()
  })

  it('r3 #3: pago en vuelo en A, el widget va a B y regresa a A antes de la respuesta ⇒ no se abre', async () => {
    await entra('tok-A', ANA)
    let resolver: (r: { checkoutUrl: string }) => void = () => {}
    vi.mocked(api.createPackCheckout).mockImplementationOnce(() => new Promise(si => { resolver = si }))
    vi.mocked(api.getVenueInfo).mockResolvedValue({ ...venue, canCharge: true })
    vi.mocked(api.getCreditPacks).mockResolvedValue([PAQUETE] as any)
    window.history.replaceState({}, '', '/studio-a')
    const { rerender } = render(<BookingFlow props={{ ...props(), flowType: 'unified' }} />); await flush()
    fireEvent.click(screen.getByRole('tab', { name: 'Comprar paquetes' })); await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Comprar' })); await flush()
    rerender(<BookingFlow props={{ ...props('studio-b'), flowType: 'unified' }} />); await flush()
    rerender(<BookingFlow props={{ ...props(), flowType: 'unified' }} />); await flush()
    await act(async () => { resolver({ checkoutUrl: '#pago-de-a' }) }); await flush()
    expect(window.location.hash).toBe('')
  })

  it('r3 #4: «Ir al pago» y otra pestaña cambia la sesión ⇒ no se abre y se le dice por qué', async () => {
    await act(async () => { state.bindCustomerSessionToVenue('studio-a') })
    ;(globalThis as any).__entradaDePrueba = ENTRADA_G
    let resolver: (r: { checkoutUrl: string }) => void = () => {}
    vi.mocked(api.createPackCheckout).mockImplementationOnce(() => new Promise(si => { resolver = si }))
    await comprar()
    fireEvent.click(screen.getByRole('button', { name: 'Simular entrar' })); await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Ir al pago' })); await flush()
    borrarSesion('studio-a') // la otra pestaña
    await act(async () => { resolver({ checkoutUrl: '#pago' }) }); await flush()
    expect(window.location.hash).toBe('')
    expect(state.toastMessage.value?.text).toBe('Cambió la cuenta o el negocio mientras preparábamos tu pago. Vuelve a tocar «Comprar».')
  })

  it('r4 #1: el widget se retira con «Entra a tu cuenta» validando ⇒ esa entrada tardía no activa su cuenta en la página', async () => {
    await act(async () => { state.bindCustomerSessionToVenue('studio-a') })
    await comprar()
    const entradaVieja = (globalThis as any).__onEntro
    cleanup() // la clienta salió de la sección de reservas
    await act(async () => {
      guardarSesion('studio-a', { ...ENTRADA_G, guardadaEn: Date.now() } as any)
      entradaVieja(ENTRADA_G)
    }); await flush()
    expect(state.customerToken.value).toBeNull()
  })

  it('r4 #2: la liga de A responde justo al cambiar a B, antes de que corran los efectos ⇒ no se abre', async () => {
    await entra('tok-A', ANA)
    let resolver: (r: { checkoutUrl: string }) => void = () => {}
    vi.mocked(api.createPackCheckout).mockImplementationOnce(() => new Promise(si => { resolver = si }))
    vi.mocked(api.getVenueInfo).mockResolvedValue({ ...venue, canCharge: true })
    vi.mocked(api.getCreditPacks).mockResolvedValue([PAQUETE] as any)
    window.history.replaceState({}, '', '/studio-a')
    const { rerender } = render(<BookingFlow props={{ ...props(), flowType: 'unified' }} />); await flush()
    fireEvent.click(screen.getByRole('tab', { name: 'Comprar paquetes' })); await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Comprar' })); await flush()
    await act(async () => {
      rerender(<BookingFlow props={{ ...props('studio-b'), flowType: 'unified' }} />)
      resolver({ checkoutUrl: '#pago-de-a' })
      await Promise.resolve(); await Promise.resolve()
    }); await flush()
    expect(window.location.hash).toBe('')
  })

  it('r4 #4: con sesión, «Comprar» dice que se está preparando el pago y de qué paquete', async () => {
    await entra('tok-A', ANA)
    vi.mocked(api.createPackCheckout).mockReturnValue(new Promise(() => {}))
    await comprar()
    expect(state.toastMessage.value?.text).toBe('Preparando tu pago de Mega Pack…')
  })

  it('r5 #1: abre «Mi cuenta» mientras se valida su código ⇒ esa entrada no cuenta y al volver no hay confirmación vieja', async () => {
    await act(async () => { state.bindCustomerSessionToVenue('studio-a') })
    await comprar()
    const entradaVieja = (globalThis as any).__onEntro
    await act(async () => { state.showPortal.value = true }); await flush()
    await act(async () => {
      guardarSesion('studio-a', { ...ENTRADA_G, guardadaEn: Date.now() } as any)
      entradaVieja(ENTRADA_G)
    }); await flush()
    expect(state.customerToken.value).toBeNull()
    await act(async () => { state.showPortal.value = false }); await flush()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('r5 #2: elegir otro paquete con la ventana abierta la abre de nuevo, en limpio (no conserva el código anterior)', async () => {
    await act(async () => { state.bindCustomerSessionToVenue('studio-a') })
    vi.mocked(api.getVenueInfo).mockResolvedValue({ ...venue, canCharge: true })
    vi.mocked(api.getCreditPacks).mockResolvedValue([PAQUETE, { ...PAQUETE, id: 'pk2', name: 'Mini Pack' }] as any)
    window.history.replaceState({}, '', '/studio-a')
    render(<BookingFlow props={{ ...props(), flowType: 'unified' }} />); await flush()
    fireEvent.click(screen.getByRole('tab', { name: 'Comprar paquetes' })); await flush()
    fireEvent.click(screen.getAllByRole('button', { name: 'Comprar' })[0]); await flush()
    const primera = screen.getByRole('heading', { name: 'Entra a tu cuenta' })
    fireEvent.click(screen.getAllByRole('button', { name: 'Comprar' })[1]); await flush()
    expect(screen.getByRole('heading', { name: 'Entra a tu cuenta' })).not.toBe(primera) // otra ventana, no la misma con su estado
  })

  it('r5 #3: el reloj de «Preparando…» no borra el aviso del 401 que llegó después', async () => {
    await entra('tok-A', ANA)
    let rechazar: (e: unknown) => void = () => {}
    vi.mocked(api.createPackCheckout).mockImplementationOnce(() => new Promise((_, no) => { rechazar = no }))
    await comprar()
    await advance(3990)
    await act(async () => { state.clearCustomerSession('studio-a'); rechazar({ status: 401, enviado: 'tok-A' }) }); await flush()
    await advance(20); await flush()
    expect(state.toastMessage.value?.text).toBe('Tu sesión se cerró. Entra otra vez.')
  })

  it('r5 #4: el error de un pago de A no se enseña tras cambiar a B', async () => {
    await entra('tok-A', ANA)
    let rechazar: (e: unknown) => void = () => {}
    vi.mocked(api.createPackCheckout).mockImplementationOnce(() => new Promise((_, no) => { rechazar = no }))
    vi.mocked(api.getVenueInfo).mockResolvedValue({ ...venue, canCharge: true })
    vi.mocked(api.getCreditPacks).mockResolvedValue([PAQUETE] as any)
    window.history.replaceState({}, '', '/studio-a')
    const { rerender } = render(<BookingFlow props={{ ...props(), flowType: 'unified' }} />); await flush()
    fireEvent.click(screen.getByRole('tab', { name: 'Comprar paquetes' })); await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Comprar' })); await flush()
    rerender(<BookingFlow props={{ ...props('studio-b'), flowType: 'unified' }} />); await flush()
    state.toastMessage.value = null
    await act(async () => { rechazar({ status: 401 }) }); await flush()
    expect(state.toastMessage.value).toBeNull()
  })

  it('r5 #5: vuelve de Stripe y en la pestaña ya es OTRA cuenta ⇒ aviso neutro, sin consultar ni anunciar saldo', async () => {
    sessionStorage.setItem('avq:compraDe', JSON.stringify({ venue: 'studio-a', cliente: 'c1' })) // pagó Ana
    await entra('tok-B', BEA) // al volver, la pestaña es de Bea
    window.history.replaceState({}, '', '/studio-a?avq_credits=success')
    render(<BookingFlow props={{ ...props(), flowType: 'unified' }} />); await flush()
    expect(api.getCustomerCredits).not.toHaveBeenCalled()
    expect(state.toastMessage.value?.text).toBe('¡Listo! Recibimos tu pago: los créditos quedan en la cuenta con la que pagaste.')
  })

  it('r6 #1: vuelve de Stripe quien ya tenía otra compra ⇒ no se le dice «ya están en tu cuenta» por una compra vieja', async () => {
    await entra('tok-A', ANA)
    sessionStorage.setItem('avq:compraDe', JSON.stringify({ venue: 'studio-a', cliente: 'c1' }))
    vi.mocked(api.getCustomerPortal).mockReturnValue(new Promise(() => {}))
    vi.mocked(api.getCustomerCredits).mockResolvedValue({ purchases: [{ id: 'vieja' }] } as any) // su compra de antes
    window.history.replaceState({}, '', '/studio-a?avq_credits=success')
    render(<BookingFlow props={{ ...props(), flowType: 'unified' }} />); await flush()
    await advance(100); await flush()
    expect(state.toastMessage.value?.text).toBe('¡Listo! Recibimos tu pago: los créditos quedan en la cuenta con la que pagaste.')
  })

  it('r6 #1: el saldo del regreso de Stripe no se publica si en otra pestaña cerró su sesión mientras llegaba', async () => {
    await entra('tok-A', ANA)
    sessionStorage.setItem('avq:compraDe', JSON.stringify({ venue: 'studio-a', cliente: 'c1' }))
    vi.mocked(api.getCustomerPortal).mockReturnValue(new Promise(() => {}))
    let resolver: (r: unknown) => void = () => {}
    vi.mocked(api.getCustomerCredits).mockImplementationOnce(() => new Promise(si => { resolver = si }) as any)
    window.history.replaceState({}, '', '/studio-a?avq_credits=success')
    render(<BookingFlow props={{ ...props(), flowType: 'unified' }} />); await flush()
    state.customerCredits.value = null
    borrarSesion('studio-a') // la otra pestaña
    await act(async () => { resolver({ purchases: [{ id: 'nueva' }] }) }); await flush()
    expect(state.customerCredits.value).toBeNull()
  })

  it('r6 #2: el 401 de la sesión vieja no le dice «Tu sesión se cerró» a la cuenta que entró después', async () => {
    await entra('tok-A', ANA)
    let rechazar: (e: unknown) => void = () => {}
    vi.mocked(api.createPackCheckout).mockImplementationOnce(() => new Promise((_, no) => { rechazar = no }))
    await comprar()
    await entra('tok-B', BEA) // salió y entró otra persona
    state.toastMessage.value = null
    await act(async () => { rechazar({ status: 401 }) }); await flush()
    expect(state.toastMessage.value).toBeNull()
  })

  it('r7 #1: se le venció SU sesión al comprar (la API la suelta antes del error) ⇒ sí se le dice «Entra otra vez»', async () => {
    await entra('tok-A', ANA)
    vi.mocked(api.createPackCheckout).mockImplementationOnce(async () => {
      state.clearCustomerSession('studio-a') // lo que hace la API con un 401 antes de lanzar
      throw { status: 401, enviado: 'tok-A' }
    })
    await comprar()
    expect(state.toastMessage.value?.text).toBe('Tu sesión se cerró. Entra otra vez.')
  })

  it('r2 #6: con un pago de la página en vuelo, otro «Comprar» avisa en vez de tragarse el toque', async () => {
    await entra('tok-A', ANA)
    state.comprandoPaquete.add('studio-a') // p. ej. el de «Mi cuenta»
    await comprar()
    expect(api.createPackCheckout).not.toHaveBeenCalled()
    expect(state.toastMessage.value?.text).toBe(OTRO_PAGO)
  })
})

describe('D656: el pago de un paquete se prepara una sola vez, y sólo para quien sigue en sesión', () => {
  afterEach(() => { cleanup(); borrarSesion('studio-a'); state.clearCustomerSession('studio-a') })

  it('P3: dos toques antes de que el botón se repinte ⇒ UNA sola petición de pago', async () => {
    await entra('tok-A', ANA)
    vi.mocked(api.createPackCheckout).mockReturnValue(new Promise(() => {}))
    const boton = await abrirPaquetes()
    await act(async () => { boton.click(); boton.click() }); await flush()
    expect(api.createPackCheckout).toHaveBeenCalledTimes(1)
  })

  it('P3: tras un fallo, el segundo toque sí prepara el pago y la clienta va a pagar', async () => {
    await entra('tok-A', ANA)
    vi.mocked(api.createPackCheckout)
      .mockRejectedValueOnce({ status: 400, data: { message: 'Sin pagos en línea' } })
      .mockResolvedValueOnce({ checkoutUrl: '#pago' })
    await comprar()
    fireEvent.click(screen.getByRole('button', { name: 'Comprar' })); await flush()
    expect(api.createPackCheckout).toHaveBeenCalledTimes(2)
    expect(window.location.hash).toBe('#pago')
  })

  it('P2: Ana compra con sesión, entra Bea y llega tarde la respuesta EXITOSA de Ana ⇒ no se abre su pago', async () => {
    await entra('tok-A', ANA)
    let resolver: (r: { checkoutUrl: string }) => void = () => {}
    vi.mocked(api.createPackCheckout).mockImplementationOnce(() => new Promise(si => { resolver = si }))
    await comprar()
    expect(vi.mocked(api.createPackCheckout).mock.calls[0][3]).toBe('tok-A')
    await entra('tok-B', BEA)
    await act(async () => { resolver({ checkoutUrl: '#pago-de-ana' }) }); await flush()
    expect(window.location.hash).toBe('')
  })

  it('P2: renovar la sesión de Ana (otro token, misma clienta) no cancela su compra', async () => {
    await entra('tok-A', ANA)
    let resolver: (r: { checkoutUrl: string }) => void = () => {}
    vi.mocked(api.createPackCheckout).mockImplementationOnce(() => new Promise(si => { resolver = si }))
    await comprar()
    await entra('tok-A2', ANA)
    await act(async () => { resolver({ checkoutUrl: '#pago-de-ana' }) }); await flush()
    expect(window.location.hash).toBe('#pago-de-ana')
  })

  it('codex-r1 #2: sesión vieja sin ficha que se completa mientras se prepara el pago ⇒ sí va a pagar', async () => {
    let ficha: (d: unknown) => void = () => {}
    vi.mocked(api.getCustomerPortal).mockImplementation(() => new Promise(si => { ficha = si }) as any)
    await act(async () => {
      state.bindCustomerSessionToVenue('studio-a')
      // Una sesión de antes (sólo el token de reservas, sin la ficha guardada): la ficha se completa al leer «Mi cuenta». Vive en lo
      // guardado de antes (`avq_customer_token:<negocio>`), que es lo que la página vuelve a mirar antes de abrir el pago.
      localStorage.setItem('avq_customer_token:studio-a', 'tok-viejo')
      fijarPagina('studio-a', 'reservas', { token: 'tok-viejo', identidad: 'hoy:reservas|tok-viejo', datos: null })
    })
    let resolver: (r: { checkoutUrl: string }) => void = () => {}
    vi.mocked(api.createPackCheckout).mockImplementationOnce(() => new Promise(si => { resolver = si }))
    await comprar()
    expect(vi.mocked(api.createPackCheckout).mock.calls[0][3]).toBe('tok-viejo')
    await act(async () => { ficha({ customer: { ...ANA, loyaltyPoints: 0, totalVisits: 0 }, credits: { purchases: [] }, reservations: { upcoming: [], past: [] } }) }); await flush()
    expect(state.customerInfo.value?.id).toBe('c1')
    await act(async () => { resolver({ checkoutUrl: '#pago-de-ana' }) }); await flush()
    expect(window.location.hash).toBe('#pago-de-ana')
  })

  it('codex-r1 #1: el pago en vuelo y la página abre «Mi cuenta» (evento): su «Comprar» no prepara otro pago', async () => {
    await entra('tok-A', ANA)
    const vacia = { items: [], total: 0, nextCursor: null }
    vi.mocked(api.getCustomerPortal).mockResolvedValue({
      customer: { ...ANA, loyaltyPoints: 0, totalVisits: 0 }, credits: { purchases: [] }, reservations: { upcoming: [], past: [] },
      invitadaRequiereEntrar: false, descuentos: vacia, tarjetas: vacia, pedidos: vacia, otraFicha: null,
    } as any)
    vi.mocked(api.createPackCheckout).mockReturnValue(new Promise(() => {}))
    const widgetProps = { ...props(), flowType: 'unified' as const }
    vi.mocked(api.getVenueInfo).mockResolvedValue({ ...venue, canCharge: true })
    vi.mocked(api.getCreditPacks).mockResolvedValue([PAQUETE] as any)
    window.history.replaceState({}, '', '/studio-a')
    render(<BookingFlow props={widgetProps} />); await flush()
    fireEvent.click(screen.getByRole('tab', { name: 'Comprar paquetes' })); await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Comprar' })); await flush()
    await act(async () => { widgetProps.hostElement!.dispatchEvent(new CustomEvent('_avq_show_account')) }); await flush()
    expect(state.showPortal.value).toBe(true)
    await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Comprar' })); await flush()
    expect(api.createPackCheckout).toHaveBeenCalledTimes(1)
  })
})

describe('diseño 18-nov: la portada de la reserva no se repite en el detalle de un servicio', () => {
  afterEach(() => { cleanup() })
  it('se ve en la lista de servicios y no en el detalle', async () => {
    vi.mocked(api.getVenueInfo).mockResolvedValue({
      ...venue, heroImageUrl: 'https://img.test/portada.png',
      branding: { ...state.DEFAULT_BRANDING, showHeroImage: true },
      products: [...venue.products, { ...venue.products[0], id: 'service-b', name: 'Otro servicio' }],
    } as any)
    render(<BookingFlow props={props()} />); await flush()
    expect(document.querySelector('.avq-hero')).not.toBeNull()
    fireEvent.click(screen.getByText('Otro servicio')); await flush()
    expect(screen.getByRole('heading', { name: 'Otro servicio' })).toBeTruthy()
    expect(document.querySelector('.avq-hero')).toBeNull()
  })
})

describe('diseño 18-nov: «Clases» se esconde si no hay clases agendadas en 30 días', () => {
  afterEach(() => { cleanup(); state.hayClasesProximas.value = null })
  const conClases = {
    ...venue,
    products: [...venue.products, { ...venue.products[0], id: 'clase-1', name: 'Yoga', type: 'CLASS' }],
  }
  async function portada() {
    vi.mocked(api.getVenueInfo).mockResolvedValue(conClases as any)
    window.history.replaceState({}, '', '/studio-a')
    const host = document.createElement('div')
    const avisos: unknown[] = []
    host.addEventListener('avoqado:classes-availability', e => avisos.push((e as CustomEvent).detail))
    render(<BookingFlow props={{ ...props(), flowType: 'unified', hostElement: host }} />); await flush()
    return avisos
  }
  it('sin clases agendadas: la portada no ofrece «Clases» y avisa a la página', async () => {
    vi.mocked(api.getClassSessionsRange).mockResolvedValue({ dateFrom: '2026-10-06', dateTo: '2026-11-05', slots: [] })
    const avisos = await portada()
    expect(screen.queryByRole('button', { name: /Clases/ })).toBeNull()
    // Diseño 27-nov: sin la pantalla «¿Qué quieres reservar?», la portada va directo a lo que sí hay (citas).
    expect(state.flowType.value).toBe('appointments')
    expect(screen.getByRole('button', { name: '8 de octubre de 2026' })).toBeTruthy()
    expect(avisos).toEqual([{ hayClases: false }])
  })
  it('con clases agendadas: «Clases» sigue', async () => {
    vi.mocked(api.getClassSessionsRange).mockResolvedValue({ dateFrom: '2026-10-06', dateTo: '2026-11-05', slots: [{ id: 's1' }] } as any)
    const avisos = await portada()
    expect(screen.getByRole('button', { name: /Clases/ })).toBeTruthy()
    expect(avisos).toEqual([{ hayClases: true }])
  })
  it('si la consulta falla, «Clases» se queda (como antes)', async () => {
    vi.mocked(api.getClassSessionsRange).mockRejectedValue(new Error('sin red'))
    await portada()
    expect(screen.getByRole('button', { name: /Clases/ })).toBeTruthy()
  })
})

// D684a (Mindform, 22-nov): volvió de Stripe sin pagar a «Tu Reservación» y tocar «Citas · Clases · Comprar paquetes» no hacía
// nada. Cada pestaña es un enlace que recarga la página, y la página nueva volvía a abrir «Tu Reservación» con la reserva
// guardada en el navegador. La cabecera ahora avisa (`leaveManageBooking`) antes de seguir el enlace.
describe('D684a: elegir otra pestaña desde «Tu Reservación»', () => {
  const salir = (host: HTMLElement) => act(async () => { host.dispatchEvent(new CustomEvent('_avq_leave_manage')) })

  it('volvió de Stripe sin pagar y eligió otra pestaña: la página nueva enseña la pestaña, no «Tu Reservación» otra vez', async () => {
    sessionStorage.setItem('avq:pendingReservation:studio-a', JSON.stringify(saved))
    window.history.replaceState({}, '', '/studio-a/appointments?avq_payment=cancelled&payment=cancelled&reservationId=r1')
    const p = props()
    const antes = render(<BookingFlow props={p} />); await flush()
    expect(screen.getByText('OWN-A')).toBeTruthy()
    await salir(p.hostElement!); await flush()
    expect(screen.queryByText('OWN-A')).toBeNull()
    expect(sessionStorage.getItem('avq:pendingReservation:studio-a')).toBeNull()
    // El enlace de la pestaña carga la página de nuevo.
    antes.unmount(); resetSignals()
    window.history.replaceState({}, '', '/studio-a/appointments')
    render(<BookingFlow props={props()} />); await flush()
    expect(screen.queryByText('OWN-A')).toBeNull()
    expect(screen.getByRole('button', { name: '8 de octubre de 2026' })).toBeTruthy()
    expect(api.getReservation).toHaveBeenCalledTimes(1)
  })

  it('🔴 Codex texto r3 #1: llegó por la liga del correo (?manage=): sale de «Tu Reservación» SIN tocar la dirección', async () => {
    // La pestaña de la cabecera navega a /<negocio>#packs. Con `?manage=` todavía en la barra es una página nueva (como en main) y
    // abre los paquetes; si el widget lo quitara antes, sólo cambiaría el «#» y se quedaría en la portada.
    window.history.replaceState({}, '', '/studio-a?manage=url-secret&campaign=fall')
    const p = props()
    render(<BookingFlow props={p} />); await flush()
    expect(screen.getByText('OWN-A')).toBeTruthy()
    await salir(p.hostElement!); await flush()
    expect(screen.queryByText('OWN-A')).toBeNull()
    expect(window.location.search).toBe('?manage=url-secret&campaign=fall')
  })

  it('«Hacer una Nueva Reservación» desde la liga del correo sí quita `?manage=` (para que recargar no la vuelva a abrir)', async () => {
    window.history.replaceState({}, '', '/studio-a/appointments?manage=url-secret&campaign=fall')
    render(<BookingFlow props={props()} />); await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Hacer una Nueva Reservación' })); await flush()
    expect(screen.queryByText('OWN-A')).toBeNull()
    expect(window.location.search).toBe('?campaign=fall')
  })

  it('fuera de «Tu Reservación» el aviso de la cabecera no toca lo que lleva escrito', async () => {
    const p = props()
    await openAppointmentForm(p)
    fireEvent.input(screen.getByLabelText(/Nombre/), { target: { value: 'Ana Escribiendo' } })
    await salir(p.hostElement!); await flush()
    expect((screen.getByLabelText(/Nombre/) as HTMLInputElement).value).toBe('Ana Escribiendo')
  })
})

// D684b (Mindform, 22-nov): un estudio que sólo da clases enseñaba «Citas» en la cabecera de book.avoqado.io. Lo único que cambia
// en el widget es el aviso a la página: `hasAppointments`, con el catálogo COMPLETO (no la ventana de 30 días de las clases). La
// página (public/index.html) esconde «Citas» sólo con `false`. Lo demás del widget (portada, /appointments) queda como en `main`.
describe('D684b: el widget le dice a la página si hay citas', () => {
  const clase = { ...venue.products[0], id: 'clase-1', name: 'Clase Lagree', type: 'CLASS' }
  async function avisoAlCargar(products: object[], sesiones: object[] = []) {
    vi.mocked(api.getVenueInfo).mockResolvedValue({ ...venue, products } as PublicVenueInfo)
    vi.mocked(api.getClassSessionsRange).mockResolvedValue({ dateFrom: '2026-10-06', dateTo: '2026-11-05', slots: sesiones } as any)
    const host = document.createElement('div')
    const avisos: Record<string, unknown>[] = []
    host.addEventListener('avoqado:venue-loaded', e => avisos.push((e as CustomEvent).detail.venue))
    render(<BookingFlow props={{ ...props(), hostElement: host }} />); await flush()
    return avisos[0]
  }

  it('🔴 estudio que sólo da clases: hasAppointments false (la cabecera esconde «Citas»)', async () => {
    expect(await avisoAlCargar([clase])).toMatchObject({ hasClasses: true, hasAppointments: false })
  })
  it('sin productos (un restaurante que recibe reservas): hasAppointments true, «Citas» se queda', async () => {
    expect(await avisoAlCargar([])).toMatchObject({ hasClasses: false, hasAppointments: true })
  })
  it('con servicios con cita (con o sin clases): hasAppointments true', async () => {
    expect(await avisoAlCargar([venue.products[0]])).toMatchObject({ hasClasses: false, hasAppointments: true })
    cleanup(); resetSignals()
    expect(await avisoAlCargar([venue.products[0], clase])).toMatchObject({ hasClasses: true, hasAppointments: true })
  })
  it('clases sin sesiones en 30 días: el aviso usa el catálogo completo, no esa ventana', async () => {
    // Con servicios y clases sin sesiones próximas, «Citas» sigue (como en main); sólo «Clases» depende de los 30 días.
    expect(await avisoAlCargar([venue.products[0], clase], [])).toMatchObject({ hasClasses: true, hasAppointments: true })
    cleanup(); resetSignals()
    expect(await avisoAlCargar([clase], [])).toMatchObject({ hasClasses: true, hasAppointments: false })
  })
  it('/appointments sigue como en main: sin productos abre el calendario', async () => {
    await avisoAlCargar([])
    expect(screen.getByRole('button', { name: '8 de octubre de 2026' })).toBeTruthy()
  })
})

// D683 (Mindform, 22-nov): reservó «Clase Lagree» $325, fue a Stripe y regresó sin pagar. «Tu Reservación» decía «Estamos
// confirmando el depósito · Pendiente», como si hubiera pagado. D681 (sólo texto, 22-nov): el SERVIDOR no cambia nada y el lugar lo
// suelta el aviso de Stripe cuando vence la liga. Al volver por «atrás»: «No se completó el pago. Si no lo terminas, tu lugar se
// libera solo cuando venza el enlace de pago». Sin volver por la liga de pago hecho, nunca «Estamos confirmando». Sin «Pagar ahora»:
// quien quiera pagar vuelve a reservar o usa la liga de su correo.
describe('D683: volvió de Stripe sin pagar', () => {
  const permitido = { allowed: true, minHoursBeforeStart: 2, creditsUsed: 0, creditsRefundable: 0, refundPercent: 0, policyLabel: '' }
  const sinPagar = { ...detail, status: 'PENDING', depositStatus: 'PENDING', cancellation: permitido }
  const NO_SE_COMPLETO = 'No se completó el pago. Si no lo terminas, tu lugar se libera solo cuando venza el enlace de pago'
  const ESPERANDO = 'Esperando tu pago. Si no lo terminas, tu lugar se libera solo cuando venza el enlace de pago'
  async function volver(url: string, reserva: object = sinPagar, guardada: object = saved) {
    sessionStorage.setItem('avq:pendingReservation:studio-a', JSON.stringify(guardada))
    window.history.replaceState({}, '', url)
    vi.mocked(api.getReservation).mockResolvedValue(reserva as PublicReservationDetail)
    const vista = render(<BookingFlow props={props()} />); await flush()
    return vista
  }
  const aviso = () => screen.getByRole('status').textContent ?? ''

  it('🔴 D681: al volver por «atrás» de Stripe dice que no se completó y que se libera solo; sin «Pagar ahora»; consulta como en main', async () => {
    await volver('/studio-a/classes?avq_payment=cancelled&payment=cancelled&reservationId=r1')
    expect(aviso()).toBe(NO_SE_COMPLETO)
    expect(screen.queryByText(/Estamos confirmando/)).toBeNull()
    expect(screen.queryByText('Pagar ahora')).toBeNull()
    expect(screen.getByRole('button', { name: 'Cancelar Reservación' })).toBeTruthy()
    await advance(40000); expect(api.getReservation).toHaveBeenCalledTimes(12)
    expect(api.getReservation).toHaveBeenCalledWith('studio-a', 'stored-a', expect.any(AbortSignal))
  })

  it('la marca de regreso se guarda con la reserva y se quita de la dirección al reconocerla; la liga de pago no se guarda', async () => {
    savePendingReservation('studio-a', { cancelSecret: 'c1', confirmationCode: 'C1', ref: 'r-c1', checkoutUrl: 'https://checkout.stripe.com/x' } as any)
    expect(JSON.parse(sessionStorage.getItem('avq:pendingReservation:studio-a')!)).toEqual({ venue: 'studio-a', cancelSecret: 'c1', confirmationCode: 'C1', ref: 'r-c1' })
    window.history.replaceState({}, '', '/studio-a/classes?avq_payment=cancelled&avq_ref=r-c1')
    expect(resolveDepositReturn('studio-a').saved?.cancelSecret).toBe('c1')
    expect(window.location.search).toBe('')
  })

  it('🔴 D681 (Codex #1): regresa de Stripe con la marca de OTRA reserva: no le habla de la guardada', async () => {
    // Abrió el pago de A, luego el de B en la misma pestaña (el navegador guarda sólo B) y volvió por la liga de A.
    await volver('/studio-a/classes?avq_payment=cancelled&avq_ref=marca-de-a&payment=cancelled&reservationId=ra', sinPagar,
      { ...saved, ref: 'marca-de-b' })
    expect(api.getReservation).not.toHaveBeenCalled()
    expect(screen.getByText('No pudimos recuperar esta reserva en este navegador. Consulta tu confirmación o contacta al negocio')).toBeTruthy()
    expect(screen.queryByText(/No se completó el pago|Esperando tu pago/)).toBeNull()
    expect(JSON.parse(sessionStorage.getItem('avq:pendingReservation:studio-a')!)).toEqual({ ...saved, ref: 'marca-de-b' })
  })

  it('regresa con la marca de la reserva guardada: la abre', async () => {
    await volver('/studio-a/classes?avq_payment=cancelled&avq_ref=marca-de-b', sinPagar, { ...saved, ref: 'marca-de-b' })
    expect(aviso()).toBe(NO_SE_COMPLETO)
    expect(window.location.search).toBe('')
  })

  it('recargar después de volver sin pagar sigue diciendo que no se completó', async () => {
    const antes = await volver('/studio-a/classes?avq_payment=cancelled')
    antes.unmount(); resetSignals()
    render(<BookingFlow props={props()} />); await flush()
    expect(aviso()).toBe(NO_SE_COMPLETO)
  })

  it('regresó con «atrás» del navegador (sin pasar por Stripe de vuelta): espera su pago, sin «confirmando»', async () => {
    await volver('/studio-a/classes')
    expect(aviso()).toBe(ESPERANDO)
  })

  it('volvió pagado y recarga mientras llega el aviso del banco: sigue «Estamos confirmando»', async () => {
    const antes = await volver('/studio-a/classes?avq_payment=success')
    expect(aviso()).toContain('Estamos confirmando el depósito')
    antes.unmount(); resetSignals()
    render(<BookingFlow props={props()} />); await flush()
    expect(aviso()).toContain('Estamos confirmando el depósito')
  })

  it.each([
    ['vencida por Stripe', { ...sinPagar, status: 'CANCELLED', depositStatus: 'EXPIRED' }, 'El plazo del depósito expiró'],
    ['pagada y reembolsada', { ...sinPagar, status: 'CANCELLED', depositStatus: 'REFUNDED' }, 'Depósito reembolsado'],
    ['pagada por la liga que seguía abierta', { ...sinPagar, status: 'CONFIRMED', depositStatus: 'PAID' }, 'Pago recibido'],
  ])('volvió por «atrás» y la reserva ya está %s: manda el depósito, sin «No se completó»', async (_caso, reserva, texto) => {
    await volver('/studio-a/classes?avq_payment=cancelled', reserva)
    expect(aviso()).toContain(texto)
    expect(screen.queryByText(/No se completó el pago|Esperando tu pago/)).toBeNull()
  })
})

describe('D679 · pagar una cita con un Ilimitado (Codex pantallas r1 #1 y #2)', () => {
  const saldo = (id: string, extra: Record<string, unknown>) => ({
    id, productId: 'service-a', product: { id: 'service-a', name: 'Servicio propio', type: 'APPOINTMENTS_SERVICE' }, ...extra,
  })
  const ilimitado = (expiresAt: string) => ({
    id: 'p-ili', creditPack: { name: 'Mensual Ilimitado' }, expiresAt, status: 'ACTIVE',
    itemBalances: [saldo('b-ili', { originalQuantity: 99999, remainingQuantity: 99999, unlimited: true })],
  })
  const normal = { id: 'p-5', creditPack: { name: 'Paquete 5' }, status: 'ACTIVE', itemBalances: [saldo('b-5', { originalQuantity: 5, remainingQuantity: 3 })] }
  function anaConCreditos(purchases: unknown[]) {
    guardarSesion('studio-a', {
      token: 'tok-ana', customer: { id: 'c1', firstName: 'Ana', lastName: 'Ruiz', email: null, phone: '5512345678' },
      contactos: [{ tipo: 'PHONE', valor: '+525512345678', metodo: 'WHATSAPP', probadoEn: 1 }], guardadaEn: Date.now(),
    })
    state.bindCustomerSessionToVenue('studio-a')
    state.entroAqui('studio-a', leerSesion('studio-a')!)
    vi.mocked(api.getCustomerCredits).mockResolvedValue({ customer: { id: 'c1' }, purchases } as any)
    vi.mocked(api.getCustomerPortal).mockReturnValue(new Promise(() => {}))
  }
  afterEach(() => state.clearCustomerSession('studio-a'))

  it('#1: «Número de personas: 2» cuenta como 2 lugares: el Ilimitado deja de ofrecerse, sale su aviso y no se manda con él', async () => {
    anaConCreditos([ilimitado('2026-11-05T06:00:00Z')])
    await openAppointmentForm()
    fireEvent.click(screen.getByRole('button', { name: /Pagar con créditos/ })); await flush()
    fireEvent.input(screen.getByLabelText(/Número de personas/), { target: { value: '2' } }); await flush()
    expect(screen.queryByRole('button', { name: /Pagar con créditos/ })).toBeNull()
    expect(screen.getByText('Tu Ilimitado es personal: cubre 1 lugar a tu nombre')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Reserva cita' })); await flush()
    // Lo elegido con 1 persona ya no vale con 2: no se manda con el Ilimitado (el SERVIDOR lo rechazaría); pregunta cómo pagar.
    expect(api.createReservation).not.toHaveBeenCalled()
    expect(screen.getByText('¿Cómo quieres pagar?')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Usar 1 crédito|Usar mi pase/ })).toBeNull()
  })

  it('#2: un Ilimitado que vence antes de la cita no se ofrece; lo dice con su fecha', async () => {
    anaConCreditos([ilimitado('2026-10-07T05:00:00Z')]) // vence el 6-oct (CDMX); la cita es el 8
    await openAppointmentForm()
    expect(screen.queryByRole('button', { name: /Pagar con créditos/ })).toBeNull()
    expect(screen.getByText('Tu Ilimitado vence el 6 de octubre, antes de este horario.')).toBeTruthy()
  })

  it('#2: con un paquete normal que sí sirve, se elige ése y no el Ilimitado vencido para esa fecha', async () => {
    anaConCreditos([ilimitado('2026-10-07T05:00:00Z'), normal])
    await openAppointmentForm()
    const opcion = screen.getByRole('button', { name: /Pagar con créditos/ })
    expect(opcion.textContent).toContain('Paquete 5')
    expect(opcion.textContent).not.toContain('Mensual Ilimitado')
  })
})

// Diseño 27-nov (portada): la entrada a reservar es el horario con la identidad del negocio; con clases y citas, «Clases | Citas».
describe('Portada: identidad del negocio, horario directo y «Clases | Citas»', () => {
  const lagree = { ...venue.products[0], id: 'class-a', name: 'Lagree', price: 325, duration: 50, type: 'CLASS' as const }
  const barre = { ...venue.products[0], id: 'class-b', name: 'Barre', price: 325, duration: 50, type: 'CLASS' as const }
  const sesiones = { dateFrom: '2026-10-06', dateTo: '2026-11-05', slots: [{
    startsAt: '2026-10-08T17:00:00Z', endsAt: '2026-10-08T17:50:00Z', available: true,
    classSessionId: 'session-lagree', productId: 'class-a', productName: 'Lagree', remaining: 8, capacity: 10, enrolled: 2,
  }] }
  const soloClases: PublicVenueInfo = { ...venue, address: 'Calle Uno 10', products: [lagree] }
  // Un estudio con 2 clases y UN servicio de citas.
  const lasDos: PublicVenueInfo = { ...venue, address: 'Calle Uno 10', products: [lagree, barre, venue.products[0]] }
  afterEach(() => { cleanup(); state.hayClasesProximas.value = null; state.clearCustomerSession('studio-a') })

  function montar(info: PublicVenueInfo, extra: Partial<WidgetProps> = {}) {
    vi.mocked(api.getVenueInfo).mockResolvedValue(info)
    vi.mocked(api.getClassSessionsRange).mockResolvedValue(sesiones)
    const p: WidgetProps = { ...props(), flowType: 'unified', ...extra }
    const navegaciones: unknown[] = []
    p.hostElement.addEventListener('avoqado:navigate', e => navegaciones.push((e as CustomEvent).detail))
    return { p, navegaciones, ...render(<BookingFlow props={p} />) }
  }

  it('negocio con clases y sin citas: no pregunta «¿Qué quieres reservar?»; la portada ES el horario', async () => {
    window.history.replaceState({}, '', '/studio-a')
    montar(soloClases); await flush()
    expect(screen.queryByText('¿Qué quieres reservar?')).toBeNull()
    expect(screen.getByRole('button', { name: /Lagree.*11:00/ })).toBeTruthy()
    expect(state.flowType.value).toBe('classes')
    // Sin citas no hay interruptor.
    expect(screen.queryByRole('button', { name: 'Citas' })).toBeNull()
  })

  it('las dos, en la página propia: abre en lo que tiene más y tocar «Citas» pide a la página cambiar su liga', async () => {
    window.history.replaceState({}, '', '/studio-a')
    const push = vi.spyOn(window.history, 'pushState')
    const { navegaciones } = montar(lasDos, { showIdentity: true }); await flush()
    expect(screen.queryByText('¿Qué quieres reservar?')).toBeNull()
    expect(screen.getByRole('button', { name: 'Clases' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('Clases en grupo con horario fijo')).toBeTruthy()
    // La entrada reemplaza la liga de la portada (no deja /studio-a en el historial).
    expect(navegaciones).toEqual([{ flow: 'classes', replace: true }])
    fireEvent.click(screen.getByRole('button', { name: 'Citas' })); await flush()
    expect(navegaciones).toEqual([{ flow: 'classes', replace: true }, { flow: 'appointments' }])
    // El `pushState` y el `flow-type` los hace la página (index.html), no el widget.
    expect(push).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Citas' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('Sesiones sólo para ti: eliges el servicio, el día y la hora')).toBeTruthy()
  })

  it('incrustado en otro sitio: tocar «Citas» no cambia la URL del sitio; cambia el flujo por dentro con su servicio elegido', async () => {
    window.history.replaceState({}, '', '/pagina-del-estudio')
    const push = vi.spyOn(window.history, 'pushState')
    const replace = vi.spyOn(window.history, 'replaceState')
    const { navegaciones } = montar(lasDos); await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Citas' })); await flush()
    expect(push).not.toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()
    expect(window.location.pathname).toBe('/pagina-del-estudio')
    expect(navegaciones).toEqual([])
    expect(state.flowType.value).toBe('appointments')
    expect(state.selectedProducts.value.map(x => x.id)).toEqual(['service-a'])
    expect(screen.getByRole('button', { name: '8 de octubre de 2026' })).toBeTruthy()
  })

  it('el apartado de la cita y la precarga de sus créditos siguen la señal del flujo (incrustado, sin cambiar el atributo)', async () => {
    guardarSesion('studio-a', {
      token: 'tok-ana', customer: { id: 'c1', firstName: 'Ana', lastName: null, email: null, phone: '5512345678' },
      contactos: [{ tipo: 'PHONE', valor: '+525512345678', metodo: 'WHATSAPP', probadoEn: 1 }], guardadaEn: Date.now(),
    })
    state.bindCustomerSessionToVenue('studio-a')
    state.entroAqui('studio-a', leerSesion('studio-a')!)
    vi.mocked(api.getCustomerCredits).mockResolvedValue({ purchases: [] } as any)
    vi.mocked(api.getCustomerPortal).mockReturnValue(new Promise(() => {}))
    vi.mocked(api.createHold).mockResolvedValue({ holdId: 'hold-cita', expiresAt: new Date(Date.now() + 600000).toISOString(), ttlSeconds: 600 })
    window.history.replaceState({}, '', '/pagina-del-estudio')
    montar(lasDos); await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Citas' })); await flush()
    fireEvent.click(screen.getByRole('button', { name: '8 de octubre de 2026' })); await flush()
    fireEvent.click(screen.getByRole('button', { name: /10:00/ })); await flush()
    expect(api.createHold).toHaveBeenCalledTimes(1)
    expect(vi.mocked(api.createHold).mock.calls[0][1]).toMatchObject({ productIds: ['service-a'] })
    expect(api.getCustomerCredits).toHaveBeenCalledWith('studio-a', { seats: 1, productIds: ['service-a'] }, 'tok-ana')
  })

  it('r2 B9: la página propia cambia `flow-type` (atrás, adelante o su liga) ⇒ el flujo nuevo empieza limpio', async () => {
    window.history.replaceState({}, '', '/studio-a/classes')
    const { p, rerender } = montar(lasDos, { showIdentity: true, flowType: 'classes' }); await flush()
    fireEvent.click(screen.getByRole('button', { name: /Lagree.*11:00/ })); await flush()
    expect(screen.getByRole('button', { name: 'Reservar' })).toBeTruthy()
    window.history.replaceState({}, '', '/studio-a/appointments')
    rerender(<BookingFlow props={{ ...p, flowType: 'appointments' }} />); await flush()
    // Un estudio con 2 clases y UN servicio llega a citas con ese servicio ya elegido, como hoy.
    expect(state.selectedProducts.value.map(x => x.id)).toEqual(['service-a'])
    expect(screen.getByRole('button', { name: '8 de octubre de 2026' })).toBeTruthy()
    // De regreso a clases: el horario, no el detalle que quedó abierto.
    window.history.replaceState({}, '', '/studio-a/classes')
    rerender(<BookingFlow props={{ ...p, flowType: 'classes' }} />); await flush()
    expect(screen.getByRole('button', { name: /Lagree.*11:00/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Reservar' })).toBeNull()
  })

  it('negocio sin clases: igual que hoy, va a citas; incrustado no toca la URL del sitio', async () => {
    window.history.replaceState({}, '', '/pagina-del-estudio')
    const replace = vi.spyOn(window.history, 'replaceState')
    const { navegaciones } = montar(venue); await flush()
    expect(screen.queryByText('¿Qué quieres reservar?')).toBeNull()
    expect(state.flowType.value).toBe('appointments')
    expect(screen.getByRole('button', { name: '8 de octubre de 2026' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Clases' })).toBeNull()
    expect(replace).not.toHaveBeenCalled()
    expect(navegaciones).toEqual([])
  })

  it('negocio sin clases, en la página propia: va a citas y le pide a la página reemplazar su liga', async () => {
    window.history.replaceState({}, '', '/studio-a')
    const { navegaciones } = montar(venue, { showIdentity: true }); await flush()
    expect(state.flowType.value).toBe('appointments')
    expect(navegaciones).toEqual([{ flow: 'appointments', replace: true }])
  })

  it('la identidad del negocio sólo se pinta en la página propia (show-identity), con «Escríbenos» si puede recibir mensajes', async () => {
    window.history.replaceState({}, '', '/pagina-del-estudio')
    const incrustado = montar(soloClases); await flush()
    expect(document.querySelector('.avq-identidad')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Escríbenos' })).toBeNull()
    incrustado.unmount(); resetSignals()
    window.history.replaceState({}, '', '/studio-a')
    const propia = montar(soloClases, { showIdentity: true }); await flush()
    expect(document.querySelector('.avq-identidad-nombre')?.textContent).toBe('Studio A')
    expect(screen.getByRole('button', { name: 'Escríbenos' })).toBeTruthy()
    propia.unmount(); resetSignals()
    montar({ ...soloClases, chat: { mode: 'DISABLED', canMessage: false } }, { showIdentity: true }); await flush()
    expect(document.querySelector('.avq-identidad')).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Escríbenos' })).toBeNull()
  })

  it('celular (≤ 640 px): el horario suma 12 px por lado a los 12 px de la página, 24 px en total (sin tocar citas)', async () => {
    window.history.replaceState({}, '', '/studio-a')
    montar(soloClases); await flush()
    expect(document.querySelector('.avq-classes-main .avq-horario')).not.toBeNull()
    const css = Array.from(document.querySelectorAll('style')).map(x => x.textContent ?? '').join('\n')
    expect(css).toMatch(/@media \(max-width: 640px\)\s*\{[^@]*\.avq-classes-main\s*\{[^}]*padding-inline:\s*12px/)
    // Sólo una vez: si el horario también lo pusiera, serían 36 px.
    expect(css).not.toMatch(/\.avq-horario\s*\{[^}]*padding-inline/)
    expect(css).not.toMatch(/\.avq-appts-main\s*\{[^}]*padding-inline/)
  })

  it('una liga vieja a los paquetes (/<negocio>#packs) abre la lista de paquetes encima del horario', async () => {
    vi.mocked(api.getCreditPacks).mockResolvedValue([{ ...PAQUETE, items: [{ ...PAQUETE.items[0], productId: 'class-a' }] }] as any)
    window.history.replaceState({}, '', '/studio-a#packs')
    montar({ ...soloClases, canCharge: true }, { showIdentity: true }); await flush()
    expect(screen.getByRole('dialog', { name: 'Comprar créditos' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Lagree.*11:00/ })).toBeTruthy()
  })
})

describe('Task 10: lo que la clienta ya tiene, en el horario', () => {
  const lagree = { ...venue.products[0], id: 'class-a', name: 'Lagree', price: 325, duration: 50, type: 'CLASS' as const }
  const estudio: PublicVenueInfo = { ...venue, canCharge: true, products: [lagree] }
  const PAQ_LAGREE = { ...PAQUETE, id: 'pk-lagree', name: 'Paquete Lagree', items: [{ ...PAQUETE.items[0], productId: 'class-a' }] }
  const clase = (id: string, inicio: string, extra: Record<string, unknown> = {}) => ({
    startsAt: inicio, endsAt: new Date(new Date(inicio).getTime() + 50 * 60000).toISOString(), available: true,
    classSessionId: id, productId: 'class-a', productName: 'Lagree', remaining: 8, capacity: 10, enrolled: 2, ...extra,
  })
  // Jueves 8 de octubre en CDMX (UTC−6): 11:00, 13:00 (llena) y 15:00.
  const s11 = clase('s-11', '2026-10-08T17:00:00Z')
  const s13 = clase('s-13', '2026-10-08T19:00:00Z', { available: false, remaining: 0, enrolled: 10 })
  const s15 = clase('s-15', '2026-10-08T21:00:00Z')
  const SES_ANA = { token: 'tok-ana', customer: ANA, contactos: [TEL] }
  const SES_BEA = { token: 'tok-bea', customer: BEA, contactos: [TEL] }
  const VENTANA = { dateFrom: '2026-10-06', dateTo: '2026-11-05' }

  function saldo(...compras: Array<{ id: string; restante: number; original: number; vence?: string; ilimitado?: boolean }>): CustomerCreditBalance {
    return {
      customer: null,
      purchases: compras.map(c => ({
        id: `compra-${c.id}`, creditPack: { name: c.ilimitado ? 'Ilimitado' : `Paquete de ${c.original}` }, expiresAt: c.vence, status: 'ACTIVE',
        itemBalances: [{
          id: c.id, productId: 'class-a', product: { id: 'class-a', name: 'Lagree', type: 'CLASS' },
          originalQuantity: c.ilimitado ? 99999 : c.original, remainingQuantity: c.ilimitado ? 99998 : c.restante, unlimited: c.ilimitado,
        }],
      })),
    }
  }
  const mia = (classSessionId: string, extra: Partial<MiReservaDeClase> = {}): MiReservaDeClase => ({
    classSessionId, spotIds: [], confirmationCode: `C-${classSessionId}`, cancelSecret: `sec-${classSessionId}`,
    startsAt: '2026-10-08T17:00:00Z', status: 'CONFIRMED', depositStatus: null, usedUnlimited: false, ...extra,
  })
  const pagina = (reservations: MiReservaDeClase[], extra: Record<string, unknown> = {}) =>
    ({ reservations, total: reservations.length, nextCursor: null, unlimitedUsedSessionIds: [] as string[], ...extra })
  const entrar = (slug: string, ses: typeof SES_ANA) => {
    state.bindCustomerSessionToVenue(slug)
    guardarSesion(slug, { ...ses, guardadaEn: Date.now() })
    state.entroAqui(slug, leerSesion(slug)!)
  }
  const fila = (re: RegExp, dentro: HTMLElement = document.body) => within(dentro).getByRole('button', { name: re }) as HTMLButtonElement
  const franja = (dentro: ParentNode = document) => dentro.querySelector('.avq-franja')?.textContent ?? null
  async function horario(slots = [s11, s13, s15]) {
    vi.mocked(api.getVenueInfo).mockResolvedValue(estudio)
    vi.mocked(api.getClassSessionsRange).mockResolvedValue({ ...VENTANA, slots })
    window.history.replaceState({}, '', '/studio-a/classes')
    const r = render(<BookingFlow props={{ ...props(), flowType: 'classes' }} />)
    await flush(); await flush()
    return r
  }

  beforeEach(() => {
    fijarPagina('studio-a', 'reservas', null); fijarPagina('studio-b', 'reservas', null)
    vi.mocked(api.getCustomerPortal).mockReturnValue(new Promise(() => {}))
    vi.mocked(api.getCreditPacks).mockResolvedValue([PAQ_LAGREE] as any)
    vi.mocked(api.getCustomerCredits).mockResolvedValue(saldo({ id: 'b5', restante: 4, original: 5, vence: '2026-12-11T18:00:00Z' }))
    vi.mocked(api.getMisReservasDeClase).mockResolvedValue(pagina([]))
  })
  afterEach(() => { cleanup(); fijarPagina('studio-a', 'reservas', null); fijarPagina('studio-b', 'reservas', null) })

  it('con sesión y un paquete de 5 con 4: «Hola, Ana · tienes 4 sesiones de Lagree · vencen el 11 dic»; el costado ya no le vende el paquete', async () => {
    entrar('studio-a', SES_ANA)
    await horario()
    expect(franja()).toBe('Hola, Ana · tienes 4 sesiones de Lagree · vencen el 11 dic')
    // El saldo se lee SIN productId (con él, el SERVIDOR recorta los saldos y «sesiones de Lagree» saldría mal).
    expect(api.getCustomerCredits).toHaveBeenCalledWith('studio-a', {}, 'tok-ana')
    const costado = document.querySelector('.avq-classes-sidebar') as HTMLElement
    expect(costado.textContent).toContain('Tu paquete: 4 de 5 · vence el 11 dic')
    expect(costado.textContent).not.toContain('Paquete Lagree')
    expect(costado.textContent).toContain('Ana')
    // Las clases que su paquete paga dicen «Incluida en tu paquete», no el precio suelto.
    expect(within(fila(/Lagree.*11:00/)).getByText('Incluida en tu paquete')).toBeTruthy()
    expect(fila(/Lagree.*11:00/).textContent).not.toContain('$325')
  })

  it('una sesión: «tienes 1 sesión de Lagree · vence el …»; un Ilimitado nunca enseña su número', async () => {
    entrar('studio-a', SES_ANA)
    vi.mocked(api.getCustomerCredits).mockResolvedValue(saldo({ id: 'b1', restante: 1, original: 5, vence: '2026-12-11T18:00:00Z' }))
    const r = await horario()
    expect(franja()).toBe('Hola, Ana · tienes 1 sesión de Lagree · vence el 11 dic')
    r.unmount()
    vi.mocked(api.getCustomerCredits).mockResolvedValue(saldo({ id: 'u1', restante: 0, original: 0, ilimitado: true, vence: '2026-12-20T18:00:00Z' }))
    await horario()
    expect(franja()).toBe('Hola, Ana · tienes Ilimitado de Lagree · vence el 20 dic')
    const costado = document.querySelector('.avq-classes-sidebar') as HTMLElement
    expect(costado.textContent).toContain('Tu paquete: Ilimitado · vence el 20 dic')
    expect(document.body.textContent).not.toMatch(/9999/)
  })

  it('sus clases se marcan «Reservada · lugar 3», «Falta pagar» o «Por aprobar»; tocar la suya, aunque esté llena, abre el detalle', async () => {
    entrar('studio-a', SES_ANA)
    vi.mocked(api.getMisReservasDeClase).mockResolvedValue(pagina([
      mia('s-11', { spotIds: ['3'] }),
      mia('s-13', { status: 'PENDING', depositStatus: 'PENDING', startsAt: s13.startsAt }),
      mia('s-15', { status: 'PENDING', depositStatus: null, startsAt: s15.startsAt }),
    ]))
    await horario()
    // La misma ventana que el horario, con el token de ESTE estudio.
    expect(api.getMisReservasDeClase).toHaveBeenCalledWith('studio-a', VENTANA, 'tok-ana')
    expect(within(fila(/Lagree.*11:00/)).getByText('Reservada · lugar 3')).toBeTruthy()
    expect(within(fila(/Lagree.*13:00/)).getByText('Falta pagar')).toBeTruthy()
    expect(within(fila(/Lagree.*15:00/)).getByText('Por aprobar')).toBeTruthy()
    const llena = fila(/Lagree.*13:00/)
    expect(llena.disabled).toBe(false)
    fireEvent.click(llena); await flush()
    // Ruling 1: abre el DETALLE de la clase (Task 11 dibuja ahí «Ya tienes lugar en esta clase»).
    expect(screen.getByRole('button', { name: 'Horario' })).toBeTruthy()
    expect(state.selectedSlot.value?.classSessionId).toBe('s-13')
  })

  it('«Incluida» se decide por sesión: no después de que vence el Ilimitado, ni donde ya lo usó', async () => {
    entrar('studio-a', SES_ANA)
    // El Ilimitado vence el jueves 8 a las 14:00 de CDMX.
    vi.mocked(api.getCustomerCredits).mockResolvedValue(saldo({ id: 'u1', restante: 0, original: 0, ilimitado: true, vence: '2026-10-08T20:00:00Z' }))
    vi.mocked(api.getMisReservasDeClase).mockResolvedValue(pagina([], { unlimitedUsedSessionIds: ['s-11'] }))
    const s12 = clase('s-12', '2026-10-08T18:00:00Z')
    await horario([s11, s12, s15])
    expect(within(fila(/Lagree.*12:00/)).getByText('Incluida en tu paquete')).toBeTruthy()
    // 15:00 empieza después de que vence: precio suelto.
    expect(fila(/Lagree.*15:00/).textContent).not.toContain('Incluida')
    expect(within(fila(/Lagree.*15:00/)).getByText('$325 · clase suelta')).toBeTruthy()
    // 11:00: ya usó su Ilimitado en esa clase (el SERVIDOR rechaza el segundo).
    expect(fila(/Lagree.*11:00/).textContent).not.toContain('Incluida')
    // Y no se marca como reservada: usar el Ilimitado no es lo mismo que tener lugar.
    expect(fila(/Lagree.*11:00/).textContent).not.toContain('Reservada')
  })

  it('con 250 reservas en el rango recorre las tres páginas y marca todas', async () => {
    entrar('studio-a', SES_ANA)
    const relleno = (n: number, desde: number) => Array.from({ length: n }, (_, i) => mia(`otra-${desde + i}`))
    vi.mocked(api.getMisReservasDeClase)
      .mockResolvedValueOnce(pagina([mia('s-11', { spotIds: ['1'] }), ...relleno(99, 0)], { total: 250, nextCursor: 'p2' }))
      .mockResolvedValueOnce(pagina([...relleno(99, 99), mia('s-13', { spotIds: ['2'] })], { total: 250, nextCursor: 'p3' }))
      .mockResolvedValueOnce(pagina([...relleno(49, 198), mia('s-15', { spotIds: ['5'] })], { total: 250, nextCursor: null }))
    await horario(); await flush()
    expect(vi.mocked(api.getMisReservasDeClase).mock.calls).toEqual([
      ['studio-a', VENTANA, 'tok-ana'],
      ['studio-a', { ...VENTANA, cursor: 'p2' }, 'tok-ana'],
      ['studio-a', { ...VENTANA, cursor: 'p3' }, 'tok-ana'],
    ])
    expect(within(fila(/Lagree.*11:00/)).getByText('Reservada · lugar 1')).toBeTruthy()
    expect(within(fila(/Lagree.*13:00/)).getByText('Reservada · lugar 2')).toBeTruthy()
    expect(within(fila(/Lagree.*15:00/)).getByText('Reservada · lugar 5')).toBeTruthy()
  })

  it('sin sesión: ni franja ni marcas, y no se llama a ninguna de las dos lecturas', async () => {
    const r = await horario()
    expect(api.getCustomerCredits).not.toHaveBeenCalled()
    expect(api.getMisReservasDeClase).not.toHaveBeenCalled()
    expect(franja()).toBeNull()
    expect(r.container.textContent).not.toMatch(/Reservada|Tu paquete|Incluida/)
    expect(fila(/Lagree.*13:00/).disabled).toBe(true)
    expect(within(fila(/Lagree.*11:00/)).getByText('$325 · clase suelta')).toBeTruthy()
  })

  it.each([
    ['el saldo', () => vi.mocked(api.getCustomerCredits).mockRejectedValue(Object.assign(new Error('x'), { status: 500 }))],
    ['sus reservas (SERVIDOR viejo, 404)', () => vi.mocked(api.getMisReservasDeClase).mockRejectedValue(Object.assign(new Error('x'), { status: 404 }))],
  ])('si falla %s, el horario se ve igual sin esa parte y sin avisos de error', async (_que, fallar) => {
    entrar('studio-a', SES_ANA)
    vi.mocked(api.getMisReservasDeClase).mockResolvedValue(pagina([mia('s-11', { spotIds: ['3'] })]))
    fallar()
    await horario()
    const fallaElSaldo = _que === 'el saldo'
    expect(franja()).toBe(fallaElSaldo ? null : 'Hola, Ana · tienes 4 sesiones de Lagree · vencen el 11 dic')
    expect(fila(/Lagree.*11:00/).textContent?.includes('Reservada · lugar 3')).toBe(fallaElSaldo)
    expect(fila(/Lagree.*15:00/)).toBeTruthy()
    expect(state.toastMessage.value).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('dos <avoqado-booking> de dos estudios: cada uno pinta sólo el nombre, saldo y reservas de SU estudio', async () => {
    entrar('studio-a', SES_ANA)
    entrar('studio-b', SES_BEA) // el último en montarse: las señales compartidas son de Bea
    vi.mocked(api.getVenueInfo).mockImplementation(async slug => ({ ...estudio, slug, name: slug === 'studio-a' ? 'Studio A' : 'Studio B' }))
    vi.mocked(api.getClassSessionsRange).mockImplementation(async slug => ({
      ...VENTANA, slots: [clase(slug === 'studio-a' ? 'sa-11' : 'sb-11', '2026-10-08T17:00:00Z')],
    }))
    vi.mocked(api.getCustomerCredits).mockImplementation(async (slug: string) => slug === 'studio-a'
      ? saldo({ id: 'ba', restante: 4, original: 5, vence: '2026-12-11T18:00:00Z' })
      : saldo({ id: 'bb', restante: 2, original: 10, vence: '2026-12-20T18:00:00Z' }))
    vi.mocked(api.getMisReservasDeClase).mockImplementation(async (slug: string) =>
      pagina([slug === 'studio-a' ? mia('sa-11', { spotIds: ['3'] }) : mia('sb-11', { spotIds: ['7'] })]))
    window.history.replaceState({}, '', '/pagina-con-dos-estudios')
    const a = render(<BookingFlow props={{ ...props('studio-a'), flowType: 'classes' }} />)
    const b = render(<BookingFlow props={{ ...props('studio-b'), flowType: 'classes' }} />)
    await flush(); await flush()
    const enA = a.container as HTMLElement
    const enB = b.container as HTMLElement
    expect(franja(enA)).toBe('Hola, Ana · tienes 4 sesiones de Lagree · vencen el 11 dic')
    expect(franja(enB)).toBe('Hola, Bea · tienes 2 sesiones de Lagree · vencen el 20 dic')
    expect(within(fila(/Lagree.*11:00/, enA)).getByText('Reservada · lugar 3')).toBeTruthy()
    expect(within(fila(/Lagree.*11:00/, enB)).getByText('Reservada · lugar 7')).toBeTruthy()
    expect(enA.textContent).not.toMatch(/Bea|lugar 7|2 de 10/)
    expect(enB.textContent).not.toMatch(/Ana|lugar 3|4 de 5/)
    // Cada lectura sale con el token de SU estudio.
    for (const [slug, , token] of [...vi.mocked(api.getCustomerCredits).mock.calls, ...vi.mocked(api.getMisReservasDeClase).mock.calls]) {
      expect(token).toBe(slug === 'studio-a' ? 'tok-ana' : 'tok-bea')
    }
  })

  it('fix r1: con un Ilimitado, la clase que ya reservó (donde ya lo usó) no enseña precio junto a «Reservada»', async () => {
    entrar('studio-a', SES_ANA)
    vi.mocked(api.getCustomerCredits).mockResolvedValue(saldo({ id: 'u1', restante: 0, original: 0, ilimitado: true, vence: '2026-12-20T18:00:00Z' }))
    vi.mocked(api.getMisReservasDeClase).mockResolvedValue(pagina([mia('s-11', { spotIds: ['3'], usedUnlimited: true })], {
      unlimitedUsedSessionIds: ['s-11'],
    }))
    await horario()
    const suya = fila(/Lagree.*11:00/)
    expect(within(suya).getByText('Reservada · lugar 3')).toBeTruthy()
    expect(suya.textContent).not.toMatch(/\$|clase suelta|Incluida/)
    // Las demás: su Ilimitado las paga.
    expect(within(fila(/Lagree.*15:00/)).getByText('Incluida en tu paquete')).toBeTruthy()
  })

  it('fix r1: vuelve de Stripe y el paquete llega en el sondeo ⇒ la franja y «Incluida» se ponen al día sin recargar', async () => {
    entrar('studio-a', SES_ANA)
    let comprado = false
    vi.mocked(api.getCustomerCredits).mockImplementation(async () => (comprado
      ? saldo({ id: 'b5', restante: 5, original: 5, vence: '2026-12-11T18:00:00Z' })
      : { customer: null, purchases: [] }))
    sessionStorage.setItem('avq:compraDe', JSON.stringify({ venue: 'studio-a', cliente: ANA.id }))
    vi.mocked(api.getVenueInfo).mockResolvedValue(estudio)
    vi.mocked(api.getClassSessionsRange).mockResolvedValue({ ...VENTANA, slots: [s11, s13, s15] })
    window.history.replaceState({}, '', '/studio-a/classes?avq_credits=success')
    render(<BookingFlow props={{ ...props(), flowType: 'classes' }} />)
    await flush(); await flush()
    expect(franja()).toBeNull()
    expect(within(fila(/Lagree.*11:00/)).getByText('$325 · clase suelta')).toBeTruthy()
    comprado = true // el aviso de Stripe acreditó el paquete
    await advance(1500); await flush()
    expect(franja()).toBe('Hola, Ana · tienes 5 sesiones de Lagree · vencen el 11 dic')
    expect(within(fila(/Lagree.*11:00/)).getByText('Incluida en tu paquete')).toBeTruthy()
  })

  describe('fix r1: al volver a la pestaña', () => {
    let visible = true
    beforeEach(() => {
      visible = true
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (visible ? 'visible' : 'hidden') })
    })
    afterEach(() => { delete (document as any).visibilityState })

    it('después de un rato fuera, vuelve a leer su saldo y sus reservas (compró o reservó en otra pestaña)', async () => {
      entrar('studio-a', SES_ANA)
      vi.mocked(api.getCustomerCredits).mockResolvedValue({ customer: null, purchases: [] })
      await horario()
      expect(franja()).toBeNull()
      const lecturas = vi.mocked(api.getMisReservasDeClase).mock.calls.length
      visible = false
      await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
      await advance(6 * 60 * 1000)
      vi.mocked(api.getCustomerCredits).mockResolvedValue(saldo({ id: 'b5', restante: 4, original: 5, vence: '2026-12-11T18:00:00Z' }))
      vi.mocked(api.getMisReservasDeClase).mockResolvedValue(pagina([mia('s-15', { spotIds: ['8'] })]))
      visible = true
      await act(async () => { document.dispatchEvent(new Event('visibilitychange')) }); await flush(); await flush()
      expect(vi.mocked(api.getMisReservasDeClase).mock.calls.length).toBe(lecturas + 1)
      expect(franja()).toBe('Hola, Ana · tienes 4 sesiones de Lagree · vencen el 11 dic')
      expect(within(fila(/Lagree.*15:00/)).getByText('Reservada · lugar 8')).toBeTruthy()
    })
  })

  it('cambia de cuenta en el mismo estudio: lo de Ana se borra al instante y su respuesta tardía no se pinta', async () => {
    let reservasDeAna!: (p: ReturnType<typeof pagina>) => void
    vi.mocked(api.getCustomerCredits).mockImplementation((_s: string, _p: unknown, token: string) =>
      token === 'tok-ana' ? Promise.resolve(saldo({ id: 'b5', restante: 4, original: 5, vence: '2026-12-11T18:00:00Z' })) : new Promise(() => {}))
    vi.mocked(api.getMisReservasDeClase).mockImplementation((_s: string, _p: unknown, token: string) =>
      token === 'tok-ana' ? new Promise(ok => { reservasDeAna = ok }) : new Promise(() => {}))
    entrar('studio-a', SES_ANA)
    await horario()
    expect(franja()).toBe('Hola, Ana · tienes 4 sesiones de Lagree · vencen el 11 dic')
    await act(async () => {
      guardarSesion('studio-a', { ...SES_BEA, guardadaEn: Date.now() })
      state.entroAqui('studio-a', leerSesion('studio-a')!)
    })
    await flush()
    expect(franja()).toBeNull()
    expect(document.body.textContent).not.toContain('4 de 5')
    await act(async () => reservasDeAna(pagina([mia('s-11', { spotIds: ['3'] })]))); await flush()
    expect(document.body.textContent).not.toContain('Reservada')
    expect(api.getCustomerCredits).toHaveBeenCalledWith('studio-a', {}, 'tok-bea')
    expect(api.getMisReservasDeClase).toHaveBeenCalledWith('studio-a', VENTANA, 'tok-bea')
  })

  describe('Task 11: el detalle de la clase', () => {
    // Jueves 8 a las 15:00 de CDMX; «ahora» es el martes 6 a las 12:00.
    const POLITICA = { allowCustomerCancel: true, minHoursBeforeStart: null, creditRefundMode: 'TIME_BASED' as const,
      creditFreeRefundHoursBefore: 24, creditLateRefundPercent: 0 }
    const sinRastroDePolitica = () => expect(document.body.textContent).not.toMatch(/cancela|12\s?h/i)

    it('tocar su clase marcada ⇒ «Ya tienes lugar en esta clase · lugar 3»; «Ver mi reserva» abre «Gestionar» con su cancelSecret', async () => {
      entrar('studio-a', SES_ANA)
      vi.mocked(api.getMisReservasDeClase).mockResolvedValue(pagina([mia('s-11', { spotIds: ['3'] })]))
      await horario()
      fireEvent.click(fila(/Lagree.*11:00/)); await flush()
      expect(screen.getByText('Ya tienes lugar en esta clase · lugar 3')).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Reservar' })).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'Ver mi reserva' })); await flush()
      expect(state.manageSecret.value).toBe('sec-s-11')
      expect(vi.mocked(api.getReservation).mock.calls[0].slice(0, 2)).toEqual(['studio-a', 'sec-s-11'])
      expect(screen.queryByText('Ya tienes lugar en esta clase · lugar 3')).toBeNull()
      expect(api.createReservation).not.toHaveBeenCalled()
    })

    it('«Reservar otro lugar para alguien» sigue el flujo normal sin mandar nada al SERVIDOR y deja la marca para la confirmación', async () => {
      entrar('studio-a', SES_ANA)
      vi.mocked(api.getMisReservasDeClase).mockResolvedValue(pagina([mia('s-11', { spotIds: ['3'] })]))
      await horario()
      fireEvent.click(fila(/Lagree.*11:00/)); await flush()
      fireEvent.click(screen.getByRole('button', { name: 'Reservar otro lugar para alguien' })); await flush()
      expect(screen.queryByText('Ya tienes lugar en esta clase · lugar 3')).toBeNull()
      expect(state.selectedSlot.value?.classSessionId).toBe('s-11')
      // Para Task 13: «Otro lugar en esta clase» y sin Ilimitado. Sólo vale para ESA clase.
      expect(state.otroLugarEnLaClase.value).toBe('s-11')
      expect(state.esOtroLugarEnLaClase()).toBe(true)
      expect(api.createReservation).not.toHaveBeenCalled()
      expect(api.createHold).not.toHaveBeenCalled()
    })

    it('«Reservar» a secas no deja la marca, y la marca sólo vale para la clase en que se tocó', async () => {
      entrar('studio-a', SES_ANA)
      vi.mocked(api.getMisReservasDeClase).mockResolvedValue(pagina([mia('s-11', { spotIds: ['3'] })]))
      await horario()
      // Una marca vieja (de otra visita a la de las 15:00) no sobrevive a volver a tocar la clase en el horario.
      state.otroLugarEnLaClase.value = 's-15'
      fireEvent.click(fila(/Lagree.*15:00/)); await flush()
      expect(state.otroLugarEnLaClase.value).toBeNull()
      expect(screen.queryByText(/Ya tienes lugar/)).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'Reservar' })); await flush()
      expect(state.otroLugarEnLaClase.value).toBeNull()
      expect(state.esOtroLugarEnLaClase()).toBe(false)
      // La de otra clase no cuenta para la elegida.
      state.otroLugarEnLaClase.value = 's-11'
      expect(state.esOtroLugarEnLaClase()).toBe(false)
    })

    it('con la clase llena y su lugar, «Reservar otro lugar» no aparece', async () => {
      entrar('studio-a', SES_ANA)
      vi.mocked(api.getMisReservasDeClase).mockResolvedValue(pagina([mia('s-13', { spotIds: ['4'], startsAt: s13.startsAt })]))
      await horario()
      fireEvent.click(fila(/Lagree.*13:00/)); await flush()
      expect(screen.getByText('Ya tienes lugar en esta clase · lugar 4')).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Ver mi reserva' })).toBeTruthy()
      expect(screen.queryByRole('button', { name: /otro lugar/ })).toBeNull()
    })

    it('con su paquete: «Incluida en tu paquete», «Te quedan 4 sesiones de Lagree» y la política real del SERVIDOR; sin «o 1 crédito»', async () => {
      entrar('studio-a', SES_ANA)
      vi.mocked(api.getVenueInfo).mockResolvedValue({ ...estudio, cancellationPolicy: POLITICA })
      vi.mocked(api.getClassSessionsRange).mockResolvedValue({ ...VENTANA, slots: [s11, s13, s15] })
      window.history.replaceState({}, '', '/studio-a/classes')
      render(<BookingFlow props={{ ...props(), flowType: 'classes' }} />); await flush(); await flush()
      fireEvent.click(fila(/Lagree.*15:00/)); await flush()
      expect(screen.getByText('Incluida en tu paquete')).toBeTruthy()
      expect(screen.getByText('Te quedan 4 sesiones de Lagree · vencen el 11 dic')).toBeTruthy()
      expect(screen.getByText(
        'Cancela gratis hasta el miércoles 7 a las 15:00 y la sesión regresa a tu paquete. Hasta el jueves 8 a las 15:00 puedes cancelar, pero ya no regresa.',
      )).toBeTruthy()
      expect(document.body.textContent).not.toMatch(/crédito|\$325/)
      expect(screen.getByRole('button', { name: 'Reservar' })).toBeTruthy()
    })

    it('sin sesión paga con tarjeta: «$325 · clase suelta» y la línea sólo dice hasta cuándo cancelar en línea', async () => {
      vi.mocked(api.getVenueInfo).mockResolvedValue({ ...estudio, cancellationPolicy: POLITICA })
      vi.mocked(api.getClassSessionsRange).mockResolvedValue({ ...VENTANA, slots: [s11, s13, s15] })
      window.history.replaceState({}, '', '/studio-a/classes')
      render(<BookingFlow props={{ ...props(), flowType: 'classes' }} />); await flush(); await flush()
      fireEvent.click(fila(/Lagree.*15:00/)); await flush()
      expect(screen.getByText('$325 · clase suelta')).toBeTruthy()
      expect(screen.getByText('Puedes cancelar en línea hasta el jueves 8 a las 15:00.')).toBeTruthy()
      expect(document.body.textContent).not.toContain('Incluida')
    })

    it('SERVIDOR viejo (sin `cancellationPolicy`): no hay línea de política y nunca «12h»', async () => {
      entrar('studio-a', SES_ANA)
      await horario()
      fireEvent.click(fila(/Lagree.*15:00/)); await flush()
      expect(screen.getByText('Incluida en tu paquete')).toBeTruthy()
      sinRastroDePolitica()
    })

    it('«¿Dudas sobre esta clase? Escríbenos» sólo si el negocio recibe mensajes', async () => {
      const r = await horario()
      fireEvent.click(fila(/Lagree.*15:00/)); await flush()
      expect(screen.getByRole('button', { name: '¿Dudas sobre esta clase? Escríbenos' })).toBeTruthy()
      r.unmount()
      vi.mocked(api.getVenueInfo).mockResolvedValue({ ...estudio, chat: { mode: 'DISABLED', canMessage: false } })
      render(<BookingFlow props={{ ...props(), flowType: 'classes' }} />); await flush(); await flush()
      fireEvent.click(fila(/Lagree.*15:00/)); await flush()
      expect(screen.queryByRole('button', { name: /Escríbenos/ })).toBeNull()
    })
  })
})

describe('Task 12: entrar en una ventanita sin salir de la clase, y aviso cuando alguien toma tu lugar', () => {
  // Un «dado» de 3 × 3 con cinco máquinas (maqueta pasos-con-aire-v7, paso 3).
  const DADO = {
    iconType: 'reformer' as const, rows: 3, cols: 3, showInstructor: true,
    spots: [
      { id: 'p1', row: 0, col: 0, label: '1', enabled: true },
      { id: 'p2', row: 0, col: 2, label: '2', enabled: true },
      { id: 'p3', row: 1, col: 1, label: '3', enabled: true },
      { id: 'p4', row: 2, col: 0, label: '4', enabled: true },
      { id: 'p5', row: 2, col: 2, label: '5', enabled: true },
    ],
  }
  const lagree = { ...venue.products[0], id: 'class-a', name: 'Lagree', price: 325, duration: 50, type: 'CLASS' as const }
  const conMapa = { ...lagree, layoutConfig: DADO }
  const VENTANA = { dateFrom: '2026-10-06', dateTo: '2026-11-05' }
  // Jueves 8 de octubre a las 15:00 de CDMX.
  const s15 = (extra: Record<string, unknown> = {}) => ({
    startsAt: '2026-10-08T21:00:00Z', endsAt: '2026-10-08T21:50:00Z', available: true, classSessionId: 's-15',
    productId: 'class-a', productName: 'Lagree', remaining: 8, capacity: 10, enrolled: 2, takenSpotIds: [] as string[], ...extra,
  })
  const SES_ANA = { token: 'tok-ana', customer: ANA, contactos: [TEL] }
  const PAQ_LAGREE = { ...PAQUETE, id: 'pk-lagree', name: 'Paquete Lagree', items: [{ ...PAQUETE.items[0], productId: 'class-a' }] }
  const CONFIRMADA = {
    confirmationCode: 'OK-1', cancelSecret: 'sec-ok', startsAt: '2026-10-08T21:00:00Z', endsAt: '2026-10-08T21:50:00Z',
    status: 'CONFIRMED', depositRequired: false,
  } as any
  const GENERICO = 'Este horario ya no está disponible. Por favor elige otro horario.'
  const conflicto = (data: Record<string, unknown>) => Object.assign(new Error('Conflicto'), { status: 409, data: { message: 'Conflicto', ...data } })
  const boton = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement
  const dialogo = () => screen.queryByRole('dialog', { name: 'Entra para reservar' })
  const aviso = () => state.toastMessage.value?.text ?? null
  const enElHorario = () => screen.queryByRole('button', { name: /Lagree.*15:00/ })
  const entrar = () => {
    guardarSesion('studio-a', { ...SES_ANA, guardadaEn: Date.now() })
    state.entroAqui('studio-a', leerSesion('studio-a')!)
  }
  /** El horario con la clase de las 15:00 y su detalle abierto. */
  async function abrirClase(producto: Record<string, unknown>, estudio: Partial<PublicVenueInfo> = {}) {
    vi.mocked(api.getVenueInfo).mockResolvedValue({ ...venue, canCharge: true, products: [producto as any], ...estudio })
    vi.mocked(api.getClassSessionsRange).mockResolvedValue({ ...VENTANA, slots: [s15()] })
    window.history.replaceState({}, '', '/studio-a/classes')
    render(<BookingFlow props={{ ...props(), flowType: 'classes' }} />); await flush(); await flush()
    fireEvent.click(screen.getByRole('button', { name: /Lagree.*15:00/ })); await flush()
  }
  /** Lo que devuelve la relectura de la clase tras el 409 (y cualquier lectura del horario después). */
  const alReleer = (slots: unknown[]) => vi.mocked(api.getClassSessionsRange).mockResolvedValue({ ...VENTANA, slots } as any)
  const lecturaTrasElConflicto = (desde: number) => vi.mocked(api.getClassSessionsRange).mock.calls[desde]

  beforeEach(() => {
    fijarPagina('studio-a', 'reservas', null)
    state.bindCustomerSessionToVenue('studio-a')
    vi.mocked(api.getCustomerPortal).mockReturnValue(new Promise(() => {}))
    vi.mocked(api.getCreditPacks).mockResolvedValue([])
    vi.mocked(api.getCustomerCredits).mockResolvedValue({ customer: null, purchases: [] } as any)
    vi.mocked(api.getMisReservasDeClase).mockResolvedValue({ reservations: [], total: 0, nextCursor: null, unlimitedUsedSessionIds: [] })
  })
  afterEach(() => {
    cleanup(); borrarSesion('studio-a'); state.clearCustomerSession('studio-a'); fijarPagina('studio-a', 'reservas', null)
    delete (globalThis as any).__entradaDePrueba; delete (globalThis as any).__onEntro
  })

  describe('entrar en una ventanita', () => {
    it('sin sesión, clase que exige paquete: «Reservar» abre «Entra para reservar» (no «Mi cuenta»); al entrar sigue al mapa con la MISMA clase', async () => {
      ;(globalThis as any).__entradaDePrueba = SES_ANA
      await abrirClase({ ...conMapa, requireCreditForBooking: true })
      fireEvent.click(boton('Reservar')); await flush()
      const d = dialogo()!
      expect(d).toBeTruthy()
      expect(within(d).getByText('Lagree · jueves 8 · 15:00')).toBeTruthy()
      expect(state.showPortal.value).toBe(false)
      expect(screen.queryByRole('heading', { name: 'Elige tu lugar' })).toBeNull()
      fireEvent.click(within(d).getByRole('button', { name: 'Simular entrar' })); await flush()
      expect(dialogo()).toBeNull()
      expect(state.showPortal.value).toBe(false)
      expect(state.customerToken.value).toBe('tok-ana')
      expect(screen.getByRole('heading', { name: 'Elige tu lugar' })).toBeTruthy()
      expect(state.selectedSlot.value?.classSessionId).toBe('s-15')
      expect(api.createReservation).not.toHaveBeenCalled()
    })

    it('cerrar la ventanita deja el detalle; una entrada que termina tarde no adopta la cuenta ni sigue sola', async () => {
      await abrirClase({ ...conMapa, requireCreditForBooking: true })
      fireEvent.click(boton('Reservar')); await flush()
      const entradaVieja = (globalThis as any).__onEntro
      fireEvent.keyDown(document, { key: 'Escape' }); await flush()
      expect(dialogo()).toBeNull()
      expect(boton('Reservar')).toBeTruthy()
      await act(async () => {
        guardarSesion('studio-a', { ...SES_ANA, guardadaEn: Date.now() })
        entradaVieja(SES_ANA)
      }); await flush()
      expect(state.customerToken.value).toBeNull()
      expect(screen.queryByRole('heading', { name: 'Elige tu lugar' })).toBeNull()
      expect(state.showPortal.value).toBe(false)
    })

    it('negocio con «Requerir cuenta para reservar»: el botón de la puerta abre la ventanita, no «Mi cuenta»', async () => {
      ;(globalThis as any).__entradaDePrueba = SES_ANA
      await abrirClase(lagree, { publicBooking: { ...venue.publicBooking, requireAccount: true } })
      fireEvent.click(boton('Reservar')); await flush()
      expect(screen.getByRole('heading', { name: 'Inicia sesión para reservar' })).toBeTruthy()
      fireEvent.click(boton('Iniciar sesión / crear cuenta')); await flush()
      expect(dialogo()).toBeTruthy()
      expect(state.showPortal.value).toBe(false)
      fireEvent.click(within(dialogo()!).getByRole('button', { name: 'Simular entrar' })); await flush()
      expect(dialogo()).toBeNull()
      expect(state.showPortal.value).toBe(false)
      expect(screen.queryByRole('heading', { name: 'Inicia sesión para reservar' })).toBeNull()
      expect(state.selectedSlot.value?.classSessionId).toBe('s-15')
    })

    it('clase que acepta tarjeta y paquete, sin sesión: el formulario enseña «¿Ya tienes paquete? Entra para usarlo» y abre la ventanita', async () => {
      vi.mocked(api.getCreditPacks).mockResolvedValue([PAQ_LAGREE] as any)
      await abrirClase(lagree)
      fireEvent.click(boton('Reservar')); await flush()
      fireEvent.click(boton('¿Ya tienes paquete? Entra para usarlo')); await flush()
      expect(dialogo()).toBeTruthy()
      expect(state.showPortal.value).toBe(false)
    })

    it('sin un paquete que pague la clase, el formulario no lo ofrece', async () => {
      vi.mocked(api.getCreditPacks).mockResolvedValue([PAQUETE] as any) // es de otro servicio
      await abrirClase(lagree)
      fireEvent.click(boton('Reservar')); await flush()
      expect(screen.getByLabelText(/Nombre/)).toBeTruthy()
      expect(screen.queryByRole('button', { name: /Ya tienes paquete/ })).toBeNull()
    })

    it('401 al leer sus paquetes en la confirmación ⇒ la ventanita (con «Tu sesión se cerró»), nunca «Mi cuenta», sin reserva', async () => {
      entrar()
      // Task 13: el saldo se lee al llegar a «Confirma tu reserva» (sin productId); el 401 suelta la sesión como lo hace `request`.
      let lecturas = 0
      vi.mocked(api.getCustomerCredits).mockImplementation(async () => {
        if (++lecturas >= 2) {
          state.clearCustomerSession('studio-a', 'tok-ana')
          throw Object.assign(new Error('x'), { status: 401, data: { message: 'x' }, enviado: 'tok-ana' })
        }
        return { customer: null, purchases: [] } as any
      })
      await abrirClase(lagree)
      fireEvent.click(boton('Reservar')); await flush(); await flush()
      expect(dialogo()).toBeTruthy()
      expect(within(dialogo()!).getByRole('status').textContent).toBe('Tu sesión se cerró. Puedes seguir sin cuenta o entrar otra vez.')
      expect(state.showPortal.value).toBe(false)
      expect(state.customerToken.value).toBeNull()
      expect(api.createReservation).not.toHaveBeenCalled()
    })

    it('401 al confirmar ⇒ la ventanita, nunca «Mi cuenta», sin reserva creada', async () => {
      entrar()
      vi.mocked(api.createReservation).mockImplementationOnce(async () => {
        // Lo que hace `request`: la página queda sin sesión antes de lanzar el error.
        state.clearCustomerSession('studio-a', 'tok-ana')
        throw Object.assign(new Error('x'), { status: 401, data: { message: 'x', code: 'CUSTOMER_SESSION_CLOSED' }, enviado: 'tok-ana' })
      })
      await abrirClase(lagree)
      fireEvent.click(boton('Reservar')); await flush(); await flush()
      // Task 13: ya no se reserva sola; la clienta toca «Pagar $325» (la clase se paga en línea).
      expect(api.createReservation).not.toHaveBeenCalled()
      fireEvent.click(boton('Pagar $325')); await flush(); await flush()
      expect(api.createReservation).toHaveBeenCalledTimes(1)
      expect(dialogo()).toBeTruthy()
      expect(within(dialogo()!).getByRole('status').textContent).toBe('Tu sesión se cerró. Puedes seguir sin cuenta o entrar otra vez.')
      expect(state.showPortal.value).toBe(false)
      expect(state.bookingResult.value).toBeNull()
      expect(state.selectedSlot.value?.classSessionId).toBe('s-15')
    })
  })

  describe('alguien tomó tu lugar o la clase se llenó', () => {
    /** Task 13: nada se reserva solo; la clienta toca «Confirmar reserva» (o «Pagar $X» en una clase que se paga en línea). */
    const confirmar = async () => { fireEvent.click(boton(/^(Confirmar reserva|Pagar )/)); await flush(); await flush() }
    async function alMapaYContinuar(lugares: string[]) {
      fireEvent.click(boton('Reservar')); await flush()
      for (const l of lugares) { fireEvent.click(boton(`Lugar ${l}`)); await flush() }
      fireEvent.click(boton(/^Continuar con /)); await flush(); await flush()
      expect(api.createReservation).not.toHaveBeenCalled()
      await confirmar()
    }

    it('409 SPOTS_TAKEN: relee con la MISMA ventana del horario, regresa al mapa sin el lugar tomado y con el aviso; el tomado no vuelve a viajar', async () => {
      entrar()
      vi.mocked(api.createReservation)
        .mockRejectedValueOnce(conflicto({ code: 'SPOTS_TAKEN', details: { takenSpotIds: ['p3'] } }))
        .mockResolvedValueOnce(CONFIRMADA)
      await abrirClase(conMapa)
      // El horario ya cargado llega a 60 días («Más fechas»): la relectura usa ESA ventana, no la de arranque ni «el día local».
      fireEvent.click(screen.getByRole('button', { name: 'Horario' })); await flush()
      fireEvent.click(boton('Más fechas')); await flush(); await flush()
      const VENTANA_60 = { dateFrom: '2026-10-06', dateTo: '2026-12-05' }
      const leidas = vi.mocked(api.getClassSessionsRange).mock.calls
      expect(leidas[leidas.length - 1]).toEqual(['studio-a', VENTANA_60])
      fireEvent.click(screen.getByRole('button', { name: /Lagree.*15:00/ })); await flush()
      const lecturas = vi.mocked(api.getClassSessionsRange).mock.calls.length
      alReleer([s15({ takenSpotIds: ['p3', 'p2'], remaining: 6 })])
      await alMapaYContinuar(['1', '3'])
      expect(api.createReservation).toHaveBeenCalledTimes(1)
      expect(vi.mocked(api.createReservation).mock.calls[0][1].spotIds).toEqual(['p1', 'p3'])
      expect(lecturaTrasElConflicto(lecturas)).toEqual(['studio-a', VENTANA_60])
      expect(screen.getByRole('heading', { name: 'Elige tu lugar' })).toBeTruthy()
      expect(boton('Lugar 3, ocupado').disabled).toBe(true)
      expect(boton('Lugar 2, ocupado').disabled).toBe(true)
      expect(state.selectedSpotIds.value).toEqual(['p1'])
      expect(aviso()).toBe('Ese lugar lo acaba de tomar alguien; elige otro')
      expect(state.bookingResult.value).toBeNull()
      fireEvent.click(boton('Continuar con el lugar 1')); await flush(); await flush()
      expect(api.createReservation).toHaveBeenCalledTimes(1)
      await confirmar()
      expect(api.createReservation).toHaveBeenCalledTimes(2)
      expect(vi.mocked(api.createReservation).mock.calls[1][1].spotIds).toEqual(['p1'])
    })

    it('409 CLASS_FULL con available 0 ⇒ regresa al horario recargado con «Esta clase se acaba de llenar»', async () => {
      entrar()
      vi.mocked(api.createReservation).mockRejectedValueOnce(conflicto({ code: 'CLASS_FULL', details: { available: 0 } }))
      await abrirClase(conMapa)
      const lecturas = vi.mocked(api.getClassSessionsRange).mock.calls.length
      alReleer([s15({ remaining: 0, available: false, enrolled: 10 })])
      await alMapaYContinuar(['3'])
      expect(lecturaTrasElConflicto(lecturas)).toEqual(['studio-a', VENTANA])
      expect(aviso()).toBe('Esta clase se acaba de llenar')
      expect(state.selectedSlot.value).toBeNull()
      expect(enElHorario()).toBeTruthy()
      // El horario se volvió a pedir al regresar: la clase ya sale llena.
      expect(vi.mocked(api.getClassSessionsRange).mock.calls.length).toBeGreaterThan(lecturas + 1)
      expect(screen.queryByRole('heading', { name: 'Elige tu lugar' })).toBeNull()
    })

    it('409 CLASS_FULL con 1 lugar y dos pedidos ⇒ se queda en el mapa con «Sólo queda 1 lugar» hasta quitar uno', async () => {
      entrar()
      vi.mocked(api.createReservation).mockRejectedValueOnce(conflicto({ code: 'CLASS_FULL', details: { available: 1 } }))
      await abrirClase(conMapa)
      alReleer([s15({ remaining: 1, enrolled: 9 })])
      await alMapaYContinuar(['1', '3'])
      expect(screen.getByRole('heading', { name: 'Elige tu lugar' })).toBeTruthy()
      expect(screen.getByRole('alert').textContent).toBe('Sólo queda 1 lugar')
      expect(state.selectedSpotIds.value).toEqual(['p1', 'p3'])
      expect(boton('Continuar con los lugares 1 y 3').disabled).toBe(true)
      fireEvent.click(boton('Lugar 3')); await flush()
      expect(screen.queryByRole('alert')).toBeNull()
      expect(boton('Continuar con el lugar 1').disabled).toBe(false)
      expect(api.createReservation).toHaveBeenCalledTimes(1)
    })

    it('si al releer la clase ya no aparece ⇒ regresa al horario con «Esa clase ya no está disponible»', async () => {
      entrar()
      vi.mocked(api.createReservation).mockRejectedValueOnce(conflicto({ code: 'SPOTS_TAKEN', details: { takenSpotIds: ['p3'] } }))
      await abrirClase(conMapa)
      alReleer([])
      await alMapaYContinuar(['3'])
      expect(aviso()).toBe('Esa clase ya no está disponible')
      expect(state.selectedSlot.value).toBeNull()
      expect(screen.queryByRole('heading', { name: 'Elige tu lugar' })).toBeNull()
    })

    it.each([
      [undefined, 3, GENERICO], ['CLASS_FULL', 3, GENERICO], ['SPOTS_TAKEN', 3, GENERICO],
      [undefined, 0, 'Esta clase se acaba de llenar'], ['CLASS_FULL', 0, 'Esta clase se acaba de llenar'],
      ['SPOTS_TAKEN', 0, 'Esta clase se acaba de llenar'],
    ] as const)('clase sin mapa (1 lugar), 409 con código %s y %i lugares al releer ⇒ «%s» y al horario', async (code, libres, texto) => {
      entrar()
      vi.mocked(api.createReservation).mockRejectedValueOnce(conflicto(code ? { code, details: {} } : {}))
      await abrirClase(lagree)
      alReleer([s15(libres ? { remaining: libres } : { remaining: 0, available: false })])
      fireEvent.click(boton('Reservar')); await flush(); await flush()
      await confirmar()
      expect(api.createReservation).toHaveBeenCalledTimes(1)
      expect(aviso()).toBe(texto)
      expect(state.selectedSlot.value).toBeNull()
      expect(enElHorario()).toBeTruthy()
    })

    it.each([
      ['sin lugares', s15({ remaining: 0, available: false }), { horario: 'Esta clase se acaba de llenar' }],
      ['su lugar ocupado', s15({ takenSpotIds: ['p3'], remaining: 6 }), { mapa: ['p1'], toast: 'Ese lugar lo acaba de tomar alguien; elige otro' }],
      ['menos lugares que los elegidos', s15({ remaining: 1 }), { mapa: ['p1', 'p3'], alerta: 'Sólo queda 1 lugar' }],
      ['nada que lo explique', s15(), { horario: GENERICO }],
    ] as const)('SERVIDOR viejo (409 sin código) con mapa, %s: decide con la relectura', async (_caso, relectura, espera: any) => {
      entrar()
      vi.mocked(api.createReservation).mockRejectedValueOnce(conflicto({}))
      await abrirClase(conMapa)
      alReleer([relectura])
      await alMapaYContinuar(['1', '3'])
      if (espera.horario) {
        expect(aviso()).toBe(espera.horario)
        expect(state.selectedSlot.value).toBeNull()
        expect(screen.queryByRole('heading', { name: 'Elige tu lugar' })).toBeNull()
      } else {
        expect(screen.getByRole('heading', { name: 'Elige tu lugar' })).toBeTruthy()
        expect(state.selectedSpotIds.value).toEqual(espera.mapa)
        if (espera.toast) expect(aviso()).toBe(espera.toast)
        if (espera.alerta) expect(screen.getByRole('alert').textContent).toBe(espera.alerta)
      }
      expect(api.createReservation).toHaveBeenCalledTimes(1)
    })

    it('la relectura falla (sin red): con lo que dijo el 409 basta para quitar el lugar tomado', async () => {
      entrar()
      vi.mocked(api.createReservation).mockRejectedValueOnce(conflicto({ code: 'SPOTS_TAKEN', details: { takenSpotIds: ['p3'] } }))
      await abrirClase(conMapa)
      vi.mocked(api.getClassSessionsRange).mockRejectedValue(new TypeError('Failed to fetch'))
      await alMapaYContinuar(['1', '3'])
      expect(screen.getByRole('heading', { name: 'Elige tu lugar' })).toBeTruthy()
      expect(boton('Lugar 3, ocupado').disabled).toBe(true)
      expect(state.selectedSpotIds.value).toEqual(['p1'])
      expect(aviso()).toBe('Ese lugar lo acaba de tomar alguien; elige otro')
    })
  })
})

describe('Task 13: «Confirma tu reserva» — nada se reserva sin el botón, y tras un error de red se revisa si quedó', () => {
  const DADO = {
    iconType: 'reformer' as const, rows: 3, cols: 3, showInstructor: true,
    spots: [
      { id: 'p1', row: 0, col: 0, label: '1', enabled: true },
      { id: 'p2', row: 0, col: 2, label: '2', enabled: true },
      { id: 'p3', row: 1, col: 1, label: '3', enabled: true },
    ],
  }
  // `venue.products[0]` cobra al reservar (`required`): con `canCharge` es una clase que se paga en línea.
  const enLinea = { ...venue.products[0], id: 'class-a', name: 'Lagree', price: 325, duration: 50, type: 'CLASS' as const }
  const enEstudio = { ...enLinea, upfrontPolicy: 'at_venue' as const }
  const gratis = { ...enEstudio, price: 0 }
  const soloPaquete = { ...enEstudio, requireCreditForBooking: true }
  const VENTANA = { dateFrom: '2026-10-06', dateTo: '2026-11-05' }
  // Jueves 8 de octubre a las 15:00 de CDMX, con Fer.
  const s15 = (extra: Record<string, unknown> = {}) => ({
    startsAt: '2026-10-08T21:00:00Z', endsAt: '2026-10-08T21:50:00Z', available: true, classSessionId: 's-15',
    productId: 'class-a', productName: 'Lagree', remaining: 8, capacity: 10, enrolled: 2, takenSpotIds: [] as string[],
    instructor: { firstName: 'Fer', lastName: 'Ruiz' }, ...extra,
  })
  const SES_ANA = { token: 'tok-ana', customer: ANA, contactos: [TEL] }
  const SES_BEA = { token: 'tok-bea', customer: BEA, contactos: [TEL] }
  const PAQ_LAGREE = { ...PAQUETE, id: 'pk-lagree', name: 'Paquete Lagree', items: [{ ...PAQUETE.items[0], productId: 'class-a' }] }
  const CONFIRMADA = {
    confirmationCode: 'OK-1', cancelSecret: 'sec-ok', startsAt: '2026-10-08T21:00:00Z', endsAt: '2026-10-08T21:50:00Z',
    status: 'CONFIRMED', depositRequired: false, depositAmount: null,
  } as any
  function saldo(...compras: Array<{ id: string; restante: number; original: number; vence?: string; ilimitado?: boolean }>): CustomerCreditBalance {
    return {
      customer: null,
      purchases: compras.map(c => ({
        id: `compra-${c.id}`, creditPack: { name: c.ilimitado ? 'Mensual Ilimitado' : `Paquete de ${c.original}` }, expiresAt: c.vence,
        status: 'ACTIVE',
        itemBalances: [{
          id: c.id, productId: 'class-a', product: { id: 'class-a', name: 'Lagree', type: 'CLASS' },
          originalQuantity: c.ilimitado ? 99999 : c.original, remainingQuantity: c.ilimitado ? 99998 : c.restante, unlimited: c.ilimitado,
        }],
      })),
    }
  }
  const B5 = { id: 'b5', restante: 4, original: 5, vence: '2026-12-11T18:00:00Z' }
  const B10 = { id: 'b10', restante: 9, original: 10, vence: '2027-01-20T18:00:00Z' }
  const mia = (extra: Partial<MiReservaDeClase> = {}): MiReservaDeClase => ({
    classSessionId: 's-15', spotIds: [], confirmationCode: 'NUEVA', cancelSecret: 'sec-nueva',
    startsAt: '2026-10-08T21:00:00Z', status: 'CONFIRMED', depositStatus: null, usedUnlimited: false, ...extra,
  })
  const pagina = (reservations: MiReservaDeClase[]) => ({ reservations, total: reservations.length, nextCursor: null, unlimitedUsedSessionIds: [] as string[] })
  /** Lo que el SERVIDOR tiene guardado: la siguiente lectura de sus reservas lo trae. */
  let guardadas: MiReservaDeClase[] = []
  /** Mientras sea verdadero, sus lecturas fallan como sin red (la del horario ya pasó). */
  let lecturasSinRed = false
  let fallaLectura: (() => unknown) | null = null
  const entrar = (ses = SES_ANA) => {
    guardarSesion('studio-a', { ...ses, guardadaEn: Date.now() })
    state.entroAqui('studio-a', leerSesion('studio-a')!)
  }
  const boton = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement
  const elBoton = () => boton(/^(Confirmar reserva|Pagar )/)
  const sinRed = () => new TypeError('Failed to fetch')
  const texto = () => document.body.textContent ?? ''
  /** El elemento anfitrión del último widget montado (los avisos `avoqado:*` salen ahí). */
  let anfitrion: HTMLElement
  async function abrirClase(producto: Record<string, unknown>, estudio: Partial<PublicVenueInfo> = {}) {
    vi.mocked(api.getVenueInfo).mockResolvedValue({ ...venue, canCharge: true, products: [producto as any], ...estudio })
    vi.mocked(api.getClassSessionsRange).mockResolvedValue({ ...VENTANA, slots: [s15()] } as any)
    window.history.replaceState({}, '', '/studio-a/classes')
    const p = { ...props(), flowType: 'classes' as const }
    anfitrion = p.hostElement
    const r = render(<BookingFlow props={p} />); await flush(); await flush()
    fireEvent.click(screen.getByRole('button', { name: /Lagree.*15:00/ })); await flush()
    return r
  }
  /** Del detalle a «Confirma tu reserva» (por el mapa si la clase lo tiene). */
  async function aConfirmar(producto: Record<string, unknown>, estudio: Partial<PublicVenueInfo> = {}, lugares: string[] = []) {
    const r = await abrirClase(producto, estudio)
    fireEvent.click(boton('Reservar')); await flush()
    for (const l of lugares) { fireEvent.click(boton(`Lugar ${l}`)); await flush() }
    if (lugares.length) { fireEvent.click(boton(/^Continuar con /)); await flush() }
    await flush()
    return r
  }
  const datosDeInvitada = (telefono = '5512345678') => {
    fireEvent.input(screen.getByLabelText(/Nombre/), { target: { value: 'Ana Invitada' } })
    if (telefono) fireEvent.input(screen.getByLabelText(/Teléfono/), { target: { value: telefono } })
  }
  /** Las dos revisiones (2 s y 5 s). */
  async function revisar() { await advance(2000); await flush(); await advance(5000); await flush() }

  beforeEach(() => {
    fijarPagina('studio-a', 'reservas', null)
    state.bindCustomerSessionToVenue('studio-a')
    guardadas = []; lecturasSinRed = false; fallaLectura = null
    vi.mocked(api.getCustomerPortal).mockReturnValue(new Promise(() => {}))
    vi.mocked(api.getCreditPacks).mockResolvedValue([])
    vi.mocked(api.getCustomerCredits).mockResolvedValue(saldo(B5))
    vi.mocked(api.getMisReservasDeClase).mockImplementation(async () => {
      if (fallaLectura) throw fallaLectura()
      if (lecturasSinRed) throw sinRed()
      return pagina(guardadas)
    })
    vi.mocked(api.getReservation).mockImplementation(async (_slug: string, secret: string) => ({
      ...detail, confirmationCode: guardadas.find(r => r.cancelSecret === secret)?.confirmationCode ?? 'X',
      status: guardadas.find(r => r.cancelSecret === secret)?.status ?? 'CONFIRMED',
      depositStatus: guardadas.find(r => r.cancelSecret === secret)?.depositStatus ?? null,
      startsAt: '2026-10-08T21:00:00Z', endsAt: '2026-10-08T21:50:00Z',
    }))
    vi.mocked(api.createReservation).mockResolvedValue(CONFIRMADA)
  })
  afterEach(() => {
    cleanup(); borrarSesion('studio-a'); state.clearCustomerSession('studio-a'); fijarPagina('studio-a', 'reservas', null)
    delete (globalThis as any).__entradaDePrueba; delete (globalThis as any).__onEntro
  })

  /** Ana confirma; el SERVIDOR guarda la reserva pero la respuesta se pierde. */
  const respuestaPerdida = (extra: Partial<MiReservaDeClase> = {}) =>
    vi.mocked(api.createReservation).mockImplementationOnce(async () => {
      guardadas = [...guardadas, mia(extra)]
      throw sinRed()
    })

  it('con sesión y un paquete de 5 con 4: «Confirma tu reserva», «Usa 1 de tus 4 sesiones de Lagree» y «A pagar hoy $0»; nada se manda hasta el botón, y entonces UNA vez con el paquete que vence primero', async () => {
    entrar()
    vi.mocked(api.getCustomerCredits).mockResolvedValue(saldo(B10, B5))
    await aConfirmar(enEstudio)
    expect(screen.getByRole('heading', { name: 'Confirma tu reserva' })).toBeTruthy()
    expect(screen.getByText('Usa 1 de tus 4 sesiones de Lagree')).toBeTruthy()
    expect(screen.getByText('Paquete de 5 · vence el 11 dic')).toBeTruthy()
    const confirmar = document.querySelector('.avq-confirmar') as HTMLElement
    expect(within(confirmar).getByText('A pagar hoy').nextElementSibling?.textContent).toBe('$0')
    // Sin el reloj de «Clase reservada durante» (el SERVIDOR no aparta nada para una clase).
    expect(texto()).not.toMatch(/reservada durante|Proceso de pago/)
    await advance(60_000); await flush()
    expect(api.createReservation).not.toHaveBeenCalled()
    fireEvent.click(boton('Confirmar reserva')); await flush()
    expect(api.createReservation).toHaveBeenCalledTimes(1)
    const [slug, body, token] = vi.mocked(api.createReservation).mock.calls[0]
    expect(slug).toBe('studio-a')
    expect(token).toBe('tok-ana')
    expect(body).toMatchObject({ classSessionId: 's-15', creditItemBalanceId: 'b5', guestName: 'Ana' })
  })

  it('doble clic en «Confirmar reserva» ⇒ una sola llamada', async () => {
    entrar()
    vi.mocked(api.createReservation).mockImplementation(() => new Promise(() => {}))
    await aConfirmar(enEstudio)
    const b = boton('Confirmar reserva')
    fireEvent.click(b); fireEvent.click(b); await flush()
    // Ya repintado dice «Reservando…» y no responde.
    const enviando = boton(/Reservando/)
    expect(enviando.disabled).toBe(true)
    fireEvent.click(enviando); await flush()
    expect(api.createReservation).toHaveBeenCalledTimes(1)
  })

  it('respuesta perdida, con sesión: «Revisando…» sin botones; la revisión la encuentra ⇒ «¡Tu lugar está apartado!» con su clase, hora y lugar, y UNA sola llamada', async () => {
    entrar()
    respuestaPerdida({ spotIds: ['p3'] })
    await aConfirmar({ ...enEstudio, layoutConfig: DADO }, {}, ['3'])
    const confirmada = vi.fn()
    anfitrion.addEventListener('avoqado:confirmed', confirmada)
    expect(screen.getByText('Lugar').nextElementSibling?.textContent).toBe('3')
    fireEvent.click(boton('Confirmar reserva')); await flush()
    expect(screen.getByText('Revisando si tu reserva quedó…')).toBeTruthy()
    expect(texto()).toContain('No toques nada; en un momento te decimos')
    expect(screen.queryByRole('button', { name: /Intentar de nuevo|Confirmar reserva|Revisar de nuevo/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Atrás' })?.hasAttribute('disabled') ?? true).toBe(true)
    await advance(2000); await flush()
    expect(screen.getByRole('heading', { name: '¡Tu lugar está apartado!' })).toBeTruthy()
    expect(texto()).toContain('Lagree')
    expect(texto()).toContain('Jueves 8 de octubre · 15:00')
    // Task 14: la misma pantalla que una reserva que respondió (la coach con su nombre y el lugar aparte).
    expect(screen.getByText('Fer Ruiz')).toBeTruthy()
    expect(screen.getByText('Lugar 3')).toBeTruthy()
    expect(api.createReservation).toHaveBeenCalledTimes(1)
    // La página se entera, como con una reserva que respondió.
    expect(confirmada).toHaveBeenCalledTimes(1)
    expect((confirmada.mock.calls[0][0] as CustomEvent).detail.confirmationCode).toBe('NUEVA')
    const ultima = <T,>(xs: T[]): T | undefined => xs[xs.length - 1]
    expect(ultima(vi.mocked(api.getReservation).mock.calls)?.slice(0, 2)).toEqual(['studio-a', 'sec-nueva'])
    // La misma ventana del horario, con el token de su estudio.
    expect(ultima(vi.mocked(api.getMisReservasDeClase).mock.calls)).toEqual(['studio-a', VENTANA, 'tok-ana'])
    // Task 14: con cuenta, «Ver mis reservas» abre «Mi cuenta» (la invitada ve «Ver mi reserva»).
    fireEvent.click(boton('Ver mis reservas')); await flush()
    expect(state.showPortal.value).toBe(true)
  })

  it.each([
    ['PENDING con el depósito pendiente', 'Tu lugar quedó apartado, pero falta pagar', { status: 'PENDING' as const, depositStatus: 'PENDING' }],
    ['PENDING sin depósito', 'Tu reserva quedó y espera la aprobación del estudio', { status: 'PENDING' as const, depositStatus: null }],
  ])('la encontrada está %s ⇒ «%s» y «Ver mi reserva» lleva a «Gestionar»', async (_caso, titulo, extra) => {
    entrar()
    respuestaPerdida(extra)
    await aConfirmar(enEstudio)
    fireEvent.click(boton('Confirmar reserva')); await flush()
    await advance(2000); await flush()
    expect(screen.getByRole('heading', { name: titulo })).toBeTruthy()
    expect(texto()).not.toContain('¡Tu lugar está apartado!')
    fireEvent.click(boton('Ver mi reserva')); await flush()
    expect(state.manageSecret.value).toBe('sec-nueva')
    expect(state.step.value).toBe(99)
  })

  it('no quedó: dos revisiones sin reserva nueva ⇒ «No encontramos tu reserva»; «Intentar de nuevo» manda el MISMO pedido, sólo al tocarlo', async () => {
    entrar()
    vi.mocked(api.createReservation).mockRejectedValueOnce(sinRed()).mockResolvedValueOnce(CONFIRMADA)
    await aConfirmar(enEstudio)
    fireEvent.click(boton('Agregar una nota para tu coach'))
    fireEvent.input(screen.getByLabelText('Algo que tu coach deba saber (lesión, embarazo…)'), { target: { value: 'Rodilla' } })
    fireEvent.click(boton('Confirmar reserva')); await flush()
    await revisar()
    expect(screen.getByText('No encontramos tu reserva')).toBeTruthy()
    expect(screen.getByText('No hay una reserva nueva a tu nombre en esta clase. Puedes intentarlo otra vez.')).toBeTruthy()
    expect(texto()).not.toMatch(/no se guardó|no se descontó|no se cobró/i)
    await advance(60_000); await flush()
    expect(api.createReservation).toHaveBeenCalledTimes(1)
    fireEvent.click(boton('Intentar de nuevo')); await flush()
    expect(api.createReservation).toHaveBeenCalledTimes(2)
    const campos = (i: number) => {
      const { successUrl: _s, cancelUrl: _c, ...resto } = vi.mocked(api.createReservation).mock.calls[i][1]
      return resto
    }
    expect(campos(1)).toEqual(campos(0))
    expect(campos(1)).toMatchObject({ creditItemBalanceId: 'b5', specialRequests: 'Rodilla', classSessionId: 's-15' })
  })

  it('sin red también al revisar ⇒ «Sin conexión» con «Revisar de nuevo» (revisa, no reserva); nunca «Intentar de nuevo» mientras no se sepa', async () => {
    entrar()
    vi.mocked(api.createReservation).mockImplementationOnce(async () => {
      guardadas = [mia()]
      lecturasSinRed = true
      throw sinRed()
    })
    await aConfirmar(enEstudio)
    fireEvent.click(boton('Confirmar reserva')); await flush()
    await revisar()
    expect(screen.getByText('Sin conexión')).toBeTruthy()
    expect(texto()).toContain('Cuando vuelva el internet, toca «Revisar de nuevo»')
    expect(screen.queryByRole('button', { name: 'Intentar de nuevo' })).toBeNull()
    const lecturas = vi.mocked(api.getMisReservasDeClase).mock.calls.length
    lecturasSinRed = false
    fireEvent.click(boton('Revisar de nuevo')); await flush()
    expect(screen.queryByRole('button', { name: /Intentar de nuevo|Revisar de nuevo/ })).toBeNull()
    await advance(2000); await flush()
    expect(vi.mocked(api.getMisReservasDeClase).mock.calls.length).toBe(lecturas + 1)
    expect(screen.getByRole('heading', { name: '¡Tu lugar está apartado!' })).toBeTruthy()
    expect(api.createReservation).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['404 (un SERVIDOR viejo sin la ruta)', 404],
    ['401 (la sesión se cerró)', 401],
  ] as const)('la revisión no está disponible: %s ⇒ «No pudimos revisar…», «Ver mi cuenta» e «Intentar de nuevo», sin ciclo de «Revisar de nuevo»', async (_caso, status) => {
    entrar()
    vi.mocked(api.createReservation).mockImplementationOnce(async () => {
      fallaLectura = () => {
        if (status === 401) state.clearCustomerSession('studio-a', 'tok-ana') // lo que hace `request` con un 401
        return Object.assign(new Error('x'), { status, data: { message: 'x' } })
      }
      throw sinRed()
    })
    await aConfirmar(enEstudio)
    fireEvent.click(boton('Confirmar reserva')); await flush()
    await advance(2000); await flush()
    expect(screen.getByText('No pudimos revisar si tu reserva quedó')).toBeTruthy()
    expect(screen.getByText('Antes de intentar de nuevo, revisa «Mi cuenta» o tu correo.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Revisar de nuevo' })).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    const lecturas = vi.mocked(api.getMisReservasDeClase).mock.calls.length
    await advance(10_000); await flush()
    expect(vi.mocked(api.getMisReservasDeClase).mock.calls.length).toBe(lecturas) // una sola lectura: sin la segunda
    expect(boton('Intentar de nuevo')).toBeTruthy()
    fireEvent.click(boton('Ver mi cuenta')); await flush()
    expect(state.showPortal.value).toBe(true)
  })

  describe('la cuenta cambió entre el toque y la respuesta ⇒ no se enseña ninguna reserva', () => {
    const NO_PUDIMOS = 'No pudimos confirmar tu reserva'

    it('durante el POST (que sí respondió)', async () => {
      entrar()
      vi.mocked(api.createReservation).mockImplementationOnce(async () => { entrar(SES_BEA); return CONFIRMADA })
      await aConfirmar(enEstudio)
      fireEvent.click(boton('Confirmar reserva')); await flush(); await flush()
      expect(screen.getByText(NO_PUDIMOS)).toBeTruthy()
      expect(screen.getByText('Revisa «Mi cuenta».')).toBeTruthy()
      expect(state.bookingResult.value).toBeNull()
      expect(texto()).not.toMatch(/Confirmada|OK-1|apartado/)
    })

    it('durante el POST que se perdió: no se revisa con la otra cuenta', async () => {
      entrar()
      vi.mocked(api.createReservation).mockImplementationOnce(async () => { guardadas = [mia()]; entrar(SES_BEA); throw sinRed() })
      await aConfirmar(enEstudio)
      const lecturas = vi.mocked(api.getMisReservasDeClase).mock.calls.length
      fireEvent.click(boton('Confirmar reserva')); await flush()
      await revisar()
      expect(screen.getByText(NO_PUDIMOS)).toBeTruthy()
      expect(texto()).not.toContain('apartado')
      // La revisión no leyó nada (ni con la sesión de Ana ni con la de Bea): sólo el horario de Bea se pone al día con la suya.
      expect(vi.mocked(api.getMisReservasDeClase).mock.calls.slice(lecturas).every(c => c[2] !== 'tok-ana')).toBe(true)
    })

    it('durante una lectura de la revisión', async () => {
      entrar()
      vi.mocked(api.createReservation).mockImplementationOnce(async () => { guardadas = [mia()]; throw sinRed() })
      await aConfirmar(enEstudio)
      fireEvent.click(boton('Confirmar reserva')); await flush()
      vi.mocked(api.getMisReservasDeClase).mockImplementationOnce(async () => { entrar(SES_BEA); return pagina(guardadas) })
      await advance(2000); await flush()
      expect(screen.getByText(NO_PUDIMOS)).toBeTruthy()
      expect(texto()).not.toContain('apartado')
    })

    it('durante el GET de la reserva encontrada (y la página no se entera de una reserva confirmada)', async () => {
      entrar()
      respuestaPerdida()
      await aConfirmar(enEstudio)
      const confirmada = vi.fn()
      anfitrion.addEventListener('avoqado:confirmed', confirmada)
      fireEvent.click(boton('Confirmar reserva')); await flush()
      vi.mocked(api.getReservation).mockImplementationOnce(async () => { entrar(SES_BEA); return { ...detail, confirmationCode: 'NUEVA' } })
      await advance(2000); await flush()
      expect(screen.getByText(NO_PUDIMOS)).toBeTruthy()
      expect(texto()).not.toContain('apartado')
      expect(confirmada).not.toHaveBeenCalled()
    })

    it('ya con «¡Tu lugar está apartado!» a la vista, entra otra cuenta ⇒ la pantalla deja de enseñar esa reserva', async () => {
      entrar()
      respuestaPerdida()
      await aConfirmar(enEstudio)
      fireEvent.click(boton('Confirmar reserva')); await flush()
      await advance(2000); await flush()
      expect(screen.getByRole('heading', { name: '¡Tu lugar está apartado!' })).toBeTruthy()
      await act(async () => { entrar(SES_BEA) }); await flush()
      expect(texto()).not.toContain('apartado')
      expect(screen.getByText(NO_PUDIMOS)).toBeTruthy()
    })

    it('el widget cambió de estudio mientras revisaba ⇒ nada de esa revisión se pinta', async () => {
      entrar()
      respuestaPerdida()
      const r = await aConfirmar(enEstudio)
      fireEvent.click(boton('Confirmar reserva')); await flush()
      r.rerender(<BookingFlow props={{ ...props('studio-b'), flowType: 'classes' }} />); await flush()
      await revisar(); await flush()
      expect(texto()).not.toMatch(/apartado|No pudimos|No encontramos|Revisando/)
    })
  })

  describe('invitada sin sesión: su POST no cambia y con error de red no se revisa', () => {
    it.each([
      ['se confirma al momento y dio teléfono', { scheduling: { maxAdvanceDays: 30, minNoticeMin: 0, autoConfirm: true } }, enEstudio, '5512345678', 'aviso'],
      ['la clase se paga en línea', { scheduling: { maxAdvanceDays: 30, minNoticeMin: 0, autoConfirm: true } }, enLinea, '5512345678', 'escribe'],
      ['el estudio aprueba las reservas', { scheduling: { maxAdvanceDays: 30, minNoticeMin: 0, autoConfirm: false } }, enEstudio, '5512345678', 'escribe'],
      ['no dio ni correo ni teléfono', {
        scheduling: { maxAdvanceDays: 30, minNoticeMin: 0, autoConfirm: true },
        publicBooking: { enabled: true, requireEmail: false, requirePhone: false },
      }, enEstudio, '', 'escribe'],
    ] as const)('%s', async (_caso, estudio, producto, telefono, cual) => {
      vi.mocked(api.createReservation).mockRejectedValueOnce(sinRed()).mockResolvedValueOnce(CONFIRMADA)
      await aConfirmar(producto, estudio as Partial<PublicVenueInfo>)
      datosDeInvitada(telefono)
      fireEvent.click(elBoton()); await flush()
      await revisar()
      // Sin cuenta, sin tope nuevo: sale sin token, como hoy.
      expect(vi.mocked(api.createReservation).mock.calls[0][2]).toBeUndefined()
      expect(api.getMisReservasDeClase).not.toHaveBeenCalled()
      expect(screen.getByText('No pudimos confirmar si tu reserva quedó')).toBeTruthy()
      expect(screen.getByText(cual === 'aviso'
        ? 'Si te llega la confirmación por correo o WhatsApp, tu lugar ya está apartado; si no te llega en unos minutos, intenta de nuevo.'
        : 'Escríbele al estudio antes de intentar de nuevo, para no apartar dos lugares.')).toBeTruthy()
      const chat = vi.fn()
      window.addEventListener('avoqado:open-chat', chat)
      try {
        fireEvent.click(boton('Escribir al estudio'))
        expect(chat).toHaveBeenCalledTimes(1)
      } finally { window.removeEventListener('avoqado:open-chat', chat) }
      expect(api.createReservation).toHaveBeenCalledTimes(1)
      fireEvent.click(boton('Intentar de nuevo')); await flush()
      expect(api.createReservation).toHaveBeenCalledTimes(2)
    })

    it('si el negocio no recibe mensajes, no hay «Escribir al estudio»', async () => {
      vi.mocked(api.createReservation).mockRejectedValueOnce(sinRed())
      await aConfirmar(enEstudio, { chat: { mode: 'DISABLED', canMessage: false } } as Partial<PublicVenueInfo>)
      datosDeInvitada()
      fireEvent.click(boton('Confirmar reserva')); await flush()
      expect(screen.getByText('No pudimos confirmar si tu reserva quedó')).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Escribir al estudio' })).toBeNull()
      expect(boton('Intentar de nuevo')).toBeTruthy()
    })
  })

  it.each([
    ['400', { status: 400, data: { message: 'Corrige tus datos' } }],
    ['409', { status: 409, data: { message: 'Conflicto' } }],
  ])('un %s NO dispara la revisión: sigue su manejo de hoy', async (_c, error) => {
    entrar()
    vi.mocked(api.createReservation).mockRejectedValueOnce(error)
    await aConfirmar(enEstudio)
    const lecturas = vi.mocked(api.getMisReservasDeClase).mock.calls.length
    fireEvent.click(boton('Confirmar reserva')); await flush(); await flush()
    expect(texto()).not.toMatch(/Revisando/)
    if (error.status === 400) expect(screen.getByRole('alert').textContent).toContain('Corrige tus datos')
    else expect(state.toastMessage.value?.text).toBe('Este horario ya no está disponible. Por favor elige otro horario.')
    await revisar()
    expect(texto()).not.toMatch(/Revisando|No encontramos|Sin conexión|No pudimos/)
    // Las únicas lecturas de después son la del horario al que regresó (409), nunca dos de revisión.
    expect(vi.mocked(api.getMisReservasDeClase).mock.calls.length - lecturas).toBeLessThan(2)
  })

  it('desde «Reservar otro lugar para alguien»: «Otro lugar en esta clase», sin el Ilimitado (es personal) y el pedido de hoy', async () => {
    entrar()
    guardadas = [mia({ confirmationCode: 'MIA', cancelSecret: 'sec-mia', spotIds: [] })]
    vi.mocked(api.getCustomerCredits).mockResolvedValue(saldo({ id: 'u1', restante: 0, original: 0, ilimitado: true, vence: '2026-12-20T18:00:00Z' }))
    await abrirClase(enEstudio)
    fireEvent.click(boton('Reservar otro lugar para alguien')); await flush(); await flush()
    expect(screen.getByText('Otro lugar en esta clase')).toBeTruthy()
    expect(texto()).not.toContain('Usa tu Ilimitado')
    expect(screen.getByText('Tu Ilimitado es personal: cubre 1 lugar a tu nombre')).toBeTruthy()
    expect(screen.getByText('Pagas en el estudio')).toBeTruthy()
    expect(texto()).not.toMatch(/9999/)
    fireEvent.click(boton('Confirmar reserva')); await flush()
    const body = vi.mocked(api.createReservation).mock.calls[0][1]
    expect(body.classSessionId).toBe('s-15')
    expect(body.creditItemBalanceId).toBeUndefined()
  })

  it('la marca de «otro lugar» no vale si la cuenta de ahora no tiene reserva en esa clase (cambió de cuenta)', async () => {
    entrar()
    guardadas = [mia({ confirmationCode: 'MIA', cancelSecret: 'sec-mia' })]
    vi.mocked(api.getMisReservasDeClase).mockImplementation(async (_s: string, _p: unknown, token: string) => pagina(token === 'tok-ana' ? guardadas : []))
    await abrirClase(enEstudio)
    fireEvent.click(boton('Reservar otro lugar para alguien')); await flush(); await flush()
    expect(screen.getByText('Otro lugar en esta clase')).toBeTruthy()
    await act(async () => { entrar(SES_BEA) }); await flush(); await flush()
    expect(screen.queryByText('Otro lugar en esta clase')).toBeNull()
    expect(screen.getByText('Usa 1 de tus 4 sesiones de Lagree')).toBeTruthy()
  })

  it('invitada en una clase gratis o que se paga en el estudio: el resumen lateral no tiene botón y sólo «Confirmar reserva» reserva; con paquete, el resumen dice «Incluida en tu paquete» (ola final W5)', async () => {
    const r = await aConfirmar(gratis)
    const lateral = () => document.querySelector('.avq-appts-sidebar') as HTMLElement
    expect(lateral()).toBeTruthy()
    expect(within(lateral()).queryAllByRole('button')).toHaveLength(0)
    expect(screen.queryByRole('button', { name: 'Reservar clase' })).toBeNull()
    datosDeInvitada()
    await advance(60_000); await flush()
    expect(api.createReservation).not.toHaveBeenCalled()
    fireEvent.click(boton('Confirmar reserva')); await flush()
    expect(api.createReservation).toHaveBeenCalledTimes(1)
    expect(vi.mocked(api.createReservation).mock.calls[0][1].creditItemBalanceId).toBeUndefined()
    r.unmount(); resetSignals(); state.bindCustomerSessionToVenue('studio-a')
    vi.mocked(api.createReservation).mockClear()
    entrar()
    await aConfirmar(enEstudio)
    expect(within(lateral()).queryAllByRole('button')).toHaveLength(0)
    expect(lateral().textContent).toContain('Incluida en tu paquete')
    expect(lateral().textContent).not.toMatch(/\$|A pagar/)
    expect(api.createReservation).not.toHaveBeenCalled()
  })

  it('volver atrás desde la confirmación y regresar ⇒ ninguna reserva automática', async () => {
    entrar()
    await aConfirmar(enEstudio)
    expect(screen.getByRole('heading', { name: 'Confirma tu reserva' })).toBeTruthy()
    fireEvent.click(boton('Atrás')); await flush(); await flush()
    expect(screen.getByRole('button', { name: /Lagree.*15:00/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Lagree.*15:00/ })); await flush()
    fireEvent.click(boton('Reservar')); await flush(); await flush()
    expect(screen.getByRole('heading', { name: 'Confirma tu reserva' })).toBeTruthy()
    await advance(60_000); await flush()
    expect(api.createReservation).not.toHaveBeenCalled()
  })

  it('dos paquetes ⇒ «Cambiar», y elegir el otro manda su balanceId', async () => {
    entrar()
    vi.mocked(api.getCustomerCredits).mockResolvedValue(saldo(B5, B10))
    await aConfirmar(enEstudio)
    fireEvent.click(boton('Cambiar'))
    fireEvent.click(screen.getByRole('radio', { name: /Usa 1 de tus 9 sesiones de Lagree/ })); await flush()
    expect(screen.getByText('Usa 1 de tus 9 sesiones de Lagree')).toBeTruthy()
    fireEvent.click(boton('Confirmar reserva')); await flush()
    expect(vi.mocked(api.createReservation).mock.calls[0][1].creditItemBalanceId).toBe('b10')
  })

  it('con paquete en una clase que también se paga en línea, «Cambiar» ofrece «Pagar $325 con tarjeta» y lleva al pago de hoy', async () => {
    entrar()
    vi.mocked(api.createReservation).mockResolvedValue({ ...CONFIRMADA, status: 'PENDING', depositRequired: true, depositAmount: 325, checkoutUrl: '#pago-tarjeta' })
    await aConfirmar(enLinea)
    fireEvent.click(boton('Cambiar'))
    fireEvent.click(screen.getByRole('radio', { name: 'Pagar $325 con tarjeta' })); await flush()
    fireEvent.click(boton('Pagar $325')); await flush()
    expect(vi.mocked(api.createReservation).mock.calls[0][1].creditItemBalanceId).toBeUndefined()
    expect(window.location.hash).toBe('#pago-tarjeta')
  })

  it('un solo paquete en una clase que exige paquete ⇒ sin «Cambiar»', async () => {
    entrar()
    await aConfirmar(soloPaquete)
    expect(screen.getByText('Usa 1 de tus 4 sesiones de Lagree')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Cambiar' })).toBeNull()
  })

  describe('un Ilimitado que vence antes del horario no se ofrece', () => {
    const VENCIDO = { id: 'u1', restante: 0, original: 0, ilimitado: true, vence: '2026-10-08T20:00:00Z' } // jueves 8, 14:00

    it('con otro paquete normal se usa ése', async () => {
      entrar()
      vi.mocked(api.getCustomerCredits).mockResolvedValue(saldo(VENCIDO, B5))
      await aConfirmar(soloPaquete)
      expect(texto()).not.toContain('Usa tu Ilimitado')
      expect(screen.getByText('Usa 1 de tus 4 sesiones de Lagree')).toBeTruthy()
      fireEvent.click(boton('Confirmar reserva')); await flush()
      expect(vi.mocked(api.createReservation).mock.calls[0][1].creditItemBalanceId).toBe('b5')
    })

    it('sin ninguno, en una clase que exige paquete: el aviso del Ilimitado y la compra de paquete de hoy, sin reservar', async () => {
      entrar()
      vi.mocked(api.getCustomerCredits).mockResolvedValue(saldo(VENCIDO))
      vi.mocked(api.getCreditPacks).mockResolvedValue([PAQ_LAGREE] as any)
      await aConfirmar(soloPaquete)
      expect(screen.getByText('Tu Ilimitado vence el 8 de octubre, antes de este horario.')).toBeTruthy()
      expect(texto()).toContain('Paquete Lagree')
      expect(screen.queryByRole('button', { name: /^(Confirmar reserva|Pagar )/ })).toBeNull()
      expect(texto()).not.toMatch(/9999/)
      expect(api.createReservation).not.toHaveBeenCalled()
    })

    it('sin ninguno, en una clase que se paga en el estudio: el aviso y se confirma sin paquete', async () => {
      entrar()
      vi.mocked(api.getCustomerCredits).mockResolvedValue(saldo(VENCIDO))
      await aConfirmar(enEstudio)
      expect(screen.getByText('Tu Ilimitado vence el 8 de octubre, antes de este horario.')).toBeTruthy()
      fireEvent.click(boton('Confirmar reserva')); await flush()
      expect(vi.mocked(api.createReservation).mock.calls[0][1].creditItemBalanceId).toBeUndefined()
    })
  })

  it('clase que se paga en línea, sin paquete ⇒ «Pagar $325» y lleva al pago de hoy', async () => {
    vi.mocked(api.createReservation).mockResolvedValue({ ...CONFIRMADA, status: 'PENDING', depositRequired: true, depositAmount: 325, checkoutUrl: '#pago-de-hoy' })
    await aConfirmar(enLinea)
    datosDeInvitada()
    fireEvent.click(boton('Pagar $325')); await flush()
    expect(api.createReservation).toHaveBeenCalledTimes(1)
    expect(vi.mocked(api.createReservation).mock.calls[0][1].creditItemBalanceId).toBeUndefined()
    expect(window.location.hash).toBe('#pago-de-hoy')
  })

  it.each([['gratis', gratis], ['que se paga en el estudio', enEstudio]])('clase %s ⇒ «Confirmar reserva», nunca «Pagar»', async (_c, producto) => {
    await aConfirmar(producto)
    expect(boton('Confirmar reserva')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Pagar / })).toBeNull()
  })

  it('en clases, la nota dice «Algo que tu coach deba saber (lesión, embarazo…)» y viaja como siempre', async () => {
    await aConfirmar(enEstudio)
    expect(screen.queryByLabelText(/Peticiones/)).toBeNull()
    datosDeInvitada()
    fireEvent.click(boton('Agregar una nota para tu coach'))
    fireEvent.input(screen.getByLabelText('Algo que tu coach deba saber (lesión, embarazo…)'), { target: { value: 'Embarazo de 5 meses' } })
    fireEvent.click(boton('Confirmar reserva')); await flush()
    expect(vi.mocked(api.createReservation).mock.calls[0][1].specialRequests).toBe('Embarazo de 5 meses')
  })

  it('entra desde la ventanita en una clase sin mapa ⇒ espera su paquete (sin dejar pagar de otro modo) y no reserva sola', async () => {
    ;(globalThis as any).__entradaDePrueba = SES_ANA
    let darSaldo!: (s: CustomerCreditBalance) => void
    vi.mocked(api.getCustomerCredits).mockImplementation(() => new Promise(ok => { darSaldo = ok }))
    await abrirClase(soloPaquete)
    fireEvent.click(boton('Reservar')); await flush()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Simular entrar' })); await flush(); await flush()
    expect(screen.getByText('Cargando tu paquete…')).toBeTruthy()
    expect(elBoton().disabled).toBe(true)
    await act(async () => darSaldo(saldo(B5))); await flush()
    expect(screen.getByText('Usa 1 de tus 4 sesiones de Lagree')).toBeTruthy()
    await advance(60_000); await flush()
    expect(api.createReservation).not.toHaveBeenCalled()
    fireEvent.click(boton('Confirmar reserva')); await flush()
    expect(vi.mocked(api.createReservation).mock.calls[0][1].creditItemBalanceId).toBe('b5')
  })

  describe('fix r1', () => {
    it('#1: con `showPrices` apagado, el resumen lateral de una clase que se paga en línea no enseña montos ni un «$0» que no es real', async () => {
      await aConfirmar(enLinea, { branding: { ...state.DEFAULT_BRANDING, showPrices: false } })
      const lateral = document.querySelector('.avq-confirmacion-lateral') as HTMLElement
      expect(lateral).toBeTruthy()
      expect(lateral.textContent).not.toMatch(/\$|A pagar|Variable/)
      expect(boton('Pagar con tarjeta')).toBeTruthy()
      expect(document.querySelector('.avq-confirmar')!.textContent).not.toContain('$')
    })

    it('#2: con sesión, «Confirmar reserva» espera también la lectura de sus reservas (sin ella, «antes» saldría vacío)', async () => {
      ;(globalThis as any).__entradaDePrueba = SES_ANA
      let darReservas!: (p: ReturnType<typeof pagina>) => void
      vi.mocked(api.getMisReservasDeClase).mockImplementationOnce(() => new Promise(ok => { darReservas = ok }))
      await abrirClase(soloPaquete)
      fireEvent.click(boton('Reservar')); await flush()
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Simular entrar' })); await flush(); await flush()
      // El saldo ya llegó; sus reservas no.
      expect(screen.getByText('Cargando tu paquete…')).toBeTruthy()
      expect(elBoton().disabled).toBe(true)
      fireEvent.click(elBoton()); await flush()
      expect(api.createReservation).not.toHaveBeenCalled()
      await act(async () => darReservas(pagina([]))); await flush()
      expect(boton('Confirmar reserva').disabled).toBe(false)
      expect(screen.getByText('Usa 1 de tus 4 sesiones de Lagree')).toBeTruthy()
    })

    it('#2: si la lectura de sus reservas FALLÓ, deja confirmar; tras un error de red sin lugares la revisión dice «no disponible», nunca «quedó» por una reserva vieja', async () => {
      ;(globalThis as any).__entradaDePrueba = SES_ANA
      // Ya tenía una reserva en esa clase (sin lugar), que la lectura fallida no dejó ver.
      guardadas = [mia({ confirmationCode: 'VIEJA', cancelSecret: 'sec-vieja' })]
      vi.mocked(api.getMisReservasDeClase).mockImplementationOnce(async () => { throw Object.assign(new Error('x'), { status: 500 }) })
      vi.mocked(api.createReservation).mockRejectedValueOnce(sinRed())
      await abrirClase(soloPaquete)
      fireEvent.click(boton('Reservar')); await flush()
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Simular entrar' })); await flush(); await flush()
      expect(boton('Confirmar reserva').disabled).toBe(false)
      const lecturas = vi.mocked(api.getMisReservasDeClase).mock.calls.length
      fireEvent.click(boton('Confirmar reserva')); await flush()
      await revisar()
      expect(screen.getByText('No pudimos revisar si tu reserva quedó')).toBeTruthy()
      expect(texto()).not.toContain('¡Tu lugar está apartado!')
      expect(vi.mocked(api.getMisReservasDeClase).mock.calls.length).toBe(lecturas)
      expect(api.createReservation).toHaveBeenCalledTimes(1)
    })

    it('#3: clase que se paga en el estudio, con paquete: «Cambiar» también ofrece «Pagar en el estudio»; elegirlo manda sin paquete y el resumen dice lo que se paga ahí', async () => {
      entrar()
      await aConfirmar(enEstudio)
      // Por default, el paquete que vence primero.
      expect(screen.getByText('Usa 1 de tus 4 sesiones de Lagree')).toBeTruthy()
      fireEvent.click(boton('Cambiar'))
      const grupo = screen.getByRole('radiogroup', { name: 'Cómo quieres pagar' })
      expect(within(grupo).getAllByRole('radio').map(r => r.textContent)).toEqual([
        'Usa 1 de tus 4 sesiones de LagreePaquete de 5 · vence el 11 dic',
        'Pagar en el estudio$325 · clase suelta',
      ])
      fireEvent.click(within(grupo).getByRole('radio', { name: /Pagar en el estudio/ })); await flush()
      expect(screen.getByText('Pagas en el estudio')).toBeTruthy()
      const confirmar = document.querySelector('.avq-confirmar') as HTMLElement
      expect(within(confirmar).getByText('A pagar en el estudio').nextElementSibling?.textContent).toBe('$325')
      const lateral = document.querySelector('.avq-confirmacion-lateral') as HTMLElement
      expect(within(lateral).getByText('A pagar en el estudio').nextElementSibling?.textContent).toBe('$325')
      expect(within(lateral).getByText('A pagar hoy').nextElementSibling?.textContent).toBe('$0')
      fireEvent.click(boton('Confirmar reserva')); await flush()
      expect(vi.mocked(api.createReservation).mock.calls[0][1].creditItemBalanceId).toBeUndefined()
    })

    it('#3: sin precios, «Pagar en el estudio» se ofrece sin monto y el resumen no enseña cantidades', async () => {
      entrar()
      await aConfirmar(enEstudio, { branding: { ...state.DEFAULT_BRANDING, showPrices: false } })
      fireEvent.click(boton('Cambiar'))
      fireEvent.click(screen.getByRole('radio', { name: 'Pagar en el estudio' })); await flush()
      expect(document.querySelector('.avq-confirmacion-lateral')!.textContent).not.toMatch(/\$|A pagar/)
      expect(document.querySelector('.avq-confirmar')!.textContent).not.toMatch(/\$325|A pagar en el estudio/)
    })
  })

  it('«¿Ya tienes paquete? Entra para usarlo» ⇒ al entrar, la confirmación ofrece su paquete y no reserva sola', async () => {
    ;(globalThis as any).__entradaDePrueba = SES_ANA
    vi.mocked(api.getCreditPacks).mockResolvedValue([PAQ_LAGREE] as any)
    await aConfirmar(enLinea)
    expect(boton('Pagar $325')).toBeTruthy()
    fireEvent.click(boton('¿Ya tienes paquete? Entra para usarlo')); await flush()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Simular entrar' })); await flush(); await flush()
    expect(screen.getByText('Usa 1 de tus 4 sesiones de Lagree')).toBeTruthy()
    await advance(60_000); await flush()
    expect(api.createReservation).not.toHaveBeenCalled()
  })

  describe('ola final W1: al volver de la confirmación al horario se releen sus reservas y su saldo', () => {
    it('«Atrás» desde la confirmación vuelve a leer y marca «Reservada» la clase que quedó', async () => {
      entrar()
      await aConfirmar(enEstudio)
      expect(screen.getByRole('heading', { name: 'Confirma tu reserva' })).toBeTruthy()
      const reservasAntes = vi.mocked(api.getMisReservasDeClase).mock.calls.length
      const saldosAntes = vi.mocked(api.getCustomerCredits).mock.calls.length
      guardadas = [mia()] // la reserva quedó (p. ej. desde otra pestaña)
      fireEvent.click(boton('Atrás')); await flush(); await flush()
      expect(vi.mocked(api.getMisReservasDeClase).mock.calls.length).toBeGreaterThan(reservasAntes)
      expect(vi.mocked(api.getCustomerCredits).mock.calls.length).toBeGreaterThan(saldosAntes)
      expect(within(screen.getByRole('button', { name: /Lagree.*15:00/ })).getByText('Reservada')).toBeTruthy()
    })

    it('tras «sí quedó» y «Reservar otra clase», la franja enseña el saldo nuevo (una sesión menos)', async () => {
      entrar()
      respuestaPerdida()
      await aConfirmar(enEstudio)
      fireEvent.click(boton('Confirmar reserva')); await flush()
      await advance(2000); await flush()
      expect(screen.getByRole('heading', { name: '¡Tu lugar está apartado!' })).toBeTruthy()
      vi.mocked(api.getCustomerCredits).mockResolvedValue(saldo({ ...B5, restante: 3 }))
      fireEvent.click(boton('Reservar otra clase')); await flush(); await flush()
      expect(document.querySelector('.avq-franja')?.textContent).toBe('Hola, Ana · tienes 3 sesiones de Lagree · vencen el 11 dic')
      expect(within(screen.getByRole('button', { name: /Lagree.*15:00/ })).getByText('Reservada')).toBeTruthy()
    })
  })

  describe('ola final W5: el costado de la confirmación no enseña montos de la clase si se paga con paquete o es gratis', () => {
    const costado = () => document.querySelector('.avq-confirmacion-lateral') as HTMLElement

    it('con su paquete: «Incluida en tu paquete», sin «$325», Subtotal, Total ni «A pagar hoy»', async () => {
      entrar()
      await aConfirmar(enEstudio)
      expect(screen.getByText('Usa 1 de tus 4 sesiones de Lagree')).toBeTruthy()
      expect(costado().textContent).toContain('Incluida en tu paquete')
      expect(costado().textContent).not.toMatch(/\$|Subtotal|Total|A pagar/)
    })

    it('clase gratis: sin montos y sin «Incluida en tu paquete»', async () => {
      await aConfirmar(gratis)
      expect(costado().textContent).not.toMatch(/\$|Subtotal|Total|A pagar|Incluida/)
    })

    it('sin paquete, en el estudio: sigue con «$325» y «A pagar en el estudio $325»', async () => {
      await aConfirmar(enEstudio)
      expect(costado().textContent).toContain('$325')
      expect(within(costado()).getByText('A pagar en el estudio').nextElementSibling?.textContent).toBe('$325')
      expect(costado().textContent).not.toContain('Incluida')
    })
  })

  describe('ola final W6: la confirmación de una clase usa la cuenta de SU estudio, no las señales compartidas', () => {
    it('dos widgets: Ana entró en A (las señales compartidas son suyas) y B no tiene sesión ⇒ B no dice «Reservando como Ana» ni manda su token', async () => {
      entrar() // Ana en studio-a, el estudio activo de las señales compartidas
      expect(state.customerToken.value).toBe('tok-ana')
      vi.mocked(api.getVenueInfo).mockImplementation(async slug => ({
        ...venue, slug, name: slug === 'studio-a' ? 'Studio A' : 'Studio B', canCharge: true, products: [enEstudio as any],
      }))
      vi.mocked(api.getClassSessionsRange).mockResolvedValue({ ...VENTANA, slots: [s15()] } as any)
      window.history.replaceState({}, '', '/pagina-con-dos-estudios')
      const a = render(<BookingFlow props={{ ...props('studio-a'), flowType: 'classes' }} />)
      const b = render(<BookingFlow props={{ ...props('studio-b'), flowType: 'classes' }} />)
      await flush(); await flush()
      const enA = a.container as HTMLElement
      const enB = b.container as HTMLElement
      expect(enA.querySelector('.avq-franja')?.textContent).toContain('Hola, Ana')
      fireEvent.click(within(enB).getByRole('button', { name: /Lagree.*15:00/ })); await flush()
      fireEvent.click(within(enB).getByRole('button', { name: 'Reservar' })); await flush(); await flush()
      expect(within(enB).getByRole('heading', { name: 'Confirma tu reserva' })).toBeTruthy()
      expect(enB.textContent).not.toContain('Reservando como')
      expect(enB.textContent).not.toContain('Ana')
      fireEvent.input(within(enB).getByLabelText(/Nombre/), { target: { value: 'Bea Invitada' } })
      fireEvent.input(within(enB).getByLabelText(/Teléfono/), { target: { value: '5512345678' } })
      fireEvent.click(within(enB).getByRole('button', { name: 'Confirmar reserva' })); await flush()
      expect(api.createReservation).toHaveBeenCalledTimes(1)
      const [slug, body, token] = vi.mocked(api.createReservation).mock.calls[0]
      expect(slug).toBe('studio-b')
      expect(token).toBeUndefined()
      expect(body.guestName).toBe('Bea Invitada')
      // B no la trata como de una cuenta: «Ver mi reserva» (de invitada), nunca «Ver mis reservas».
      expect(within(enB).queryByRole('button', { name: 'Ver mis reservas' })).toBeNull()
    })
  })

  describe('ola final W7: con sesión, si no se pudo leer su paquete, no se le ofrece pagar con tarjeta', () => {
    it('la primera lectura del saldo falla ⇒ «No pudimos leer tu paquete» con «Reintentar», sin «Pagar $325» y con el botón deshabilitado; al releerlo, su paquete', async () => {
      entrar()
      vi.mocked(api.getCustomerCredits).mockRejectedValue(sinRed())
      await aConfirmar(enLinea)
      expect(screen.getByRole('heading', { name: 'Confirma tu reserva' })).toBeTruthy()
      expect(screen.getByText('No pudimos leer tu paquete')).toBeTruthy()
      expect(texto()).not.toMatch(/Pagar \$325|con tarjeta|A pagar hoy/)
      expect(elBoton().disabled).toBe(true)
      fireEvent.click(elBoton()); await flush()
      expect(api.createReservation).not.toHaveBeenCalled()
      const lecturas = vi.mocked(api.getCustomerCredits).mock.calls.length
      vi.mocked(api.getCustomerCredits).mockResolvedValue(saldo(B5))
      fireEvent.click(boton('Reintentar')); await flush(); await flush()
      expect(vi.mocked(api.getCustomerCredits).mock.calls.length).toBe(lecturas + 1)
      expect(screen.queryByText('No pudimos leer tu paquete')).toBeNull()
      expect(screen.getByText('Usa 1 de tus 4 sesiones de Lagree')).toBeTruthy()
      expect(elBoton().disabled).toBe(false)
      fireEvent.click(boton('Confirmar reserva')); await flush()
      expect(vi.mocked(api.createReservation).mock.calls[0][1].creditItemBalanceId).toBe('b5')
    })

    it('una clase que sólo se paga con paquete: si falla la lectura, tampoco le dice que no tiene paquete', async () => {
      entrar()
      vi.mocked(api.getCustomerCredits).mockRejectedValue(sinRed())
      await aConfirmar(soloPaquete)
      expect(screen.getByText('No pudimos leer tu paquete')).toBeTruthy()
      expect(boton('Reintentar')).toBeTruthy()
      expect(texto()).not.toContain('Compra un paquete')
      expect(elBoton().disabled).toBe(true)
    })

    it('invitada (sin sesión): sin aviso de paquete, como hoy', async () => {
      vi.mocked(api.getCustomerCredits).mockRejectedValue(sinRed())
      await aConfirmar(enLinea)
      expect(screen.queryByText('No pudimos leer tu paquete')).toBeNull()
      expect(boton('Pagar $325')).toBeTruthy()
    })
  })

  describe('Task 14: «¡Tu lugar está apartado!» dice qué clase, con quién, en qué lugar y cuántas sesiones le quedan', () => {
    const CON_SALDO = {
      ...CONFIRMADA, creditRedeemed: true, creditsUsed: 1,
      creditBalance: { balanceId: 'b5', packName: 'Paquete de 5', remaining: 3, original: 5, unlimited: false, expiresAt: '2026-12-11T18:00:00Z' },
    }

    it('con sesión y paquete: la clase, cuándo, la coach y el saldo que regresó el SERVIDOR; «Ver mis reservas» abre «Mi cuenta»', async () => {
      entrar()
      vi.mocked(api.createReservation).mockResolvedValueOnce(CON_SALDO)
      await aConfirmar(enEstudio)
      fireEvent.click(boton('Confirmar reserva')); await flush()
      expect(screen.getByRole('heading', { name: '¡Tu lugar está apartado!' })).toBeTruthy()
      expect(screen.getByText('Te esperamos, Ana')).toBeTruthy()
      expect(screen.getByText('Lagree')).toBeTruthy()
      expect(screen.getByText('Jueves 8 de octubre · 15:00 – 15:50')).toBeTruthy()
      expect(screen.getByText('Fer Ruiz')).toBeTruthy()
      expect(screen.getByText('Usaste 1 sesión · te quedan 3 de 5 (vencen el 11 dic)')).toBeTruthy()
      expect(texto()).not.toMatch(/Reservación Confirmada|Gestionar Reservación| De /)
      fireEvent.click(boton('Ver mis reservas')); await flush()
      expect(state.showPortal.value).toBe(true)
    })

    it('con mapa y 2 lugares, SERVIDOR viejo (sin `creditBalance`): «Usaste 2 sesiones» y «Lugares 1, 3», sin saldo', async () => {
      entrar()
      vi.mocked(api.createReservation).mockResolvedValueOnce({ ...CONFIRMADA, creditRedeemed: true, creditsUsed: 2 })
      await aConfirmar({ ...enEstudio, layoutConfig: DADO }, {}, ['1', '3'])
      fireEvent.click(boton('Confirmar reserva')); await flush()
      expect(screen.getByText('Usaste 2 sesiones')).toBeTruthy()
      expect(screen.getByText('Lugares 1, 3')).toBeTruthy()
      expect(texto()).not.toMatch(/te quedan|te queda/)
    })

    it('al gastar la última: «Usaste tu última sesión de este paquete» y «Ver paquetes» abre los paquetes del estudio', async () => {
      entrar()
      vi.mocked(api.getCreditPacks).mockResolvedValue([PAQ_LAGREE] as any)
      vi.mocked(api.createReservation).mockResolvedValueOnce({ ...CON_SALDO, creditBalance: { ...CON_SALDO.creditBalance, remaining: 0 } })
      await aConfirmar(enEstudio)
      fireEvent.click(boton('Confirmar reserva')); await flush()
      expect(screen.getByText('Usaste tu última sesión de este paquete')).toBeTruthy()
      fireEvent.click(boton('Ver paquetes')); await flush()
      expect(screen.getByRole('dialog')).toBeTruthy()
    })

    it('con su Ilimitado: «Usaste tu Ilimitado», nunca sus números internos', async () => {
      entrar()
      vi.mocked(api.getCustomerCredits).mockResolvedValue(saldo({ id: 'u1', restante: 0, original: 0, vence: '2026-12-20T18:00:00Z', ilimitado: true }))
      vi.mocked(api.createReservation).mockResolvedValueOnce({
        ...CONFIRMADA, creditRedeemed: true, creditsUsed: 1,
        creditBalance: { balanceId: 'u1', packName: 'Mensual Ilimitado', remaining: 99998, original: 99999, unlimited: true, expiresAt: '2026-12-20T18:00:00Z' },
      })
      await aConfirmar(enEstudio)
      fireEvent.click(boton('Confirmar reserva')); await flush()
      expect(screen.getByText('Usaste tu Ilimitado (vence el 20 dic)')).toBeTruthy()
      expect(texto()).not.toMatch(/9999/)
    })

    it('invitada en una clase que se paga en el estudio: «Pagas $325 en el estudio» y «Ver mi reserva» abre «Gestionar»', async () => {
      await aConfirmar(enEstudio)
      datosDeInvitada()
      fireEvent.click(boton('Confirmar reserva')); await flush()
      expect(screen.getByRole('heading', { name: '¡Tu lugar está apartado!' })).toBeTruthy()
      expect(screen.getByText('Te esperamos, Ana')).toBeTruthy()
      expect(screen.getByText('Pagas $325 en el estudio')).toBeTruthy()
      expect(screen.queryByText(/Usaste/)).toBeNull()
      expect(screen.queryByRole('button', { name: 'Ver mis reservas' })).toBeNull()
      fireEvent.click(boton('Ver mi reserva')); await flush()
      expect(state.manageSecret.value).toBe('sec-ok')
    })

    it('con la reserva a la vista entra otra cuenta del estudio ⇒ «No pudimos confirmar tu reserva», sin un dato de la de Ana', async () => {
      entrar()
      vi.mocked(api.createReservation).mockResolvedValueOnce(CON_SALDO)
      await aConfirmar(enEstudio)
      fireEvent.click(boton('Confirmar reserva')); await flush()
      expect(screen.getByRole('heading', { name: '¡Tu lugar está apartado!' })).toBeTruthy()
      await act(async () => { entrar(SES_BEA) }); await flush()
      expect(screen.getByText('No pudimos confirmar tu reserva')).toBeTruthy()
      expect(texto()).not.toMatch(/apartado|Usaste|Fer Ruiz|Te esperamos/)
    })

    it.each([
      ['con sesión', true],
      ['invitada', false],
    ])('fix r1 #2: %s, la reserva espera la aprobación del estudio (`PENDING` sin depósito) ⇒ «…espera la aprobación del estudio», nunca «apartado»', async (_caso, conSesion) => {
      if (conSesion) entrar()
      vi.mocked(api.createReservation).mockResolvedValueOnce({ ...CONFIRMADA, status: 'PENDING' })
      await aConfirmar(enEstudio)
      if (!conSesion) datosDeInvitada()
      fireEvent.click(boton('Confirmar reserva')); await flush()
      expect(screen.getByRole('heading', { name: 'Tu reserva quedó y espera la aprobación del estudio' })).toBeTruthy()
      expect(texto()).not.toMatch(/apartado|Te esperamos/)
      fireEvent.click(boton('Ver mi reserva')); await flush()
      expect(state.manageSecret.value).toBe('sec-ok')
    })

    it('fix r1 #2: `PENDING` por aprobar y entra otra cuenta ⇒ «No pudimos confirmar tu reserva»', async () => {
      entrar()
      vi.mocked(api.createReservation).mockResolvedValueOnce({ ...CONFIRMADA, status: 'PENDING' })
      await aConfirmar(enEstudio)
      fireEvent.click(boton('Confirmar reserva')); await flush()
      await act(async () => { entrar(SES_BEA) }); await flush()
      expect(screen.getByText('No pudimos confirmar tu reserva')).toBeTruthy()
      expect(texto()).not.toMatch(/espera la aprobación|Lagree/)
    })

    it('«sí quedó» (Task 13) enseña la misma pantalla: sin saldo del SERVIDOR, «Usaste 1 sesión»', async () => {
      entrar()
      respuestaPerdida()
      await aConfirmar(enEstudio)
      fireEvent.click(boton('Confirmar reserva')); await flush()
      await advance(2000); await flush()
      expect(screen.getByRole('heading', { name: '¡Tu lugar está apartado!' })).toBeTruthy()
      expect(screen.getByText('Usaste 1 sesión')).toBeTruthy()
      expect(screen.getByText('Te esperamos, Ana')).toBeTruthy()
      expect(document.querySelector('.avq-listo')).toBeTruthy()
    })

    describe('al volver de Stripe', () => {
      const pagada = {
        ...detail, confirmationCode: 'OK-9', startsAt: '2026-10-08T21:00:00Z', endsAt: '2026-10-08T21:50:00Z', duration: 50,
        depositAmount: 325, depositStatus: 'PAID', status: 'CONFIRMED', className: 'Lagree', instructorName: 'Fer Ruiz', spotIds: ['3'],
      }
      async function volverDeStripe(reserva: object) {
        sessionStorage.setItem('avq:pendingReservation:studio-a', JSON.stringify({ venue: 'studio-a', cancelSecret: 'sec-9', confirmationCode: 'OK-9', ref: 'r9' }))
        window.history.replaceState({}, '', '/studio-a/classes?avq_payment=success&avq_ref=r9')
        vi.mocked(api.getVenueInfo).mockResolvedValue({ ...venue, canCharge: true, products: [enLinea as any] })
        vi.mocked(api.getClassSessionsRange).mockResolvedValue({ ...VENTANA, slots: [s15()] } as any)
        vi.mocked(api.getReservation).mockResolvedValue(reserva as PublicReservationDetail)
        render(<BookingFlow props={{ ...props(), flowType: 'classes' }} />); await flush(); await flush()
      }

      it('CONFIRMED y pagada: la misma pantalla, con la clase, la coach y el lugar guardados (del GET)', async () => {
        await volverDeStripe(pagada)
        expect(screen.getByRole('heading', { name: '¡Tu lugar está apartado!' })).toBeTruthy()
        expect(screen.getByText('Jueves 8 de octubre · 15:00 – 15:50')).toBeTruthy()
        expect(screen.getByText('Fer Ruiz')).toBeTruthy()
        expect(screen.getByText('Lugar 3')).toBeTruthy()
        expect(screen.getByText('Pagaste $325 con tarjeta')).toBeTruthy()
        expect(screen.queryByText('Tu Reservación')).toBeNull()
        fireEvent.click(boton('Ver mi reserva')); await flush()
        expect(screen.getByText('Tu Reservación')).toBeTruthy()
      })

      const portalCon = (upcoming: object[]) => ({
        customer: { ...ANA, loyaltyPoints: 0, totalVisits: 0 }, credits: { purchases: [] }, reservations: { upcoming, past: [] },
        invitadaRequiereEntrar: false, descuentos: { items: [], total: 0, nextCursor: null }, tarjetas: { items: [], total: 0, nextCursor: null },
        pedidos: { items: [], total: 0, nextCursor: null }, otraFicha: null,
      }) as any

      it('fix r1 #1: con sesión, «Ver mis reservas» y de vuelta ⇒ «Gestionar» (la pantalla no vuelve a salir)', async () => {
        entrar()
        vi.mocked(api.getCustomerPortal).mockResolvedValue(portalCon([]))
        await volverDeStripe(pagada)
        expect(screen.getByRole('heading', { name: '¡Tu lugar está apartado!' })).toBeTruthy()
        fireEvent.click(boton('Ver mis reservas')); await flush()
        expect(state.showPortal.value).toBe(true)
        await act(async () => { state.showPortal.value = false }); await flush()
        expect(screen.getByText('Tu Reservación')).toBeTruthy()
        expect(texto()).not.toContain('apartado')
      })

      it('fix r1 #1: con sesión también llega a «Gestionar» de ESTA reserva con «Ver o cambiar esta reserva»', async () => {
        entrar()
        await volverDeStripe(pagada)
        fireEvent.click(boton('Ver o cambiar esta reserva')); await flush()
        expect(screen.getByText('Tu Reservación')).toBeTruthy()
        expect(screen.getByText('OK-9')).toBeTruthy()
      })

      it('fix r1 #1: otra clase pagada abierta desde «Mi cuenta» ⇒ «Gestionar», no esta pantalla', async () => {
        entrar()
        vi.mocked(api.getCustomerPortal).mockResolvedValue(portalCon([{
          confirmationCode: 'OTRA-1', cancelSecret: 'sec-otra', status: 'CONFIRMED', startsAt: '2026-10-09T21:00:00Z',
          endsAt: '2026-10-09T21:50:00Z', product: { id: 'class-a', name: 'Lagree' },
        }]))
        await volverDeStripe(pagada)
        vi.mocked(api.getReservation).mockImplementation(async (_slug: string, secret: string) => (
          secret === 'sec-otra' ? { ...pagada, confirmationCode: 'OTRA-1', startsAt: '2026-10-09T21:00:00Z', endsAt: '2026-10-09T21:50:00Z' } : pagada
        ) as PublicReservationDetail)
        fireEvent.click(boton('Ver mis reservas')); await flush(); await flush()
        fireEvent.click(boton('Gestionar')); await flush(); await flush()
        expect(state.manageSecret.value).toBe('sec-otra')
        expect(screen.getByText('Tu Reservación')).toBeTruthy()
        expect(screen.getByText('OTRA-1')).toBeTruthy()
        expect(texto()).not.toContain('apartado')
      })

      it('el depósito todavía pendiente: «Gestionar» como hoy, con «Estamos confirmando el depósito»', async () => {
        await volverDeStripe({ ...pagada, status: 'PENDING', depositStatus: 'PENDING' })
        expect(screen.getByText('Tu Reservación')).toBeTruthy()
        expect(screen.getByRole('status').textContent).toContain('Estamos confirmando el depósito')
        expect(texto()).not.toContain('apartado')
      })
    })
  })
})
