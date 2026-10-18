import { h } from 'preact'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return { ...actual, createOrder: vi.fn(), requestOrderingOtp: vi.fn(), verifyOrderingOtp: vi.fn(), getInfo: vi.fn(), getMenu: vi.fn() }
})
import { API_BASE, createOrder } from '../api'
import { saveSession } from '../session'
import { DetailsScreen } from './DetailsScreen'
import { infoOf, makeStore, menuOf, withStore } from './testKit'

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
})
afterEach(cleanup)
const flush = () => act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve() })

function show() {
  const s = makeStore(
    infoOf({ contact: { address: 'Av. Universidad 123, Coyoacán', phone: '55 1234 5678' }, privacyNoticePath: '/venues/v1/privacy-notice' }),
    menuOf(),
  )
  s.cart.value = [{ lineId: 'a', productId: 'p1', name: 'Flautas', unitPrice: 85, quantity: 2, note: null, modifiers: [] }]
  s.quote.value = { ok: true, lines: [], subtotal: 170, total: 170, minOrderAmount: 0, issues: [] }
  s.go('details')
  render(withStore(s, <DetailsScreen />))
  return s
}
function fill(name = 'Ana López', phone = '55 4442 2262') {
  fireEvent.input(screen.getByLabelText('Nombre'), { target: { value: name } })
  fireEvent.input(screen.getByPlaceholderText('10 dígitos'), { target: { value: phone } })
}
const accept = () => fireEvent.click(screen.getByLabelText('Acepto el aviso de privacidad'))
const confirmBtn = () => screen.getByRole('button', { name: /Confirmar pedido|Enviando…/ }) as HTMLButtonElement

describe('tus datos y aviso de privacidad', () => {
  it('el aviso simplificado nombra al restaurante, va antes de la casilla y liga al aviso integral', () => {
    show()
    const notice = screen.getByText(
      'Flautas usará tu nombre y teléfono para preparar tu pedido, verificar tu número por WhatsApp, avisarte cómo va y contactarte sobre este pedido. Avoqado procesa estos datos por cuenta del restaurante.',
    )
    const link = screen.getByRole('link', { name: 'Aviso de privacidad' }) as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe(API_BASE + '/venues/v1/privacy-notice')
    const box = screen.getByLabelText('Acepto el aviso de privacidad')
    expect(notice.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText('Av. Universidad 123, Coyoacán')).toBeTruthy()
    expect(screen.getByText('55 1234 5678')).toBeTruthy()
    expect(screen.getByText('Puedes cancelar mientras el restaurante no acepte tu pedido; después, llama al restaurante.')).toBeTruthy()
    expect(screen.getByText('Te avisaremos en la página de tu pedido (y por correo si lo diste).')).toBeTruthy()
  })

  it('sin la casilla no se continúa', async () => {
    const s = show()
    saveSession(s.slug, { token: 't', phone: '+525544422262', name: null, savedAt: Date.now() })
    fill()
    expect(confirmBtn().disabled).toBe(true)
    fireEvent.click(confirmBtn())
    await flush()
    expect(createOrder).not.toHaveBeenCalled()
    accept()
    expect(confirmBtn().disabled).toBe(false)
  })

  it('nombre de menos de 2 letras o teléfono incompleto ⇒ no se continúa', () => {
    show()
    fill('A')
    accept()
    expect(confirmBtn().disabled).toBe(true)
    fill('Ana', '55 4442')
    expect(confirmBtn().disabled).toBe(true)
  })

  it('doble clic en «Confirmar pedido» ⇒ una sola llamada, con «Enviando…»; el teléfono va armado con phoneE164 (lada 52)', async () => {
    const s = show()
    saveSession(s.slug, { token: 'tok', phone: '+525544422262', name: 'Ana', savedAt: Date.now() })
    vi.mocked(createOrder).mockReturnValue(new Promise(() => {}))
    fill('Ana López', '525544422262')
    accept()
    fireEvent.click(confirmBtn())
    fireEvent.click(confirmBtn())
    await flush()
    expect(createOrder).toHaveBeenCalledTimes(1)
    expect(vi.mocked(createOrder).mock.calls[0][1].customer).toEqual({ name: 'Ana López', phone: '+525544422262' })
    expect(confirmBtn().textContent).toBe('Enviando…')
    expect(confirmBtn().disabled).toBe(true)
  })

  it('sin sesión para ese teléfono ⇒ pasa a la pantalla del código sin mandar el pedido', async () => {
    const s = show()
    fill()
    accept()
    fireEvent.click(confirmBtn())
    await flush()
    expect(s.screen.value).toBe('otp')
    expect(createOrder).not.toHaveBeenCalled()
  })
})
