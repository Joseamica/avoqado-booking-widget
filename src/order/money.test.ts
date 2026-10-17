import { describe, expect, it } from 'vitest'
import { expectedTotalFromQuote, formatMXN, toCents } from './money'

describe('toCents', () => {
  it('redondea al centavo exacto, sin arrastrar el error del punto flotante', () => {
    expect(toCents(0.1)).toBe(10)
    expect(toCents(0.2)).toBe(20)
    expect(toCents(0.1 + 0.2)).toBe(30)
    expect(toCents(1.15)).toBe(115) // 1.15 * 100 = 114.99999999999999
    expect(toCents(12.5)).toBe(1250)
    expect(toCents(206)).toBe(20600)
  })
})

describe('formatMXN', () => {
  it.each([
    [85, 'es', '$85'],
    [85.5, 'es', '$85.50'],
    [1234.5, 'es', '$1,234.50'],
    [0.1 + 0.2, 'es', '$0.30'],
    [85.000000001, 'es', '$85'],
    [85, 'en', '$85'],
    [1234.5, 'en', '$1,234.50'],
  ] as const)('%s en %s ⇒ %s', (pesos, locale, esperado) => {
    expect(formatMXN(pesos, locale)).toBe(esperado)
  })
})

describe('expectedTotalFromQuote', () => {
  it('pesos con dos decimales, como lo pide el servidor', () => {
    expect(expectedTotalFromQuote(206)).toBe('206.00')
    expect(expectedTotalFromQuote(85.5)).toBe('85.50')
    expect(expectedTotalFromQuote(0.1 + 0.2)).toBe('0.30')
    for (const t of [206, 85.5, 0.3, 1234567.89]) expect(expectedTotalFromQuote(t)).toMatch(/^\d{1,7}\.\d{2}$/)
  })
})
