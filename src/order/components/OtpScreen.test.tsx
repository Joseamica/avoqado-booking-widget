import { h } from 'preact'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return { ...actual, createOrder: vi.fn(), requestOrderingOtp: vi.fn(), verifyOrderingOtp: vi.fn(), getInfo: vi.fn(), getMenu: vi.fn() }
})
import { ApiError, createOrder, requestOrderingOtp, verifyOrderingOtp } from '../api'
import { checkoutOf } from '../checkout'
import { loadSession } from '../session'
import { OtpScreen } from './OtpScreen'
import { infoOf, makeStore, menuOf, withStore } from './testKit'
import type { CreateOrderBody } from '../types'

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  vi.useFakeTimers()
  vi.mocked(requestOrderingOtp).mockResolvedValue(undefined)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0) })

const body: CreateOrderBody = {
  items: [{ productId: 'p1', quantity: 2, modifiers: [] }], paymentMode: 'PAY_AT_PICKUP', expectedTotal: '170.00',
  customer: { name: 'Ana', phone: '+525544422262' },
}
function show() {
  const s = makeStore(infoOf(), menuOf())
  checkoutOf(s).lastBody.value = body
  s.go('otp')
  render(withStore(s, <OtpScreen />))
  return s
}
const resend = () => screen.getByRole('button', { name: /Reenviar código/ }) as HTMLButtonElement

describe('código de WhatsApp', () => {
  it('al entrar pide el código para el teléfono del pedido; «Reenviar» se habilita a los 30 s', async () => {
    const s = show()
    await flush()
    expect(requestOrderingOtp).toHaveBeenCalledTimes(1)
    expect(requestOrderingOtp).toHaveBeenCalledWith(s.slug, '+525544422262')
    expect(resend().disabled).toBe(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(resend().disabled).toBe(false)
    fireEvent.click(resend())
    await flush()
    expect(requestOrderingOtp).toHaveBeenCalledTimes(2)
    expect(resend().disabled).toBe(true)
  })

  it('W9: salir («Cambiar número») y volver antes de 30 s no manda otro código; la cuenta sigue con lo que falta', async () => {
    const s = show()
    await flush()
    expect(requestOrderingOtp).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar número' }))
    expect(s.screen.value).toBe('details')
    cleanup()
    render(withStore(s, <OtpScreen />))
    await flush()
    expect(requestOrderingOtp).toHaveBeenCalledTimes(1)
    expect(resend().textContent).toBe('Reenviar código en 20 s')
    expect(resend().disabled).toBe(true)
    // Pasados los 30 s, volver a entrar sí lo pide (y otra tienda lleva su propia cuenta).
    cleanup()
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000) })
    render(withStore(s, <OtpScreen />))
    await flush()
    expect(requestOrderingOtp).toHaveBeenCalledTimes(2)
    cleanup()
    show()
    await flush()
    expect(requestOrderingOtp).toHaveBeenCalledTimes(3)
  })

  it('M1: tras verificar bien, si un 401 regresa a esta pantalla antes de 30 s, sí se pide un código nuevo', async () => {
    const s = show()
    vi.mocked(verifyOrderingOtp).mockResolvedValue({ token: 'tok-otp', customer: { id: 'c1' } } as any)
    vi.mocked(createOrder).mockRejectedValue(new ApiError('Token inválido', 401, 'CUSTOMER_TOKEN_INVALID'))
    await flush()
    expect(requestOrderingOtp).toHaveBeenCalledTimes(1)
    fireEvent.input(screen.getAllByRole('textbox')[0], { target: { value: '123456' } })
    await flush()
    cleanup()
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    render(withStore(s, <OtpScreen />))
    await flush()
    expect(requestOrderingOtp).toHaveBeenCalledTimes(2)
  })

  it('M1: si el envío del código falla por red, salir y volver lo pide otra vez (sin una cuenta regresiva muda)', async () => {
    vi.mocked(requestOrderingOtp).mockRejectedValueOnce(new ApiError('Sin conexión', 0, undefined, undefined, true))
    const s = show()
    await flush()
    expect(screen.getByText('Sin conexión. Revisa tu internet y vuelve a intentar.')).toBeTruthy()
    cleanup()
    render(withStore(s, <OtpScreen />))
    await flush()
    expect(requestOrderingOtp).toHaveBeenCalledTimes(2)
    expect(screen.queryByText('Sin conexión. Revisa tu internet y vuelve a intentar.')).toBeNull()
  })

  it('al completar el código verifica, guarda la sesión con ESE teléfono y manda el pedido', async () => {
    const s = show()
    vi.mocked(verifyOrderingOtp).mockResolvedValue({ token: 'tok-otp', customer: { id: 'c1' } } as any)
    vi.mocked(createOrder).mockResolvedValue({
      orderId: 'o1', onlineOrderId: 'oo1', trackingToken: 'T'.repeat(32), status: 'PENDING_ACCEPTANCE', orderNumber: '7',
      total: '170.00', acceptDeadlineAt: '', replay: false,
    })
    await flush()
    fireEvent.input(screen.getAllByRole('textbox')[0], { target: { value: '123456' } })
    await flush()
    expect(verifyOrderingOtp).toHaveBeenCalledWith(s.slug, '+525544422262', '123456')
    expect(loadSession(s.slug)).toMatchObject({ token: 'tok-otp', phone: '+525544422262' })
    expect(vi.mocked(createOrder).mock.calls[0][2].token).toBe('tok-otp')
    expect(s.screen.value).toBe('tracking')
  })

  it('un error del servidor se muestra con su message; un 429 en texto plano, con el texto por code', async () => {
    vi.mocked(requestOrderingOtp).mockRejectedValueOnce(new ApiError('HTTP 429', 429, 'RATE_LIMIT_EXCEEDED'))
    show()
    await flush()
    expect(screen.getByText('Demasiados intentos. Espera un minuto.')).toBeTruthy()
    vi.mocked(verifyOrderingOtp).mockRejectedValue(new ApiError('Código incorrecto.', 400))
    fireEvent.input(screen.getAllByRole('textbox')[0], { target: { value: '000000' } })
    await flush()
    expect(screen.getByText('Código incorrecto.')).toBeTruthy()
    expect(createOrder).not.toHaveBeenCalled()
  })

  it('si tras verificar bien el pedido vuelve a pedir código, lo dice claro (no se queda callado en esta pantalla)', async () => {
    const s = show()
    vi.mocked(verifyOrderingOtp).mockResolvedValue({ token: 'tok-otp', customer: { id: 'c1' } } as any)
    vi.mocked(createOrder).mockRejectedValue(new ApiError('Verifica tu teléfono', 401, 'PHONE_VERIFICATION_REQUIRED'))
    await flush()
    fireEvent.input(screen.getAllByRole('textbox')[0], { target: { value: '123456' } })
    await flush()
    expect(s.screen.value).toBe('otp')
    expect(screen.getByText('No pudimos usar tu verificación en este navegador. Revisa tu número o ábrelo fuera del modo privado.')).toBeTruthy()
  })
})
