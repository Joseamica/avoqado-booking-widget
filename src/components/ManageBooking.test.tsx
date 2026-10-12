import { h } from 'preact'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ManageBooking } from './ManageBooking'
import { createT } from '../i18n'
import * as api from '../api/booking'
import type { PublicReservationDetail, PublicVenueInfo } from '../types'

vi.mock('../api/booking', () => ({
  getReservation: vi.fn(), cancelReservation: vi.fn(), cancelHold: vi.fn(),
  getRescheduleAvailability: vi.fn(), createRescheduleHold: vi.fn(), rescheduleAppointment: vi.fn(),
}))
const venue: PublicVenueInfo = {
  slug: 'studio-a', name: 'Studio A', type: 'SALON', logo: null, address: null, phone: null,
  timezone: 'America/Mexico_City', products: [],
  publicBooking: { enabled: true, requireEmail: false, requirePhone: false },
}
function detail(depositStatus: string | null = 'PAID', status = 'CONFIRMED'): PublicReservationDetail {
  return { confirmationCode: 'OWN-A', status, startsAt: '2026-10-08T16:00:00Z', endsAt: '2026-10-08T17:00:00Z',
    duration: 60, partySize: 1, guestName: 'Ana', product: null, assignedStaff: null, table: null,
    specialRequests: null, depositAmount: 500, depositStatus,
    cancellation: { allowed: true, minHoursBeforeStart: 2, creditsUsed: 0, creditsRefundable: 0, refundPercent: 0, policyLabel: '' },
  }
}
const props = { venueSlug: venue.slug, cancelSecret: 'local-a', timezone: venue.timezone, venueInfo: venue, t: createT('es'), onBack: vi.fn() }
async function flush() { for (let i = 0; i < 4; i++) await act(async () => { for (let j = 0; j < 8; j++) await Promise.resolve() }) }
async function advance(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }

beforeEach(() => { vi.useFakeTimers(); vi.resetAllMocks(); vi.mocked(api.getReservation).mockResolvedValue(detail()); vi.mocked(api.cancelHold).mockResolvedValue(undefined) })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('reservation language matches the widget', () => {
  it.each([
    ['es', 'jueves, 8 de octubre de 2026', '10:00 a.m. - 11:00 a.m.'],
    ['en', 'Thursday, October 8, 2026', '10:00 AM - 11:00 AM'],
  ] as const)('formats the date and venue time in %s', async (locale, date, time) => {
    render(<ManageBooking {...props} locale={locale} t={createT(locale)} />); await flush()
    expect(screen.getByText(date)).toBeTruthy()
    expect(screen.getByText(time)).toBeTruthy()
  })

  it.each([
    ['es', 'Cancelar Reservación', 'Solo puedes cancelar hasta 2h antes del inicio.'],
    ['en', 'Cancel Reservation', 'You can only cancel until 2h before the start.'],
  ] as const)('explains a disabled cancellation in %s', async (locale, button, explanation) => {
    const reservation = detail()
    reservation.cancellation!.allowed = false
    vi.mocked(api.getReservation).mockResolvedValue(reservation)
    render(<ManageBooking {...props} locale={locale} t={createT(locale)} />); await flush()
    expect(screen.getByRole('button', { name: button }).getAttribute('title')).toBe(explanation)
    expect(api.cancelReservation).not.toHaveBeenCalled()
  })
})

