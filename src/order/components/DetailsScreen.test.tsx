import { h } from 'preact'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return { ...actual, createOrder: vi.fn(), requestOrderingOtp: vi.fn(), verifyOrderingOtp: vi.fn(), getInfo: vi.fn(), getMenu: vi.fn(), quote: vi.fn() }
})
// D661: entrar a la cuenta desde la tienda («Pagar ahora» sin sesión) pide y verifica el código con la API de reservas.
vi.mock('../../api/booking', async () => {
  const actual = await vi.importActual<typeof import('../../api/booking')>('../../api/booking')
  return { ...actual, requestOtp: vi.fn(), verifyOtp: vi.fn() }
})
import * as bookingApi from '../../api/booking'
import { API_BASE, ApiError, createOrder, getInfo, quote } from '../api'
import { loadSession, saveSession } from '../session'
import { fijarPagina, guardarSesion } from '../../lib/sesionDeCliente'
import { clearCustomerSession } from '../../state/booking'
import { autorizarIntento, beginAttempt, pendingAttempt, reautorizarIntento } from '../attempt'
import { checkoutOf, entroEnLaTienda } from '../checkout'
import { createOrderStore } from '../store'
import { DetailsScreen } from './DetailsScreen'
import { OrderApp } from './OrderApp'
import { infoOf, makeStore, menuOf, withStore } from './testKit'
import type { CartLine } from '../cart'
import type { ContactoProbado } from '../../lib/sesionDeCliente'

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
      'Flautas usará tu nombre y teléfono para preparar tu pedido, verificar tu número por WhatsApp, avisarte cómo va y contactarte sobre este pedido. Avoqado procesa estos datos por cuenta del negocio.',
    )
    const link = screen.getByRole('link', { name: 'Aviso de privacidad' }) as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe(API_BASE + '/venues/v1/privacy-notice')
    const box = screen.getByLabelText('Acepto el aviso de privacidad')
    expect(notice.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText('Av. Universidad 123, Coyoacán')).toBeTruthy()
    expect(screen.getByText('55 1234 5678')).toBeTruthy()
    expect(screen.getByText('Puedes cancelar mientras el negocio no acepte tu pedido; después, llama al negocio.')).toBeTruthy()
    expect(screen.getByText('Te avisaremos en la página de tu pedido (y por correo si lo diste).')).toBeTruthy()
  })

  it('sin la casilla no se continúa', async () => {
    const s = show()
    saveSession(s.slug, { token: 't', phone: '+525544422262', name: null, savedAt: Date.now() })
    fijarPagina(s.slug, 'pedidos', loadSession(s.slug)) // alcance A: la página abierta ya tenía esta sesión
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
    fijarPagina(s.slug, 'pedidos', loadSession(s.slug)) // alcance A: la página abierta ya tenía esta sesión
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

  it('D661 ronda 5 (2): «Cerrar sesión» en reservas, en esta misma página, también suelta el intento de la tienda: el aviso se va y «Confirmar pedido» vuelve', () => {
    const s = show({}, slug => {
      saveSession(slug, { token: 'tok', phone: '+525544422262', name: 'Ana', savedAt: Date.now() })
      beginAttempt(slug, {
        items: [{ productId: 'p-viejo', quantity: 1, modifiers: [] }], paymentMode: 'PAY_AT_PICKUP', expectedTotal: '50.00',
        customer: { name: 'Ana', phone: '+525544422262' },
      }, 'tok')
    })
    fill()
    accept()
    expect(confirmBtn().disabled).toBe(true)
    act(() => clearCustomerSession(s.slug)) // el «Cerrar sesión» del widget de reservas
    expect(pendingAttempt(s.slug)).toBeNull()
    expect(screen.queryByText('Tu pedido anterior no se confirmó por la conexión. Reintenta para saber si llegó.')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reintentar' })).toBeNull()
    expect(confirmBtn().disabled).toBe(false)
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
  fijarPagina(s.slug, 'pedidos', loadSession(s.slug)) // alcance A: la página abierta ya tenía esta sesión
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
    fijarPagina(s.slug, 'pedidos', loadSession(s.slug)) // alcance A: la página abierta ya tenía esta sesión
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

describe('fase 2: cómo pagar', () => {
  const radios = () => screen.queryAllByRole('radio') as HTMLInputElement[]
  const foot = () => document.querySelector('.avq-o-foot') as HTMLElement

  it('con tarjeta y al recoger: dos opciones, «Pagar ahora con tarjeta» primero y elegida; el pie dice cómo se paga', () => {
    show({ paymentModes: { payAtPickup: true, cardOnline: true } })
    const group = screen.getByRole('radiogroup', { name: '¿Cómo quieres pagar?' })
    const [card, pickup] = within(group).getAllByRole('radio') as HTMLInputElement[]
    expect(within(group).getAllByRole('radio')).toHaveLength(2)
    expect(card.closest('label')!.textContent).toBe('Pagar ahora con tarjeta')
    expect(pickup.closest('label')!.textContent).toBe('Pagar al recoger')
    expect([card.checked, pickup.checked]).toEqual([true, false])
    expect(within(foot()).getByText('Pagas ahora con tarjeta.')).toBeTruthy()
    expect(within(foot()).queryByText('Pagas al recoger en el negocio.')).toBeNull()
    // Con tarjeta no se manda código: la ayuda del código no aplica.
    expect(screen.queryByText('Aquí te mandamos un código para confirmar tu pedido.')).toBeNull()
    fireEvent.click(pickup)
    expect([card.checked, pickup.checked]).toEqual([false, true])
    expect(within(foot()).getByText('Pagas al recoger en el negocio.')).toBeTruthy()
    expect(screen.getByText('Aquí te mandamos un código para confirmar tu pedido.')).toBeTruthy()
  })

  it('sólo tarjeta: sin selector, y el pie dice que se paga con tarjeta', () => {
    show({ paymentModes: { payAtPickup: false, cardOnline: true } })
    expect(screen.queryByRole('radiogroup')).toBeNull()
    expect(radios()).toHaveLength(0)
    expect(within(foot()).getByText('Pagas ahora con tarjeta.')).toBeTruthy()
  })

  it('sin tarjeta (o un servidor viejo sin `cardOnline`): como hoy, sin selector y «Pagas al recoger»', () => {
    for (const paymentModes of [{ payAtPickup: true, cardOnline: false }, { payAtPickup: true }]) {
      show({ paymentModes })
      expect(screen.queryByRole('radiogroup')).toBeNull()
      expect(within(foot()).getByText('Pagas al recoger en el negocio.')).toBeTruthy()
      cleanup()
    }
  })

  it('con tarjeta NO pide el código por WhatsApp: manda el pedido con CARD_ONLINE sin sesión', async () => {
    const s = show({ paymentModes: { payAtPickup: true, cardOnline: true } })
    vi.mocked(createOrder).mockReturnValue(new Promise(() => {}))
    fill()
    accept()
    await pastGuard()
    fireEvent.click(confirmBtn())
    await flush()
    expect(s.screen.value).toBe('details')
    expect(createOrder).toHaveBeenCalledTimes(1)
    const [, body, opts] = vi.mocked(createOrder).mock.calls[0]
    expect(body.paymentMode).toBe('CARD_ONLINE')
    expect(body.customer).toEqual({ name: 'Ana López', phone: '+525544422262' })
    expect(opts.token).toBeUndefined()
  })

  it('eligiendo «Pagar al recoger» sigue pidiendo el código como hoy', async () => {
    const s = show({ paymentModes: { payAtPickup: true, cardOnline: true } })
    fill()
    accept()
    fireEvent.click(screen.getByRole('radio', { name: 'Pagar al recoger' }))
    await pastGuard()
    fireEvent.click(confirmBtn())
    await flush()
    expect(s.screen.value).toBe('otp')
    expect(createOrder).not.toHaveBeenCalled()
  })

  it('en inglés', () => {
    const s = makeStore(infoOf({ paymentModes: { payAtPickup: true, cardOnline: true } }), menuOf(), 'en')
    s.quote.value = { ok: true, lines: [], subtotal: 170, total: 170, minOrderAmount: 0, issues: [] }
    render(withStore(s, <DetailsScreen />))
    expect(screen.getByRole('radiogroup', { name: 'How do you want to pay?' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Pay now by card' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Pay at pickup' })).toBeTruthy()
    expect(screen.getByText('You pay now by card.')).toBeTruthy()
  })
})

describe('«Nadie»: Tus datos (tienda híbrida, etapa 1)', () => {
  const nadie = (over: Parameters<typeof infoOf>[0] = {}) => show({ requiresAcceptance: false, ...over })
  const pedir = () => screen.getByRole('button', { name: /^Pedir/ }) as HTMLButtonElement

  it('sólo pide nombre y nota, con «Al pedir aceptas el aviso de privacidad de <negocio>» y sin casilla, WhatsApp ni correo', () => {
    nadie()
    expect(screen.getByText('Con tu nombre te encuentran en caja y te entregan tu pedido.')).toBeTruthy()
    expect(screen.getByLabelText('Nombre')).toBeTruthy()
    expect(screen.getByLabelText('Nota para el negocio (opcional)')).toBeTruthy()
    expect(screen.getByText('Al pedir aceptas el aviso de privacidad de Flautas.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Aviso de privacidad' })).toBeTruthy()
    expect(screen.queryByLabelText('WhatsApp')).toBeNull()
    expect(screen.queryByLabelText('Correo (opcional)')).toBeNull()
    expect(screen.queryByRole('checkbox')).toBeNull()
    // Sin tarjeta en línea no hay medio de pago que elegir (con ella, D661: «Pagar ahora con tarjeta» o «Pagar en caja», abajo).
    expect(screen.queryByRole('radiogroup')).toBeNull()
    expect(screen.getByText('Pagas en caja: tarjeta o efectivo.')).toBeTruthy()
    expect(pedir().textContent).toContain('$170')
  })

  it('sin nombre dice «Escribe tu nombre (de 2 a 80 caracteres).» y no deja pedir', () => {
    nadie()
    expect(screen.getByText('Escribe tu nombre (de 2 a 80 caracteres).')).toBeTruthy()
    expect(pedir().disabled).toBe(true)
  })

  it('manda el pedido sin teléfono ni token y sin pasar por el código', async () => {
    const s = nadie()
    vi.mocked(createOrder).mockReturnValue(new Promise(() => {}))
    fireEvent.input(screen.getByLabelText('Nombre'), { target: { value: ' Ana ' } })
    fireEvent.input(screen.getByLabelText('Nota para el negocio (opcional)'), { target: { value: 'sin azúcar' } })
    await pastGuard()
    fireEvent.click(pedir())
    await flush()
    expect(s.screen.value).toBe('details')
    expect(createOrder).toHaveBeenCalledTimes(1)
    const [, body, opts] = vi.mocked(createOrder).mock.calls[0]
    expect(body.paymentMode).toBe('PAY_AT_PICKUP')
    expect(body.customer).toEqual({ name: 'Ana' })
    expect(body.note).toBe('sin azúcar')
    expect(opts.token).toBeUndefined()
  })

  it('«Mi equipo» (requiresAcceptance true o un servidor viejo) sigue pidiendo WhatsApp y la casilla', () => {
    show({ requiresAcceptance: true })
    expect(screen.getByLabelText('WhatsApp')).toBeTruthy()
    expect(screen.getByLabelText('Acepto el aviso de privacidad')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Confirmar pedido/ })).toBeTruthy()
  })

  it('en inglés', () => {
    const s = makeStore(infoOf({ requiresAcceptance: false }), menuOf(), 'en')
    s.quote.value = { ok: true, lines: [], subtotal: 170, total: 170, minOrderAmount: 0, issues: [] }
    render(withStore(s, <DetailsScreen />))
    expect(screen.getByLabelText('Note for the business (optional)')).toBeTruthy()
    expect(screen.getByText('You pay at the counter: card or cash.')).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Order/ })).toBeTruthy()
  })
})

