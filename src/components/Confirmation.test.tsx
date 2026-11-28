import { h } from 'preact'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createT } from '../i18n'
import * as api from '../api/booking'
import type { PublicBookingResult, PublicReservationDetail, PublicVenueInfo } from '../types'
import { Confirmation, ConfirmacionDeClase } from './Confirmation'
import { ManageBooking } from './ManageBooking'
import { AppointmentConfirmation } from './AppointmentConfirmation'
import { DatePicker } from './DatePicker'

vi.mock('../api/booking', () => ({
  getReservation: vi.fn(), cancelReservation: vi.fn(), cancelHold: vi.fn(),
  getRescheduleAvailability: vi.fn(), createRescheduleHold: vi.fn(), rescheduleAppointment: vi.fn(),
}))

const t = createT('es')
const venue: PublicVenueInfo = {
  slug: 'studio-a', name: 'Studio A', type: 'SALON', logo: null, address: 'Calle Uno 10', phone: null,
  timezone: 'America/Mexico_City', products: [],
  publicBooking: { enabled: true, requireEmail: false, requirePhone: false },
}
async function flush() { for (let i = 0; i < 4; i++) await act(async () => { for (let j = 0; j < 8; j++) await Promise.resolve() }) }
const texto = () => document.body.textContent ?? ''
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

type Props = Parameters<typeof ConfirmacionDeClase>[0]
// Jueves 8 de octubre de 2026, 15:00–15:50 en CDMX, con Fer en el lugar 3.
function pinta(extra: Partial<Props> = {}) {
  const props: Props = {
    clase: 'Lagree', startsAt: '2026-10-08T21:00:00Z', endsAt: '2026-10-08T21:50:00Z', timeZone: 'America/Mexico_City',
    coach: 'Fer Ruiz', lugares: ['3'], confirmationCode: 'OK-1', nombre: 'Ana', canje: null, pago: null, politica: null,
    negocio: 'Studio A', direccion: 'Calle Uno 10', puedeEscribir: true, conCuenta: true,
    onVerMisReservas: vi.fn(), onVerPaquetes: vi.fn(), onOtraClase: vi.fn(), onVerMiCuenta: vi.fn(), t,
    ...extra,
  }
  const r = render(<ConfirmacionDeClase {...props} />)
  return { ...r, props }
}
const saldo = (extra: Partial<NonNullable<NonNullable<Props['canje']>['saldo']>> = {}) => ({
  packName: 'Paquete de 5', remaining: 3, original: 5, unlimited: false, expiresAt: '2026-12-11T18:00:00Z', ...extra,
})

