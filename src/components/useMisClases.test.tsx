import { h } from 'preact'
import { act, cleanup, render } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api/booking'
import { bindCustomerSessionToVenue, entroAqui } from '../state/booking'
import { documentoNuevoParaPruebas, guardarSesion, identidadDe, leerSesion } from '../lib/sesionDeCliente'
import type { MiReservaDeClase } from '../types'
import { estadoDeMiReserva, miLugarEn, useMisClases, type MisClases, type VentanaDelHorario } from './useMisClases'

vi.mock('../api/booking', () => ({ getCustomerCredits: vi.fn(), getMisReservasDeClase: vi.fn() }))

// Task 10 deja a mano para Task 13 (revisar si la reserva quedó): la última lectura de la ventana y cómo volver a leerla entera,
// con su `slug`, la identidad de la sesión y la instancia del widget.
const ANA = {
  token: 'tok-ana', customer: { id: 'c1', firstName: 'Ana', lastName: null, email: null, phone: '5512345678' },
  contactos: [{ tipo: 'PHONE' as const, valor: '+525512345678', metodo: 'WHATSAPP' as const, probadoEn: 1 }],
}
const VENTANA: VentanaDelHorario = { dateFrom: '2026-11-26', dateTo: '2026-12-26' }
const mia = (classSessionId: string, extra: Partial<MiReservaDeClase> = {}): MiReservaDeClase => ({
  classSessionId, spotIds: [], confirmationCode: `C-${classSessionId}`, cancelSecret: `sec-${classSessionId}`,
  startsAt: '2026-11-28T17:00:00Z', status: 'CONFIRMED', depositStatus: null, usedUnlimited: false, ...extra,
})
const pagina = (reservations: MiReservaDeClase[], nextCursor: string | null = null) =>
  ({ reservations, total: reservations.length, nextCursor, unlimitedUsedSessionIds: [] })

async function flush() { for (let i = 0; i < 4; i++) await act(async () => { for (let j = 0; j < 8; j++) await Promise.resolve() }) }

function Sonda({ slug, ventana, activo = true, salida }: {
  slug: string; ventana: VentanaDelHorario | null; activo?: boolean; salida: { actual?: MisClases }
}) {
  salida.actual = useMisClases(slug, { activo, ventana, productos: [] })
  return null
}

function entrar(slug: string) {
  bindCustomerSessionToVenue(slug)
  guardarSesion(slug, { ...ANA, guardadaEn: Date.now() })
  entroAqui(slug, leerSesion(slug)!)
}

beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear()
  documentoNuevoParaPruebas()
  vi.mocked(api.getCustomerCredits).mockResolvedValue({ customer: null, purchases: [] })
})
afterEach(() => cleanup())

