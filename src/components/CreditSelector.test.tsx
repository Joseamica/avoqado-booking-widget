import { h } from 'preact'
import { cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CreditSelector } from './CreditSelector'
import { createT } from '../i18n'
import type { CustomerCreditBalance } from '../types'

const VENCE = '2026-12-23T05:00:00Z' // 22-dic en CDMX

const conIlimitado = (extra: CustomerCreditBalance['purchases'] = []): CustomerCreditBalance => ({
  customer: { id: 'c1', firstName: 'Ana' },
  purchases: [
    {
      id: 'p1', creditPack: { name: 'Mensual Ilimitado' }, expiresAt: VENCE, status: 'ACTIVE',
      itemBalances: [{ id: 'b1', productId: 'yoga', product: { id: 'yoga', name: 'Yoga', type: 'CLASS' }, originalQuantity: 99999, remainingQuantity: 99999, unlimited: true }],
    },
    ...extra,
  ],
})

const props = (seats: number, credits = conIlimitado()) => ({
  credits, productId: 'yoga', seats, onSelect: vi.fn(), onSkip: vi.fn(), onBuyMore: vi.fn(),
  timezone: 'America/Mexico_City', t: createT('es'),
})

afterEach(() => cleanup())

describe('D679 · CreditSelector con un Ilimitado', () => {
  it('sólo un Ilimitado y 2 lugares: encabezado y renglón sin 99999, deshabilitado con «Tu Ilimitado es personal…»', () => {
    const { container } = render(<CreditSelector {...props(2)} />)
    expect(screen.getByRole('status').textContent).toBe('Tu Ilimitado es personal: cubre 1 lugar a tu nombre')
    const fila = screen.getByRole('button', { name: /Mensual Ilimitado/ }) as HTMLButtonElement
    expect(fila.disabled).toBe(true)
    expect(container.textContent).not.toMatch(/9999/)
    expect(container.textContent).not.toContain('Necesitas')
  })

  it('con 1 lugar lo deja elegir: «Ilimitado · vence el 22 de diciembre», sin «quedan 99998»', () => {
    const p = props(1)
    const { container } = render(<CreditSelector {...p} />)
    expect(screen.getByRole('status').textContent).toBe('Ilimitado · vence el 22 de diciembre')
    expect(screen.getByText('Ilimitado · vence el 22 de diciembre · a tu nombre')).toBeTruthy()
    expect(container.textContent).not.toMatch(/9999/)
    fireEvent.click(screen.getByRole('button', { name: /Mensual Ilimitado/ }))
    expect(p.onSelect).toHaveBeenCalledWith('b1', 'yoga')
  })

  it('con un paquete normal al lado, 2 lugares: el normal sí cubre y el Ilimitado queda «Sólo 1 lugar»', () => {
    const normal = {
      id: 'p2', creditPack: { name: 'Paquete 5' }, status: 'ACTIVE',
      itemBalances: [{ id: 'b2', productId: 'yoga', product: { id: 'yoga', name: 'Yoga', type: 'CLASS' }, originalQuantity: 5, remainingQuantity: 3 }],
    }
    const { container } = render(<CreditSelector {...props(2, conIlimitado([normal]))} />)
    expect(screen.getByText(/^Te quedan 3 de 5/)).toBeTruthy()
    expect(screen.getByText('Sólo 1 lugar')).toBeTruthy()
    expect((screen.getByRole('button', { name: /Paquete 5/ }) as HTMLButtonElement).disabled).toBe(false)
    expect(container.textContent).not.toMatch(/9999/)
  })

  it('Codex r1 #2: la clase empieza después de que vence: deshabilitado con su fecha; un normal que sirve va primero', () => {
    const normal = {
      id: 'p2', creditPack: { name: 'Paquete 5' }, status: 'ACTIVE',
      itemBalances: [{ id: 'b2', productId: 'yoga', product: { id: 'yoga', name: 'Yoga', type: 'CLASS' }, originalQuantity: 5, remainingQuantity: 3 }],
    }
    const tarde = '2026-12-24T16:00:00Z'
    render(<CreditSelector {...props(1)} startsAt={tarde} />)
    expect(screen.getByRole('status').textContent).toBe('Tu Ilimitado vence el 22 de diciembre, antes de este horario.')
    expect((screen.getByRole('button', { name: /Mensual Ilimitado/ }) as HTMLButtonElement).disabled).toBe(true)
    cleanup()
    const p = props(1, conIlimitado([normal]))
    render(<CreditSelector {...p} startsAt={tarde} />)
    const botones = screen.getAllByRole('button').filter(b => /Paquete 5|Mensual Ilimitado/.test(b.getAttribute('aria-label') ?? ''))
    expect(botones[0].getAttribute('aria-label')).toContain('Paquete 5')
    fireEvent.click(botones[0])
    expect(p.onSelect).toHaveBeenCalledWith('b2', 'yoga')
  })
})