describe('«¡Tu lugar está apartado!» (Task 14)', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-06T18:00:00Z')) })

  it('dice qué clase, cuándo, con quién y en qué lugar; «Lugar 3» sale tal como se le pasa, sin buscarlo en un mapa', () => {
    pinta()
    expect(screen.getByRole('heading', { name: '¡Tu lugar está apartado!' })).toBeTruthy()
    expect(screen.getByText('Te esperamos, Ana')).toBeTruthy()
    expect(screen.getByText('Lagree')).toBeTruthy()
    expect(screen.getByText('Jueves 8 de octubre · 15:00 – 15:50')).toBeTruthy()
    expect(screen.getByText('Fer Ruiz')).toBeTruthy()
    expect(screen.getByText('Coach')).toBeTruthy()
    expect(screen.getByText('Lugar 3')).toBeTruthy()
  })

  it('con 2 lugares: «Lugares 3, 4»', () => {
    pinta({ lugares: ['3', '4'] })
    expect(screen.getByText('Lugares 3, 4')).toBeTruthy()
  })

  it('sin coach ni lugares (clase sin mapa) no deja renglones vacíos', () => {
    pinta({ coach: null, lugares: [] })
    expect(screen.queryByText('Coach')).toBeNull()
    expect(texto()).not.toMatch(/Lugar/)
  })

  it('con paquete y el saldo del SERVIDOR: «Usaste 1 sesión · te quedan 3 de 5 (vencen el 11 dic)», con su paquete y su barra', () => {
    const { container } = pinta({ canje: { usadas: 1, saldo: saldo(), soloEstaClase: true } })
    expect(screen.getByText('Usaste 1 sesión · te quedan 3 de 5 (vencen el 11 dic)')).toBeTruthy()
    expect(screen.getByText('Tu paquete · Paquete de 5')).toBeTruthy()
    expect((container.querySelector('.avq-ls-barra i') as HTMLElement).style.width).toBe('60%')
  })

  it('con 2 lugares (`creditsUsed: 2`): «Usaste 2 sesiones · …»', () => {
    pinta({ lugares: ['3', '4'], canje: { usadas: 2, saldo: saldo({ remaining: 2 }), soloEstaClase: true } })
    expect(screen.getByText('Usaste 2 sesiones · te quedan 2 de 5 (vencen el 11 dic)')).toBeTruthy()
  })

  it('le queda una: «te queda 1 de 5 (vence el 11 dic)»; sin vencimiento, sin paréntesis', () => {
    pinta({ canje: { usadas: 1, saldo: saldo({ remaining: 1 }), soloEstaClase: true } })
    expect(screen.getByText('Usaste 1 sesión · te queda 1 de 5 (vence el 11 dic)')).toBeTruthy()
    cleanup()
    pinta({ canje: { usadas: 1, saldo: saldo({ expiresAt: null }), soloEstaClase: true } })
    expect(screen.getByText('Usaste 1 sesión · te quedan 3 de 5')).toBeTruthy()
  })

  it('al gastar la última: «Usaste tu última sesión de este paquete» y la invitación a ver paquetes', () => {
    const { props } = pinta({ canje: { usadas: 1, saldo: saldo({ remaining: 0 }), soloEstaClase: true } })
    expect(screen.getByText('Usaste tu última sesión de este paquete')).toBeTruthy()
    expect(texto()).not.toMatch(/te quedan|te queda/)
    fireEvent.click(screen.getByRole('button', { name: 'Ver paquetes' }))
    expect(props.onVerPaquetes).toHaveBeenCalledTimes(1)
    cleanup()
    pinta({ lugares: ['3', '4'], canje: { usadas: 2, saldo: saldo({ remaining: 0 }), soloEstaClase: true } })
    expect(screen.getByText('Usaste tus últimas 2 sesiones de este paquete')).toBeTruthy()
  })

  it('la última, sin paquetes que ofrecer: no hay botón «Ver paquetes»', () => {
    pinta({ canje: { usadas: 1, saldo: saldo({ remaining: 0 }), soloEstaClase: true }, onVerPaquetes: undefined })
    expect(screen.getByText('Usaste tu última sesión de este paquete')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Ver paquetes' })).toBeNull()
  })

  it.each([
    [1, 'Usaste 1 sesión'],
    [2, 'Usaste 2 sesiones'],
  ])('SERVIDOR viejo (sin `creditBalance`), %i lugar(es): «%s», sin saldo', (usadas, linea) => {
    pinta({ canje: { usadas, saldo: null, soloEstaClase: true } })
    expect(screen.getByText(linea)).toBeTruthy()
    expect(texto()).not.toMatch(/te quedan|te queda|Tu paquete ·|vencen/)
  })

  it('un paquete que cubre varias clases habla de créditos', () => {
    pinta({ canje: { usadas: 1, saldo: saldo(), soloEstaClase: false } })
    expect(screen.getByText('Usaste 1 crédito · te quedan 3 de 5 (vencen el 11 dic)')).toBeTruthy()
    cleanup()
    pinta({ canje: { usadas: 1, saldo: saldo({ remaining: 0 }), soloEstaClase: false } })
    expect(screen.getByText('Usaste tu último crédito de este paquete')).toBeTruthy()
  })

  it('Ilimitado: «Usaste tu Ilimitado», nunca sus números internos ni su barra', () => {
    const { container } = pinta({
      canje: { usadas: 1, saldo: saldo({ packName: 'Mensual Ilimitado', remaining: 99998, original: 99999, unlimited: true, expiresAt: '2026-12-20T18:00:00Z' }) },
    })
    expect(screen.getByText('Usaste tu Ilimitado (vence el 20 dic)')).toBeTruthy()
    expect(texto()).not.toMatch(/9999/)
    expect(container.querySelector('.avq-ls-barra')).toBeNull()
    cleanup()
    // Tras «sí quedó» no hay saldo del SERVIDOR: el pedido dice que fue con su Ilimitado.
    pinta({ canje: { usadas: 1, saldo: null, ilimitado: true } })
    expect(screen.getByText('Usaste tu Ilimitado')).toBeTruthy()
  })

  it('fix r1 #3: el pedido dice Ilimitado aunque el saldo del SERVIDOR no lo marque ⇒ nunca sus números', () => {
    const { container } = pinta({
      canje: { usadas: 1, saldo: saldo({ packName: 'Mensual Ilimitado', remaining: 99998, original: 99999, unlimited: false }), ilimitado: true },
    })
    expect(screen.getByText('Usaste tu Ilimitado (vence el 11 dic)')).toBeTruthy()
    expect(texto()).not.toMatch(/9999|Tu paquete ·/)
    expect(container.querySelector('.avq-ls-barra')).toBeNull()
  })

  it('«Ver o cambiar esta reserva» sólo con cuenta (la invitada ya tiene «Ver mi reserva»)', () => {
    const onVerEstaReserva = vi.fn()
    pinta({ onVerEstaReserva })
    fireEvent.click(screen.getByRole('button', { name: 'Ver o cambiar esta reserva' }))
    expect(onVerEstaReserva).toHaveBeenCalledTimes(1)
    cleanup()
    pinta({ onVerEstaReserva, conCuenta: false })
    expect(screen.queryByRole('button', { name: 'Ver o cambiar esta reserva' })).toBeNull()
  })

  it('con tarjeta o en el estudio lo dice; sin monto (precios apagados) no enseña cantidades', () => {
    pinta({ pago: { forma: 'tarjeta', monto: 325 } })
    expect(screen.getByText('Pagaste $325 con tarjeta')).toBeTruthy()
    cleanup()
    pinta({ pago: { forma: 'estudio', monto: 325 } })
    expect(screen.getByText('Pagas $325 en el estudio')).toBeTruthy()
    cleanup()
    pinta({ pago: { forma: 'estudio', monto: null } })
    expect(screen.getByText('Pagas en el estudio')).toBeTruthy()
    expect(texto()).not.toContain('$')
  })

  it('la línea de política, si la hay; sin política del SERVIDOR, ninguna', () => {
    pinta({ politica: 'Cancela gratis hasta el miércoles 7 a las 15:00 y la sesión regresa a tu paquete.' })
    expect(screen.getByText('Cancela gratis hasta el miércoles 7 a las 15:00 y la sesión regresa a tu paquete.')).toBeTruthy()
    cleanup()
    pinta({ politica: null })
    expect(texto()).not.toMatch(/[Cc]ancela/)
  })

  it('«Agregar a mi calendario» ofrece Google Calendar (con su clase y su hora) y el archivo para Apple u Outlook', async () => {
    vi.useRealTimers()
    const blobs: Blob[] = []
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: (b: Blob) => { blobs.push(b); return 'blob:x' }, revokeObjectURL: () => {} }))
    const clic = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    pinta()
    const boton = screen.getByRole('button', { name: 'Agregar a mi calendario' })
    expect(boton.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(boton)
    expect(boton.getAttribute('aria-expanded')).toBe('true')
    const google = new URL((screen.getByRole('link', { name: 'Google Calendar' }) as HTMLAnchorElement).href)
    expect(google.searchParams.get('dates')).toBe('20261008T210000Z/20261008T215000Z')
    expect(google.searchParams.get('text')).toBe('Lagree · Studio A')
    expect(google.searchParams.get('location')).toBe('Calle Uno 10')
    fireEvent.click(screen.getByRole('button', { name: 'Apple u Outlook (.ics)' }))
    expect(blobs).toHaveLength(1)
    expect((clic.mock.contexts[0] as HTMLAnchorElement).download).toBe('reserva-OK-1.ics')
    const ics = await new Promise<string>(ok => {
      const r = new FileReader()
      r.onload = () => ok(String(r.result))
      r.readAsText(blobs[0])
    })
    expect(ics).toContain('DTSTART:20261008T210000Z')
    expect(ics).toContain('DTEND:20261008T215000Z')
    expect(ics).toContain('SUMMARY:Lagree · Studio A')
    expect(ics).toContain('UID:OK-1@avoqado.io')
    expect(ics).toContain('LOCATION:Calle Uno 10')
  })

  it('«Ver mis reservas» con cuenta; sin cuenta, «Ver mi reserva» (la de esta reserva)', () => {
    const { props } = pinta()
    fireEvent.click(screen.getByRole('button', { name: 'Ver mis reservas' }))
    expect(props.onVerMisReservas).toHaveBeenCalledTimes(1)
    cleanup()
    const sin = pinta({ conCuenta: false })
    expect(screen.queryByRole('button', { name: 'Ver mis reservas' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Ver mi reserva' }))
    expect(sin.props.onVerMisReservas).toHaveBeenCalledTimes(1)
  })

  it('«¿Dudas? Escríbenos» sólo si el negocio recibe mensajes, y abre el chat', () => {
    const abrir = vi.fn()
    window.addEventListener('avoqado:open-chat', abrir)
    try {
      pinta()
      fireEvent.click(screen.getByRole('button', { name: '¿Dudas? Escríbenos' }))
      expect(abrir).toHaveBeenCalledTimes(1)
      cleanup()
      pinta({ puedeEscribir: false })
      expect(screen.queryByRole('button', { name: '¿Dudas? Escríbenos' })).toBeNull()
    } finally {
      window.removeEventListener('avoqado:open-chat', abrir)
    }
  })

  it('«Reservar otra clase» vuelve al horario', () => {
    const { props } = pinta()
    fireEvent.click(screen.getByRole('button', { name: 'Reservar otra clase' }))
    expect(props.onOtraClase).toHaveBeenCalledTimes(1)
  })

  it('si la cuenta del estudio ya no es la que reservó: «No pudimos confirmar tu reserva. Revisa «Mi cuenta»», sin un solo dato de la reserva', () => {
    const { props } = pinta({ cambioDeCuenta: true, canje: { usadas: 1, saldo: saldo() } })
    expect(screen.getByText('No pudimos confirmar tu reserva')).toBeTruthy()
    expect(screen.getByText('Revisa «Mi cuenta».')).toBeTruthy()
    expect(texto()).not.toMatch(/apartado|Lagree|Fer|Lugar|OK-1|Usaste|Ana/)
    fireEvent.click(screen.getByRole('button', { name: 'Ver mi cuenta' }))
    expect(props.onVerMiCuenta).toHaveBeenCalledTimes(1)
  })

  it('el código de la reserva queda a la vista, en chico', () => {
    pinta()
    expect(screen.getByText('OK-1')).toBeTruthy()
  })

  it('en inglés', () => {
    pinta({ t: createT('en'), canje: { usadas: 1, saldo: saldo(), soloEstaClase: true } })
    expect(screen.getByRole('heading', { name: 'Your spot is reserved!' })).toBeTruthy()
    expect(screen.getByText('Thursday, October 8 · 3:00 PM – 3:50 PM')).toBeTruthy()
    expect(screen.getByText('You used 1 session · 3 of 5 left (expiring Dec 11)')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'View my bookings' })).toBeTruthy()
  })

  it('celular (≤ 640 px): sin margen propio (28 px en total, W2); título de 28 px, texto de 17 px y botones de 56 px', () => {
    const { container } = pinta()
    const css = container.querySelector('style')?.textContent ?? ''
    const celular = css.slice(css.indexOf('@media (max-width: 640px)'))
    expect(celular).not.toMatch(/\.avq-listo \{[^}]*padding-inline/)
    expect(celular).toMatch(/\.avq-ls-titulo \{[^}]*font-size: 28px/)
    expect(celular).toMatch(/\.avq-ls-cuando[^{]*\{[^}]*font-size: 17px/)
    expect(celular).toMatch(/\.avq-ls-btn[^{]*\{[^}]*min-height: 56px/)
    // En la computadora: 26 px y 52 px.
    const compu = css.slice(0, css.indexOf('@media (max-width: 640px)'))
    expect(compu).toMatch(/\.avq-ls-titulo \{[^}]*font-size: 26px/)
    expect(compu).toMatch(/\.avq-ls-btn[^{]*\{[^}]*min-height: 52px/)
  })
})

describe('al volver de Stripe (Task 14): «¡Tu lugar está apartado!» sólo con la reserva CONFIRMED y el depósito pagado', () => {
  const clase = (extra: Partial<PublicReservationDetail> = {}): PublicReservationDetail => ({
    confirmationCode: 'OK-9', status: 'CONFIRMED', startsAt: '2026-10-08T21:00:00Z', endsAt: '2026-10-08T21:50:00Z',
    duration: 50, partySize: 1, guestName: 'Ana', product: { id: 'class-a', name: 'Lagree', price: 325 }, assignedStaff: null,
    table: null, specialRequests: null, depositAmount: 325, depositStatus: 'PAID',
    className: 'Lagree', instructorName: 'Fer Ruiz', spotIds: ['3'],
    cancellation: { allowed: true, minHoursBeforeStart: 2, creditsUsed: 0, creditsRefundable: 0, refundPercent: 0, policyLabel: '' },
    ...extra,
  })
  const base = { venueSlug: 'studio-a', cancelSecret: 'sec-9', timezone: venue.timezone, venueInfo: venue, t, onBack: vi.fn() }
  const listo = vi.fn((r: PublicReservationDetail, verGestion: () => void) => (
    <div>
      <h1>apartado {r.className} · Lugar {r.spotIds?.join(', ')}</h1>
      <button type="button" onClick={verGestion}>gestionar</button>
    </div>
  ))
  beforeEach(() => { vi.useFakeTimers(); vi.resetAllMocks(); listo.mockClear() })

  it('CONFIRMED y pagada ⇒ la pantalla de «Listo», con los lugares guardados; «Ver mi reserva» deja ver «Gestionar»', async () => {
    vi.mocked(api.getReservation).mockResolvedValue(clase())
    render(<ManageBooking {...base} depositReturn confirmacionDeClase={listo} />); await flush()
    expect(screen.getByRole('heading', { name: 'apartado Lagree · Lugar 3' })).toBeTruthy()
    expect(screen.queryByText('Tu Reservación')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'gestionar' })); await flush()
    expect(screen.getByText('Tu Reservación')).toBeTruthy()
  })

  it.each([
    ['sigue pendiente', { status: 'PENDING', depositStatus: 'PENDING' }],
    ['falló o venció', { status: 'CANCELLED', depositStatus: 'EXPIRED' }],
    ['pagada, pero el estudio aún no la confirma', { status: 'PENDING', depositStatus: 'PAID' }],
    ['reembolsada', { status: 'CANCELLED', depositStatus: 'REFUNDED' }],
  ])('%s ⇒ «Gestionar» como hoy, con su aviso', async (_caso, extra) => {
    vi.mocked(api.getReservation).mockResolvedValue(clase(extra))
    render(<ManageBooking {...base} depositReturn confirmacionDeClase={listo} />); await flush()
    expect(screen.getByText('Tu Reservación')).toBeTruthy()
    expect(screen.getByRole('status')).toBeTruthy()
    expect(listo).not.toHaveBeenCalled()
  })

  it('mientras llega el aviso del banco espera en «Gestionar»; cuando se confirma, la pantalla de «Listo»', async () => {
    vi.mocked(api.getReservation)
      .mockResolvedValueOnce(clase({ status: 'PENDING', depositStatus: 'PENDING' }))
      .mockResolvedValue(clase())
    render(<ManageBooking {...base} depositReturn confirmacionDeClase={listo} />); await flush()
    expect(screen.getByText('Estamos confirmando el depósito')).toBeTruthy()
    await act(async () => { await vi.advanceTimersByTimeAsync(2500) }); await flush()
    expect(screen.getByRole('heading', { name: 'apartado Lagree · Lugar 3' })).toBeTruthy()
  })

  it('sin volver de Stripe (la liga del correo), una clase confirmada abre «Gestionar»', async () => {
    vi.mocked(api.getReservation).mockResolvedValue(clase())
    render(<ManageBooking {...base} confirmacionDeClase={listo} />); await flush()
    expect(screen.getByText('Tu Reservación')).toBeTruthy()
    expect(listo).not.toHaveBeenCalled()
  })

  it('una cita (sin `className`) se queda en «Gestionar»', async () => {
    vi.mocked(api.getReservation).mockResolvedValue(clase({ className: undefined, instructorName: undefined, spotIds: undefined }))
    render(<ManageBooking {...base} depositReturn confirmacionDeClase={listo} />); await flush()
    expect(screen.getByText('Tu Reservación')).toBeTruthy()
    expect(listo).not.toHaveBeenCalled()
  })
})