describe('R82 #6: aviso de cierre cercano también en «Tus datos»', () => {
  const inMin = (m: number) => new Date(Date.now() + m * 60_000).toISOString()
  it('«Nadie» y cierra en menos de 30 min: «Cerramos a las HH:MM» y su frase', () => {
    show({ requiresAcceptance: false, closesAt: inMin(20) })
    expect(screen.getByText(/^Cerramos a las \d{1,2}:\d{2}$/)).toBeTruthy()
    expect(screen.getByText('Si no pasas a pagar antes, tu pedido se cancela.')).toBeTruthy()
  })
  it('a 30 min o más, o en «Mi equipo», no sale', () => {
    show({ requiresAcceptance: false, closesAt: inMin(31) })
    expect(screen.queryByText(/^Cerramos a las/)).toBeNull()
    cleanup()
    show({ requiresAcceptance: true, closesAt: inMin(20) })
    expect(screen.queryByText(/^Cerramos a las/)).toBeNull()
  })
})

describe('W3: el precio cambió por un beneficio (1h·3) o porque se cerró la sesión (1h·4)', () => {
  const cuerpo = { items: [], paymentMode: 'PAY_AT_PICKUP' as const, expectedTotal: '170.00', customer: { name: 'Ana' } }

  it('1h·3: «Tu café gratis ya se usó en otro pedido», el total nuevo, «Confirmar $170» y «Volver a mi pedido»', async () => {
    const s = show({ requiresAcceptance: false })
    await act(async () => { checkoutOf(s).feedback.value = { kind: 'priceChanged', total: 170, body: cuerpo, motivo: 'PREMIO', premio: 'Café gratis' } })
    expect(screen.getByText('Tu café gratis ya se usó en otro pedido')).toBeTruthy()
    expect(screen.getByText('El nuevo total es $170. ¿Confirmas?')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Confirmar $170' })).toBeTruthy()
    // pulido W4 (mockup 1h·3): sólo «Confirmar» y «Volver a mi pedido»; el «Pedir» del pie no compite con el mismo monto.
    expect(screen.queryByRole('button', { name: 'Pedir $170' })).toBeNull()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Volver a mi pedido' })) })
    expect(s.screen.value).toBe('cart')
  })

  it('1h·4: «Tu sesión se cerró», «Entrar otra vez» primero y «Pedir sin beneficios · $170»', async () => {
    vi.mocked(createOrder).mockResolvedValue(new Promise(() => {}) as any)
    const s = show({ requiresAcceptance: false })
    await act(async () => { checkoutOf(s).feedback.value = { kind: 'priceChanged', total: 170, body: cuerpo, motivo: 'SIN_SESION' } })
    expect(screen.getByText('Tu sesión se cerró')).toBeTruthy()
    expect(screen.getByText('Entra otra vez para usar tus beneficios, o confirma el precio sin ellos.')).toBeTruthy()
    const [entrar, sin] = [screen.getByRole('button', { name: 'Entrar otra vez' }), screen.getByRole('button', { name: 'Pedir sin beneficios · $170' })]
    expect(entrar.compareDocumentPosition(sin) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Pedir $170' })).toBeNull() // pulido W4: tampoco aquí (1h·4)
    await act(async () => { fireEvent.click(sin) })
    expect(vi.mocked(createOrder).mock.calls[0][1]).toEqual(cuerpo)
  })

  it('1h·4 «Entrar otra vez» abre la pantalla de entrar de la tienda', async () => {
    const s = show({ requiresAcceptance: false })
    await act(async () => { checkoutOf(s).feedback.value = { kind: 'priceChanged', total: 170, body: cuerpo, motivo: 'SIN_SESION' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Entrar otra vez' })) })
    expect(s.screen.value).toBe('entrar')
  })
})

describe('pulido W5: el aviso del pedido pendiente dice la causa real', () => {
  const cuerpo = { items: [], paymentMode: 'PAY_AT_PICKUP' as const, expectedTotal: '170.00', customer: { name: 'Ana' } }

  it('su sesión recibió 401 y espera entrar: «Tu sesión se cerró · Entra otra vez para terminar tu pedido», nunca «por la conexión»', async () => {
    const s = show({ requiresAcceptance: false }, slug => {
      beginAttempt(slug, cuerpo, 'tok-A')
      autorizarIntento(slug, { requiereEntrar: true }) // lo que hace checkout.ts con el 401
    })
    await flush()
    expect(screen.getByText('Tu sesión se cerró')).toBeTruthy()
    expect(screen.getByText('Entra otra vez para terminar tu pedido.')).toBeTruthy()
    expect(screen.queryByText(/por la conexión/)).toBeNull()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Entrar otra vez' })) })
    expect(s.screen.value).toBe('entrar')
  })

  it('ya entró otra vez: dice que fue la sesión y deja «Reintentar» (el mismo intento)', async () => {
    show({ requiresAcceptance: false }, slug => {
      beginAttempt(slug, cuerpo, 'tok-A')
      autorizarIntento(slug, { requiereEntrar: true })
      reautorizarIntento(slug, 'tok-B') // lo que hace entrar otra vez
    })
    await flush()
    expect(screen.getByText('Se cerró tu sesión antes de confirmar tu pedido anterior. Ya entraste: reintenta para terminarlo.')).toBeTruthy()
    expect(screen.queryByText(/por la conexión/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeTruthy()
  })

  it('sin red (sin 401): el aviso de siempre, «por la conexión»', async () => {
    show({ requiresAcceptance: false }, slug => { beginAttempt(slug, cuerpo, null) })
    await flush()
    expect(screen.getByText('Tu pedido anterior no se confirmó por la conexión. Reintenta para saber si llegó.')).toBeTruthy()
  })
})

describe('W2 (c), regla de parada: el nombre sólo es el que ella teclea', () => {
  // El nombre de la ficha vuelve cuando el SERVIDOR lo mande en la sesión (conductor, 11-nov).
  const ana = (slug: string) => {
    guardarSesion(slug, {
      token: 'tok-A', customer: { id: 'c1', firstName: 'Ana', lastName: 'López', email: null, phone: '+525512345678' },
      contactos: [{ tipo: 'PHONE', valor: '+525512345678', metodo: 'WHATSAPP', probadoEn: 1 }], guardadaEn: Date.now(),
    })
    fijarPagina(slug, 'pedidos', loadSession(slug)) // la página abierta ya tenía esta sesión
  }
  const nombre = () => screen.getByLabelText('Nombre') as HTMLInputElement
  const pedirBtn = () => screen.getByRole('button', { name: /^Pedir/ }) as HTMLButtonElement
  const conAna = (slug?: string) => {
    const s = slug ? createOrderStore(slug, { locale: 'es' }) : makeStore(infoOf({ requiresAcceptance: false }), menuOf())
    s.info.value = infoOf({ requiresAcceptance: false })
    s.menu.value = menuOf()
    ana(s.slug)
    s.cart.value = [{ lineId: 'a', productId: 'p1', name: 'Flautas', unitPrice: 85, quantity: 1, note: null, modifiers: [] }]
    s.quote.value = { ok: true, lines: [], subtotal: 85, total: 85, minOrderAmount: 0, issues: [] }
    s.go('details')
    vi.mocked(createOrder).mockReset()
    vi.mocked(createOrder).mockReturnValue(new Promise(() => {}))
    render(withStore(s, <DetailsScreen />))
    return s
  }

  it('con sesión el campo nace vacío: no se ve ni se manda un nombre que ella no tecleó', async () => {
    conAna()
    await flush()
    expect(nombre().value).toBe('')
    expect(screen.getByText('Escribe tu nombre (de 2 a 80 caracteres).')).toBeTruthy()
    await pastGuard()
    fireEvent.click(pedirBtn())
    await flush()
    expect(createOrder).not.toHaveBeenCalled()
  })

  it('«Pedir» manda el nombre tecleado, aunque en otra tienda del negocio entre otra persona', async () => {
    const slug = `dos${Date.now()}`
    conAna(slug)
    await flush()
    const otra = createOrderStore(slug, { locale: 'es' })
    const r = { token: 'tok-B', customer: { id: 'c2', firstName: 'Beatriz', lastName: null, email: null, phone: '+525599998888' },
      contactos: [{ tipo: 'PHONE' as const, valor: '+525599998888', metodo: 'WHATSAPP' as const, probadoEn: 2 }] }
    guardarSesion(slug, { ...r, guardadaEn: Date.now() })
    await act(async () => { entroEnLaTienda(otra, r as any, null) })
    await flush()
    expect(nombre().value).toBe('') // nada de «Ana López» ni de «Beatriz» sin teclear
    fireEvent.input(nombre(), { target: { value: ' Beatriz ' } })
    await pastGuard()
    fireEvent.click(pedirBtn())
    await flush()
    expect(createOrder).toHaveBeenCalledTimes(1)
    expect(vi.mocked(createOrder).mock.calls[0][1].customer.name).toBe('Beatriz')
  })

  it('un nombre largo cortado en 80 con un espacio al final (codex-pulido-r3 #2) se manda limpio, sin bloquear «Pedir»', async () => {
    conAna()
    await flush()
    const largo = 'María José de los Ángeles del Sagrado Corazón Fernández de Córdoba Rodríguez de la Torre'.slice(0, 80)
    expect(largo.endsWith(' ')).toBe(true) // lo que deja el campo (maxLength 80)
    fireEvent.input(nombre(), { target: { value: largo } })
    expect(pedirBtn().disabled).toBe(false)
    await pastGuard()
    fireEvent.click(pedirBtn())
    await flush()
    expect(createOrder).toHaveBeenCalledTimes(1)
    expect(vi.mocked(createOrder).mock.calls[0][1].customer.name).toBe(largo.trim())
  })
})

describe('codex-w3-r1 #1: el pedido anterior salió con otra sesión', () => {
  it('dice con calma que entre otra vez para terminarlo, sin ofrecer pedir de nuevo', async () => {
    const s = show({ requiresAcceptance: false })
    await act(async () => { checkoutOf(s).feedback.value = { kind: 'sesionParaTerminar' } })
    expect(screen.getByText('Tu sesión se cerró')).toBeTruthy()
    expect(screen.getByText('Entra otra vez para terminar tu pedido.')).toBeTruthy()
    expect(document.querySelector('.avq-o-notice--error')).toBeNull()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Entrar otra vez' })) })
    expect(s.screen.value).toBe('entrar')
  })
})

describe('W3 (e): entrar otra vez dentro de la tienda', () => {
  it('la pantalla «entrar» enseña «Entra a tu cuenta» (EntrarConCuenta) y una flecha de regreso al pedido', async () => {
    const s = makeStore(infoOf(), menuOf())
    s.go('entrar')
    render(withStore(s, <OrderApp />))
    await flush()
    expect(screen.getByText('Entra a tu cuenta')).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Volver a tu pedido' })) })
    expect(s.screen.value).toBe('cart')
  })
})

describe('D661: pagar con tarjeta en línea en «Nadie»', () => {
  const NADIE_CARD = { requiresAcceptance: false, paymentModes: { payAtPickup: true, cardOnline: true } }
  const TEL: ContactoProbado = { tipo: 'PHONE', valor: '+525544422262', metodo: 'WHATSAPP', probadoEn: 1 }
  const CORREO: ContactoProbado = { tipo: 'EMAIL', valor: 'ana@correo.mx', metodo: 'EMAIL_CODE', probadoEn: 1 }
  // Pasada por familias (Ruling 87): lo que de verdad pasa con su dinero, igual para todas; nunca saldo a favor ni a dónde se devuelve.
  const TERMINOS = 'Se cobra a tu tarjeta cuando Flautas abra tu pedido; si nadie lo abre a tiempo, no se te cobra. Si no lo recoges o cambias de opinión, no se te devuelve solo: lo decide Flautas.'
  const pedir = () => screen.getByRole('button', { name: /^Pedir/ }) as HTMLButtonElement
  /** La sesión única de la página, con lo que probó (la abre la tienda, como al cargar con ella guardada). */
  const conSesion = (slug: string, contactos: ContactoProbado[] = [TEL], token = 'tok-A') => {
    guardarSesion(slug, { token, customer: { id: 'c1', firstName: 'Ana', lastName: null, email: null, phone: TEL.valor }, contactos, guardadaEn: Date.now() })
    fijarPagina(slug, 'pedidos', loadSession(slug))
  }
  /** Un toque de verdad dentro de la tienda: pasada la guarda de doble toque (400 ms tras cambiar la vista). */
  const tocar = async (el: HTMLElement) => {
    await act(() => { vi.advanceTimersByTime(500) })
    await act(async () => { fireEvent.click(el) })
    await flush()
  }
  /** Entra con su WhatsApp en la pantalla de entrar de la tienda (la API de reservas, simulada). */
  async function entrarConWhatsApp(token = 'tok-nueva') {
    vi.mocked(bookingApi.requestOtp).mockResolvedValueOnce({ ok: true })
    vi.mocked(bookingApi.verifyOtp).mockResolvedValueOnce({
      token, customer: { id: 'c9', firstName: 'Ana', lastName: null, email: null, phone: TEL.valor }, contactos: [TEL], otraFicha: null,
    } as any)
    await tocar(screen.getByRole('button', { name: 'Seguir con WhatsApp' }))
    fireEvent.input(screen.getByPlaceholderText('Tu número de teléfono'), { target: { value: '5544422262' } })
    await tocar(screen.getByRole('button', { name: 'Enviar código' }))
    await act(async () => { fireEvent.input(screen.getAllByRole('textbox')[0], { target: { value: '123456' } }) })
    await flush()
  }
  /** «Tus datos» de «Nadie» con tarjeta, dentro de la tienda completa (para ir a entrar y volver). */
  async function enLaTienda(over: Parameters<typeof infoOf>[0] = {}) {
    const s = makeStore(infoOf({ ...NADIE_CARD, ...over }), menuOf())
    s.cart.value = [line()]
    s.quote.value = { ok: true, lines: [], subtotal: 170, total: 170, minOrderAmount: 0, issues: [] }
    s.go('details')
    render(withStore(s, <OrderApp />))
    await flush()
    return s
  }

  it('«Nadie» con cardOnline: «Pagar ahora» y «Pagar en caja»; sin cardOnline, sólo caja', () => {
    show(NADIE_CARD)
    const group = screen.getByRole('radiogroup', { name: '¿Cómo quieres pagar?' })
    const [card, counter] = within(group).getAllByRole('radio') as HTMLInputElement[]
    expect(within(group).getAllByRole('radio')).toHaveLength(2)
    expect(card.closest('label')!.textContent).toBe('Pagar ahora con tarjeta')
    expect(counter.closest('label')!.textContent).toBe('Pagar en caja')
    // Ronda 1 (Ruling 46): sin sesión sale elegida «Pagar en caja» (la tarjeta pide entrar a su cuenta); las dos se pueden elegir.
    expect([card.checked, counter.checked]).toEqual([false, true])
    expect(screen.getByText('Pagas en caja: tarjeta o efectivo.')).toBeTruthy()
    expect(screen.queryByText('Para pagar en línea, entra a tu cuenta.')).toBeNull()
    // Sigue siendo «Nadie»: sin WhatsApp ni casilla, y «Pedir».
    expect(screen.queryByLabelText('WhatsApp')).toBeNull()
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(pedir().textContent).toContain('$170')
    fireEvent.click(card)
    expect([card.checked, counter.checked]).toEqual([true, false])
    expect(screen.getByText('Para pagar en línea, entra a tu cuenta.')).toBeTruthy()
    fireEvent.click(counter)
    expect([card.checked, counter.checked]).toEqual([false, true])
    expect(screen.getByText('Pagas en caja: tarjeta o efectivo.')).toBeTruthy()
    cleanup()
    for (const paymentModes of [{ payAtPickup: true, cardOnline: false }, { payAtPickup: true }]) {
      show({ requiresAcceptance: false, paymentModes })
      expect(screen.queryByRole('radiogroup')).toBeNull()
      expect(screen.getByText('Pagas en caja: tarjeta o efectivo.')).toBeTruthy()
      cleanup()
    }
  })

  it('pasada por familias (Ruling 87): antes de pagar dice lo que de verdad pasa con su dinero; nunca promete saldo a favor ni a dónde se devuelve', () => {
    // Antes: con teléfono probado y `storeCredit`, «te queda como saldo a favor»; pero «No lo recogió» se queda con el cobro, y el saldo
    // sólo va al teléfono que verificó al pagar si sigue siendo suyo. La línea es la misma con o sin teléfono, y con cualquier servidor.
    const casos: [string, Parameters<typeof infoOf>[0], ((slug: string) => void) | null][] = [
      ['saldo a favor posible y la sesión probó su teléfono', { storeCredit: true }, slug => conSesion(slug)],
      ['la sesión de pedidos de antes (trae su teléfono probado)', { storeCredit: true }, slug => {
        saveSession(slug, { token: 'tok-viejo', phone: TEL.valor, name: 'Ana', savedAt: Date.now() })
        fijarPagina(slug, 'pedidos', loadSession(slug))
      }],
      ['sólo probó su correo (o Google)', { storeCredit: true }, slug => conSesion(slug, [CORREO])],
      ['el servidor no puede abonar saldo a favor', { storeCredit: false }, slug => conSesion(slug)],
      ['un servidor viejo, sin storeCredit', {}, slug => conSesion(slug)],
      ['sin sesión', { storeCredit: true }, null],
    ]
    const linea = () => document.querySelector('.avq-o-confirm__pay')?.textContent ?? null
    for (const [caso, over, sesion] of casos) {
      show({ ...NADIE_CARD, ...over }, sesion ?? undefined)
      // Sin sesión la caja sale elegida (Ruling 46): el aviso es de «Pagar ahora».
      fireEvent.click(screen.getByRole('radio', { name: 'Pagar ahora con tarjeta' }))
      expect(linea(), caso).toBe(TERMINOS)
      expect(document.body.textContent, caso).not.toMatch(/saldo a favor|te queda|devuelve a tu|devuelve como|te devolvemos|reembols/i) // ni saldo ni destino
      // Con «Pagar en caja» no hay nada pagado: el pie dice cómo se paga.
      fireEvent.click(screen.getByRole('radio', { name: 'Pagar en caja' }))
      expect(linea(), caso).toBe('Pagas en caja: tarjeta o efectivo.')
      cleanup()
    }
    // «Mi equipo» con tarjeta no cambia: ni esta línea ni otra de saldo.
    show({ paymentModes: { payAtPickup: true, cardOnline: true }, storeCredit: true }, slug => conSesion(slug))
    expect(screen.queryByText(TERMINOS)).toBeNull()
    expect(document.body.textContent).not.toMatch(/saldo a favor/)
    expect(screen.getByText('Pagas ahora con tarjeta.')).toBeTruthy()
  })

  it('ronda 1 (Ruling 46): en «Nadie» la tarjeta sale elegida sólo con sesión; sin ella, «Pagar en caja» y «Pedir» da el folio sin entrar', async () => {
    const elegida = (name: string) => (screen.getByRole('radio', { name }) as HTMLInputElement).checked
    show(NADIE_CARD, slug => conSesion(slug))
    expect([elegida('Pagar ahora con tarjeta'), elegida('Pagar en caja')]).toEqual([true, false])
    cleanup()
    const s = show(NADIE_CARD)
    expect([elegida('Pagar ahora con tarjeta'), elegida('Pagar en caja')]).toEqual([false, true])
    fireEvent.input(screen.getByLabelText('Nombre'), { target: { value: 'Ana' } })
    vi.mocked(createOrder).mockResolvedValueOnce({ trackingToken: 'T'.repeat(32), orderNumber: 'A7K2' } as any)
    await pastGuard()
    fireEvent.click(pedir())
    await flush()
    expect(createOrder).toHaveBeenCalledTimes(1)
    const [, body, opts] = vi.mocked(createOrder).mock.calls[0]
    expect(body.paymentMode).toBe('PAY_AT_PICKUP')
    expect(body.customer).toEqual({ name: 'Ana' })
    expect(opts.token).toBeUndefined()
    expect(s.screen.value).toBe('tracking') // el folio, sin pasar por entrar
    expect(s.trackingToken.value).toBe('T'.repeat(32))
    cleanup()
    // «Mi equipo» no cambia: la tarjeta sale primero y elegida, sin sesión.
    show({ paymentModes: { payAtPickup: true, cardOnline: true } })
    expect([elegida('Pagar ahora con tarjeta'), elegida('Pagar al recoger')]).toEqual([true, false])
  })

  it('«Pagar ahora» sin sesión manda a entrar y regresa a Detalles', async () => {
    const s = await enLaTienda({ storeCredit: true })
    fireEvent.input(screen.getByLabelText('Nombre'), { target: { value: 'Ana López' } })
    fireEvent.click(screen.getByRole('radio', { name: 'Pagar ahora con tarjeta' })) // sin sesión la caja sale elegida (Ruling 46)
    // Sin sesión lo dice antes del toque, con lo que pasa con su dinero (Ruling 87).
    expect(screen.getByText('Para pagar en línea, entra a tu cuenta.')).toBeTruthy()
    expect(screen.getByText(TERMINOS)).toBeTruthy()
    await tocar(pedir())
    expect(s.screen.value).toBe('entrar')
    expect(createOrder).not.toHaveBeenCalled()
    expect(pendingAttempt(s.slug)).toBeNull() // no se guardó un intento sin sesión
    await entrarConWhatsApp('tok-nueva')
    // De regreso en «Tus datos» (no en el carrito), con su carrito, su nombre y la tarjeta elegida.
    expect(s.screen.value).toBe('details')
    expect(s.cart.value).toEqual([line()])
    expect((screen.getByLabelText('Nombre') as HTMLInputElement).value).toBe('Ana López')
    expect((screen.getByRole('radio', { name: 'Pagar ahora con tarjeta' }) as HTMLInputElement).checked).toBe(true)
    expect(screen.queryByText('Para pagar en línea, entra a tu cuenta.')).toBeNull()
    expect(screen.getByText(TERMINOS)).toBeTruthy() // Ruling 87: con su teléfono ya probado, la misma línea (nunca promete saldo)
    vi.mocked(createOrder).mockReturnValueOnce(new Promise(() => {}))
    await tocar(pedir())
    expect(createOrder).toHaveBeenCalledTimes(1)
    const [, body, opts] = vi.mocked(createOrder).mock.calls[0]
    expect(body.paymentMode).toBe('CARD_ONLINE')
    expect(body.customer).toEqual({ name: 'Ana López' })
    expect(opts.token).toBe('tok-nueva')
  })

  it('D661: sólo «Pagar ahora» regresa a «Tus datos»; entrar por «¿Tienes premios?» sigue regresando al carrito', async () => {
    vi.mocked(quote).mockResolvedValue({ ok: true, lines: [], subtotal: 170, total: 170, minOrderAmount: 0, issues: [] })
    const s = await enLaTienda()
    fireEvent.input(screen.getByLabelText('Nombre'), { target: { value: 'Ana' } })
    fireEvent.click(screen.getByRole('radio', { name: 'Pagar ahora con tarjeta' })) // sin sesión la caja sale elegida (Ruling 46)
    await tocar(pedir())
    expect(s.screen.value).toBe('entrar')
    // Se arrepiente y regresa con la flecha; luego entra por sus premios.
    await tocar(screen.getByRole('button', { name: 'Volver a tu pedido' }))
    expect(s.screen.value).toBe('details')
    await tocar(screen.getByRole('button', { name: 'Entrar' }))
    expect(s.screen.value).toBe('entrar')
    await entrarConWhatsApp()
    expect(s.screen.value).toBe('cart') // donde se eligen los premios
  })

  it('D661: si la tarjeta ya no se acepta al pagar, lo dice en una línea ámbar y deja «Pagar en caja» lista, sin perder el carrito', async () => {
    const s = show(NADIE_CARD, slug => conSesion(slug))
    fireEvent.input(screen.getByLabelText('Nombre'), { target: { value: 'Ana' } })
    vi.mocked(createOrder).mockRejectedValueOnce(new ApiError('Este negocio no acepta pagar con tarjeta en línea.', 400, 'CARD_PAYMENT_NOT_ACCEPTED'))
    // La caja dejó de avisar: /info ya no ofrece la tarjeta.
    vi.mocked(getInfo).mockResolvedValueOnce(infoOf({ requiresAcceptance: false, paymentModes: { payAtPickup: true, cardOnline: false } }))
    await pastGuard()
    fireEvent.click(pedir())
    await flush()
    const aviso = screen.getByText('Pagar en línea no está disponible ahora. Puedes pagar en caja.').closest('.avq-o-notice') as HTMLElement
    expect(aviso.classList.contains('avq-o-notice--warn')).toBe(true)
    expect(document.querySelector('.avq-o-notice--error')).toBeNull()
    expect(within(aviso).queryByRole('button')).toBeNull() // nada que reintentar: se paga en caja
    expect(s.screen.value).toBe('details')
    expect(s.cart.value).toEqual([line()])
    expect(screen.queryByRole('radiogroup')).toBeNull()
    expect(screen.getByText('Pagas en caja: tarjeta o efectivo.')).toBeTruthy()
    expect(pedir().disabled).toBe(false)
    vi.mocked(createOrder).mockReturnValueOnce(new Promise(() => {}))
    fireEvent.click(pedir())
    await flush()
    expect(vi.mocked(createOrder).mock.calls[1][1].paymentMode).toBe('PAY_AT_PICKUP')
  })

  it('D661: «Pagar ahora» con sesión y la tarjeta ocupada (CARD_ONLINE_QUEUE_FULL): ámbar, «Pagar en caja» elegida y la tienda sigue abierta', async () => {
    const s = show(NADIE_CARD, slug => conSesion(slug))
    fireEvent.input(screen.getByLabelText('Nombre'), { target: { value: 'Ana' } })
    vi.mocked(createOrder).mockRejectedValueOnce(new ApiError('Por ahora hay muchos pagos con tarjeta esperando.', 409, 'CARD_ONLINE_QUEUE_FULL'))
    vi.mocked(getInfo).mockResolvedValueOnce(infoOf({ ...NADIE_CARD }))
    await pastGuard()
    fireEvent.click(pedir())
    await flush()
    const aviso = screen.getByText('Ahora hay muchos pagos en línea. Puedes pagar en caja o intentar en unos minutos.').closest('.avq-o-notice') as HTMLElement
    expect(aviso.classList.contains('avq-o-notice--warn')).toBe(true)
    expect(s.screen.value).toBe('details')
    expect(s.info.value?.status).toBe('OPEN') // nunca «la tienda no está recibiendo pedidos»
    expect((screen.getByRole('radio', { name: 'Pagar en caja' }) as HTMLInputElement).checked).toBe(true)
    expect(screen.getByRole('radio', { name: 'Pagar ahora con tarjeta' })).toBeTruthy() // se puede volver a intentar en unos minutos
  })

  it('ronda 2 #5 (Ruling 58): tras «El precio cambió», cambiar entre caja y tarjeta quita «Confirmar»; «Pedir» manda el medio que se ve, con el total nuevo', async () => {
    const nuevo = { ok: true, lines: [], subtotal: 190, total: 190, minOrderAmount: 0, issues: [] }
    for (const [primero, luego, medio] of [
      ['Pagar en caja', 'Pagar ahora con tarjeta', 'CARD_ONLINE'],
      ['Pagar ahora con tarjeta', 'Pagar en caja', 'PAY_AT_PICKUP'],
    ] as const) {
      show(NADIE_CARD, slug => conSesion(slug))
      fireEvent.input(screen.getByLabelText('Nombre'), { target: { value: 'Ana' } })
      fireEvent.click(screen.getByRole('radio', { name: primero }))
      vi.mocked(createOrder).mockRejectedValueOnce(new ApiError('El precio cambió', 409, 'PRICE_CHANGED', { quote: nuevo }))
      await pastGuard()
      fireEvent.click(pedir())
      await flush()
      expect(screen.getByRole('alert').textContent, medio).toContain('El precio cambió: el nuevo total es $190.')
      expect(screen.getByRole('button', { name: 'Confirmar' })).toBeTruthy()
      fireEvent.click(screen.getByRole('radio', { name: luego }))
      // La pregunta del precio era del medio anterior: se va con él, así ningún botón manda el cuerpo viejo.
      expect(screen.queryByRole('button', { name: 'Confirmar' }), medio).toBeNull()
      vi.mocked(createOrder).mockReturnValueOnce(new Promise(() => {}))
      fireEvent.click(pedir())
      await flush()
      const enviado = vi.mocked(createOrder).mock.lastCall![1]
      expect(enviado.paymentMode, medio).toBe(medio)
      expect(enviado.expectedTotal, medio).toBe('190.00')
      cleanup()
    }
  })

  describe('pasada por familias (Ruling 83): lo que se manda es SIEMPRE el medio que se ve', () => {
    const nuevo = { ok: true, lines: [], subtotal: 190, total: 190, minOrderAmount: 0, issues: [] }
    const sinRed = () => new ApiError('Sin conexión', 0, undefined, undefined, true)
    const radio = (name: string) => screen.getByRole('radio', { name }) as HTMLInputElement
    const visible = () => (radio('Pagar ahora con tarjeta').checked ? 'CARD_ONLINE' : 'PAY_AT_PICKUP')
    const ultimo = () => vi.mocked(createOrder).mock.lastCall![1]
    const AMBOS = [
      ['Pagar ahora con tarjeta', 'Pagar en caja', 'CARD_ONLINE', 'PAY_AT_PICKUP'],
      ['Pagar en caja', 'Pagar ahora con tarjeta', 'PAY_AT_PICKUP', 'CARD_ONLINE'],
    ] as const

    it('sin red → intenta cambiar el radio → «Reintentar» → PRICE_CHANGED: «Confirmar» manda el medio que se ve (en los dos sentidos)', async () => {
      for (const [elegido, otro, medio] of AMBOS) {
        show(NADIE_CARD, slug => conSesion(slug))
        fireEvent.input(screen.getByLabelText('Nombre'), { target: { value: 'Ana' } })
        fireEvent.click(radio(elegido))
        vi.mocked(createOrder).mockRejectedValueOnce(sinRed())
        await pastGuard()
        fireEvent.click(pedir())
        await flush()
        fireEvent.click(radio(otro)) // mientras el pedido sigue en camino
        vi.mocked(createOrder).mockRejectedValueOnce(new ApiError('El precio cambió', 409, 'PRICE_CHANGED', { quote: nuevo }))
        fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
        await flush()
        expect(ultimo().paymentMode, medio).toBe(medio) // el reintento es el mismo pedido
        const seVe = visible()
        vi.mocked(createOrder).mockReturnValueOnce(new Promise(() => {}))
        fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
        await flush()
        expect(ultimo().paymentMode, medio).toBe(seVe)
        expect(seVe, medio).toBe(medio) // el medio nunca cambió en silencio
        expect(ultimo().expectedTotal, medio).toBe('190.00')
        cleanup()
      }
    })

    it('con el pedido en camino el radio queda fijo y dice por qué; «Empezar de nuevo» suelta el intento a propósito y entonces se elige otro', async () => {
      // Ajuste final (Ruling 111): sólo desde caja; uno con tarjeta no se suelta mientras «Reintentar» lo pueda traer (prueba aparte).
      for (const [antes, despues, medioAntes, medioDespues] of [AMBOS[1]]) {
        const s = show(NADIE_CARD, slug => conSesion(slug))
        fireEvent.input(screen.getByLabelText('Nombre'), { target: { value: 'Ana' } })
        fireEvent.click(radio(antes))
        vi.mocked(createOrder).mockRejectedValueOnce(sinRed())
        await pastGuard()
        fireEvent.click(pedir())
        await flush()
        expect([radio(antes).disabled, radio(despues).disabled], medioAntes).toEqual([true, true])
        expect(screen.getByText('Tu pedido sigue en camino: reintenta o empieza de nuevo.')).toBeTruthy()
        fireEvent.click(screen.getByRole('button', { name: 'Empezar de nuevo' }))
        expect(pendingAttempt(s.slug), medioAntes).toBeNull()
        expect(screen.queryByRole('button', { name: 'Reintentar' })).toBeNull()
        expect(screen.queryByText('Tu pedido sigue en camino: reintenta o empieza de nuevo.')).toBeNull()
        expect(visible(), medioAntes).toBe(medioAntes) // empezar de nuevo no cambia el medio: lo deja elegir
        fireEvent.click(radio(despues))
        vi.mocked(createOrder).mockRejectedValueOnce(new ApiError('El precio cambió', 409, 'PRICE_CHANGED', { quote: nuevo }))
        fireEvent.click(pedir())
        await flush()
        expect(ultimo().paymentMode, medioDespues).toBe(medioDespues)
        vi.mocked(createOrder).mockReturnValueOnce(new Promise(() => {}))
        fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
        await flush()
        expect(ultimo().paymentMode, medioDespues).toBe(visible())
        expect(ultimo().paymentMode, medioDespues).toBe(medioDespues)
        cleanup()
      }
    })

    it('limpieza final (1): mientras «Confirmar» va en camino, la pantalla enseña el medio que se está mandando, no el de por omisión', async () => {
      // El camino de la revisión: «Nadie» sin sesión → «Pagar en caja» (por omisión) → «Pedir» sin red → entra → «Reintentar» →
      // PRICE_CHANGED → «Confirmar». Con sesión, la tarjeta sería la de por omisión; lo que va es la caja.
      const s = show(NADIE_CARD)
      fireEvent.input(screen.getByLabelText('Nombre'), { target: { value: 'Ana' } })
      expect(visible()).toBe('PAY_AT_PICKUP')
      vi.mocked(createOrder).mockRejectedValueOnce(sinRed())
      await pastGuard()
      fireEvent.click(pedir())
      await flush()
      await act(async () => { conSesion(s.slug) }) // entra con su cuenta
      vi.mocked(createOrder).mockRejectedValueOnce(new ApiError('El precio cambió', 409, 'PRICE_CHANGED', { quote: nuevo }))
      fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
      await flush()
      expect(visible()).toBe('PAY_AT_PICKUP')
      vi.mocked(createOrder).mockReturnValueOnce(new Promise(() => {})) // «Confirmar» se queda en camino
      fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
      await flush()
      expect(ultimo().paymentMode).toBe('PAY_AT_PICKUP')
      expect(visible()).toBe('PAY_AT_PICKUP') // lo que va, no la tarjeta de por omisión con sesión
      expect(document.querySelector('.avq-o-confirm__pay')?.textContent).toBe('Pagas en caja: tarjeta o efectivo.')
    })

    it('limpieza final (3): la línea del radio fijo dice sólo lo que se puede hacer: reintentar, entrar otra vez o sólo empezar de nuevo', async () => {
      const r401 = () => new ApiError('Tu sesión ya no es válida.', 401, 'CUSTOMER_TOKEN_INVALID')
      const inactiva = () => new ApiError('Tu cuenta está desactivada.', 401, 'CUSTOMER_INACTIVE')
      // Ajuste final (Ruling 111): con tarjeta, «Empezar de nuevo» sólo cuando no hay cómo traer la compra (cuenta desactivada).
      const casos: [string, string, () => ApiError, string, string | null, boolean][] = [
        ['caja sin red', 'Pagar en caja', sinRed, 'Tu pedido sigue en camino: reintenta o empieza de nuevo.', 'Reintentar', true],
        ['caja, su sesión recibió 401', 'Pagar en caja', r401, 'Tu pedido sigue en camino: entra otra vez o empieza de nuevo.', 'Entrar otra vez', true],
        ['caja, cuenta desactivada', 'Pagar en caja', inactiva, 'Tu pedido sigue en camino: puedes empezar de nuevo.', null, true],
        ['tarjeta sin red', 'Pagar ahora con tarjeta', sinRed, 'Tu pedido sigue en camino: reintenta para saber si llegó.', 'Reintentar', false],
        ['tarjeta, su sesión recibió 401', 'Pagar ahora con tarjeta', r401, 'Tu pedido sigue en camino: entra otra vez para saber si llegó.',
          'Entrar otra vez', false],
        ['tarjeta, cuenta desactivada', 'Pagar ahora con tarjeta', inactiva, 'Tu pedido sigue en camino: puedes empezar de nuevo.', null, true],
      ]
      for (const [caso, medio, falla, linea, boton, empezar] of casos) {
        show(NADIE_CARD, slug => conSesion(slug))
        fireEvent.input(screen.getByLabelText('Nombre'), { target: { value: 'Ana' } })
        fireEvent.click(radio(medio))
        vi.mocked(createOrder).mockRejectedValueOnce(falla())
        await pastGuard()
        fireEvent.click(pedir())
        await flush()
        expect(screen.getByText(linea), caso).toBeTruthy()
        // Lo que la línea nombra, está; lo que no está, no lo nombra.
        if (boton) expect(screen.getByRole('button', { name: boton }), caso).toBeTruthy()
        if (boton !== 'Reintentar') expect(screen.queryByRole('button', { name: 'Reintentar' }), caso).toBeNull()
        expect(!!screen.queryByRole('button', { name: 'Empezar de nuevo' }), caso).toBe(empezar)
        expect(!!screen.queryByText('Si tu pedido ya llegó, empezar de nuevo puede repetirlo.'), caso).toBe(empezar) // el aviso va con el botón
        cleanup()
      }
    })

    it('limpieza final (5): con un pedido de caja pendiente, bajo «Empezar de nuevo» avisa que puede repetirlo; con tarjeta, ni botón ni aviso', async () => {
      const AVISO = 'Si tu pedido ya llegó, empezar de nuevo puede repetirlo.'
      for (const [medio, avisa] of [['Pagar en caja', true], ['Pagar ahora con tarjeta', false]] as const) {
        show(NADIE_CARD, slug => conSesion(slug))
        fireEvent.input(screen.getByLabelText('Nombre'), { target: { value: 'Ana' } })
        fireEvent.click(radio(medio))
        vi.mocked(createOrder).mockRejectedValueOnce(sinRed()) // la respuesta se perdió: quizá ya llegó
        await pastGuard()
        fireEvent.click(pedir())
        await flush()
        if (avisa) {
          const empezar = screen.getByRole('button', { name: 'Empezar de nuevo' })
          const aviso = screen.getByText(AVISO)
          expect(empezar.compareDocumentPosition(aviso) & Node.DOCUMENT_POSITION_FOLLOWING, medio).toBeTruthy() // bajo el botón
        } else {
          // Ajuste final (Ruling 111): la compra con tarjeta se trae con «Reintentar» (su llave), no se suelta.
          expect(screen.queryByRole('button', { name: 'Empezar de nuevo' }), medio).toBeNull()
          expect(screen.queryByText(AVISO), medio).toBeNull()
        }
        cleanup()
      }
    })

    it('ajuste final (Ruling 111): con tarjeta, perder la respuesta y pagarla en otra pestaña no deja empezar otra compra: «Reintentar» enseña la pagada', async () => {
      const s = show(NADIE_CARD, slug => conSesion(slug))
      fireEvent.input(screen.getByLabelText('Nombre'), { target: { value: 'Ana' } })
      expect(visible()).toBe('CARD_ONLINE')
      vi.mocked(createOrder).mockRejectedValueOnce(sinRed()) // pestaña 1: el 201 se pierde
      await pastGuard()
      fireEvent.click(pedir())
      await flush()
      const llave = vi.mocked(createOrder).mock.lastCall![2].idempotencyKey
      // Pestaña 2: la misma compra recupera esta llave y se paga. De vuelta en la 1, no se puede cambiar a caja ni soltar el intento.
      expect(screen.queryByRole('button', { name: 'Empezar de nuevo' })).toBeNull()
      expect([radio('Pagar ahora con tarjeta').disabled, radio('Pagar en caja').disabled]).toEqual([true, true])
      expect(screen.getByText('Tu pedido sigue en camino: reintenta para saber si llegó.')).toBeTruthy()
      vi.mocked(createOrder).mockResolvedValueOnce({ trackingToken: 'T'.repeat(32), checkoutUrl: '', status: 'PENDING_ACCEPTANCE', total: '170.00', replay: true } as any)
      fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
      await flush()
      expect(vi.mocked(createOrder).mock.lastCall![2].idempotencyKey).toBe(llave) // la misma compra
      expect(vi.mocked(createOrder).mock.calls.every(c => c[1].paymentMode === 'CARD_ONLINE')).toBe(true) // ningún folio de caja
      expect(s.screen.value).toBe('tracking') // la pagada, en su seguimiento
      expect(s.trackingToken.value).toBe('T'.repeat(32))
    })

    it('ajuste final (Ruling 113): un intento con tarjeta recargado con la tienda en el otro modo no enseña las condiciones de una compra nueva mientras se resuelve', async () => {
      const items = [{ productId: 'p1', quantity: 2, modifiers: [] }]
      const casos = [
        // «Mi equipo» (con teléfono, sin sesión) que se perdió y la tienda ya está en «Nadie»: el SERVIDOR repite su borrador, que sigue
        // esperando que lo acepten; «se cobra cuando abra» no es de ese pedido.
        ['«Mi equipo» → «Nadie»', NADIE_CARD, { items, paymentMode: 'CARD_ONLINE', expectedTotal: '170.00', customer: { name: 'Ana', phone: '+525544422262' } }, null],
        // Y al revés: uno de «Nadie» (con su sesión) con la tienda ya en «Mi equipo».
        ['«Nadie» → «Mi equipo»', { requiresAcceptance: true, paymentModes: { payAtPickup: true, cardOnline: true } },
          { items, paymentMode: 'CARD_ONLINE', expectedTotal: '170.00', customer: { name: 'Ana' } }, 'tok-A'],
      ] as const
      const condiciones = /se cobra|Pagas ahora con tarjeta|Pagas en caja|Pagas al recoger|Puedes cancelar mientras|Para pagar en línea/i
      for (const [caso, info, body, token] of casos) {
        show(info, slug => { beginAttempt(slug, body as any, token) })
        expect(visible(), caso).toBe('CARD_ONLINE')
        expect(screen.queryAllByText(condiciones).map(e => e.textContent), caso).toEqual([])
        vi.mocked(createOrder).mockReturnValueOnce(new Promise(() => {})) // «Reintentar» se queda resolviendo
        fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
        await flush()
        expect(vi.mocked(createOrder).mock.lastCall![1], caso).toEqual(body) // el pedido de antes, tal cual
        expect(screen.queryAllByText(condiciones).map(e => e.textContent), caso).toEqual([])
        cleanup()
      }
    })

    it('tras recargar con un intento pendiente, el radio enseña SU medio (el que «Reintentar» manda), aunque sin él saldría otro', () => {
      show(NADIE_CARD, slug => {
        beginAttempt(slug, {
          items: [{ productId: 'p1', quantity: 2, modifiers: [] }], paymentMode: 'CARD_ONLINE', expectedTotal: '170.00', customer: { name: 'Ana' },
        }, 'tok-A')
      })
      // Sin sesión en la página, «Pagar en caja» saldría elegida (Ruling 46); el pedido en camino es con tarjeta.
      expect(visible()).toBe('CARD_ONLINE')
      expect([radio('Pagar ahora con tarjeta').disabled, radio('Pagar en caja').disabled]).toEqual([true, true])
      expect(screen.getByText('Tu pedido sigue en camino: reintenta para saber si llegó.')).toBeTruthy() // Ruling 111
      expect(screen.queryByRole('button', { name: 'Empezar de nuevo' })).toBeNull()
    })

    it('en inglés', async () => {
      const s = makeStore(infoOf({ ...NADIE_CARD }), menuOf(), 'en')
      beginAttempt(s.slug, {
        items: [{ productId: 'p1', quantity: 2, modifiers: [] }], paymentMode: 'PAY_AT_PICKUP', expectedTotal: '170.00', customer: { name: 'Ana' },
      })
      s.quote.value = { ok: true, lines: [], subtotal: 170, total: 170, minOrderAmount: 0, issues: [] }
      render(withStore(s, <DetailsScreen />))
      expect(screen.getByText('Your order is still on its way: retry or start over.')).toBeTruthy()
      expect(screen.getByText('If your order already arrived, starting over may repeat it.')).toBeTruthy() // limpieza final (5)
      fireEvent.click(screen.getByRole('button', { name: 'Start over' }))
      expect(pendingAttempt(s.slug)).toBeNull()
    })
  })

  it('ronda 3 (Minor 4): mientras «Pedir» va en camino, el medio de pago no se puede cambiar (si volviera PRICE_CHANGED, «Confirmar» llevaría el de antes)', async () => {
    show(NADIE_CARD, slug => conSesion(slug))
    fireEvent.input(screen.getByLabelText('Nombre'), { target: { value: 'Ana' } })
    const radio = (name: string) => screen.getByRole('radio', { name }) as HTMLInputElement
    expect([radio('Pagar ahora con tarjeta').disabled, radio('Pagar en caja').disabled]).toEqual([false, false])
    vi.mocked(createOrder).mockReturnValueOnce(new Promise(() => {}))
    await pastGuard()
    fireEvent.click(pedir())
    await flush()
    expect([radio('Pagar ahora con tarjeta').disabled, radio('Pagar en caja').disabled]).toEqual([true, true])
  })

  it('ronda 2 (Ruling 59): «Mi equipo» de sólo tarjeta pasa a «Nadie» sin tarjeta: tras el primer «Confirmar» queda la caja lista, con el carrito', async () => {
    const s = show({ paymentModes: { payAtPickup: false, cardOnline: true } })
    fill()
    accept()
    vi.mocked(createOrder).mockRejectedValueOnce(new ApiError('Este negocio no acepta pagar con tarjeta en línea.', 400, 'CARD_PAYMENT_NOT_ACCEPTED'))
    vi.mocked(getInfo).mockResolvedValueOnce(infoOf({ requiresAcceptance: false, paymentModes: { payAtPickup: true, cardOnline: false } }))
    await pastGuard()
    fireEvent.click(confirmBtn())
    await flush()
    expect(s.screen.value).toBe('details')
    expect(s.cart.value).toHaveLength(1)
    expect(screen.getByText('Pagas en caja: tarjeta o efectivo.')).toBeTruthy()
    expect(pedir().disabled).toBe(false) // su nombre sigue escrito: «Pedir» manda el folio de caja
  })

  it('ronda 1 M5: con la tarjeta de «Nadie», TOO_MANY_PENDING_ORDERS y CARD_AMOUNT_OUT_OF_RANGE van en ámbar y dejan «Pagar en caja» elegida', async () => {
    for (const [code, status, text] of [
      ['TOO_MANY_PENDING_ORDERS', 409, 'Ya tienes pagos con tarjeta sin terminar en este negocio. Paga en caja o espera unos minutos.'],
      ['CARD_AMOUNT_OUT_OF_RANGE', 400, 'Este monto no se puede pagar con tarjeta en línea. Paga en caja.'],
    ] as const) {
      show(NADIE_CARD, slug => conSesion(slug))
      fireEvent.input(screen.getByLabelText('Nombre'), { target: { value: 'Ana' } })
      vi.mocked(createOrder).mockRejectedValueOnce(new ApiError('texto del servidor', status, code))
      vi.mocked(getInfo).mockResolvedValueOnce(infoOf({ ...NADIE_CARD }))
      await pastGuard()
      fireEvent.click(pedir())
      await flush()
      const aviso = screen.getByText(text).closest('.avq-o-notice') as HTMLElement
      expect(aviso.classList.contains('avq-o-notice--warn'), code).toBe(true)
      expect(document.querySelector('.avq-o-notice--error'), code).toBeNull()
      expect((screen.getByRole('radio', { name: 'Pagar en caja' }) as HTMLInputElement).checked, code).toBe(true)
      cleanup()
    }
  })

  it('en inglés', () => {
    const s = makeStore(infoOf({ ...NADIE_CARD, storeCredit: true }), menuOf(), 'en')
    s.quote.value = { ok: true, lines: [], subtotal: 170, total: 170, minOrderAmount: 0, issues: [] }
    render(withStore(s, <DetailsScreen />))
    expect((screen.getByRole('radio', { name: 'Pay at the counter' }) as HTMLInputElement).checked).toBe(true) // sin sesión (Ruling 46)
    fireEvent.click(screen.getByRole('radio', { name: 'Pay now by card' }))
    expect(screen.getByText('To pay online, sign in to your account.')).toBeTruthy()
    expect(screen.getByText("Your card is charged when Flautas opens your order; if nobody opens it in time, you aren't charged. If you don't pick it up or change your mind, it isn't refunded automatically: Flautas decides.")).toBeTruthy()
  })
})