describe('Task 10 → Task 13: la lectura de sus reservas por instancia', () => {
  it('sin sesión no hay nada que revisar y no se lee nada', async () => {
    bindCustomerSessionToVenue('un-estudio')
    const salida: { actual?: MisClases } = {}
    render(<Sonda slug="un-estudio" ventana={VENTANA} salida={salida} />)
    await flush()
    expect(salida.actual!.paraRevisar).toBeNull()
    expect(api.getMisReservasDeClase).not.toHaveBeenCalled()
  })

  it('guarda la última lectura de la ventana con su slug, identidad e instancia; `leer` vuelve a recorrer TODAS las páginas', async () => {
    entrar('un-estudio')
    vi.mocked(api.getMisReservasDeClase)
      .mockResolvedValueOnce(pagina([mia('s-1')], 'p2'))
      .mockResolvedValueOnce(pagina([mia('s-2')]))
    const salida: { actual?: MisClases } = {}
    render(<Sonda slug="un-estudio" ventana={VENTANA} salida={salida} />)
    await flush()
    const r = salida.actual!.paraRevisar!
    expect(r.slug).toBe('un-estudio')
    expect(r.identidad).toBe(identidadDe(leerSesion('un-estudio')!))
    expect(r.instancia).toMatch(/\S/)
    expect(r.ventana).toEqual(VENTANA)
    expect(r.ultima!.map(x => x.confirmationCode)).toEqual(['C-s-1', 'C-s-2'])

    vi.mocked(api.getMisReservasDeClase)
      .mockResolvedValueOnce(pagina([mia('s-1')], 'p2'))
      .mockResolvedValueOnce(pagina([mia('s-2'), mia('s-2', { confirmationCode: 'C-nueva' })]))
    let filas: MiReservaDeClase[] = []
    await act(async () => { filas = await r.leer() })
    expect(filas.map(x => x.confirmationCode)).toEqual(['C-s-1', 'C-s-2', 'C-nueva'])
    expect(vi.mocked(api.getMisReservasDeClase).mock.calls.slice(2)).toEqual([
      ['un-estudio', VENTANA, 'tok-ana'],
      ['un-estudio', { ...VENTANA, cursor: 'p2' }, 'tok-ana'],
    ])
    // La lectura nueva también queda como la última (y marca la reserva nueva en el horario).
    expect(salida.actual!.paraRevisar!.ultima!.map(x => x.confirmationCode)).toContain('C-nueva')
    expect(salida.actual!.reservaDe({ classSessionId: 's-2' })!.reservas).toHaveLength(2)
  })

  it('`leer` lanza el error de la lectura con su status (un SERVIDOR viejo: 404)', async () => {
    entrar('un-estudio')
    vi.mocked(api.getMisReservasDeClase).mockResolvedValue(pagina([]))
    const salida: { actual?: MisClases } = {}
    render(<Sonda slug="un-estudio" ventana={VENTANA} salida={salida} />)
    await flush()
    vi.mocked(api.getMisReservasDeClase).mockRejectedValue(Object.assign(new Error('x'), { status: 404 }))
    await expect(salida.actual!.paraRevisar!.leer()).rejects.toMatchObject({ status: 404 })
  })

  it('si la ventana creció y su lectura no ha llegado, no hay «última» de ESA ventana (null)', async () => {
    entrar('un-estudio')
    vi.mocked(api.getMisReservasDeClase).mockResolvedValueOnce(pagina([mia('s-1')])).mockReturnValueOnce(new Promise(() => {}))
    const salida: { actual?: MisClases } = {}
    const v = render(<Sonda slug="un-estudio" ventana={VENTANA} salida={salida} />)
    await flush()
    expect(salida.actual!.paraRevisar!.ultima).toHaveLength(1)
    const mas = { dateFrom: VENTANA.dateFrom, dateTo: '2027-01-25' }
    v.rerender(<Sonda slug="un-estudio" ventana={mas} salida={salida} />)
    await flush()
    expect(salida.actual!.paraRevisar!.ventana).toEqual(mas)
    expect(salida.actual!.paraRevisar!.ultima).toBeNull()
    // Las marcas del horario siguen con lo que ya se sabía.
    expect(salida.actual!.reservaDe({ classSessionId: 's-1' })).not.toBeNull()
  })

  it('cada widget tiene su instancia', async () => {
    entrar('un-estudio')
    vi.mocked(api.getMisReservasDeClase).mockResolvedValue(pagina([]))
    const a: { actual?: MisClases } = {}
    const b: { actual?: MisClases } = {}
    render(<div><Sonda slug="un-estudio" ventana={VENTANA} salida={a} /><Sonda slug="un-estudio" ventana={VENTANA} salida={b} /></div>)
    await flush()
    expect(a.actual!.paraRevisar!.instancia).not.toBe(b.actual!.paraRevisar!.instancia)
  })
})

describe('su reserva en una clase', () => {
  it('confirmada o ya llegó ⇒ reservada; PENDING con depósito pendiente ⇒ falta pagar; otro PENDING ⇒ por aprobar', () => {
    expect(estadoDeMiReserva({ status: 'CONFIRMED', depositStatus: 'PAID' })).toBe('reservada')
    expect(estadoDeMiReserva({ status: 'CHECKED_IN', depositStatus: null })).toBe('reservada')
    expect(estadoDeMiReserva({ status: 'PENDING', depositStatus: 'PENDING' })).toBe('faltaPagar')
    expect(estadoDeMiReserva({ status: 'PENDING', depositStatus: null })).toBe('porAprobar')
    expect(estadoDeMiReserva({ status: 'PENDING', depositStatus: 'PAID' })).toBe('porAprobar')
  })

  it('con varias en la misma clase se enseña la confirmada, con todos sus lugares confirmados', () => {
    const l = miLugarEn([
      mia('s', { status: 'PENDING', depositStatus: 'PENDING', spotIds: ['9'], confirmationCode: 'P' }),
      mia('s', { spotIds: ['3'], confirmationCode: 'A' }),
      mia('s', { spotIds: ['4'], confirmationCode: 'B' }),
    ])!
    expect(l.estado).toBe('reservada')
    expect(l.principal.confirmationCode).toBe('A')
    expect(l.lugar).toBe('3')
    expect(l.lugares).toEqual(['3', '4'])
    expect(l.reservas).toHaveLength(3)
    expect(miLugarEn([])).toBeNull()
  })
})