describe('ninguna fecha con « De » (Task 14)', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-06T18:00:00Z')) })
  const sinCapitalize = (el: Element) => expect(el.outerHTML).not.toMatch(/capitalize/)
  const reserva: PublicBookingResult = {
    confirmationCode: 'C-1', cancelSecret: 's-1', startsAt: '2026-10-08T16:00:00Z', endsAt: '2026-10-08T17:00:00Z',
    status: 'CONFIRMED', depositRequired: false, depositAmount: null,
  }

  it('Confirmation (la de siempre): sólo la primera letra en mayúscula', () => {
    const { container } = render(<Confirmation booking={reserva} venueInfo={venue} onManageBooking={vi.fn()} onNewBooking={vi.fn()} t={t} />)
    const fecha = [...container.querySelectorAll('p')].find(p => /octubre|October/.test(p.textContent ?? ''))!
    expect(fecha.textContent![0]).toBe(fecha.textContent![0].toLocaleUpperCase())
    expect(fecha.textContent).not.toMatch(/ De /)
    sinCapitalize(container)
  })

  it('«Gestionar»: «Jueves, 8 de octubre de 2026»', async () => {
    vi.mocked(api.getReservation).mockResolvedValue({
      confirmationCode: 'OWN-A', status: 'CONFIRMED', startsAt: '2026-10-08T16:00:00Z', endsAt: '2026-10-08T17:00:00Z',
      duration: 60, partySize: 1, guestName: 'Ana', product: null, assignedStaff: null, table: null,
      specialRequests: null, depositAmount: null, depositStatus: null,
    })
    const { container } = render(<ManageBooking venueSlug="studio-a" cancelSecret="x" timezone={venue.timezone} venueInfo={venue} t={t} onBack={vi.fn()} />)
    await flush()
    expect(screen.getByText('Jueves, 8 de octubre de 2026')).toBeTruthy()
    sinCapitalize(container)
  })

  it('confirmación de una cita: «Jueves 8 de oct»', () => {
    const { container } = render(
      <AppointmentConfirmation booking={reserva} venueInfo={venue} selectedProducts={[]} onReschedule={vi.fn()} onCancel={vi.fn()}
        onBookAgain={vi.fn()} locale="es" t={t} />,
    )
    const h2 = [...container.querySelectorAll('h2')].find(x => /oct/.test(x.textContent ?? ''))!
    expect(h2.textContent).toMatch(/^Jueves 8 de oct/)
    sinCapitalize(h2)
  })

  it('calendario de citas: el mes en el idioma del widget («Octubre de 2026»), sin `capitalize`', () => {
    const { container } = render(<DatePicker selectedDate={null} onSelect={vi.fn()} timezone={venue.timezone} t={t} />)
    expect(screen.getByText('Octubre de 2026')).toBeTruthy()
    sinCapitalize(container)
    cleanup()
    render(<DatePicker selectedDate={null} onSelect={vi.fn()} timezone={venue.timezone} t={createT('en')} />)
    expect(screen.getByText('October 2026')).toBeTruthy()
  })
})
