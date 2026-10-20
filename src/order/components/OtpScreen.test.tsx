import { h } from 'preact'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/preact'
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
  // Un «una vez» que sobre de una prueba (p. ej. si falla antes de usarlo) no pasa a la siguiente: `clearMocks` no vacía esa cola.
  vi.mocked(requestOrderingOtp).mockReset()
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

  it('Código: título «Escribe tu código» y OtpInput con look tienda (caja de 60px)', async () => {
    show()
    await flush()
    expect(screen.getByRole('heading', { name: 'Escribe tu código' })).toBeTruthy()
    expect(screen.getByText('Te lo mandamos por WhatsApp al +525544422262.')).toBeTruthy()
    expect(screen.getByText('Si no te llega, revisa que el número sea el de tu WhatsApp.')).toBeTruthy()
    const boxes = screen.getAllByRole('textbox') as HTMLInputElement[]
    expect(boxes).toHaveLength(6)
    // El aspecto «tienda» del campo compartido con reservas: cajas de 60 px, claras y con colores fijos.
    for (const b of boxes) expect([b.style.height, b.style.background, b.style.color]).toEqual(['60px', 'rgb(255, 255, 255)', 'rgb(0, 0, 0)'])
    // La ayuda va debajo del reenvío, como en la maqueta.
    expect(resend().compareDocumentPosition(screen.getByText('Si no te llega, revisa que el número sea el de tu WhatsApp.')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('al llegar, con el foco libre, el cursor ya está en la primera caja (con preventScroll) y lleva el borde de acento (el teclado no se promete: iOS no lo abre con un foco asíncrono)', async () => {
    const focus = vi.spyOn(HTMLElement.prototype, 'focus')
    try {
      show()
      await flush()
      const boxes = screen.getAllByRole('textbox') as HTMLInputElement[]
      expect(document.activeElement).toBe(boxes[0])
      expect(focus.mock.calls[focus.mock.contexts.lastIndexOf(boxes[0])][0]).toEqual({ preventScroll: true })
      // El borde de 2 px de acento (spec §5.5) es el de la caja activa; las demás conservan el borde de campo.
      expect(boxes[0].style.border).toBe('2px solid var(--avq-accent, #000)')
      expect(boxes.slice(1).map(b => b.style.border)).toEqual(Array(5).fill(boxes[1].style.border))
      expect(boxes[1].style.border).not.toBe(boxes[0].style.border)
      // Al escribir el primer dígito, el cursor y el borde pasan a la segunda.
      fireEvent.input(boxes[0], { target: { value: '4' } })
      expect(document.activeElement).toBe(boxes[1])
      expect(boxes[1].style.border).toBe('2px solid var(--avq-accent, #000)')
    } finally {
      focus.mockRestore()
    }
  })

  it('al llegar no le quita el foco a nadie: si la persona (o el sitio) ya está en otro elemento, ahí se queda', async () => {
    const elsewhere = document.body.appendChild(document.createElement('input'))
    elsewhere.focus()
    try {
      show()
      await flush()
      expect(document.activeElement).toBe(elsewhere)
    } finally {
      elsewhere.remove()
    }
  })

  it('tras un código equivocado las cajas se vacían y, si el foco se perdió, el cursor vuelve a la primera (sin mover la página); si la persona ya está en otro lado, no', async () => {
    const focus = vi.spyOn(HTMLElement.prototype, 'focus')
    const boxes = () => within(screen.getByRole('group', { name: 'Escribe tu código' })).getAllByRole('textbox') as HTMLInputElement[]
    let fail!: (e: unknown) => void
    vi.mocked(verifyOrderingOtp).mockImplementation(() => new Promise((_, reject) => { fail = reject }))
    const wrong = async (meanwhile: () => void) => {
      fireEvent.input(boxes()[0], { target: { value: '000000' } })
      await flush()
      expect(boxes().every(b => b.disabled)).toBe(true) // verificando
      meanwhile()
      await act(async () => { fail(new ApiError('Código incorrecto.', 400)); await vi.advanceTimersByTimeAsync(0) })
      expect(screen.getByText('Código incorrecto.')).toBeTruthy()
      expect(boxes().map(b => b.value)).toEqual(['', '', '', '', '', ''])
      expect(boxes().some(b => b.disabled)).toBe(false)
    }
    const elsewhere = document.createElement('button')
    try {
      show()
      await flush()
      // La caja que se deshabilita pierde el foco: el navegador lo hace solo (en Android se cierra el teclado). jsdom no (y su blur() no
      // actúa sobre un campo deshabilitado): el foco se pierde a mano, pasándolo a un botón de paso que luego se quita.
      await wrong(() => {
        const stopover = document.body.appendChild(document.createElement('button'))
        stopover.focus()
        stopover.remove()
        expect(document.activeElement).toBe(document.body)
      })
      expect(document.activeElement).toBe(boxes()[0])
      expect(focus.mock.calls[focus.mock.contexts.lastIndexOf(boxes()[0])][0]).toEqual({ preventScroll: true })
      // Mientras se verificaba, la persona se fue a otro elemento: ahí se queda.
      document.body.appendChild(elsewhere)
      await wrong(() => elsewhere.focus())
      expect(document.activeElement).toBe(elsewhere)
    } finally {
      elsewhere.remove()
      focus.mockRestore()
      vi.mocked(verifyOrderingOtp).mockReset() // la verificación que nunca contesta no pasa a las demás pruebas
    }
  })

  it('las cajas forman un grupo con nombre y descripción (el titular y «Te lo mandamos…»): quien llega con un lector de pantalla a la primera caja sabe qué se pide', async () => {
    show()
    await flush()
    const group = screen.getByRole('group', { name: 'Escribe tu código' })
    expect(document.getElementById(group.getAttribute('aria-describedby')!)!.textContent).toBe('Te lo mandamos por WhatsApp al +525544422262.')
    expect(within(group).getAllByRole('textbox')).toHaveLength(6)
    expect(group.contains(document.activeElement)).toBe(true)
  })

  it('si pedir el código falla sin red (no salió nada), «Reenviar código» queda listo al instante; un fallo del servidor conserva la espera', async () => {
    vi.mocked(requestOrderingOtp)
      .mockRejectedValueOnce(new ApiError('Sin conexión', 0, undefined, undefined, true))
      .mockRejectedValueOnce(new ApiError('Algo falló', 500))
    show()
    await flush()
    expect(resend().disabled).toBe(false)
    expect(resend().textContent).toBe('Reenviar código')
    fireEvent.click(resend())
    await flush()
    expect(requestOrderingOtp).toHaveBeenCalledTimes(2)
    // Un fallo del servidor no dice que el código no salió: la espera de 30 s sigue.
    expect(resend().disabled).toBe(true)
    expect(resend().textContent).toBe('Reenviar código en 30 s')
  })

  it('sin red no es un error en rojo: al pedir o al verificar el código sale el aviso ámbar; los demás errores siguen en rojo', async () => {
    const OFFLINE = 'Sin conexión. Revisa tu internet y vuelve a intentar.'
    const offline = () => screen.getByText(OFFLINE).closest('[role=alert]') as HTMLElement
    vi.mocked(requestOrderingOtp).mockRejectedValueOnce(new ApiError('Sin conexión', 0, undefined, undefined, true))
    show()
    await flush()
    expect(offline().className).toBe('avq-o-notice avq-o-notice--warn')
    expect(document.querySelector('.avq-o-issue')).toBeNull()
    // Al verificar, un error que ni siquiera es un ApiError, igual. Es una rama defensiva: api.ts convierte toda falla del fetch en
    // ApiError con network: true (el caso de arriba).
    vi.mocked(verifyOrderingOtp).mockRejectedValueOnce(new TypeError('Failed to fetch'))
    fireEvent.input(screen.getAllByRole('textbox')[0], { target: { value: '123456' } })
    await flush()
    expect(offline().className).toBe('avq-o-notice avq-o-notice--warn')
    // Un código incorrecto sí es un error: rojo.
    vi.mocked(verifyOrderingOtp).mockRejectedValueOnce(new ApiError('Código incorrecto.', 400))
    fireEvent.input(screen.getAllByRole('textbox')[0], { target: { value: '000000' } })
    await flush()
    expect(screen.getByText('Código incorrecto.').className).toBe('avq-o-issue')
    expect(screen.queryByText(OFFLINE)).toBeNull()
  })

  it('en inglés: «Enter your code» y «We sent it by WhatsApp to …»', async () => {
    const s = makeStore(infoOf(), menuOf(), 'en')
    checkoutOf(s).lastBody.value = body
    s.go('otp')
    render(withStore(s, <OtpScreen />))
    await flush()
    expect(screen.getByRole('heading', { name: 'Enter your code' })).toBeTruthy()
    expect(screen.getByText('We sent it by WhatsApp to +525544422262.')).toBeTruthy()
    expect(screen.getByText("Didn't get it? Check that it's your WhatsApp number.")).toBeTruthy()
  })
})
