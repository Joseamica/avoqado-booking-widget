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
