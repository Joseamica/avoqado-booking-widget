import { describe, expect, it } from 'vitest'
import { closesAt, formatClock, formatTime, opensAt, todayRanges, weekdayKey } from './hours'
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
  it('formatClock: una hora del horario («09:05», ya en la zona del negocio) sale con el formato de formatTime, en español y en inglés', () => {
    // La misma hora, dicha como horario y como instante en CDMX (15:05Z = 09:05 y 19:30Z = 13:30): se leen igual.
    for (const locale of ['es', 'en'] as const) {
      expect(formatClock('09:05', locale), locale).toBe(formatTime('2026-10-17T15:05:00Z', TZ, locale))
      expect(formatClock('13:30', locale), locale).toBe(formatTime('2026-10-17T19:30:00Z', TZ, locale))
    }
    expect(formatClock('09:05', 'es')).toBe('09:05')
    expect(formatClock('13:30', 'es')).toBe('13:30')
    expect(formatClock('09:05', 'en')).toMatch(/^9:05\sAM$/)
    expect(formatClock('13:30', 'en')).toMatch(/^1:30\sPM$/)
    expect(formatClock('00:15', 'en')).toMatch(/^12:15\sAM$/)
    expect(formatClock('cerrado', 'en')).toBe('cerrado') // no es una hora: tal cual, sin lanzar
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
  it('franjas seguidas (una cierra a las 14:00 y otra abre a las 14:00): sigue de corrido hasta el cierre real; con un hueco, cierra a las 14:00', () => {
    const chain = everyDay([{ open: '09:00', close: '14:00' }, { open: '14:00', close: '22:00' }])
    expect(closesAt(chain, at('2026-10-19T16:00:00Z'), TZ)).toBe('22:00') // 10:00
    expect(closesAt(chain, at('2026-10-19T19:59:00Z'), TZ)).toBe('22:00') // 13:59
    expect(closesAt(chain, at('2026-10-19T20:00:00Z'), TZ)).toBe('22:00') // 14:00 en punto
    const gap = everyDay([{ open: '09:00', close: '14:00' }, { open: '15:00', close: '22:00' }])
    expect(closesAt(gap, at('2026-10-19T16:00:00Z'), TZ)).toBe('14:00') // 10:00
    expect(closesAt(gap, at('2026-10-19T20:30:00Z'), TZ)).toBeNull() // 14:30: en la pausa
    expect(closesAt(gap, at('2026-10-19T21:00:00Z'), TZ)).toBe('22:00') // 15:00
  })
  it('la cadena no depende del orden en que vengan las franjas, cruza traslapes y sigue varias', () => {
    const reversed = everyDay([{ open: '14:00', close: '22:00' }, { open: '09:00', close: '14:00' }])
    expect(closesAt(reversed, at('2026-10-19T16:00:00Z'), TZ)).toBe('22:00')
    const overlap = everyDay([{ open: '09:00', close: '17:00' }, { open: '12:00', close: '20:00' }])
    expect(closesAt(overlap, at('2026-10-19T16:00:00Z'), TZ)).toBe('20:00') // 10:00
    expect(closesAt(overlap, at('2026-10-19T19:00:00Z'), TZ)).toBe('20:00') // 13:00
    const three = everyDay([{ open: '09:00', close: '12:00' }, { open: '12:00', close: '15:00' }, { open: '15:00', close: '22:00' }])
    expect(closesAt(three, at('2026-10-19T16:00:00Z'), TZ)).toBe('22:00')
  })
  it('la cadena cruza la medianoche: la franja nocturna (o la que cierra a las 00:00) y el día siguiente abre justo ahí', () => {
    const night = week(['monday', true, [{ open: '22:00', close: '02:00' }]], ['tuesday', true, [{ open: '02:00', close: '10:00' }]])
    expect(closesAt(night, at('2026-10-20T05:30:00Z'), TZ)).toBe('10:00') // lunes 23:30
    expect(closesAt(night, at('2026-10-20T07:00:00Z'), TZ)).toBe('10:00') // martes 01:00: la madrugada de ayer, seguida por la franja de hoy
    expect(closesAt(night, at('2026-10-20T09:00:00Z'), TZ)).toBe('10:00') // martes 03:00
    // Con el martes apagado, cierra a las 02:00.
    const off = week(['monday', true, [{ open: '22:00', close: '02:00' }]], ['tuesday', false, [{ open: '02:00', close: '10:00' }]])
    expect(closesAt(off, at('2026-10-20T05:30:00Z'), TZ)).toBe('02:00')
    // Cierra «a las 00:00» y el martes abre a las 00:00.
    const midnight = week(['monday', true, [{ open: '18:00', close: '00:00' }]], ['tuesday', true, [{ open: '00:00', close: '03:00' }]])
    expect(closesAt(midnight, at('2026-10-20T05:00:00Z'), TZ)).toBe('03:00') // lunes 23:00
    // Con un hueco de un minuto no hay cadena.
    const almost = week(['monday', true, [{ open: '18:00', close: '23:59' }]], ['tuesday', true, [{ open: '00:00', close: '03:00' }]])
    expect(closesAt(almost, at('2026-10-20T05:00:00Z'), TZ)).toBe('23:59')
  })
  it('una franja de largo cero (10:00–10:00) no abre nunca, como en el servidor', () => {
    expect(closesAt(everyDay([{ open: '10:00', close: '10:00' }]), at('2026-10-19T18:00:00Z'), TZ)).toBeNull() // 12:00
  })
  it('una zona inválida no tumba nada: null', () => {
    expect(closesAt(everyDay([{ open: '09:00', close: '22:00' }]), at('2026-10-19T18:00:00Z'), 'Marte/Olimpo')).toBeNull()
  })
})

