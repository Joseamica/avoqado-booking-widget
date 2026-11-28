import { h } from 'preact'
import { cleanup, render } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createT } from '../i18n'
import type { CreditPackPublic } from '../types'
import { CreditPacksModal } from './CreditPacksModal'

// hz:d46b99a0:D6 — «Comprar créditos» en el celular: la página de atrás no se mueve y «1 día» va en singular.
const t = createT('es')
const fn = vi.fn()
const pack = (id: string, validityDays: number | null): CreditPackPublic => ({
  id, name: `Paquete ${id}`, price: 300, currency: 'MXN', validityDays,
  items: [{ id: `i${id}`, productId: 'y', product: { id: 'y', name: 'Yoga', type: 'CLASS', price: 300 }, quantity: 1, unlimited: false }],
} as CreditPackPublic)

afterEach(() => cleanup())

describe('Comprar créditos en el celular', () => {
  it('mientras está abierta, la página de atrás no se desliza; al cerrar vuelve como estaba', () => {
    document.documentElement.style.overflow = 'auto'
    const { unmount } = render(<CreditPacksModal packs={[pack('a', 30)]} buyingPackId={null} onBuy={fn} onClose={fn} locale="es" t={t} />)
    expect(document.documentElement.style.overflow).toBe('hidden')
    unmount()
    expect(document.documentElement.style.overflow).toBe('auto')
  })

  it('la altura usa lo que sí se ve (dvh), no la pantalla con las barras', () => {
    const { container } = render(<CreditPacksModal packs={[pack('a', 30)]} buyingPackId={null} onBuy={fn} onClose={fn} locale="es" t={t} />)
    expect(container.querySelector('style')?.textContent).toContain('92dvh')
    expect((container.querySelector('.avq-credit-packs-modal') as HTMLElement).style.maxHeight).toBe('')
  })

  it('«Válido por 1 día» en singular y «30 días» en plural', () => {
    const { container } = render(<CreditPacksModal packs={[pack('a', 1), pack('b', 30)]} buyingPackId={null} onBuy={fn} onClose={fn} locale="es" t={t} />)
    expect(container.textContent).toContain('Válido por 1 día')
    expect(container.textContent).not.toContain('1 días')
    expect(container.textContent).toContain('Válido por 30 días')
  })

  it('el aviso de paquetes también dice «1 día»', () => {
    expect(t('creditPacks.validityOne')).toBe('Válido por 1 día')
    expect(createT('en')('portal.packValidityOne')).toBe('Valid for 1 day')
  })
})