// Fix r1 (Ruling del controlador): `leer` nunca hace pasar una lectura a medias por completa. Con un cursor repetido o al llegar al tope
// de páginas LANZA (sin `status`: Task 13 lo toma como «no se sabe», nunca como «no quedó»); `ultima` se queda con la última buena.
describe('Task 10 → Task 13: una lectura a medias no cuenta como completa', () => {
  async function conUnaLecturaBuena() {
    entrar('un-estudio')
    vi.mocked(api.getMisReservasDeClase).mockResolvedValueOnce(pagina([mia('s-1')]))
    const salida: { actual?: MisClases } = {}
    render(<Sonda slug="un-estudio" ventana={VENTANA} salida={salida} />)
    await flush()
    expect(salida.actual!.paraRevisar!.ultima!.map(x => x.confirmationCode)).toEqual(['C-s-1'])
    return salida
  }

  it('cursor repetido ⇒ `leer` falla (sin status) y `ultima` sigue siendo la última lectura buena', async () => {
    const salida = await conUnaLecturaBuena()
    vi.mocked(api.getMisReservasDeClase)
      .mockResolvedValueOnce(pagina([mia('s-1')], 'p2'))
      .mockResolvedValueOnce(pagina([mia('s-2')], 'p2'))
    let error: any = null
    await act(async () => { await salida.actual!.paraRevisar!.leer().catch(e => { error = e }) })
    expect(error).toBeInstanceOf(Error)
    expect(error.status).toBeUndefined()
    expect(error.code).toBe('LECTURA_INCOMPLETA')
    expect(salida.actual!.paraRevisar!.ultima!.map(x => x.confirmationCode)).toEqual(['C-s-1'])
  })

  it('más páginas que el tope ⇒ `leer` falla en lugar de devolver lo que alcanzó', async () => {
    const salida = await conUnaLecturaBuena()
    let n = 0
    vi.mocked(api.getMisReservasDeClase).mockImplementation(async () => pagina([mia(`s-${++n}`)], `p${n + 1}`))
    await expect(salida.actual!.paraRevisar!.leer()).rejects.toMatchObject({ code: 'LECTURA_INCOMPLETA' })
    expect(n).toBe(20)
  })
})

describe('Task 10: refrescar', () => {
  it('vuelve a leer el saldo y sus reservas de la ventana con la cuenta de ahora; nada si este widget nunca las leyó', async () => {
    entrar('un-estudio')
    vi.mocked(api.getMisReservasDeClase).mockResolvedValue(pagina([]))
    const fuera: { actual?: MisClases } = {}
    const v = render(<Sonda slug="un-estudio" ventana={VENTANA} activo={false} salida={fuera} />)
    await flush()
    fuera.actual!.refrescar(); await flush()
    expect(api.getCustomerCredits).not.toHaveBeenCalled()
    v.unmount()
    const salida: { actual?: MisClases } = {}
    render(<Sonda slug="un-estudio" ventana={VENTANA} salida={salida} />)
    await flush()
    expect(api.getCustomerCredits).toHaveBeenCalledTimes(1)
    expect(api.getMisReservasDeClase).toHaveBeenCalledTimes(1)
    vi.mocked(api.getMisReservasDeClase).mockResolvedValue(pagina([mia('s-9', { spotIds: ['4'] })]))
    await act(async () => { salida.actual!.refrescar() }); await flush()
    expect(api.getCustomerCredits).toHaveBeenLastCalledWith('un-estudio', {}, 'tok-ana')
    expect(api.getMisReservasDeClase).toHaveBeenCalledTimes(2)
    expect(salida.actual!.reservaDe({ classSessionId: 's-9' })!.lugar).toBe('4')
  })
})

