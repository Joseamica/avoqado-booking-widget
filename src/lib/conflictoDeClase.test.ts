import { describe, expect, it } from 'vitest'
import type { PublicClassSessionSlot } from '../types'
import { decidirConflicto } from './conflictoDeClase'

const clase = (extra: Partial<PublicClassSessionSlot> = {}): PublicClassSessionSlot => ({
  startsAt: '2026-10-08T21:00:00Z', endsAt: '2026-10-08T21:50:00Z', available: true, classSessionId: 's-15',
  productId: 'class-a', productName: 'Lagree', remaining: 8, capacity: 10, enrolled: 2, takenSpotIds: [], ...extra,
})
const base = { actual: clase(), elegidos: ['p1', 'p3'], conMapa: true }

describe('decidirConflicto: qué hacer con un 409 de una clase', () => {
  it('la clase ya no sale al releer ⇒ al horario con «ya no está disponible»', () => {
    expect(decidirConflicto({ ...base, code: 'SPOTS_TAKEN', fresca: null })).toEqual({ a: 'horario', aviso: 'noDisponible' })
  })

  it('SPOTS_TAKEN ⇒ al mapa sin los lugares tomados (los de la relectura y los que dijo el SERVIDOR)', () => {
    const d = decidirConflicto({
      ...base, code: 'SPOTS_TAKEN', details: { takenSpotIds: ['p3'] }, fresca: clase({ takenSpotIds: ['p2'], remaining: 7 }),
    })
    expect(d).toMatchObject({ a: 'mapa', aviso: 'lugarTomado', lugares: ['p1'] })
    expect(d.a === 'mapa' && d.slot.takenSpotIds).toEqual(['p2', 'p3'])
  })

  it('SPOTS_TAKEN y la relectura falla ⇒ con lo que dijo el 409 basta para quitar el lugar', () => {
    const d = decidirConflicto({ ...base, code: 'SPOTS_TAKEN', details: { takenSpotIds: ['p1'] }, fresca: undefined })
    expect(d).toMatchObject({ a: 'mapa', aviso: 'lugarTomado', lugares: ['p3'] })
  })

  it('CLASS_FULL: sin lugares ⇒ al horario; con 1 y dos pedidos ⇒ se queda en el mapa con su número', () => {
    expect(decidirConflicto({ ...base, code: 'CLASS_FULL', details: { available: 0 }, fresca: clase({ remaining: 0, available: false }) }))
      .toEqual({ a: 'horario', aviso: 'seLleno' })
    const d = decidirConflicto({ ...base, code: 'CLASS_FULL', details: { available: 1 }, fresca: clase({ remaining: 1 }) })
    expect(d).toMatchObject({ a: 'mapa', aviso: 'soloQueda', lugares: ['p1', 'p3'] })
    expect(d.a === 'mapa' && d.slot.remaining).toBe(1)
    // Sin relectura, el número del 409.
    expect(decidirConflicto({ ...base, code: 'CLASS_FULL', details: { available: 0 }, fresca: undefined }))
      .toEqual({ a: 'horario', aviso: 'seLleno' })
    expect(decidirConflicto({ ...base, code: 'CLASS_FULL', details: { available: 1 }, fresca: undefined }))
      .toMatchObject({ a: 'mapa', aviso: 'soloQueda' })
  })

  it('sin mapa (1 lugar): con lugares al releer, el aviso genérico; sin lugares, como CLASS_FULL', () => {
    const sinMapa = { ...base, elegidos: [], conMapa: false }
    for (const code of [undefined, 'CLASS_FULL', 'SPOTS_TAKEN']) {
      expect(decidirConflicto({ ...sinMapa, code, fresca: clase({ remaining: 3 }) })).toEqual({ a: 'generico' })
      expect(decidirConflicto({ ...sinMapa, code, fresca: clase({ remaining: 0, available: false }) })).toEqual({ a: 'horario', aviso: 'seLleno' })
    }
  })

  it('SERVIDOR viejo (409 sin código) con mapa: decide con la relectura', () => {
    expect(decidirConflicto({ ...base, fresca: clase({ remaining: 0, available: false }) })).toEqual({ a: 'horario', aviso: 'seLleno' })
    expect(decidirConflicto({ ...base, fresca: clase({ takenSpotIds: ['p3'] }) })).toMatchObject({ a: 'mapa', aviso: 'lugarTomado', lugares: ['p1'] })
    expect(decidirConflicto({ ...base, fresca: clase({ remaining: 1 }) })).toMatchObject({ a: 'mapa', aviso: 'soloQueda', lugares: ['p1', 'p3'] })
    expect(decidirConflicto({ ...base, fresca: clase() })).toEqual({ a: 'generico' })
    // La relectura falló y el 409 no dice nada: el aviso genérico de hoy.
    expect(decidirConflicto({ ...base, fresca: undefined })).toEqual({ a: 'generico' })
  })

  it('una relectura sin `remaining` (SERVIDOR viejo) cuenta como llena sólo si dice que no está disponible', () => {
    expect(decidirConflicto({ ...base, fresca: clase({ remaining: undefined, available: false }) })).toEqual({ a: 'horario', aviso: 'seLleno' })
    expect(decidirConflicto({ ...base, fresca: clase({ remaining: undefined }) })).toEqual({ a: 'generico' })
  })
})
