import { h } from 'preact'
import { cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CustomerPortal } from './CustomerPortal'
import * as api from '../api/booking'
import * as state from '../state/booking'
import { createT } from '../i18n'
import { borrarSesion, guardarSesion, leerSesion } from '../lib/sesionDeCliente'
import { cuentasNuevasParaPruebas } from '../state/miCuenta'

vi.mock('../api/booking', async importOriginal => {
  const real = await importOriginal<typeof import('../api/booking')>()
  return { ...real, getCustomerPortal: vi.fn(), getCreditPacks: vi.fn(), updateCustomerProfile: vi.fn() }
})

const CLIENTE = { id: 'c1', firstName: 'Ana', lastName: 'Ruiz', email: null, phone: '+525544422262' }
const TEL = { tipo: 'PHONE' as const, valor: '+525544422262', metodo: 'WHATSAPP' as const, probadoEn: 1 }
const yoga = { id: 'yoga', name: 'Yoga', type: 'CLASS', imageUrl: null }
const ILIMITADO = {
  id: 'p1', creditPack: { name: 'Mensual Ilimitado' }, purchasedAt: '2026-11-22T18:00:00Z', expiresAt: '2026-12-23T05:00:00Z',
  status: 'ACTIVE', amountPaid: 1500,
  itemBalances: [{ id: 'b1', productId: 'yoga', product: yoga, originalQuantity: 99999, remainingQuantity: 99998, unlimited: true }],
}
const PAQUETE_ILIMITADO = {
  id: 'pk1', name: 'Mensual Ilimitado', price: 1500, currency: 'MXN', validityDays: 30,
  items: [{ id: 'i1', productId: 'yoga', product: { id: 'yoga', name: 'Yoga', type: 'CLASS', price: 200 }, quantity: 99999, unlimited: true }],
}
const portal = (purchases: unknown[]) => ({
  customer: { ...CLIENTE, loyaltyPoints: 0, totalVisits: 0 }, credits: { purchases }, reservations: { upcoming: [], past: [] },
}) as any

function renderPortal(locale: 'es' | 'en' = 'es') {
  return render(<CustomerPortal venueSlug="testarudo" timezone="America/Mexico_City" t={createT(locale)} onBack={() => {}} onManageBooking={() => {}} />)
}

beforeEach(() => {
  localStorage.clear()
  borrarSesion('testarudo')
  state.bindCustomerSessionToVenue('testarudo')
  state.clearCustomerSession('testarudo')
  state.portalData.value = null
  cuentasNuevasParaPruebas()
  state.portalLoading.value = false
  guardarSesion('testarudo', { token: 'tok-A', customer: CLIENTE, contactos: [TEL], guardadaEn: Date.now() })
  state.entroAqui('testarudo', leerSesion('testarudo')!)
  vi.mocked(api.getCreditPacks).mockResolvedValue([])
})
afterEach(() => cleanup())

describe('D679 · «Mi cuenta» con un Ilimitado', () => {
  it('sólo un Ilimitado: «Ilimitado · vence el 22 de diciembre», sin barra ni 99999', async () => {
    vi.mocked(api.getCustomerPortal).mockResolvedValue(portal([ILIMITADO]))
    vi.mocked(api.getCreditPacks).mockResolvedValue([PAQUETE_ILIMITADO] as any)
    const { container } = renderPortal()
    await screen.findByText('Hola, Ana')
    expect(screen.getByText('Mis Créditos')).toBeTruthy()
    expect(await screen.findByText('Ilimitado · vence el 22 de diciembre')).toBeTruthy()
    expect(screen.queryByText('No tienes créditos disponibles')).toBeNull()
    expect(container.textContent).not.toMatch(/9999/) // tampoco el paquete en venta («99999×»)
    expect(await screen.findByText('Personal: sólo a tu nombre')).toBeTruthy() // D687: el paquete en venta dice que es personal
  })

  it('Codex r1 #3: la cabecera y el renglón dan el vencimiento en la MISMA zona, la del negocio', async () => {
    // 03:00 UTC del 22-dic: en CDMX (la zona de la prueba) es 21-dic; en el negocio (Tokio) ya es 22-dic.
    vi.mocked(api.getCustomerPortal).mockResolvedValue(portal([{ ...ILIMITADO, expiresAt: '2026-12-22T03:00:00Z' }]))
    render(<CustomerPortal venueSlug="testarudo" timezone="Asia/Tokyo" t={createT('es')} onBack={() => {}} onManageBooking={() => {}} />)
    await screen.findByText('Hola, Ana')
    expect(await screen.findByText('Ilimitado · vence el 22 de diciembre')).toBeTruthy()
    expect(screen.getByText('Expira 22/12/2026')).toBeTruthy()
  })

  it('una compra normal sin saldos visibles sigue en «Sin créditos» y nunca dice «Ilimitado»', async () => {
    vi.mocked(api.getCustomerPortal).mockResolvedValue(portal([{ ...ILIMITADO, creditPack: { name: 'Paquete 5' }, itemBalances: [] }]))
    const { container } = renderPortal()
    await screen.findByText('Hola, Ana')
    expect(screen.getByText('No tienes créditos disponibles')).toBeTruthy()
    expect(container.textContent).not.toContain('Ilimitado')
  })

  it.each([
    ['es', 'Tu nombre está ligado a tu Ilimitado. Para corregirlo, pídeselo al estudio.'],
    ['en', 'Your name is tied to your unlimited pass. To correct it, ask the studio.'],
  ] as const)('con un Ilimitado vigente el nombre no se edita en «Mi cuenta» y lo explica (%s)', async (locale, aviso) => {
    vi.mocked(api.getCustomerPortal).mockResolvedValue(portal([ILIMITADO]))
    renderPortal(locale)
    await screen.findByText(locale === 'es' ? 'Hola, Ana' : 'Hello, Ana')
    fireEvent.click(screen.getByRole('button', { name: locale === 'es' ? 'Editar Perfil' : 'Edit Profile' }))
    expect(screen.getByText(aviso)).toBeTruthy()
    expect(screen.getByText('Ana Ruiz')).toBeTruthy()
    expect(screen.queryByPlaceholderText(locale === 'es' ? 'Nombre' : 'First Name')).toBeNull()
  })

  it('sin Ilimitado el nombre se edita como siempre', async () => {
    vi.mocked(api.getCustomerPortal).mockResolvedValue(portal([]))
    renderPortal()
    await screen.findByText('Hola, Ana')
    fireEvent.click(screen.getByRole('button', { name: 'Editar Perfil' }))
    expect(screen.getByPlaceholderText('Nombre')).toBeTruthy()
    expect(screen.queryByText(/ligado a tu Ilimitado/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeTruthy()
  })

  it('D687: con un Ilimitado «Editar Perfil» no tiene nada que guardar: sin «Guardar», y «Cancelar» lo cierra', async () => {
    vi.mocked(api.getCustomerPortal).mockResolvedValue(portal([ILIMITADO]))
    renderPortal()
    await screen.findByText('Hola, Ana')
    fireEvent.click(screen.getByRole('button', { name: 'Editar Perfil' }))
    expect(screen.queryByRole('button', { name: 'Guardar' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByText(/ligado a tu Ilimitado/)).toBeNull()
    expect(api.updateCustomerProfile).not.toHaveBeenCalled()
  })
})
