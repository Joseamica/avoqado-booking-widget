import { h } from 'preact'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClassSessionList } from './ClassSessionList'
import * as api from '../api/booking'
import { branding, DEFAULT_BRANDING } from '../state/booking'
import { createT } from '../i18n'
import type { Product, PublicClassSessionSlot } from '../types'

vi.mock('../api/booking', () => ({ getClassSessionsRange: vi.fn() }))

// Diseño 27-nov (portada-v3): el horario es una semana tipo calendario en pantallas anchas y una lista con tira de días en
// el celular; el encabezado de cada día sin « De », el precio con su etiqueta y los lugares con su color.
const TZ = 'America/Mexico_City'
const AHORA = new Date('2026-11-26T18:00:00Z') // jueves 26 de noviembre, 12:00 en CDMX

const lagree = {
  id: 'clase-lagree', name: 'Lagree', price: 325, duration: 60, eventCapacity: 10, type: 'CLASS',
} as unknown as Product

function sesion(id: string, inicio: string, fin: string, extra: Partial<PublicClassSessionSlot> = {}): PublicClassSessionSlot {
  return {
    startsAt: inicio, endsAt: fin, available: true, classSessionId: id, productId: 'clase-lagree', productName: 'Lagree',
    capacity: 10, enrolled: 2, remaining: 8, instructor: { firstName: 'Fer', lastName: 'Ruiz', photoUrl: null }, ...extra,
  }
}
// Sábado 28: 11:00 (50 min, 8 lugares), 13:00 (2 lugares) y 15:00 (llena). Las horas son de CDMX (UTC−6).
const s11 = sesion('s-11', '2026-11-28T17:00:00Z', '2026-11-28T17:50:00Z')
const s13 = sesion('s-13', '2026-11-28T19:00:00Z', '2026-11-28T19:50:00Z', { enrolled: 8, remaining: 2 })
const s15 = sesion('s-15', '2026-11-28T21:00:00Z', '2026-11-28T21:50:00Z', { available: false, enrolled: 10, remaining: 0 })
// Viernes 27 («Mañana»): una sesión con un solo lugar.
const v09 = sesion('v-09', '2026-11-27T15:00:00Z', '2026-11-27T16:45:00Z', { enrolled: 9, remaining: 1 })

/** Simula el ancho de la pantalla como lo lee el navegador (matchMedia). */
function pantalla(ancho: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: ancho })
  ;(window as unknown as { matchMedia: unknown }).matchMedia = vi.fn((consulta: string) => {
    const min = /min-width:\s*(\d+)px/.exec(consulta)
    const max = /max-width:\s*(\d+)px/.exec(consulta)
    const matches = min ? ancho >= Number(min[1]) : max ? ancho <= Number(max[1]) : false
    return {
      matches, media: consulta, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
      dispatchEvent: () => false,
    }
  })
}

async function flush() { for (let i = 0; i < 4; i++) await act(async () => { for (let j = 0; j < 8; j++) await Promise.resolve() }) }

async function pintar(
  slots: PublicClassSessionSlot[],
  extra: Partial<Parameters<typeof ClassSessionList>[0]> = {},
) {
  vi.mocked(api.getClassSessionsRange).mockResolvedValue({ dateFrom: '2026-11-26', dateTo: '2026-12-26', slots })
  const onSelect = vi.fn()
  const r = render(
    <ClassSessionList venueSlug="un-estudio" timezone={TZ} onSelect={onSelect} products={[lagree]} t={createT('es')} {...extra} />,
  )
  await flush()
  return { onSelect, ...r }
}

const fila = (re: RegExp) => screen.getByRole('button', { name: re }) as HTMLButtonElement

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(AHORA)
  localStorage.clear()
  branding.value = { ...DEFAULT_BRANDING, showPrices: true, showDuration: true }
  pantalla(390)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  branding.value = DEFAULT_BRANDING
  delete (window as unknown as { matchMedia?: unknown }).matchMedia
})

