import { h } from 'preact'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BookingFlow } from './BookingFlow'
import * as api from '../api/booking'
import * as state from '../state/booking'
import { borrarSesion, fijarPagina, guardarSesion, leerSesion } from '../lib/sesionDeCliente'
import { resolveDepositReturn, savePendingReservation } from '../lib/depositReturn'
import type { PublicVenueInfo, PublicReservationDetail, WidgetProps } from '../types'

vi.mock('../api/booking', () => ({
  getVenueInfo: vi.fn(), getCreditPacks: vi.fn(), getReservation: vi.fn(),
  getAvailability: vi.fn(), getClassSessionsRange: vi.fn(), createReservation: vi.fn(), createHold: vi.fn(), cancelHold: vi.fn(),
  getCustomerCredits: vi.fn(), getCustomerPortal: vi.fn(), createPackCheckout: vi.fn(),
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

  it('preserves fields written without submitting when the classes countdown expires without a hold', async () => {
    vi.mocked(api.getVenueInfo).mockResolvedValue({ ...venue, products: [{ ...venue.products[0], id: 'class-a', name: 'Clase propia', type: 'CLASS' }] })
    vi.mocked(api.getClassSessionsRange).mockResolvedValue({ dateFrom: '2026-10-06', dateTo: '2026-11-05', slots: [{
      startsAt: '2026-10-08T17:00:00Z', endsAt: '2026-10-08T18:00:00Z', available: true,
      classSessionId: 'session-draft', productId: 'class-a', productName: 'Clase propia', remaining: 8, capacity: 10, enrolled: 2,
    }] })
    window.history.replaceState({}, '', '/studio-a/classes')
    render(<BookingFlow props={{ ...props(), flowType: 'classes' }} />); await flush()
    fireEvent.click(screen.getByRole('button', { name: /Clase propia.*11:00/ })); await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Reservar lugar' })); await flush()
    fireEvent.input(screen.getByLabelText(/Nombre/), { target: { value: 'Ana Clase' } })
    fireEvent.input(screen.getByLabelText(/Teléfono/), { target: { value: '5512345678' } })
    fireEvent.input(screen.getByLabelText(/Peticiones/), { target: { value: 'Clase sin perder borrador' } })
    await advance(601000); await flush()
    expect(state.selectedSlot.value).toBeNull()
    expect(api.createReservation).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /Clase propia.*11:00/ })); await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Reservar lugar' })); await flush()
    expect((screen.getByLabelText(/Nombre/) as HTMLInputElement).value).toBe('Ana Clase')
    expect((screen.getByLabelText(/Teléfono/) as HTMLInputElement).value).toBe('5512345678')
    expect((screen.getByLabelText(/Peticiones/) as HTMLTextAreaElement).value).toBe('Clase sin perder borrador')
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
    fireEvent.click(screen.getByRole('button', { name: 'Reservar lugar' })); await flush()
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

  it.each(['Atrás', 'Mi cuenta'])('enables %s after the classes fallback expires without another selection', async control => {
    vi.useRealTimers()
    const settle = () => new Promise(resolve => setTimeout(resolve, 150))
    vi.mocked(api.getVenueInfo).mockResolvedValue({ ...venue, products: [{ ...venue.products[0], id: 'class-a', name: 'Clase propia', type: 'CLASS' }] })
    vi.mocked(api.getClassSessionsRange).mockResolvedValue({ dateFrom: '2026-10-06', dateTo: '2026-11-05', slots: [{
      startsAt: '2026-10-08T17:00:00Z', endsAt: '2026-10-08T18:00:00Z', available: true,
      classSessionId: 'session-expiring', productId: 'class-a', productName: 'Clase propia', remaining: 8, capacity: 10, enrolled: 2,
    }] })
    window.history.replaceState({}, '', '/studio-a/classes')
    render(<BookingFlow props={{ ...props(), flowType: 'classes' }} />); await settle()
    ;(screen.getByRole('button', { name: /Clase propia.*11:00/ }) as HTMLButtonElement).click(); await settle()
    ;(screen.getByRole('button', { name: 'Reservar lugar' }) as HTMLButtonElement).click(); await settle()
    expect(screen.getByText('Clase reservada durante 10:00')).toBeTruthy()
    expect(state.slotHoldToken.value).toBeNull()
    // Keep the native render scheduling: act would flush after the transition
    // settles and hide a missing render when its navigation guard clears.
    vi.spyOn(Date, 'now').mockReturnValue(state.slotHoldExpiresAt.value! + 1000)
    await new Promise(resolve => setTimeout(resolve, 1100))
    expect(screen.getByRole('button', { name: /Clase propia.*11:00/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Reservar clase' })).toBeNull()
    expect(state.selectedSlot.value).toBeNull()
    expect(state.slotHoldExpiresAt.value).toBeNull()
    expect((screen.getByRole('button', { name: /Mi cuenta/i }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByRole('button', { name: 'Atrás' }) as HTMLButtonElement).disabled).toBe(false)
    expect(api.createHold).not.toHaveBeenCalled()
    expect(api.cancelHold).not.toHaveBeenCalled()
    expect(api.createReservation).not.toHaveBeenCalled()
    ;(screen.getByRole('button', { name: new RegExp(control, 'i') }) as HTMLButtonElement).click(); await settle()
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
        expect(JSON.parse(sessionStorage.getItem('avq:pendingReservation:studio-a')!)).toEqual({ venue: 'studio-a', cancelSecret: 'r1-result', confirmationCode: 'R1-RESULT' })
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

  it('management → a new class starts a usable countdown and submits without manage', async () => {
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
      ;(view.getByRole('button', { name: 'Reservar lugar' }) as HTMLButtonElement).click()
      for (let i = 0; i < 4; i++) await Promise.resolve()
      // Form readiness must not wait for passive effects after the first paint.
      expect(view.getByText('Clase reservada durante 10:00')).toBeTruthy()
      expect(view.getByRole('button', { name: 'Reservar clase' })).toBeTruthy()
      await settle()
      expect(view.getByText('Clase reservada durante 10:00')).toBeTruthy()
      const button = view.getByRole('button', { name: 'Reservar clase' }) as HTMLButtonElement
      expect(button.disabled).toBe(false)
      // El reloj baja de 10:00. Con la máquina cargada el primer tic puede tardar o saltar segundos: se espera hasta 3 s y basta 9:5x.
      await vi.waitFor(() => expect(view.getByText(/Clase reservada durante 9:5\d/)).toBeTruthy(), { timeout: 3000, interval: 100 })
      const firstExpiry = state.slotHoldExpiresAt.value!
      ;(view.getByRole('button', { name: 'Atrás' }) as HTMLButtonElement).click(); await settle()
      const clock = vi.spyOn(Date, 'now').mockReturnValue(firstExpiry + 1000)
      ;(view.getByRole('button', { name: /Clase propia.*11:00/ }) as HTMLButtonElement).click(); await settle()
      ;(view.getByRole('button', { name: 'Reservar lugar' }) as HTMLButtonElement).click()
      for (let i = 0; i < 4; i++) await Promise.resolve()
      expect(view.getByText('Clase reservada durante 10:00')).toBeTruthy()
      expect(state.slotHoldExpiresAt.value).toBeGreaterThan(firstExpiry)
      clock.mockRestore()
      await settle()
      fireEvent.input(view.getByLabelText(/Nombre/), { target: { value: 'Ana Clase' } })
      fireEvent.input(view.getByLabelText(/Teléfono/), { target: { value: '5512345678' } })
      ;(view.getByRole('button', { name: 'Reservar clase' }) as HTMLButtonElement).click(); await settle()
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
    ['es', 'jueves, 8 de octubre de 2026', '10:00 a.m. - 11:00 a.m.'],
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
    for (const [key, flag] of [['successUrl', 'success'], ['cancelUrl', 'cancelled']] as const) {
      const url = new URL(body[key]!); expect(url.searchParams.get('avq_payment')).toBe(flag)
      expect(url.searchParams.has('manage')).toBe(false); expect(url.searchParams.has('avq_credits')).toBe(false)
      expect(url.searchParams.get('campaign')).toBe('fall'); expect(url.hash).toBe('#context')
      expect(url.href).not.toContain('url-secret')
    }
    if (blockedWrite) expect(sessionStorage.getItem('avq:pendingReservation:studio-a')).toBeNull()
    else expect(JSON.parse(sessionStorage.getItem('avq:pendingReservation:studio-a')!)).toEqual({ venue: 'studio-a', cancelSecret: 'new-a', confirmationCode: 'NEW-A' })
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
    expect(screen.getByRole('button', { name: /Citas/ })).toBeTruthy()
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

  it('llegó por la liga del correo (?manage=): sale de «Tu Reservación» y la liga se quita de la dirección', async () => {
    window.history.replaceState({}, '', '/studio-a/appointments?manage=url-secret&campaign=fall')
    const p = props()
    render(<BookingFlow props={p} />); await flush()
    expect(screen.getByText('OWN-A')).toBeTruthy()
    await salir(p.hostElement!); await flush()
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

// D684b (Mindform, 22-nov): sólo da clases, y /appointments abría un calendario vacío con «Todavía no se han añadido servicios».
describe('D684b: /appointments en un negocio sin servicios con cita', () => {
  const soloClases = { ...venue, products: [{ ...venue.products[0], id: 'clase-1', name: 'Clase Lagree', type: 'CLASS' }] }
  async function abrir(info: PublicVenueInfo) {
    vi.mocked(api.getVenueInfo).mockResolvedValue(info)
    vi.mocked(api.getClassSessionsRange).mockResolvedValue({ dateFrom: '2026-10-06', dateTo: '2026-11-05', slots: [] })
    const host = document.createElement('div')
    const avisos: Record<string, unknown>[] = []
    host.addEventListener('avoqado:venue-loaded', e => avisos.push((e as CustomEvent).detail.venue))
    render(<BookingFlow props={{ ...props(), hostElement: host }} />); await flush()
    return avisos
  }

  it('dice que no agenda citas en línea, ofrece «Ver clases» y le avisa a la página que no hay citas', async () => {
    const avisos = await abrir(soloClases as PublicVenueInfo)
    expect(screen.getByText('Este negocio no agenda citas en línea')).toBeTruthy()
    expect(screen.queryByText('Todavía no se han añadido servicios')).toBeNull()
    expect(avisos[0]).toMatchObject({ hasClasses: true, hasAppointments: false })
    fireEvent.click(screen.getByRole('button', { name: 'Ver clases' })); await flush()
    expect(window.location.pathname).toBe('/studio-a/classes')
    expect(state.flowType.value).toBe('classes')
    expect(screen.queryByText('Este negocio no agenda citas en línea')).toBeNull()
  })

  it('«Comprar paquetes» de la cabecera sigue abriendo la lista encima del aviso', async () => {
    vi.mocked(api.getCreditPacks).mockResolvedValue([PAQUETE] as any)
    const host = document.createElement('div')
    vi.mocked(api.getVenueInfo).mockResolvedValue({ ...soloClases, canCharge: true } as PublicVenueInfo)
    vi.mocked(api.getClassSessionsRange).mockResolvedValue({ dateFrom: '2026-10-06', dateTo: '2026-11-05', slots: [] })
    render(<BookingFlow props={{ ...props(), hostElement: host }} />); await flush()
    await act(async () => { host.dispatchEvent(new CustomEvent('_avq_show_credit_packs')) }); await flush()
    expect(screen.getByText('Este negocio no agenda citas en línea')).toBeTruthy()
    expect(screen.getByText('Mega Pack')).toBeTruthy()
  })

  it('sin clases tampoco: sólo el aviso, sin botón que lleve a nada', async () => {
    await abrir({ ...venue, products: [] })
    expect(screen.getByText('Este negocio no agenda citas en línea')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Ver clases' })).toBeNull()
  })

  it('con servicios con cita, todo sigue igual y la página sabe que hay citas', async () => {
    const avisos = await abrir(venue)
    expect(screen.queryByText('Este negocio no agenda citas en línea')).toBeNull()
    expect(avisos[0]).toMatchObject({ hasClasses: false, hasAppointments: true })
  })
})

// D683 (Mindform, 22-nov): reservó «Clase Lagree» $325, fue a Stripe y regresó sin pagar. «Tu Reservación» decía «Estamos
// confirmando el depósito · Pendiente», como si hubiera pagado. La hora del apartado la da el SERVIDOR (`depositExpiresAt`, #596,
// aditivo); la liga de pago es la que devolvió la reserva al crearse, guardada en este navegador. Sin las dos no hay «Pagar ahora».
describe('D683: volvió de Stripe sin pagar', () => {
  const permitido = { allowed: true, minHoursBeforeStart: 2, creditsUsed: 0, creditsRefundable: 0, refundPercent: 0, policyLabel: '' }
  const sinPagar = { ...detail, status: 'PENDING', depositStatus: 'PENDING', cancellation: permitido, depositExpiresAt: '2026-10-06T18:25:00Z' }
  const PAGO = 'https://checkout.stripe.com/c/pay/cs_test_a'
  async function volver(url: string, reserva: object = sinPagar, guardada: object = { ...saved, checkoutUrl: PAGO }) {
    sessionStorage.setItem('avq:pendingReservation:studio-a', JSON.stringify(guardada))
    window.history.replaceState({}, '', url)
    vi.mocked(api.getReservation).mockResolvedValue(reserva as PublicReservationDetail)
    const vista = render(<BookingFlow props={props()} />); await flush()
    return vista
  }
  const aviso = () => screen.getByRole('status').textContent ?? ''

  it('dice que el pago no se completó y hasta cuándo guarda el lugar; ofrece pagar y cancelar; no se queda consultando', async () => {
    await volver('/studio-a/classes?avq_payment=cancelled&payment=cancelled&reservationId=r1')
    expect(aviso()).toContain('Tu pago no se completó')
    expect(aviso()).toContain('12:25 p.m.')
    expect(screen.queryByText(/Estamos confirmando/)).toBeNull()
    expect(screen.getByRole('link', { name: 'Pagar ahora' }).getAttribute('href')).toBe(PAGO)
    expect(screen.getByRole('button', { name: 'Cancelar Reservación' })).toBeTruthy()
    await advance(40000); expect(api.getReservation).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['sin la hora del SERVIDOR', { ...sinPagar, depositExpiresAt: undefined }, { ...saved, checkoutUrl: PAGO }],
    ['con el plazo ya vencido', { ...sinPagar, depositExpiresAt: '2026-10-06T17:59:00Z' }, { ...saved, checkoutUrl: PAGO }],
  ])('%s: el aviso honesto, sin hora y sin «Pagar ahora»', async (_caso, reserva, guardada) => {
    await volver('/studio-a/classes?avq_payment=cancelled', reserva, guardada)
    expect(aviso()).toContain('Tu pago no se completó')
    expect(aviso()).not.toMatch(/\d:\d\d/)
    expect(screen.queryByRole('link', { name: 'Pagar ahora' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Cancelar Reservación' })).toBeTruthy()
  })

  it.each([
    ['la liga no está en este navegador', { ...saved }],
    ['la liga guardada no es https', { ...saved, checkoutUrl: 'javascript:alert(1)' }],
  ])('%s: dice hasta cuándo guarda el lugar, pero no ofrece pagar', async (_caso, guardada) => {
    await volver('/studio-a/classes?avq_payment=cancelled', sinPagar, guardada)
    expect(aviso()).toContain('12:25 p.m.')
    expect(screen.queryByRole('link', { name: 'Pagar ahora' })).toBeNull()
  })

  it('la liga de pago que devuelve la reserva al crearse se guarda sólo si es https (y la recuerda al volver)', async () => {
    savePendingReservation('studio-a', { cancelSecret: 'c1', confirmationCode: 'C1', checkoutUrl: PAGO })
    expect(JSON.parse(sessionStorage.getItem('avq:pendingReservation:studio-a')!)).toEqual({ venue: 'studio-a', cancelSecret: 'c1', confirmationCode: 'C1', checkoutUrl: PAGO })
    window.history.replaceState({}, '', '/studio-a/classes?avq_payment=cancelled')
    expect(resolveDepositReturn('studio-a').saved?.checkoutUrl).toBe(PAGO)
    savePendingReservation('studio-a', { cancelSecret: 'c2', confirmationCode: 'C2', checkoutUrl: '#provider' })
    expect(JSON.parse(sessionStorage.getItem('avq:pendingReservation:studio-a')!)).toEqual({ venue: 'studio-a', cancelSecret: 'c2', confirmationCode: 'C2' })
  })

  it('recargar después de volver sin pagar sigue diciendo que falta el pago', async () => {
    const antes = await volver('/studio-a/classes?avq_payment=cancelled')
    antes.unmount(); resetSignals()
    render(<BookingFlow props={props()} />); await flush()
    expect(aviso()).toContain('Tu pago no se completó')
  })

  it('regresó con «atrás» del navegador (sin pasar por Stripe de vuelta): también falta el pago', async () => {
    await volver('/studio-a/classes')
    expect(aviso()).toContain('Tu pago no se completó')
  })

  it('volvió pagado y recarga mientras llega el aviso del banco: sigue «Estamos confirmando», sin «Pagar ahora»', async () => {
    const antes = await volver('/studio-a/classes?avq_payment=success')
    expect(aviso()).toContain('Estamos confirmando el depósito')
    antes.unmount(); resetSignals()
    render(<BookingFlow props={props()} />); await flush()
    expect(aviso()).toContain('Estamos confirmando el depósito')
    expect(screen.queryByRole('link', { name: 'Pagar ahora' })).toBeNull()
  })

  it('si el lugar ya se liberó, dice lo que pasó y no ofrece pagar', async () => {
    await volver('/studio-a/classes?avq_payment=cancelled', { ...sinPagar, status: 'CANCELLED', depositStatus: 'EXPIRED' })
    expect(aviso()).toContain('El plazo del depósito expiró')
    expect(screen.queryByRole('link', { name: 'Pagar ahora' })).toBeNull()
  })
})