describe('opensAt: a qué hora abre HOY el negocio, si todavía no ha abierto', () => {
  const everyDay = (...ranges: { open: string; close: string }[]) =>
    Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map(k => [k, day(true, ranges)])) as WeeklyHours
  // CDMX es UTC-6 todo el año: 08:00 del lunes 19-oct = 14:00Z.
  const at = (iso: string) => new Date(iso)

  it('antes de la primera franja devuelve su apertura; con varias, la primera que falta por abrir', () => {
    const h = everyDay({ open: '09:00', close: '14:00' }, { open: '17:00', close: '22:00' })
    expect(opensAt(h, at('2026-10-19T14:00:00Z'), TZ)).toBe('09:00') // 08:00
    expect(opensAt(h, at('2026-10-19T21:00:00Z'), TZ)).toBe('17:00') // 15:00, entre las dos franjas
  })
  it('a la hora exacta de apertura ya no es "falta por abrir"; pasada la última apertura de hoy, null (mañana no se promete)', () => {
    const h = everyDay({ open: '09:00', close: '22:00' })
    expect(opensAt(h, at('2026-10-19T15:00:00Z'), TZ)).toBeNull() // 09:00 en punto
    expect(opensAt(h, at('2026-10-20T03:00:00Z'), TZ)).toBeNull() // 21:00
  })
  it('sin horario o con el día apagado, null', () => {
    expect(opensAt(null, at('2026-10-19T14:00:00Z'), TZ)).toBeNull()
    expect(opensAt(hours, at('2026-10-19T14:00:00Z'), TZ)).toBeNull() // el lunes de `hours` no abre
  })
  it('una franja nocturna cuenta por su apertura (22:00) y las de largo cero no cuentan', () => {
    expect(opensAt(everyDay({ open: '22:00', close: '02:00' }), at('2026-10-19T14:00:00Z'), TZ)).toBe('22:00')
    expect(opensAt(everyDay({ open: '10:00', close: '10:00' }), at('2026-10-19T14:00:00Z'), TZ)).toBeNull()
  })
  it('el día y la hora son los del negocio, no los del navegador', () => {
    const h = everyDay({ open: '09:00', close: '14:00' })
    expect(opensAt(h, at('2026-10-19T14:00:00Z'), TZ)).toBe('09:00') // 08:00 en CDMX
    expect(opensAt(h, at('2026-10-19T14:00:00Z'), 'Asia/Tokyo')).toBeNull() // 23:00 en Tokio: ya pasó
  })
  it('una zona inválida no tumba nada: null', () => {
    expect(opensAt(everyDay({ open: '09:00', close: '22:00' }), at('2026-10-19T14:00:00Z'), 'Marte/Olimpo')).toBeNull()
  })
})
