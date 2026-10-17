import { describe, expect, it } from 'vitest'
import { phoneE164 } from './phone'

// Casos copiados de src/data/countries.test.ts de la rama de sellos (avoqado-booking-widget d03dbad).
describe('phoneE164: nunca sale un teléfono sin lada', () => {
  it.each([
    ['52', '5544422262', '+525544422262'],
    ['52', '55 4442-2262', '+525544422262'],
    ['', '5544422262', '+525544422262'], // lada vacía ⇒ México
    ['999', '5544422262', '+525544422262'], // lada que no está en la lista ⇒ México
    ['52', '525544422262', '+525544422262'], // repitió el 52 en el número
    ['52', '5215544422262', '+525544422262'], // celular viejo con 1
    ['1', '5125551234', '+15125551234'], // otro país: no se toca
    ['55', '11987654321', '+5511987654321'],
    ['44', '7911123456', '+447911123456'],
  ])('lada %j + número %j ⇒ %s', (dial, national, esperado) => {
    expect(phoneE164(dial, national)).toBe(esperado)
  })
})