describe('Task 13: `saldoListo` (la confirmación no deja confirmar hasta leer su paquete)', () => {
  it('falso hasta que llega la lectura del saldo; verdadero también si la lectura falló; la instancia no cambia', async () => {
    entrar('un-estudio')
    vi.mocked(api.getMisReservasDeClase).mockResolvedValue(pagina([]))
    let dar!: (v: any) => void
    vi.mocked(api.getCustomerCredits).mockImplementationOnce(() => new Promise(ok => { dar = ok }))
    const salida: { actual?: MisClases } = {}
    render(<Sonda slug="un-estudio" ventana={VENTANA} salida={salida} />)
    await flush()
    const instancia = salida.actual!.instancia
    expect(instancia).toMatch(/\S/)
    expect(salida.actual!.saldoListo).toBe(false)
    await act(async () => dar({ customer: null, purchases: [] })); await flush()
    expect(salida.actual!.saldoListo).toBe(true)
    expect(salida.actual!.instancia).toBe(instancia)
    cleanup()
    vi.mocked(api.getCustomerCredits).mockRejectedValueOnce(Object.assign(new Error('x'), { status: 500 }))
    render(<Sonda slug="un-estudio" ventana={VENTANA} salida={salida} />)
    await flush()
    expect(salida.actual!.creditos).toBeNull()
    expect(salida.actual!.saldoListo).toBe(true)
  })

  it('sin sesión nunca está listo (no hay saldo que leer); al entrar otra cuenta vuelve a falso hasta leer el suyo', async () => {
    bindCustomerSessionToVenue('otro-estudio')
    const salida: { actual?: MisClases } = {}
    render(<Sonda slug="otro-estudio" ventana={VENTANA} salida={salida} />)
    await flush()
    expect(salida.actual!.saldoListo).toBe(false)
    entrar('otro-estudio')
    vi.mocked(api.getMisReservasDeClase).mockResolvedValue(pagina([]))
    await flush()
    expect(salida.actual!.saldoListo).toBe(true)
    vi.mocked(api.getCustomerCredits).mockImplementationOnce(() => new Promise(() => {}))
    await act(async () => {
      const BEA = { ...ANA, token: 'tok-bea', customer: { ...ANA.customer, id: 'c2', firstName: 'Bea' } }
      guardarSesion('otro-estudio', { ...BEA, guardadaEn: Date.now() })
      entroAqui('otro-estudio', leerSesion('otro-estudio')!)
    })
    await flush()
    expect(salida.actual!.cuenta?.cliente?.firstName).toBe('Bea')
    expect(salida.actual!.saldoListo).toBe(false)
  })
})

describe('Task 13 fix r1 #2: `reservasLeidas` (la confirmación espera la lectura de sus reservas)', () => {
  it('«esperando» mientras llega; «listas» con la lectura buena; «fallaron» si falló', async () => {
    entrar('un-estudio')
    let dar!: (v: any) => void
    vi.mocked(api.getMisReservasDeClase).mockImplementationOnce(() => new Promise(ok => { dar = ok }))
    const salida: { actual?: MisClases } = {}
    render(<Sonda slug="un-estudio" ventana={VENTANA} salida={salida} />)
    await flush()
    expect(salida.actual!.reservasLeidas).toBe('esperando')
    await act(async () => dar(pagina([]))); await flush()
    expect(salida.actual!.reservasLeidas).toBe('listas')
    cleanup()
    vi.mocked(api.getMisReservasDeClase).mockRejectedValueOnce(Object.assign(new Error('x'), { status: 500 }))
    render(<Sonda slug="un-estudio" ventana={VENTANA} salida={salida} />)
    await flush()
    expect(salida.actual!.reservasLeidas).toBe('fallaron')
  })

  it('sin ventana no hay qué leer: «fallaron» (no se puede revisar)', async () => {
    entrar('un-estudio')
    const salida: { actual?: MisClases } = {}
    render(<Sonda slug="un-estudio" ventana={null} salida={salida} />)
    await flush()
    expect(salida.actual!.reservasLeidas).toBe('fallaron')
  })
})