describe('financial source of truth and one bounded read round', () => {
  it.each([
    ['PAID', 'CANCELLED', 'Pago recibido'], ['PENDING', 'CONFIRMED', 'Estamos confirmando el depósito'],
    ['REFUNDED', 'CONFIRMED', 'Depósito reembolsado'], ['FORFEITED', 'CONFIRMED', 'Depósito retenido'],
    ['EXPIRED', 'CONFIRMED', 'El plazo del depósito expiró'], ['DISPUTED', 'CONFIRMED', 'Depósito en disputa'],
    ['CARD_HOLD', 'CONFIRMED', 'Retención de tarjeta'], [null, 'CONFIRMED', 'Aún no pudimos confirmar el estado del depósito'],
    ['NEW_STATUS', 'CONFIRMED', 'Aún no pudimos confirmar el estado del depósito'],
    ['constructor', 'CONFIRMED', 'Aún no pudimos confirmar el estado del depósito'],
  ])('%s financial status with %s administrative status', async (financial, administrative, notice) => {
    vi.mocked(api.getReservation).mockResolvedValue(detail(financial, administrative!))
    render(<ManageBooking {...props} />); await flush()
    expect(screen.getByRole('status').textContent).toContain(notice)
    expect(screen.queryByText(/sin cargo|no se hizo cargo|no charge/i)).toBeNull()
    if (financial !== 'PAID') expect(screen.queryByText('Pago recibido')).toBeNull()
    if (financial !== 'PENDING') { await advance(40000); expect(api.getReservation).toHaveBeenCalledTimes(1) }
  })
  it('reads PENDING then PAID sequentially and stops', async () => {
    vi.mocked(api.getReservation).mockResolvedValueOnce(detail('PENDING')).mockResolvedValue(detail('PAID', 'PENDING'))
    render(<ManageBooking {...props} />); await flush()
    expect(api.getReservation).toHaveBeenCalledTimes(1)
    await advance(2499); expect(api.getReservation).toHaveBeenCalledTimes(1)
    await advance(1); expect(screen.getByRole('status').textContent).toContain('Pago recibido')
    await advance(40000); expect(api.getReservation).toHaveBeenCalledTimes(2)
    expect(screen.getByText('Pendiente')).toBeTruthy()
  })
  it('caps a PENDING round at 12 and starts one new round on a real retry click', async () => {
    vi.mocked(api.getReservation).mockResolvedValue(detail('PENDING'))
    render(<ManageBooking {...props} />); await flush(); await advance(27500)
    expect(api.getReservation).toHaveBeenCalledTimes(12)
    expect(screen.getByRole('status').textContent).toContain('Aún no se confirma')
    await advance(40000); expect(api.getReservation).toHaveBeenCalledTimes(12)
    fireEvent.click(screen.getByRole('button', { name: 'Consultar de nuevo' })); await flush()
    expect(api.getReservation).toHaveBeenCalledTimes(13)
    await advance(2500); expect(api.getReservation).toHaveBeenCalledTimes(14)
  })
  it.each([new TypeError('network'), Object.assign(new Error('rate'), { status: 429 }), Object.assign(new Error('upstream'), { status: 503 })])('first failure remains retryable: %s', async error => {
    vi.mocked(api.getReservation).mockRejectedValueOnce(error).mockResolvedValue(detail())
    render(<ManageBooking {...props} />); await flush()
    expect(screen.getByText('No pudimos consultar la reserva')).toBeTruthy()
    expect(screen.queryByText('Reservación no encontrada')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Consultar de nuevo' })); await flush()
    expect(screen.getByText('OWN-A')).toBeTruthy(); expect(api.getReservation).toHaveBeenCalledTimes(2)
  })
  it('404 is definitive and separately labelled', async () => {
    vi.mocked(api.getReservation).mockRejectedValue(Object.assign(new Error('missing'), { status: 404 }))
    render(<ManageBooking {...props} />); await flush()
    expect(screen.getByText('Reservación no encontrada')).toBeTruthy()
    await advance(40000); expect(api.getReservation).toHaveBeenCalledTimes(1)
  })
  it('keeps the obtained reservation after a later network failure', async () => {
    vi.mocked(api.getReservation).mockResolvedValueOnce(detail('PENDING')).mockRejectedValueOnce(new TypeError('network'))
    render(<ManageBooking {...props} />); await flush(); await advance(2500)
    expect(screen.getByText('OWN-A')).toBeTruthy(); expect(screen.getByText('No pudimos consultar la reserva')).toBeTruthy()
    expect(screen.queryByText('Reservación no encontrada')).toBeNull()
  })
  it('aborts at 10 seconds and supports manual retry after the timeout', async () => {
    const late = deferred<PublicReservationDetail>()
    vi.mocked(api.getReservation).mockReturnValueOnce(late.promise).mockResolvedValue(detail())
    render(<ManageBooking {...props} />); await flush()
    const signal = vi.mocked(api.getReservation).mock.calls[0][2]
    await advance(9999); expect(screen.queryByText('No pudimos consultar la reserva')).toBeNull()
    await advance(1); expect(signal?.aborted).toBe(true)
    expect(screen.getByText('No pudimos consultar la reserva')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Consultar de nuevo' })); await flush()
    late.resolve({ ...detail(), confirmationCode: 'STALE' }); await flush()
    expect(screen.getByText('OWN-A')).toBeTruthy(); expect(screen.queryByText('STALE')).toBeNull()
  })
  it('unmount aborts the active read and clears future reads even when the response ignores abort', async () => {
    const late = deferred<PublicReservationDetail>(); vi.mocked(api.getReservation).mockReturnValue(late.promise)
    const view = render(<ManageBooking {...props} />); await flush()
    const signal = vi.mocked(api.getReservation).mock.calls[0][2]
    view.unmount(); expect(signal?.aborted).toBe(true)
    late.resolve(detail('PENDING')); await flush(); await advance(40000)
    expect(api.getReservation).toHaveBeenCalledTimes(1); expect(view.container.textContent).toBe('')
  })
  it('venue/secret change discards an old response and aborts its request', async () => {
    const late = deferred<PublicReservationDetail>(); vi.mocked(api.getReservation).mockReturnValueOnce(late.promise).mockResolvedValue({ ...detail(), confirmationCode: 'OWN-B' })
    const view = render(<ManageBooking {...props} />); await flush()
    const signal = vi.mocked(api.getReservation).mock.calls[0][2]
    view.rerender(<ManageBooking {...props} venueSlug="studio-b" cancelSecret="local-b" />); await flush()
    expect(signal?.aborted).toBe(true); expect(screen.getByText('OWN-B')).toBeTruthy()
    late.resolve(detail('PENDING')); await flush(); await advance(40000)
    expect(screen.queryByText('OWN-A')).toBeNull(); expect(api.getReservation).toHaveBeenCalledTimes(2)
  })
  it('cancel preserves backend failure message and never retries the write', async () => {
    vi.mocked(api.cancelReservation).mockRejectedValue(new Error('No se puede cancelar con menos de 2 horas. Contacta al negocio.'))
    render(<ManageBooking {...props} />); await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar Reservación' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar Cancelación' })); await flush()
    expect(screen.getByText('No se puede cancelar con menos de 2 horas. Contacta al negocio.')).toBeTruthy()
    expect(screen.getByText('OWN-A')).toBeTruthy(); await advance(40000)
    expect(api.cancelReservation).toHaveBeenCalledTimes(1)
  })
  it('a post-cancel read cannot overwrite a different secret', async () => {
    const late = deferred<PublicReservationDetail>()
    vi.mocked(api.cancelReservation).mockResolvedValue({ confirmationCode: 'OWN-A', status: 'CANCELLED', cancelledAt: '2026-10-06T12:00:00Z' })
    vi.mocked(api.getReservation).mockResolvedValueOnce(detail()).mockReturnValueOnce(late.promise).mockResolvedValue({ ...detail(), confirmationCode: 'OWN-B' })
    const view = render(<ManageBooking {...props} />); await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar Reservación' })); fireEvent.click(screen.getByRole('button', { name: 'Confirmar Cancelación' })); await flush()
    view.rerender(<ManageBooking {...props} cancelSecret="local-b" />); await flush()
    late.resolve(detail('PAID', 'CANCELLED')); await flush()
    expect(screen.getByText('OWN-B')).toBeTruthy(); expect(screen.queryByText('OWN-A')).toBeNull(); expect(api.cancelReservation).toHaveBeenCalledTimes(1)
  })
  it.each([false, true])('real reschedule refresh guards; late write=%s', async lateWrite => {
    vi.mocked(api.getReservation).mockResolvedValueOnce({ ...detail(), product: { id: 'service-a', name: 'Consulta', price: 500 },
      reschedule: { allowed: true, kind: 'appointment', minHoursBeforeStart: 2, productId: 'service-a' } })
      .mockResolvedValue({ ...detail(), confirmationCode: 'MOVED-A' })
    vi.mocked(api.getRescheduleAvailability).mockResolvedValue({ date: '2026-10-08',
      slots: [{ startsAt: '2026-10-08T18:00:00Z', endsAt: '2026-10-08T19:00:00Z', available: true }] })
    vi.mocked(api.createRescheduleHold).mockResolvedValue({ holdId: 'own-hold', expiresAt: '2026-10-08T20:00:00Z', ttlSeconds: 600 })
    const moved = { confirmationCode: 'MOVED-A', status: 'CONFIRMED', startsAt: '2026-10-08T18:00:00Z', endsAt: '2026-10-08T19:00:00Z' }
    const late = deferred<typeof moved>()
    vi.mocked(api.rescheduleAppointment).mockImplementation(() => lateWrite ? late.promise : Promise.resolve(moved))
    vi.setSystemTime(new Date('2026-10-06T18:00:00Z'))
    const view = render(<ManageBooking {...props} />); await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar horario' })); await flush()
    fireEvent.click(screen.getByRole('button', { name: '8' })); await flush()
    fireEvent.click(screen.getByRole('button', { name: /12:00/ })); await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar cambio' })); await flush()
    if (lateWrite) {
      vi.mocked(api.getReservation).mockResolvedValue({ ...detail(), confirmationCode: 'OWN-B' })
      view.rerender(<ManageBooking {...props} venueSlug="studio-b" cancelSecret="local-b" />); await flush()
      late.resolve(moved); await flush()
      expect(screen.getByText('OWN-B')).toBeTruthy(); expect(screen.queryByText('MOVED-A')).toBeNull()
    } else expect(screen.getByText('MOVED-A')).toBeTruthy()
    expect(api.getReservation).toHaveBeenCalledTimes(2)
    await advance(40000); expect(api.rescheduleAppointment).toHaveBeenCalledTimes(1)
  })
  it('getReservation forwards the optional signal through the existing fetch wrapper', async () => {
    const actual = await vi.importActual<typeof api>('../api/booking')
    const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => detail() }); vi.stubGlobal('fetch', fetch)
    const controller = new AbortController(); await actual.getReservation(venue.slug, 'local-a', controller.signal)
    expect(fetch.mock.calls[0][1].signal).toBe(controller.signal)
  })
})