describe('Horario: lista con tira de días (celular)', () => {
  it('el encabezado del día es «Sábado, 28 de noviembre», sin « De » ni mayúsculas en cada palabra', async () => {
    await pintar([s11])
    const titulo = screen.getByRole('heading', { name: 'Sábado, 28 de noviembre' })
    expect(titulo.textContent).not.toContain(' De ')
    expect((titulo as HTMLElement).style.textTransform).not.toBe('capitalize')
  })

  it('con precios: la fila dice «$325 · clase suelta»', async () => {
    await pintar([s11])
    expect(within(fila(/Lagree.*11:00/)).getByText('$325 · clase suelta')).toBeTruthy()
  })

  it('sin precios (branding): ningún precio en el horario', async () => {
    branding.value = { ...DEFAULT_BRANDING, showPrices: false }
    await pintar([s11, s13])
    expect(document.body.textContent).not.toMatch(/\$/)
    expect(document.body.textContent).not.toContain('clase suelta')
  })

  it('con un paquete que cubre la sesión: «Incluida en tu paquete» y no el precio suelto', async () => {
    const cubreSesion = vi.fn(() => true)
    await pintar([s11], { cubreSesion })
    const f = fila(/Lagree.*11:00/)
    expect(within(f).getByText('Incluida en tu paquete')).toBeTruthy()
    expect(f.textContent).not.toContain('$325')
    expect(cubreSesion).toHaveBeenCalledWith(s11)
  })

  it('lugares: «8 lugares» libres (verde), «2 lugares» de «pocos», «1 lugar» en singular', async () => {
    await pintar([v09, s11, s13])
    // El primer día de la tira es «Mañana» (viernes), con un solo lugar.
    expect(within(fila(/Lagree.*9:00/)).getByText('1 lugar')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Sábado, 28 de noviembre' }))
    const libres = within(fila(/Lagree.*11:00/)).getByText('8 lugares')
    expect(libres.closest('[data-lugares]')!.getAttribute('data-lugares')).toBe('libres')
    const pocos = within(fila(/Lagree.*13:00/)).getByText('2 lugares')
    expect(pocos.closest('[data-lugares]')!.className).toContain('pocos')
  })

  it('«Llena» se ve deshabilitada y no se puede tocar', async () => {
    const { onSelect } = await pintar([s15])
    const f = fila(/Lagree.*15:00/)
    expect(within(f).getAllByText('Llena').length).toBeGreaterThan(0)
    expect(f.disabled).toBe(true)
    fireEvent.click(f)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('una clase llena que ya reservó se puede tocar para abrir su clase, y dice «Reservada · lugar 3»', async () => {
    const miReserva = vi.fn((slot: PublicClassSessionSlot) => (slot.classSessionId === 's-15' ? { lugar: '3' } : null))
    const { onSelect } = await pintar([s11, s15], { miReserva })
    const llena = fila(/Lagree.*15:00/)
    expect(within(llena).getByText('Reservada · lugar 3')).toBeTruthy()
    expect(llena.disabled).toBe(false)
    fireEvent.click(llena)
    expect(onSelect).toHaveBeenCalledWith(s15)
    // Las demás clases no se marcan.
    expect(fila(/Lagree.*11:00/).textContent).not.toContain('Reservada')
  })

  it('una reserva sin lugar asignado dice sólo «Reservada»', async () => {
    await pintar([s11], { miReserva: () => ({ lugar: null }) })
    expect(within(fila(/Lagree.*11:00/)).getByText('Reservada')).toBeTruthy()
  })

  it('en 390 px y sin preferencia abre en Lista con la tira de días; tocar un día enseña sus clases', async () => {
    const { onSelect } = await pintar([v09, s11, s13])
    // En el celular no hay «Semana | Lista»: la lista es la vista.
    expect(screen.queryByRole('button', { name: 'Semana' })).toBeNull()
    const tira = screen.getByRole('group', { name: 'Días con clases' })
    const dias = within(tira).getAllByRole('button')
    expect(dias.map(d => d.textContent)).toEqual(['VIE27', 'SÁB28'])
    // Abre en el primer día con clases.
    expect(dias[0].getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('heading', { name: 'Mañana' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Lagree.*11:00/ })).toBeNull()
    fireEvent.click(dias[1])
    expect(dias[1].getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('heading', { name: 'Sábado, 28 de noviembre' })).toBeTruthy()
    fireEvent.click(fila(/Lagree.*11:00/))
    expect(onSelect).toHaveBeenCalledWith(s11)
  })

  it('una sesión sin fecha válida se salta y no tumba el horario', async () => {
    await pintar([{ ...s11, classSessionId: 'rota', startsAt: 'no-es-fecha' }, s11])
    expect(fila(/Lagree.*11:00/)).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /Lagree/ })).toHaveLength(1)
  })

  it('las medidas del celular: filas de al menos 56 px y texto para leer de 16–17 px', async () => {
    await pintar([s11])
    const css = Array.from(document.querySelectorAll('style')).map(s => s.textContent).join('\n')
    const celular = css.slice(css.indexOf('@media (max-width: 640px)'))
    expect(celular).toMatch(/\.avq-fila\s*\{[^}]*min-height:\s*56px/)
    expect(celular).toMatch(/\.avq-fila-clase\s*\{[^}]*font-size:\s*17px/)
    expect(celular).toMatch(/\.avq-fila-meta[^{]*\{[^}]*font-size:\s*16px/)
    expect(celular).toMatch(/\.avq-horario-titulo\s*\{[^}]*font-size:\s*26px/)
  })
})

describe('Horario: semana tipo calendario (pantallas anchas)', () => {
  it('con ≥ 768 px y sin preferencia guardada abre en Semana: columnas por día con hora, duración, clase, coach y lugares', async () => {
    pantalla(1024)
    const { onSelect } = await pintar([s11, s13, s15])
    expect(screen.getByRole('button', { name: 'Semana' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Lista' }).getAttribute('aria-pressed')).toBe('false')
    // Siete columnas desde hoy.
    expect(screen.getByRole('group', { name: 'Hoy' }).textContent).toContain('HOY · JUE 26')
    const sabado = screen.getByRole('group', { name: 'Sábado, 28 de noviembre' })
    expect(within(sabado).getByText('SÁB 28')).toBeTruthy()
    const tarjeta = within(sabado).getByRole('button', { name: /Lagree.*11:00/ })
    expect(within(tarjeta).getByText('11:00')).toBeTruthy()
    // La duración es la de la sesión (50 min), no la del producto (60).
    expect(within(tarjeta).getByText('50 min')).toBeTruthy()
    expect(tarjeta.textContent).not.toContain('1 h')
    expect(within(tarjeta).getByText('Lagree')).toBeTruthy()
    expect(within(tarjeta).getByText('Fer R.')).toBeTruthy()
    expect(within(tarjeta).getByText('8 lugares')).toBeTruthy()
    expect(within(sabado).getByText('2 lugares').closest('[data-lugares]')!.className).toContain('pocos')
    const llena = within(sabado).getByRole('button', { name: /Lagree.*15:00/ }) as HTMLButtonElement
    expect(within(llena).getByText('Llena')).toBeTruthy()
    expect(llena.disabled).toBe(true)
    fireEvent.click(tarjeta)
    expect(onSelect).toHaveBeenCalledWith(s11)
  })

  it('una clase llena que ya reservó se puede tocar también en la semana', async () => {
    pantalla(1024)
    const { onSelect } = await pintar([s15], { miReserva: () => ({ lugar: '3' }) })
    const llena = screen.getByRole('button', { name: /Lagree.*15:00/ }) as HTMLButtonElement
    expect(within(llena).getByText('Reservada · lugar 3')).toBeTruthy()
    expect(llena.disabled).toBe(false)
    fireEvent.click(llena)
    expect(onSelect).toHaveBeenCalledWith(s15)
  })

  it('la preferencia guardada gana al ancho, y elegir una vista la guarda', async () => {
    pantalla(1024)
    localStorage.setItem('avq_classes_view', 'list')
    await pintar([s11])
    expect(screen.getByRole('button', { name: 'Lista' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('group', { name: 'Días con clases' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Semana' }))
    expect(localStorage.getItem('avq_classes_view')).toBe('calendar')
    expect(screen.getByRole('group', { name: 'Sábado, 28 de noviembre' })).toBeTruthy()
  })

  it('en el celular la semana guardada se enseña como la lista con tira (no hay espacio para siete columnas)', async () => {
    localStorage.setItem('avq_classes_view', 'calendar')
    await pintar([s11])
    expect(screen.getByRole('group', { name: 'Días con clases' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Semana' })).toBeNull()
  })

  it('al avanzar más allá de lo cargado, pide los días que faltan (hasta 60)', async () => {
    pantalla(1024)
    await pintar([s11])
    expect(api.getClassSessionsRange).toHaveBeenCalledTimes(1)
    expect(vi.mocked(api.getClassSessionsRange).mock.calls[0][1]).toEqual({ dateFrom: '2026-11-26', dateTo: '2026-12-26' })
    const atras = screen.getByRole('button', { name: 'Semana anterior' }) as HTMLButtonElement
    expect(atras.disabled).toBe(true)
    const adelante = screen.getByRole('button', { name: 'Semana siguiente' })
    for (let i = 0; i < 4; i++) fireEvent.click(adelante)
    await flush()
    // La quinta semana (24 al 30 de diciembre) pasa del 26: se piden 60 días.
    expect(api.getClassSessionsRange).toHaveBeenCalledTimes(2)
    expect(vi.mocked(api.getClassSessionsRange).mock.calls[1][1]).toEqual({ dateFrom: '2026-11-26', dateTo: '2027-01-25' })
  })

  // Fix r1: «Sin clases» sólo en días que ya llegaron. Lo pedido y aún no recibido dice «Cargando…»; si falla, aviso y reintento.
  const lunes28 = sesion('l-28', '2026-12-28T17:00:00Z', '2026-12-28T17:50:00Z')
  const columna = (nombre: string) => screen.getByRole('group', { name: nombre })
  function pendiente() {
    let resolver!: (r: { dateFrom: string; dateTo: string; slots: PublicClassSessionSlot[] }) => void
    let rechazar!: (e: unknown) => void
    const promesa = new Promise<{ dateFrom: string; dateTo: string; slots: PublicClassSessionSlot[] }>((ok, mal) => {
      resolver = ok; rechazar = mal
    })
    return { promesa, resolver, rechazar }
  }
  async function hastaLaQuintaSemana() {
    for (let i = 0; i < 4; i++) fireEvent.click(screen.getByRole('button', { name: 'Semana siguiente' }))
    await flush()
  }

  it('al cruzar el día 30, los días 31 en adelante dicen «Cargando…» (no «Sin clases») hasta que llega la respuesta', async () => {
    pantalla(1024)
    const segunda = pendiente()
    vi.mocked(api.getClassSessionsRange)
      .mockResolvedValueOnce({ dateFrom: '2026-11-26', dateTo: '2026-12-26', slots: [s11] })
      .mockReturnValueOnce(segunda.promesa)
    const onSelect = vi.fn()
    render(<ClassSessionList venueSlug="un-estudio" timezone={TZ} onSelect={onSelect} products={[lagree]} t={createT('es')} />)
    await flush()
    await hastaLaQuintaSemana()
    expect(api.getClassSessionsRange).toHaveBeenCalledTimes(2)
    // El 26 ya llegó (vacío); del 27 al 30 todavía no.
    expect(columna('Sábado, 26 de diciembre').textContent).toContain('Sin clases')
    for (const dia of ['Domingo, 27 de diciembre', 'Lunes, 28 de diciembre', 'Miércoles, 30 de diciembre']) {
      expect(columna(dia).textContent).toContain('Cargando…')
      expect(columna(dia).textContent).not.toContain('Sin clases')
    }
    await act(async () => { segunda.resolver({ dateFrom: '2026-11-26', dateTo: '2027-01-25', slots: [s11, lunes28] }) })
    await flush()
    expect(within(columna('Lunes, 28 de diciembre')).getByRole('button', { name: /Lagree.*11:00/ })).toBeTruthy()
    expect(columna('Domingo, 27 de diciembre').textContent).toContain('Sin clases')
    expect(document.body.textContent).not.toContain('Cargando…')
  })

  it('si falla la segunda página: aviso con «Intentar de Nuevo» y sin «Sin clases» falsos; reintentar la trae', async () => {
    pantalla(1024)
    const tercera = pendiente()
    vi.mocked(api.getClassSessionsRange)
      .mockResolvedValueOnce({ dateFrom: '2026-11-26', dateTo: '2026-12-26', slots: [s11] })
      .mockRejectedValueOnce(new Error('sin red'))
      .mockReturnValueOnce(tercera.promesa)
    render(<ClassSessionList venueSlug="un-estudio" timezone={TZ} onSelect={vi.fn()} products={[lagree]} t={createT('es')} />)
    await flush()
    await hastaLaQuintaSemana()
    const aviso = screen.getByRole('alert')
    expect(aviso.textContent).toContain('No pudimos cargar más fechas.')
    expect(columna('Domingo, 27 de diciembre').textContent).not.toContain('Sin clases')
    expect(columna('Domingo, 27 de diciembre').textContent).not.toContain('Cargando…')
    // Lo que ya estaba se sigue viendo.
    fireEvent.click(screen.getByRole('button', { name: 'Semana anterior' }))
    fireEvent.click(screen.getByRole('button', { name: 'Semana anterior' }))
    fireEvent.click(screen.getByRole('button', { name: 'Semana anterior' }))
    fireEvent.click(screen.getByRole('button', { name: 'Semana anterior' }))
    expect(screen.getByRole('button', { name: /Lagree.*11:00/ })).toBeTruthy()
    await hastaLaQuintaSemana()
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Intentar de Nuevo' }))
    await flush()
    expect(api.getClassSessionsRange).toHaveBeenCalledTimes(3)
    expect(vi.mocked(api.getClassSessionsRange).mock.calls[2][1]).toEqual({ dateFrom: '2026-11-26', dateTo: '2027-01-25' })
    expect(screen.queryByRole('alert')).toBeNull()
    await act(async () => { tercera.resolver({ dateFrom: '2026-11-26', dateTo: '2027-01-25', slots: [s11, lunes28] }) })
    await flush()
    expect(within(columna('Lunes, 28 de diciembre')).getByRole('button', { name: /Lagree.*11:00/ })).toBeTruthy()
    expect(columna('Domingo, 27 de diciembre').textContent).toContain('Sin clases')
  })

  it('en la lista, si fallan las fechas de más: el mismo aviso con reintento', async () => {
    vi.mocked(api.getClassSessionsRange)
      .mockResolvedValueOnce({ dateFrom: '2026-11-26', dateTo: '2026-12-26', slots: [s11] })
      .mockRejectedValueOnce(new Error('sin red'))
      .mockResolvedValueOnce({ dateFrom: '2026-11-26', dateTo: '2027-01-25', slots: [s11, lunes28] })
    render(<ClassSessionList venueSlug="un-estudio" timezone={TZ} onSelect={vi.fn()} products={[lagree]} t={createT('es')} />)
    await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Más fechas' }))
    await flush()
    expect(screen.getByRole('alert').textContent).toContain('No pudimos cargar más fechas.')
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Intentar de Nuevo' }))
    await flush()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('button', { name: 'Lunes, 28 de diciembre' })).toBeTruthy()
  })
})

// Task 10: lo que la clienta ya tiene, en el horario (la franja, la ventana para sus reservas y los estados de su reserva).
describe('Horario: lo que la clienta ya tiene', () => {
  it('la franja de su paquete va arriba del horario, debajo del título', async () => {
    await pintar([s11], { franja: <p class="avq-franja-prueba">Hola, Ana · tienes 4 sesiones de Lagree</p> })
    const franja = screen.getByText('Hola, Ana · tienes 4 sesiones de Lagree')
    const titulo = screen.getByRole('heading', { name: 'Próximas clases' })
    expect(titulo.compareDocumentPosition(franja) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(franja.compareDocumentPosition(fila(/Lagree.*11:00/)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('avisa la ventana que pidió (para leer sus reservas con las mismas fechas), también al pedir más días', async () => {
    const onVentana = vi.fn()
    await pintar([s11], { onVentana })
    expect(onVentana).toHaveBeenLastCalledWith({ dateFrom: '2026-11-26', dateTo: '2026-12-26' })
    fireEvent.click(screen.getByRole('button', { name: 'Más fechas' }))
    await flush()
    expect(onVentana).toHaveBeenLastCalledWith({ dateFrom: '2026-11-26', dateTo: '2027-01-25' })
  })

  it('una reserva con el depósito pendiente dice «Falta pagar»; una que espera al estudio, «Por aprobar»', async () => {
    const miReserva = (slot: PublicClassSessionSlot) =>
      slot.classSessionId === 's-11' ? { lugar: '3', estado: 'faltaPagar' as const }
        : slot.classSessionId === 's-13' ? { lugar: null, estado: 'porAprobar' as const } : null
    await pintar([s11, s13, s15], { miReserva })
    expect(within(fila(/Lagree.*11:00/)).getByText('Falta pagar')).toBeTruthy()
    expect(fila(/Lagree.*11:00/).textContent).not.toContain('Reservada')
    expect(within(fila(/Lagree.*13:00/)).getByText('Por aprobar')).toBeTruthy()
    expect(fila(/Lagree.*15:00/).textContent).not.toMatch(/Falta pagar|Por aprobar|Reservada/)
  })

  it('con dos lugares en la misma clase: «Reservada · lugares 3, 4» (lista y semana)', async () => {
    await pintar([s11], { miReserva: () => ({ lugar: '3', lugares: ['3', '4'] }) })
    expect(within(fila(/Lagree.*11:00/)).getByText('Reservada · lugares 3, 4')).toBeTruthy()
    cleanup()
    pantalla(1024)
    await pintar([s11], { miReserva: () => ({ lugar: null, estado: 'faltaPagar' as const }) })
    expect(within(screen.getByRole('button', { name: /Lagree.*11:00/ })).getByText('Falta pagar')).toBeTruthy()
  })
})
