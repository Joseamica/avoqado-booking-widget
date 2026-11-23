/**
 * D679 · barrido del Inventario 1 (N21–N24): cada pantalla que enseña paquetes o saldos, con un Ilimitado, no deja «99999»
 * (ni «99998») en el texto. «Mi cuenta» (N23) y «Gestionar reserva» (N25) tienen su barrido en sus propias pruebas.
 */
import { h } from 'preact'
import { cleanup, render } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createT } from '../i18n'
import type { CreditPackPublic, CustomerCreditBalance, Product, PublicVenueInfo } from '../types'
import { CreditSelector } from './CreditSelector'
import { PaymentSelector } from './PaymentSelector'
import { PaymentChoiceInline } from './PaymentChoiceInline'
import { CreditPackBanner } from './CreditPackBanner'
import { CreditPacksModal } from './CreditPacksModal'
import { UnifiedLanding } from './UnifiedLanding'
import { VenueSidebarCard } from './VenueSidebarCard'

const t = createT('es')
const yoga: Product = { id: 'yoga', name: 'Yoga', price: 200, duration: 60, eventCapacity: null, type: 'CLASS', upfrontPolicy: 'at_venue' }
const credits: CustomerCreditBalance = {
  customer: { id: 'c1' },
  purchases: [{
    id: 'p1', creditPack: { name: 'Mensual Ilimitado' }, expiresAt: '2026-12-23T05:00:00Z', status: 'ACTIVE',
    itemBalances: [{ id: 'b1', productId: 'yoga', product: { id: 'yoga', name: 'Yoga', type: 'CLASS' }, originalQuantity: 99999, remainingQuantity: 99999, unlimited: true }],
  }],
}
const pack: CreditPackPublic = {
  id: 'pk1', name: 'Mensual Ilimitado', price: 1500, currency: 'MXN', validityDays: 30,
  items: [{ id: 'i1', productId: 'yoga', product: { id: 'yoga', name: 'Yoga', type: 'CLASS', price: 200 }, quantity: 99999, unlimited: true }],
}
const info = { slug: 'mindform', name: 'Mindform', logo: null, timezone: 'America/Mexico_City', products: [yoga] } as unknown as PublicVenueInfo
const fn = vi.fn()

afterEach(() => cleanup())

const pantallas: [string, () => h.JSX.Element][] = [
  ['selector de crédito, 1 lugar', () => <CreditSelector credits={credits} productId="yoga" seats={1} onSelect={fn} onSkip={fn} t={t} />],
  ['selector de crédito, 2 lugares', () => <CreditSelector credits={credits} productId="yoga" seats={2} onSelect={fn} onSkip={fn} onBuyMore={fn} t={t} />],
  ['cómo pagar, 1 lugar', () => <PaymentSelector product={yoga} seats={1} credits={credits} upfrontPolicy="at_venue" onSelectCredits={fn} onSelectCash={fn} onBuyPack={fn} t={t} />],
  ['cómo pagar, 2 lugares', () => <PaymentSelector product={yoga} seats={2} credits={credits} upfrontPolicy="at_venue" onSelectCredits={fn} onSelectCash={fn} onBuyPack={fn} t={t} />],
  ['cómo pagar en la cita', () => <PaymentChoiceInline products={[yoga]} seats={1} credits={credits} upfrontPolicy="at_venue" selected={null} onChange={fn} locale="es" t={t} />],
  ['banner de paquetes', () => <CreditPackBanner packs={[pack]} onBuy={fn} buyingPackId={null} t={t} />],
  ['ventana de paquetes', () => <CreditPacksModal packs={[pack]} buyingPackId={null} onBuy={fn} onClose={fn} locale="es" t={t} />],
  ['pestaña de paquetes', () => <UnifiedLanding products={[yoga]} creditPacks={[pack]} onPickAppointments={fn} onPickClasses={fn} onBuyPack={fn} buyingPackId={null} initialTab="packs" t={t} />],
  ['tarjeta lateral', () => <VenueSidebarCard info={info} creditPacks={[pack]} onBuyPack={fn} customerInfo={null} t={t} />],
]

describe('D679 · ninguna pantalla enseña 99999 con un Ilimitado', () => {
  it.each(pantallas)('%s', (_, pantalla) => {
    const { container } = render(pantalla())
    expect(container.textContent).not.toMatch(/9999/)
  })

  it('el paquete en venta dice «Ilimitado»', () => {
    for (const [, pantalla] of pantallas.slice(5)) {
      const { container } = render(pantalla())
      expect(container.textContent).toContain('Ilimitado')
      cleanup()
    }
  })

  it('donde se ofrece el Ilimitado (1 lugar) se dice que va a su nombre', () => {
    for (const i of [0, 2, 4]) {
      const { container } = render(pantallas[i][1]())
      expect(container.textContent).toContain('a tu nombre')
      cleanup()
    }
  })

  it('con 2 lugares «cómo pagar» no ofrece el Ilimitado y dice por qué', () => {
    const { container } = render(pantallas[3][1]())
    expect(container.textContent).toContain('Tu Ilimitado es personal: cubre 1 lugar a tu nombre')
    expect(container.textContent).not.toContain('Usar 1 crédito')
  })
})
