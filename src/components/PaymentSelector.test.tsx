import { h } from 'preact'
import { cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PaymentSelector } from './PaymentSelector'
import { createT } from '../i18n'
import type { CustomerCreditBalance, Product } from '../types'

const VENCE = '2026-12-23T05:00:00Z' // 22-dic en CDMX

const credits: CustomerCreditBalance = {
  customer: { id: 'c1', firstName: 'Ana' },
  purchases: [
    {
      id: 'p1', creditPack: { name: 'Mensual Ilimitado' }, expiresAt: VENCE, status: 'ACTIVE',
      itemBalances: [{ id: 'b1', productId: 'yoga', product: { id: 'yoga', name: 'Yoga', type: 'CLASS' }, originalQuantity: 99999, remainingQuantity: 99999, unlimited: true }],
    },
  ],
}

const yoga = { id: 'yoga', name: 'Yoga', type: 'CLASS', price: 300 } as unknown as Product

const props = (startsAt: string, seats = 1) => ({
  product: yoga, seats, credits, upfrontPolicy: 'at_venue' as const,
  onSelectCredits: vi.fn(), onSelectCash: vi.fn(), onBuyPack: vi.fn(),
  timezone: 'America/Mexico_City', startsAt, t: createT('es'),
})

afterEach(() => cleanup())

describe('D679 · PaymentSelector con un Ilimitado', () => {
  it('horario antes de que venza: ofrece el Ilimitado a su nombre, sin 99999', () => {
    const p = props('2026-12-20T16:00:00Z')
    const { container } = render(<PaymentSelector {...p} />)
    fireEvent.click(screen.getByRole('button', { name: /Mensual Ilimitado/ }))
    expect(p.onSelectCredits).toHaveBeenCalledWith('b1')
    expect(container.textContent).toContain('Ilimitado · vence el 22 de diciembre · a tu nombre')
    expect(container.textContent).not.toMatch(/9999/)
  })

  it('horario DESPUÉS de que venza: no lo ofrece y avisa antes de tocar nada (la fecha vive en la compra, no en el saldo)', () => {
    const { container } = render(<PaymentSelector {...props('2026-12-23T16:00:00Z')} />)
    expect(screen.queryByRole('button', { name: /Mensual Ilimitado/ })).toBeNull()
    expect(screen.getByRole('status').textContent).toContain('Tu Ilimitado vence el 22 de diciembre, antes de este horario.')
    expect(container.textContent).not.toMatch(/9999/)
  })

  it.each([
    ['es', 'Usar mi pase (Mensual Ilimitado)'],
    ['en', 'Use my pass (Mensual Ilimitado)'],
  ] as const)('D687: el botón del pase no habla de créditos (%s)', (locale, texto) => {
    render(<PaymentSelector {...props('2026-12-20T16:00:00Z')} t={createT(locale)} />)
    expect(screen.getByRole('button', { name: /Mensual Ilimitado/ }).textContent).toContain(texto)
    expect(screen.queryByText(/crédito|credit/)).toBeNull()
  })

  it('D687: el paquete normal sigue diciendo «Usar 1 crédito (…)» y «Usar N créditos (…)»', () => {
    const normal: CustomerCreditBalance = { customer: { id: 'c1' }, purchases: [{
      id: 'p5', creditPack: { name: 'Paquete 5' }, expiresAt: VENCE, status: 'ACTIVE',
      itemBalances: [{ id: 'b5', productId: 'yoga', product: { id: 'yoga', name: 'Yoga', type: 'CLASS' }, originalQuantity: 5, remainingQuantity: 5 }],
    }] }
    render(<PaymentSelector {...props('2026-12-20T16:00:00Z')} credits={normal} />)
    expect(screen.getByRole('button', { name: /Paquete 5/ }).textContent).toContain('Usar 1 crédito (Paquete 5)')
    cleanup()
    render(<PaymentSelector {...props('2026-12-20T16:00:00Z', 2)} credits={normal} />)
    expect(screen.getByRole('button', { name: /Paquete 5/ }).textContent).toContain('Usar 2 créditos (Paquete 5)')
  })

  it('2 lugares: no lo ofrece y dice que es personal', () => {
    render(<PaymentSelector {...props('2026-12-20T16:00:00Z', 2)} />)
    expect(screen.queryByRole('button', { name: /Mensual Ilimitado/ })).toBeNull()
    expect(screen.getByRole('status').textContent).toContain('Tu Ilimitado es personal: cubre 1 lugar a tu nombre')
  })
})
