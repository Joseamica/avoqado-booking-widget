import { describe, expect, it } from 'vitest'
import { createT } from '../i18n'
import { cubreLugares, hayIlimitado, saldoRestante, totalDeSesiones, venceEl } from './credits'

const ILIMITADO = { unlimited: true, remainingQuantity: 99999 }

describe('D679 · el Ilimitado es personal: cubre 1 lugar', () => {
  it('Ilimitado cubre 1 lugar y no 2 (su 99,999 no cuenta)', () => {
    expect(cubreLugares(ILIMITADO, 1)).toBe(true)
    expect(cubreLugares(ILIMITADO, 2)).toBe(false)
  })
  it('un paquete normal cubre lo que le alcanza, como hoy', () => {
    expect(cubreLugares({ remainingQuantity: 3 }, 2)).toBe(true)
    expect(cubreLugares({ remainingQuantity: 1 }, 2)).toBe(false)
    expect(cubreLugares({ remainingQuantity: 3 }, 2, 2)).toBe(false) // 2 lugares × 2 créditos por lugar
  })
})

describe('D679 · nunca 99,999 en lo que se enseña', () => {
  it('totalDeSesiones: con un renglón Ilimitado es «ilimitado»; sin él, la suma de siempre', () => {
    expect(totalDeSesiones([{ quantity: 99999, unlimited: true }])).toBe('ilimitado')
    expect(totalDeSesiones([{ quantity: 4 }, { quantity: 99999, unlimited: true }])).toBe('ilimitado')
    expect(totalDeSesiones([{ quantity: 4 }, { quantity: 6 }])).toBe(10)
  })
  it('saldoRestante sólo suma los normales', () => {
    expect(saldoRestante([ILIMITADO, { remainingQuantity: 3 }])).toBe(3)
    expect(saldoRestante([ILIMITADO])).toBe(0)
  })
  it('hayIlimitado mira los saldos de cada compra', () => {
    expect(hayIlimitado([{ itemBalances: [{ unlimited: false }] }, { itemBalances: [ILIMITADO] }])).toBe(true)
    expect(hayIlimitado([{ itemBalances: [] }, { itemBalances: [{}] }])).toBe(false)
  })
  it('venceEl: «Ilimitado · vence el …» con la fecha del negocio, en es y en', () => {
    // 05:00 UTC del 23-dic = 23:00 del 22-dic en CDMX
    expect(venceEl(createT('es'), '2026-12-23T05:00:00Z', 'America/Mexico_City')).toBe('Ilimitado · vence el 22 de diciembre')
    expect(venceEl(createT('en'), '2026-12-23T05:00:00Z', 'America/Mexico_City')).toBe('Unlimited · expires December 22')
    expect(venceEl(createT('es'), null)).toBe('Ilimitado')
  })
})
