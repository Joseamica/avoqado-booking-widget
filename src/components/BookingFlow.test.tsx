import { h } from 'preact'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BookingFlow } from './BookingFlow'
import * as api from '../api/booking'
import * as state from '../state/booking'
import type { PublicVenueInfo, PublicReservationDetail, WidgetProps } from '../types'

vi.mock('../api/booking', () => ({
  getVenueInfo: vi.fn(), getCreditPacks: vi.fn(), getReservation: vi.fn(),
  getAvailability: vi.fn(), getClassSessionsRange: vi.fn(), createReservation: vi.fn(), createHold: vi.fn(), cancelHold: vi.fn(),
}))
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
      await new Promise(resolve => setTimeout(resolve, 1100))
      expect(view.getByText(/Clase reservada durante 9:5[89]/)).toBeTruthy()
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
    expect(sessionStorage.getItem('avq:pendingReservation:studio-a')).toBe(JSON.stringify(saved))
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
