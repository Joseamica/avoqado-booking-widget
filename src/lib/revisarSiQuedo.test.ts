import { describe, expect, it, vi } from 'vitest'
import { esResultadoIncierto, reservaNueva, revisarSiQuedo, type Intento, type ReservaPropia } from './revisarSiQuedo'

const reserva = (classSessionId: string, codigo: string, extra: Partial<ReservaPropia> = {}): ReservaPropia => ({
  classSessionId, confirmationCode: codigo, cancelSecret: `sec-${codigo}`, spotIds: [], status: 'CONFIRMED', depositStatus: null, ...extra,
})
const intento = (extra: Partial<Intento> = {}): Intento => ({
  slug: 'studio-a', identidad: 'c1|tel', instancia: 'avq-1', classSessionId: 's-15', spotIds: [], antes: new Set(['VIEJA']), ...extra,
})
const conStatus = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status })
const sinRed = () => new TypeError('Failed to fetch')
/** `dormir` falso: anota cuánto pidió esperar y no espera de verdad. */
const reloj = () => {
  const esperas: number[] = []
  return { esperas, dormir: async (ms: number) => { esperas.push(ms) } }
}

describe('reservaNueva', () => {
  it('sólo cuenta una reserva de ESA clase cuyo código no estaba antes', () => {
    const i = intento()
    expect(reservaNueva(i, [reserva('s-15', 'VIEJA')])).toBeNull()
    expect(reservaNueva(i, [reserva('s-15', 'VIEJA'), reserva('s-15', 'NUEVA')])?.confirmationCode).toBe('NUEVA')
  })

  it('una reserva nueva en OTRA clase no cuenta (r6 #1)', () => {
    expect(reservaNueva(intento(), [reserva('s-11', 'NUEVA')])).toBeNull()
  })

  it('con lugares elegidos, una nueva de esa clase con otros lugares no cuenta; con los mismos (en otro orden) sí', () => {
    const i = intento({ spotIds: ['p1', 'p3'] })
    expect(reservaNueva(i, [reserva('s-15', 'OTRA', { spotIds: ['p2'] })])).toBeNull()
    expect(reservaNueva(i, [reserva('s-15', 'MIA', { spotIds: ['p3', 'p1'] })])?.confirmationCode).toBe('MIA')
  })

  it('sin lectura de antes (`antes: null`), cualquier reserva de esa clase cuenta', () => {
    expect(reservaNueva(intento({ antes: null }), [reserva('s-15', 'VIEJA')])?.confirmationCode).toBe('VIEJA')
  })
})

