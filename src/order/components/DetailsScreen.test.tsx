import { h } from 'preact'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return { ...actual, createOrder: vi.fn(), requestOrderingOtp: vi.fn(), verifyOrderingOtp: vi.fn(), getInfo: vi.fn(), getMenu: vi.fn() }
})
import { API_BASE, createOrder } from '../api'
import { saveSession } from '../session'
import { beginAttempt, pendingAttempt } from '../attempt'
import { checkoutOf } from '../checkout'
import { DetailsScreen } from './DetailsScreen'
import { OrderApp } from './OrderApp'
import { infoOf, makeStore, menuOf, withStore } from './testKit'
import type { CartLine } from '../cart'

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  vi.useFakeTimers()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})
const flush = () => act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve() })
/** «Confirmar pedido» ignora los toques de sus primeros 400 ms (el segundo toque de un doble toque en «Continuar»): reloj falso. */
const pastGuard = () => act(() => { vi.advanceTimersByTime(400) })

function show(over: Parameters<typeof infoOf>[0] = {}, before?: (slug: string) => void) {
  const s = makeStore(
    infoOf({ contact: { address: 'Av. Universidad 123, Coyoacán', phone: '55 1234 5678' }, privacyNoticePath: '/venues/v1/privacy-notice', ...over }),
    menuOf(),
  )
  before?.(s.slug)
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
    await pastGuard()
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
    await pastGuard()
    fireEvent.click(confirmBtn())
    await flush()
    expect(s.screen.value).toBe('otp')
    expect(createOrder).not.toHaveBeenCalled()
  })

  it('con un intento pendiente (y el carrito ya editado) «Confirmar pedido» está deshabilitado: sólo se puede «Reintentar» el anterior', () => {
    show({}, slug => {
      saveSession(slug, { token: 'tok', phone: '+525544422262', name: 'Ana', savedAt: Date.now() })
      beginAttempt(slug, {
        items: [{ productId: 'p-viejo', quantity: 1, modifiers: [] }], paymentMode: 'PAY_AT_PICKUP', expectedTotal: '50.00',
        customer: { name: 'Ana', phone: '+525544422262' },
      })
    })
    fill()
    accept()
    expect(confirmBtn().disabled).toBe(true)
    expect(screen.getByText('Tu pedido anterior no se confirmó por la conexión. Reintenta para saber si llegó.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeTruthy()
  })

  it('con la tienda no abierta «Confirmar pedido» está deshabilitado (igual que «Continuar» del carrito)', () => {
    show({ status: 'PAUSED', reason: 'MANUAL_PAUSE' })
    fill()
    accept()
    expect(confirmBtn().disabled).toBe(true)
  })
})

const line = (over: Partial<CartLine> = {}): CartLine =>
  ({ lineId: 'a', productId: 'p1', name: 'Flautas', unitPrice: 85, quantity: 2, note: null, modifiers: [], ...over })
/** «Tus datos» dentro de OrderApp (con la hoja de la tienda), con la sesión verificada y el borrador completo de antes. */
function ready(cart: CartLine[] = [line()], total = 170, locale: 'es' | 'en' = 'es') {
  const s = makeStore(infoOf(), menuOf(), locale)
  saveSession(s.slug, { token: 'tok', phone: '+525544422262', name: 'Ana', savedAt: Date.now() })
  checkoutOf(s).draft.value = { note: '', name: 'Ana López', dial: '52', national: '5544422262', email: '', accepted: true }
  s.cart.value = cart
  s.quote.value = { ok: true, lines: [], subtotal: total, total, minOrderAmount: 0, issues: [] }
  s.go('details')
  return { s, ...render(withStore(s, <OrderApp />)) }
}

