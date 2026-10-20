import { describe, expect, it } from 'vitest'
import { closesAt, formatTime, todayRanges, weekdayKey } from './hours'
import type { WeeklyHours } from './types'

const TZ = 'America/Mexico_City'
const day = (enabled: boolean, ranges: { open: string; close: string }[] = []) => ({ enabled, ranges })
const hours: WeeklyHours = {
  monday: day(false), tuesday: day(false), wednesday: day(false), thursday: day(false),
  friday: day(true, [{ open: '09:00', close: '17:00' }, { open: '22:00', close: '02:00' }]),
  saturday: day(false), sunday: day(false),
}

describe('horario', () => {
  it('el día se toma en la zona del negocio', () => {
    expect(weekdayKey(new Date('2026-10-17T05:30:00Z'), TZ)).toBe('friday') // sábado en UTC, viernes en CDMX
    expect(weekdayKey(new Date('2026-10-17T05:30:00Z'), 'UTC')).toBe('saturday')
  })
  it('franjas de hoy y cruce de medianoche', () => {
    expect(todayRanges(hours, new Date('2026-10-17T05:30:00Z'), TZ)).toEqual([
      { open: '09:00', close: '17:00', overnight: false },
      { open: '22:00', close: '02:00', overnight: true },
    ])
  })
  it('sin horario = null; día apagado = []', () => {
    expect(todayRanges(null, new Date(), TZ)).toBeNull()
    expect(todayRanges(hours, new Date('2026-10-19T18:00:00Z'), TZ)).toEqual([])
  })
  it('formatTime en la zona del negocio', () => {
    expect(formatTime('2026-10-17T19:30:00Z', TZ, 'es')).toBe('13:30')
    expect(formatTime('2026-10-17T19:30:00Z', TZ, 'en')).toMatch(/1:30\s?PM/)
  })
  it('formatTime con hora de un dígito', () => {
    expect(formatTime('2026-10-17T15:05:00Z', TZ, 'es')).toBe('09:05')
    expect(formatTime('2026-10-17T15:05:00Z', TZ, 'en')).toMatch(/^9:05\s?AM$/)
  })
  it('formatTime usa la zona pedida, no la de la máquina', () => {
    expect(formatTime('2026-10-17T19:30:00Z', 'Asia/Tokyo', 'es')).toBe('04:30')
    expect(formatTime('2026-10-17T19:30:00Z', 'UTC', 'es')).toBe('19:30')
  })
})

describe('closesAt: la hora de cierre de la franja abierta ahora', () => {
  const week = (...days: [string, boolean, { open: string; close: string }[]][]): WeeklyHours => {
    const w = Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map(k => [k, day(false)])) as WeeklyHours
    for (const [k, enabled, ranges] of days) (w as any)[k] = day(enabled, ranges)
    return w
  }
  const everyDay = (ranges: { open: string; close: string }[]) =>
    Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map(k => [k, day(true, ranges)])) as WeeklyHours
  // CDMX es UTC-6 todo el año: 12:00 del lunes 19-oct = 18:00Z.
  const at = (iso: string) => new Date(iso)

  it('dentro de 09:00–22:00 devuelve 22:00; a la hora exacta de apertura sí, a la de cierre ya no; fuera, null', () => {
    const h = everyDay([{ open: '09:00', close: '22:00' }])
    expect(closesAt(h, at('2026-10-19T18:00:00Z'), TZ)).toBe('22:00') // 12:00
    expect(closesAt(h, at('2026-10-19T15:00:00Z'), TZ)).toBe('22:00') // 09:00 en punto
    expect(closesAt(h, at('2026-10-20T03:59:00Z'), TZ)).toBe('22:00') // 21:59
    expect(closesAt(h, at('2026-10-20T04:00:00Z'), TZ)).toBeNull() // 22:00 en punto
    expect(closesAt(h, at('2026-10-19T14:59:00Z'), TZ)).toBeNull() // 08:59
  })
  it('sin horario = null; día apagado = null', () => {
    expect(closesAt(null, at('2026-10-19T18:00:00Z'), TZ)).toBeNull()
    expect(closesAt(week(['monday', false, [{ open: '09:00', close: '22:00' }]]), at('2026-10-19T18:00:00Z'), TZ)).toBeNull()
    expect(closesAt(week(), at('2026-10-19T18:00:00Z'), TZ)).toBeNull()
  })
  it('franja nocturna 22:00–02:00: a las 23:30 cierra a las 02:00 (del día siguiente)', () => {
    const h = everyDay([{ open: '22:00', close: '02:00' }])
    expect(closesAt(h, at('2026-10-20T05:30:00Z'), TZ)).toBe('02:00') // 23:30
    expect(closesAt(h, at('2026-10-20T04:00:00Z'), TZ)).toBe('02:00') // 22:00 en punto
    expect(closesAt(h, at('2026-10-20T03:59:00Z'), TZ)).toBeNull() // 21:59: todavía cerrado
  })
  it('en la madrugada cuenta la franja nocturna de AYER, hasta su cierre', () => {
    const h = week(['monday', true, [{ open: '22:00', close: '02:00' }]])
    expect(closesAt(h, at('2026-10-20T07:00:00Z'), TZ)).toBe('02:00') // martes 01:00
    expect(closesAt(h, at('2026-10-20T07:59:00Z'), TZ)).toBe('02:00') // martes 01:59
    expect(closesAt(h, at('2026-10-20T08:00:00Z'), TZ)).toBeNull() // martes 02:00: ya cerró
    // El domingo (ayer del lunes) también cruza a la semana siguiente.
    const sun = week(['sunday', true, [{ open: '22:00', close: '02:00' }]])
    expect(closesAt(sun, at('2026-10-19T07:00:00Z'), TZ)).toBe('02:00') // lunes 01:00
    // Un día de ayer apagado no aporta su madrugada.
    expect(closesAt(week(['monday', false, [{ open: '22:00', close: '02:00' }]]), at('2026-10-20T07:00:00Z'), TZ)).toBeNull()
  })
  it('varias franjas: la de ahora, no la primera ni la última', () => {
    const h = everyDay([{ open: '09:00', close: '13:00' }, { open: '17:00', close: '22:00' }])
    expect(closesAt(h, at('2026-10-19T16:00:00Z'), TZ)).toBe('13:00') // 10:00
    expect(closesAt(h, at('2026-10-19T20:00:00Z'), TZ)).toBeNull() // 14:00: en la pausa
    expect(closesAt(h, at('2026-10-20T00:00:00Z'), TZ)).toBe('22:00') // 18:00
  })
  it('el día y la hora son los del negocio, no los del navegador', () => {
    const h = week(['sunday', true, [{ open: '09:00', close: '22:00' }]])
    const now = at('2026-10-19T03:30:00Z') // domingo 21:30 en CDMX; lunes 03:30 en UTC
    expect(closesAt(h, now, TZ)).toBe('22:00')
    expect(closesAt(h, now, 'UTC')).toBeNull()
  })
  it('una zona inválida no tumba nada: null', () => {
    expect(closesAt(everyDay([{ open: '09:00', close: '22:00' }]), at('2026-10-19T18:00:00Z'), 'Marte/Olimpo')).toBeNull()
  })
})
