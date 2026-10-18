import { describe, expect, it } from 'vitest'
import { formatTime, todayRanges, weekdayKey } from './hours'
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
})