describe('«Confirmar pedido» en un pie fijo', () => {
  it('Tus datos: pie fijo con «2 productos, para recoger» y «Confirmar pedido» + total; «Enviando…» mientras va', async () => {
    vi.mocked(createOrder).mockReturnValue(new Promise(() => {}))
    const { container } = ready()
    const foot = confirmBtn().closest('.avq-o-cartfoot') as HTMLElement
    // Pegajoso abajo DENTRO de la tienda (el mismo pie que el del carrito) y último hijo de la pantalla; nunca fijo a la ventana.
    expect(container.firstElementChild!.contains(foot)).toBe(true)
    expect(getComputedStyle(foot).position).toBe('sticky')
    expect(getComputedStyle(foot).bottom).toMatch(/^0(px)?$/)
    expect(foot.parentElement!.lastElementChild).toBe(foot)
    for (const el of Array.from(container.querySelectorAll('*'))) expect(getComputedStyle(el).position).not.toBe('fixed')
    expect(within(foot).getByText('2 productos, para recoger')).toBeTruthy()
    expect(within(foot).getByText('IVA incluido')).toBeTruthy()
    expect(confirmBtn().textContent).toBe('Confirmar pedido $170')
    expect(confirmBtn().classList.contains('avq-o-btn--primary')).toBe(true)
    await pastGuard()
    fireEvent.click(confirmBtn())
    await flush()
    expect(createOrder).toHaveBeenCalledTimes(1)
    expect(confirmBtn().textContent).toBe('Enviando…')
    expect(confirmBtn().disabled).toBe(true)
  })

  it('N es la suma de las cantidades (el número de la barra del carrito), en singular con 1; y en inglés', () => {
    ready([line(), line({ lineId: 'b', productId: 'p2', name: 'Tacos', unitPrice: 30, quantity: 1 })], 200)
    expect(screen.getByText('3 productos, para recoger')).toBeTruthy()
    cleanup()
    ready([line({ quantity: 1 })], 85)
    expect(screen.getByText('1 producto, para recoger')).toBeTruthy()
    cleanup()
    ready([line({ quantity: 1 })], 85, 'en')
    expect(screen.getByText('1 item, for pickup')).toBeTruthy()
    expect(screen.getByText('VAT included')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Place order $85' })).toBeTruthy()
    cleanup()
    ready([line()], 170, 'en')
    expect(screen.getByText('2 items, for pickup')).toBeTruthy()
  })

  it('al aparecer, «Confirmar pedido» ignora los toques de sus primeros 400 ms: no manda nada ni cambia el estado', async () => {
    // El caso de riesgo: sesión verificada y borrador completo. En el carrito, «Continuar» está donde cae «Confirmar pedido»: el
    // segundo toque de un doble toque llega aquí y, sin la guarda, crearía el pedido sin que la persona viera esta pantalla.
    vi.mocked(createOrder).mockReturnValue(new Promise(() => {}))
    const { s } = ready()
    const c = checkoutOf(s)
    expect(confirmBtn().disabled).toBe(false) // se ve igual que siempre: la guarda no cambia el botón
    fireEvent.click(confirmBtn())
    await act(() => { vi.advanceTimersByTime(399) })
    fireEvent.click(confirmBtn())
    await flush()
    expect(createOrder).not.toHaveBeenCalled()
    expect(s.screen.value).toBe('details')
    expect([c.busy.value, c.lastBody.value, c.feedback.value, c.pending.value, pendingAttempt(s.slug)]).toEqual([false, null, null, false, null])
    expect(confirmBtn().textContent).toBe('Confirmar pedido $170')
    await act(() => { vi.advanceTimersByTime(1) })
    fireEvent.click(confirmBtn())
    await flush()
    expect(createOrder).toHaveBeenCalledTimes(1)
    expect(confirmBtn().textContent).toBe('Enviando…')
  })

  it('la guarda mide la hora del TOQUE (timeStamp), no la de atenderlo: un hilo trabado 500 ms no deja pasar el toque encolado', async () => {
    vi.mocked(createOrder).mockReturnValue(new Promise(() => {}))
    const armed = performance.now() // reloj falso: no avanza solo, así que la pantalla se arma en este instante
    const { s } = ready()
    // Justo después de «Continuar» el hilo se traba 500 ms: los toques ya ocurrieron (sellados dentro de la ventana) y se atienden ahora.
    await act(() => { vi.advanceTimersByTime(500) })
    const tap = (timeStamp: number) => {
      const e = new MouseEvent('click', { bubbles: true, cancelable: true })
      Object.defineProperty(e, 'timeStamp', { value: timeStamp })
      fireEvent(confirmBtn(), e)
    }
    tap(armed + 100)
    tap(armed + 399)
    await flush()
    expect(createOrder).not.toHaveBeenCalled()
    expect(s.screen.value).toBe('details')
    // Sin hora del toque (0) se usa la de ahora (500 ms después de armarse): pasa.
    tap(0)
    await flush()
    expect(createOrder).toHaveBeenCalledTimes(1)
  })

  it('un toque sellado ANTES de que la pantalla se armara (diferencia negativa) también se ignora: es de quien la abrió, no de quien la ve', async () => {
    vi.mocked(createOrder).mockReturnValue(new Promise(() => {}))
    await act(() => { vi.advanceTimersByTime(1000) }) // el reloj falso arranca en 0: hace falta un «antes» al que sellar el toque
    const armed = performance.now()
    const { s } = ready()
    await act(() => { vi.advanceTimersByTime(500) }) // al atenderse los toques, la ventana de 400 ms ya pasó
    const tap = (timeStamp: number) => {
      const e = new MouseEvent('click', { bubbles: true, cancelable: true })
      Object.defineProperty(e, 'timeStamp', { value: timeStamp })
      fireEvent(confirmBtn(), e)
    }
    tap(armed - 400) // 800 ms antes de armarse, 50 ms antes, 1 ms antes: ninguno pasa aunque ya hayan pasado más de 400 ms
    tap(armed - 50)
    tap(armed - 1)
    await flush()
    expect(createOrder).not.toHaveBeenCalled()
    expect(s.screen.value).toBe('details')
    // Sin hora del toque se usa la de ahora (500 ms después de armarse): pasa. La guarda no dejó nada trabado.
    tap(0)
    await flush()
    expect(createOrder).toHaveBeenCalledTimes(1)
  })

  it('la fila de la casilla de privacidad mide al menos 44 px (toque mínimo)', () => {
    ready()
    expect(getComputedStyle(screen.getByLabelText('Acepto el aviso de privacidad').closest('label')!).minHeight).toBe('44px')
  })

  it('estado del envío: sin red en ámbar con «Reintentar»; un 5xx en rojo; «revisa tu pedido» en ámbar', async () => {
    const s = show()
    const box = () => within(confirmBtn().closest('.avq-o-cartfoot') as HTMLElement).getByRole('alert')
    const feedback = (message: string, retryable: boolean) => act(() => { checkoutOf(s).feedback.value = { kind: 'error', message, retryable } })
    await feedback('Sin conexión. Revisa tu internet y vuelve a intentar.', true)
    expect(box().className).toBe('avq-o-notice avq-o-notice--warn')
    expect(within(box()).getByRole('button', { name: 'Reintentar' })).toBeTruthy()
    await feedback('Algo falló de nuestro lado. Intenta de nuevo.', true)
    expect(box().className).toBe('avq-o-notice avq-o-notice--error')
    expect(within(box()).getByRole('button', { name: 'Reintentar' })).toBeTruthy()
    // «El precio cambió; revisa tu pedido.» (un intento viejo con otro carrito) tampoco es un fallo: ámbar, sin botón.
    await feedback('El precio cambió; revisa tu pedido.', false)
    expect(box().className).toBe('avq-o-notice avq-o-notice--warn')
    expect(within(box()).queryByRole('button')).toBeNull()
  })

  it('lo que falta y el aviso del envío van en el pie, arriba del botón; «Confirmar» del precio cambiado manda el total nuevo', async () => {
    const s = show()
    saveSession(s.slug, { token: 'tok', phone: '+525544422262', name: 'Ana', savedAt: Date.now() })
    const foot = () => confirmBtn().closest('.avq-o-cartfoot') as HTMLElement
    const above = (el: Element) => !!(el.compareDocumentPosition(confirmBtn()) & Node.DOCUMENT_POSITION_FOLLOWING)
    const missing = (text: string) => expect(above(within(foot()).getByText(text))).toBe(true)
    missing('Escribe tu nombre (de 2 a 80 caracteres).')
    fireEvent.input(screen.getByLabelText('Nombre'), { target: { value: 'Ana López' } })
    missing('Escribe un teléfono válido.')
    fireEvent.input(screen.getByPlaceholderText('10 dígitos'), { target: { value: '55 4442 2262' } })
    missing('Acepta el aviso de privacidad para continuar.')
    fireEvent.input(screen.getByLabelText('Correo (opcional)'), { target: { value: 'ana@' } })
    missing('Revisa tu correo.')
    fireEvent.input(screen.getByLabelText('Correo (opcional)'), { target: { value: '' } })
    accept()
    expect(foot().querySelectorAll('p')).toHaveLength(1) // sólo el resumen: ya no falta nada
    // El precio cambió al mandar: la pregunta (CheckoutStatus) va en el pie, arriba del botón, y su «Confirmar» manda el total nuevo.
    await act(() => {
      s.quote.value = { ok: true, lines: [], subtotal: 190, total: 190, minOrderAmount: 0, issues: [] }
      checkoutOf(s).feedback.value = {
        kind: 'priceChanged', total: 190,
        body: { items: [{ productId: 'p1', quantity: 2, modifiers: [] }], paymentMode: 'PAY_AT_PICKUP', expectedTotal: '190.00', customer: { name: 'Ana López', phone: '+525544422262' } },
      }
    })
    const ask = within(foot()).getByRole('alert')
    expect(ask.textContent).toContain('El precio cambió: el nuevo total es $190. ¿Confirmas?')
    expect(above(ask)).toBe(true)
    expect(confirmBtn().textContent).toBe('Confirmar pedido $190')
    vi.mocked(createOrder).mockReturnValue(new Promise(() => {}))
    fireEvent.click(within(ask).getByRole('button', { name: 'Confirmar' }))
    await flush()
    expect(createOrder).toHaveBeenCalledTimes(1)
    expect(vi.mocked(createOrder).mock.calls[0][1].expectedTotal).toBe('190.00')
  })
})

describe('campos de «Tus datos»', () => {
  it('título «Tus datos» con su ayuda, campos grandes y «WhatsApp» (aspecto tienda) con la ayuda del código; la flecha vuelve al pedido', () => {
    const s = show()
    expect(screen.getByRole('heading', { name: 'Tus datos' })).toBeTruthy()
    expect(screen.getByText('Con tu nombre te entregan el pedido en el mostrador.')).toBeTruthy()
    expect(screen.getByLabelText('Nombre').classList.contains('avq-o-input')).toBe(true)
    expect(screen.getByLabelText('Correo (opcional)').classList.contains('avq-o-input')).toBe(true)
    // «WhatsApp» es la etiqueta REAL del número (<label for>), no un grupo con nombre.
    const number = screen.getByLabelText('WhatsApp') as HTMLInputElement
    expect(number.getAttribute('type')).toBe('tel')
    const phone = number.closest('.avq-o-field') as HTMLElement
    expect(within(phone).getByText('Aquí te mandamos un código para confirmar tu pedido.')).toBeTruthy()
    // El campo compartido con reservas, en su aspecto «tienda» (sólo aquí): 52 px de alto, con la lada como segmento.
    expect((number.parentElement as HTMLElement).style.height).toBe('52px')
    expect(within(phone).getByRole('button', { name: /\+52/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Volver al pedido' }))
    expect(s.screen.value).toBe('cart')
  })
  it('«WhatsApp» es una etiqueta real (<label for>) del número: tocarla llega al campo y el navegador lo enfoca; nombra al campo, ya no a un grupo', () => {
    show()
    const label = screen.getByText('WhatsApp', { selector: 'label' }) as HTMLLabelElement
    const number = screen.getByPlaceholderText('10 dígitos') as HTMLInputElement
    expect(number.id).not.toBe('')
    expect(label.htmlFor).toBe(number.id)
    expect(label.control).toBe(number)
    expect(screen.queryByRole('group', { name: 'WhatsApp' })).toBeNull()
    // jsdom reenvía el clic de la etiqueta al campo; MOVER el foco ahí es la acción por omisión del navegador (se comprueba en la corrida real).
    const clicks = vi.fn()
    number.addEventListener('click', clicks)
    fireEvent.click(label)
    expect(clicks).toHaveBeenCalledTimes(1)
  })
})