describe('revisarSiQuedo', () => {
  it('espera [2000, 5000] por default, y aparece un código nuevo en la segunda lectura ⇒ quedó', async () => {
    const { esperas, dormir } = reloj()
    const leer = vi.fn()
      .mockResolvedValueOnce([reserva('s-15', 'VIEJA')])
      .mockResolvedValueOnce([reserva('s-15', 'VIEJA'), reserva('s-15', 'NUEVA')])
    const r = await revisarSiQuedo({ intento: intento(), leer, sigueSiendoEl: () => true, dormir })
    expect(r).toEqual({ estado: 'quedo', reserva: reserva('s-15', 'NUEVA') })
    expect(esperas).toEqual([2000, 5000])
    expect(leer).toHaveBeenCalledTimes(2)
  })

  it('la encuentra en la primera lectura ⇒ quedó sin una segunda', async () => {
    const { esperas, dormir } = reloj()
    const leer = vi.fn().mockResolvedValue([reserva('s-15', 'NUEVA')])
    const r = await revisarSiQuedo({ intento: intento(), leer, sigueSiendoEl: () => true, dormir })
    expect(r.estado).toBe('quedo')
    expect(leer).toHaveBeenCalledTimes(1)
    expect(esperas).toEqual([2000])
  })

  it('un código que ya estaba en `antes` no cuenta: dos lecturas bien y sin nada nuevo ⇒ no quedó', async () => {
    const { dormir } = reloj()
    const leer = vi.fn().mockResolvedValue([reserva('s-15', 'VIEJA'), reserva('s-11', 'DE-OTRA-CLASE')])
    expect(await revisarSiQuedo({ intento: intento(), leer, sigueSiendoEl: () => true, dormir })).toEqual({ estado: 'no-quedo' })
    expect(leer).toHaveBeenCalledTimes(2)
  })

  it('con lugares elegidos, la nueva con otros lugares no cuenta ⇒ no quedó', async () => {
    const { dormir } = reloj()
    const leer = vi.fn().mockResolvedValue([reserva('s-15', 'OTRA', { spotIds: ['p2'] })])
    const r = await revisarSiQuedo({ intento: intento({ spotIds: ['p3'] }), leer, sigueSiendoEl: () => true, dormir })
    expect(r).toEqual({ estado: 'no-quedo' })
  })

  it.each([429, 408, 500, 503])('un %i en la primera lectura es falla pasajera: hace la segunda (r6 #3)', async status => {
    const { dormir } = reloj()
    const leer = vi.fn().mockRejectedValueOnce(conStatus(status)).mockResolvedValueOnce([reserva('s-15', 'NUEVA')])
    const r = await revisarSiQuedo({ intento: intento(), leer, sigueSiendoEl: () => true, dormir })
    expect(r.estado).toBe('quedo')
    expect(leer).toHaveBeenCalledTimes(2)
  })

  it('la primera bien y la segunda sin red ⇒ sin red (no se sabe)', async () => {
    const { dormir } = reloj()
    const leer = vi.fn().mockResolvedValueOnce([]).mockRejectedValueOnce(sinRed())
    expect(await revisarSiQuedo({ intento: intento(), leer, sigueSiendoEl: () => true, dormir })).toEqual({ estado: 'sin-red' })
  })

  it('la primera sin red y la segunda bien sin nada nuevo ⇒ no quedó (manda la ÚLTIMA lectura)', async () => {
    const { dormir } = reloj()
    const leer = vi.fn().mockRejectedValueOnce(sinRed()).mockResolvedValueOnce([])
    expect(await revisarSiQuedo({ intento: intento(), leer, sigueSiendoEl: () => true, dormir })).toEqual({ estado: 'no-quedo' })
  })

  it('una lectura a medias (LECTURA_INCOMPLETA, sin `status`) cuenta como «no se sabe»', async () => {
    const { dormir } = reloj()
    const incompleta = Object.assign(new Error('a medias'), { code: 'LECTURA_INCOMPLETA' })
    const leer = vi.fn().mockRejectedValue(incompleta)
    expect(await revisarSiQuedo({ intento: intento(), leer, sigueSiendoEl: () => true, dormir })).toEqual({ estado: 'sin-red' })
  })

  it.each([404, 401, 403, 400])('un %i en la primera ⇒ no disponible, sin segunda lectura (r5 #4)', async status => {
    const { esperas, dormir } = reloj()
    const leer = vi.fn().mockRejectedValue(conStatus(status))
    // Con un 401, `request` ya soltó la sesión: aun así manda el «no disponible», no el «cambio de cuenta».
    let viva = true
    leer.mockImplementation(async () => { if (status === 401) viva = false; throw conStatus(status) })
    expect(await revisarSiQuedo({ intento: intento(), leer, sigueSiendoEl: () => viva, dormir })).toEqual({ estado: 'no-disponible' })
    expect(leer).toHaveBeenCalledTimes(1)
    expect(esperas).toEqual([2000])
  })

  it('`sigueSiendoEl()` falso entre lecturas ⇒ cambio de cuenta, aunque la segunda la hubiera encontrado', async () => {
    const { dormir } = reloj()
    let viva = true
    const leer = vi.fn()
      .mockImplementationOnce(async () => { viva = false; return [] })
      .mockResolvedValueOnce([reserva('s-15', 'NUEVA')])
    expect(await revisarSiQuedo({ intento: intento(), leer, sigueSiendoEl: () => viva, dormir })).toEqual({ estado: 'cambio-de-cuenta' })
    expect(leer).toHaveBeenCalledTimes(1)
  })

  it('la cuenta cambió durante la lectura que sí la encontró ⇒ cambio de cuenta, sin enseñar la reserva', async () => {
    const { dormir } = reloj()
    let viva = true
    const leer = vi.fn().mockImplementation(async () => { viva = false; return [reserva('s-15', 'NUEVA')] })
    expect(await revisarSiQuedo({ intento: intento(), leer, sigueSiendoEl: () => viva, dormir })).toEqual({ estado: 'cambio-de-cuenta' })
  })

  it('la cuenta ya cambió antes de leer (mientras esperaba) ⇒ cambio de cuenta sin leer', async () => {
    const leer = vi.fn()
    let viva = true
    const dormir = async () => { viva = false }
    expect(await revisarSiQuedo({ intento: intento(), leer, sigueSiendoEl: () => viva, dormir })).toEqual({ estado: 'cambio-de-cuenta' })
    expect(leer).not.toHaveBeenCalled()
  })

  it('sin `dormir`, espera de verdad con el reloj (2 s y 5 s)', async () => {
    vi.useFakeTimers()
    try {
      const leer = vi.fn().mockResolvedValue([])
      let fin: unknown = null
      void revisarSiQuedo({ intento: intento(), leer, sigueSiendoEl: () => true }).then(r => { fin = r })
      await vi.advanceTimersByTimeAsync(1999)
      expect(leer).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(leer).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(4999)
      expect(leer).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(leer).toHaveBeenCalledTimes(2)
      expect(fin).toEqual({ estado: 'no-quedo' })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('esResultadoIncierto', () => {
  it('sin `status` (sin red, tope, fetch que truena, cuerpo que no llega) ⇒ verdadero', () => {
    expect(esResultadoIncierto(new TypeError('Failed to fetch'))).toBe(true)
    expect(esResultadoIncierto(new DOMException('The operation was aborted.', 'AbortError'))).toBe(true)
    expect(esResultadoIncierto(Object.assign(new Error('tope'), { name: 'TimeoutError' }))).toBe(true)
    expect(esResultadoIncierto(undefined)).toBe(true)
  })

  it.each([500, 502, 503, 504])('%i ⇒ verdadero', status => {
    expect(esResultadoIncierto(conStatus(status))).toBe(true)
  })

  it('un 4xx sigue su manejo de hoy: 409, 400 y el 401 local (antes de fetch) ⇒ falso', () => {
    expect(esResultadoIncierto({ status: 409, data: { code: 'SPOTS_TAKEN' } })).toBe(false)
    expect(esResultadoIncierto({ status: 400, data: { message: 'x' } })).toBe(false)
    expect(esResultadoIncierto({ status: 401, data: { code: 'CUSTOMER_SESSION_CLOSED' } })).toBe(false)
  })
})
