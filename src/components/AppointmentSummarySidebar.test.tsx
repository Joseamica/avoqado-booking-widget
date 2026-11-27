import { h } from 'preact'
import { cleanup, render, screen } from '@testing-library/preact'
import { afterEach, describe, expect, it } from 'vitest'
import { AppointmentSummarySidebar } from './AppointmentSummarySidebar'
import { createT } from '../i18n'
import type { Product } from '../types'

afterEach(cleanup)
const products = [{ id: 's1', name: 'Corte', price: 500, duration: 60 } as Product]
const show = (taxes?: number) =>
  render(<AppointmentSummarySidebar products={products} totalPrice={500} totalDuration={60} showTotals subtotal={500} taxes={taxes} dueToday={0} dueAtVenue={500} t={createT('es')} />)

describe('«Impuestos» en el resumen de reservas (en México el precio ya incluye IVA)', () => {
  it('taxes={0}: no se muestra la fila', () => {
    show(0)
    expect(screen.queryByText('Impuestos')).toBeNull()
    expect(screen.getByText('Total')).toBeTruthy()
  })
  it('sin taxes: tampoco', () => {
    show()
    expect(screen.queryByText('Impuestos')).toBeNull()
  })
  it('con impuestos de verdad sí se muestra y suma al total', () => {
    show(80)
    expect(screen.getByText('Impuestos')).toBeTruthy()
    expect(screen.getByText('$580')).toBeTruthy()
  })
})

describe('Task 13 fix r1 #1: `sinPrecios` (una clase con `showPrices` apagado)', () => {
  it('no enseña precio, «Variable», totales ni «$0»', () => {
    const clase = [{ id: 'c1', name: 'Lagree', price: 325, duration: 50 } as Product]
    const { container } = render(<AppointmentSummarySidebar products={clase} totalPrice={null} totalDuration={50} sinPrecios t={createT('es')} />)
    expect(container.textContent).toContain('Lagree')
    expect(container.textContent).not.toMatch(/\$|Variable|A pagar|Total/)
  })
  it('sin la marca, citas sigue igual', () => {
    show(0)
    expect(screen.getByText('A pagar hoy')).toBeTruthy()
    expect(screen.getAllByText('$500').length).toBeGreaterThan(0)
  })
})
