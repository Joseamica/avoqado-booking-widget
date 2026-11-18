import { describe, expect, it } from 'vitest'
import { precio } from './precio'

describe('precio: un solo formato en las reservas', () => {
  it('entero sin «.00» y con separador de miles', () => {
    expect(precio(3500)).toBe('$3,500')
    expect(precio(5320)).toBe('$5,320')
  })
  it('con centavos los enseña, nunca los redondea', () => {
    expect(precio(99.5)).toBe('$99.50')
    expect(precio(1234.05)).toBe('$1,234.05')
  })
  it('un flotante «casi entero» no saca «.00»', () => {
    expect(precio(0.1 + 0.2 + 2.7)).toBe('$3')
  })
})
