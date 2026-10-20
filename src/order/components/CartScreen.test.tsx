import { h, render as mount } from 'preact'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return { ...actual, quote: vi.fn(), getInfo: vi.fn(), getMenu: vi.fn() }
})
import { ApiError, quote } from '../api'
import { checkoutOf } from '../checkout'
import { CartScreen } from './CartScreen'
import { OrderApp } from './OrderApp'
import { STORE_CSS } from './theme'
import { infoOf, makeStore, menuOf, product, withStore } from './testKit'
import type { CartLine } from '../cart'
import type { Quote, QuoteLine, StoreInfo } from '../types'

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  // Ni la implementación ni los "una vez" de una prueba (p. ej. la de la respuesta vieja) pasan a la siguiente, aunque la anterior falle.
  vi.mocked(quote).mockReset()
  vi.useFakeTimers()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})
/** La cotización espera ~300 ms (debounce): se adelanta el reloj falso y se dejan correr las promesas. */
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(300) })

const flautas: CartLine = { lineId: 'a', productId: 'p1', name: 'Flautas', unitPrice: 85, quantity: 2, note: null, modifiers: [] }
const tacos: CartLine = { lineId: 'b', productId: 'p2', name: 'Tacos', unitPrice: 30, quantity: 1, note: 'Sin cebolla', modifiers: [] }
const qline = (productId: string, lineTotal: number): QuoteLine =>
  ({ productId, name: '', quantity: 1, unitPrice: lineTotal, modifiers: [], note: null, lineTotal })
const quoteOf = (total: number, over: Partial<Quote> = {}): Quote =>
  ({ ok: true, lines: [qline('p1', total)], subtotal: total, total, minOrderAmount: 0, issues: [], ...over })

async function show(cart: CartLine[], q: Quote | ApiError, info: StoreInfo = infoOf()) {
  const s = makeStore(info, menuOf())
  s.cart.value = cart
  if (q instanceof ApiError) vi.mocked(quote).mockRejectedValue(q)
  else vi.mocked(quote).mockResolvedValue(q)
  s.go('cart')
  render(withStore(s, <CartScreen />))
  await flush()
  return s
}
// «Continuar» lleva el total a la derecha cuando ya hay cotización («Continuar $180»): se busca por el principio del nombre.
const continueBtn = () => screen.getByRole('button', { name: /^Continuar/ }) as HTMLButtonElement
const totalText = () => screen.getByText('Total').parentElement!.textContent
const rowOf = (name: string) => screen.getByRole('listitem', { name })
const qtyOf = (s: { cart: { value: CartLine[] } }, lineId: string) => s.cart.value.find(l => l.lineId === lineId)?.quantity
const flautas1: CartLine = { ...flautas, quantity: 1 }
const refresco: CartLine = { lineId: 'c', productId: 'p3', name: 'Refresco', unitPrice: 25, quantity: 1, note: null, modifiers: [] }
/** El bote de un renglón con cantidad 1: el «−» que lo quita. */
const trashOf = (name: string) => within(rowOf(name)).getByRole('button', { name: `Quitar ${name}` }) as HTMLButtonElement

describe('carrito cotizado por el servidor', () => {
  it('al entrar cotiza los renglones del carrito; el total que se muestra es el de la cotización, no la estimación', async () => {
    const s = await show([flautas], quoteOf(180))
    expect(quote).toHaveBeenCalledWith(s.slug, [{ productId: 'p1', quantity: 2, modifiers: [] }])
    expect(totalText()).toContain('$180')
    expect(totalText()).not.toContain('$170')
    expect(s.quote.value?.total).toBe(180)
  })

  it('cada issue cuelga del renglón de su lineIndex; BELOW_MINIMUM va arriba del total', async () => {
    await show([flautas, tacos], quoteOf(170, {
      ok: false,
      minOrderAmount: 200,
      issues: [
        { code: 'PRODUCT_UNAVAILABLE', productId: 'p2', lineIndex: 1, message: 'Un platillo de tu pedido ya no está disponible.' },
        { code: 'BELOW_MINIMUM', message: 'El pedido mínimo es de $200.00.' },
      ],
    }))
    const tacosRow = rowOf('Tacos')
    const rowIssue = within(tacosRow).getByText('Un platillo de tu pedido ya no está disponible.')
    expect(within(rowOf('Flautas')).queryByText('Un platillo de tu pedido ya no está disponible.')).toBeNull()
    // El de un renglón es un <p role="alert" class="avq-o-issue"> dentro del <li> (radio 12); el del pedido entero, el mismo <p>
    // pero hijo directo de la pantalla, que es lo que la hoja de estilos usa para darle el radio de los avisos (16).
    expect(rowIssue.tagName).toBe('P')
    expect(rowIssue.classList.contains('avq-o-issue')).toBe(true)
    expect(rowIssue.getAttribute('role')).toBe('alert')
    expect(rowIssue.parentElement).toBe(tacosRow)
    // El monto sale de la cotización y con el formato de la tienda (no el texto del servidor).
    const minimum = screen.getByText('El pedido mínimo es de $200.')
    expect(minimum.tagName).toBe('P')
    expect(minimum.classList.contains('avq-o-issue')).toBe(true)
    expect(minimum.getAttribute('role')).toBe('alert')
    expect(minimum.parentElement!.classList.contains('avq-o-cart')).toBe(true)
    expect(tacosRow.contains(minimum)).toBe(false)
    expect(minimum.compareDocumentPosition(screen.getByText('Total')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // El renglón con problema no trae importe (el servidor lo omite de `lines`); nada se calcula con los precios del carrito.
    expect(tacosRow.textContent).not.toMatch(/\$\d/)
    expect(within(rowOf('Flautas')).getByText('$170')).toBeTruthy()
  })

  it('con quote.ok:false «Continuar» está deshabilitado; con ok:true lleva a tus datos', async () => {
    await show([flautas], quoteOf(170, { ok: false, issues: [{ code: 'BELOW_MINIMUM', message: 'El pedido mínimo es de $200.00.' }] }))
    expect(continueBtn().disabled).toBe(true)
    cleanup()
    const s = await show([flautas], quoteOf(170))
    expect(continueBtn().disabled).toBe(false)
    fireEvent.click(continueBtn())
    expect(s.screen.value).toBe('details')
  })

  it('«Continuar» lleva el total de la cotización y sigue deshabilitado sin cotización ok o con la tienda no abierta', async () => {
    // Antes de que llegue la cotización: sólo «Continuar», sin total, deshabilitado.
    const s = makeStore(infoOf(), menuOf())
    s.cart.value = [flautas]
    vi.mocked(quote).mockResolvedValue(quoteOf(180))
    s.go('cart')
    render(withStore(s, <CartScreen />))
    expect(continueBtn().textContent).toBe('Continuar')
    expect(continueBtn().disabled).toBe(true)
    // Con la cotización buena y la tienda abierta: lleva el total de la cotización (no la estimación de $170) y se habilita.
    await flush()
    expect(continueBtn().textContent).toBe('Continuar $180')
    expect(continueBtn().disabled).toBe(false)
    // Cotización sin ok: el total se ve, el botón sigue deshabilitado.
    cleanup()
    await show([flautas], quoteOf(170, { ok: false, issues: [{ code: 'BELOW_MINIMUM', message: 'El pedido mínimo es de $200.00.' }] }))
    expect(continueBtn().textContent).toBe('Continuar $170')
    expect(continueBtn().disabled).toBe(true)
    // Tienda no abierta: aunque la cotización sea buena, deshabilitado.
    cleanup()
    await show([flautas], quoteOf(170), infoOf({ status: 'CLOSED' }))
    expect(continueBtn().textContent).toBe('Continuar $170')
    expect(continueBtn().disabled).toBe(true)
  })

  it('M2: «Continuar» limpia el aviso «El precio cambió; revisa tu pedido.» (no reaparece en «Tus datos»)', async () => {
    const s = makeStore(infoOf(), menuOf())
    s.cart.value = [flautas]
    vi.mocked(quote).mockResolvedValue(quoteOf(190))
    checkoutOf(s).feedback.value = { kind: 'error', message: 'El precio cambió; revisa tu pedido.', retryable: false }
    s.go('cart')
    render(withStore(s, <CartScreen />))
    await flush()
    fireEvent.click(continueBtn())
    expect(s.screen.value).toBe('details')
    expect(checkoutOf(s).feedback.value).toBeNull()
  })

  it('con la tienda no abierta «Continuar» está deshabilitado aunque la cotización sea buena', async () => {
    await show([flautas], quoteOf(170), infoOf({ status: 'CLOSED' }))
    expect(continueBtn().disabled).toBe(true)
  })

  it('W3: con la tienda DISABLED (p. ej. tras un 409 ORDERING_DISABLED) el carrito dice por qué y no deja continuar', async () => {
    await show([flautas], quoteOf(170), infoOf({ status: 'DISABLED', reason: 'NOT_ENABLED' }))
    expect(screen.getByText('Este restaurante no recibe pedidos en línea por el momento.')).toBeTruthy()
    expect(continueBtn().disabled).toBe(true)
  })

  it('con la tienda no abierta el carrito se puede ver, editar y vaciar; sólo «Continuar» queda deshabilitado (spec §9.2)', async () => {
    const s = await show([flautas], quoteOf(170), infoOf({ status: 'PAUSED', reason: 'MANUAL_PAUSE' }))
    expect(screen.getByText('Pedidos en pausa')).toBeTruthy()
    expect(continueBtn().disabled).toBe(true)
    // Ver y editar: la nota, «Más», «Menos» y el bote funcionan como con la tienda abierta.
    const note = screen.getByLabelText('Nota para el restaurante') as HTMLTextAreaElement
    expect(note.disabled).toBe(false)
    fireEvent.click(within(rowOf('Flautas')).getByRole('button', { name: 'Más Flautas' }))
    expect(qtyOf(s, 'a')).toBe(3)
    fireEvent.click(within(rowOf('Flautas')).getByRole('button', { name: 'Menos Flautas' }))
    fireEvent.click(within(rowOf('Flautas')).getByRole('button', { name: 'Menos Flautas' }))
    expect(qtyOf(s, 'a')).toBe(1)
    // Vaciar: el bote quita el último renglón y queda el carrito vacío.
    fireEvent.click(within(rowOf('Flautas')).getByRole('button', { name: 'Quitar Flautas' }))
    expect(s.cart.value).toEqual([])
    expect(screen.getByText('Tu pedido está vacío.')).toBeTruthy()
    // Y «Agregar algo más» sigue llevando a la carta aunque la tienda no esté abierta.
    s.cart.value = [flautas]
    await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Agregar algo más' }))
    expect(s.screen.value).toBe('menu')
  })

  it('sin red al cotizar ⇒ «Sin conexión…», nada de total, «Continuar» deshabilitado y el carrito intacto; «Reintentar» cotiza otra vez', async () => {
    const s = await show([flautas], new ApiError('Sin conexión', 0, undefined, undefined, true))
    expect(screen.getByText('Sin conexión. Revisa tu internet y vuelve a intentar.')).toBeTruthy()
    expect(continueBtn().disabled).toBe(true)
    expect(s.cart.value).toEqual([flautas])
    // Sin red es un estado normal, no una falla: tarjeta ámbar con la nube tachada (como en la carta), no roja.
    const card = screen.getByText('Sin conexión. Revisa tu internet y vuelve a intentar.').closest('.avq-o-notice') as HTMLElement
    expect(card.classList.contains('avq-o-notice--warn')).toBe(true)
    vi.mocked(quote).mockResolvedValue(quoteOf(170))
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    await flush()
    expect(quote).toHaveBeenCalledTimes(2)
    expect(continueBtn().disabled).toBe(false)
  })

  it('un fallo del servidor al cotizar se dice en rojo y también deja «Reintentar»', async () => {
    await show([flautas], new ApiError('boom', 500))
    const card = screen.getByText('Algo falló de nuestro lado. Intenta de nuevo.').closest('.avq-o-notice') as HTMLElement
    expect(card.classList.contains('avq-o-notice--error')).toBe(true)
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeTruthy()
    expect(continueBtn().disabled).toBe(true)
  })

  it('cambiar la cantidad vuelve a cotizar; con 1 el «−» es el bote que quita el renglón y no queda un «Quitar» aparte', async () => {
    const s = await show([{ ...flautas, quantity: 1 }], quoteOf(85))
    expect(within(rowOf('Flautas')).queryByRole('button', { name: 'Menos Flautas' })).toBeNull()
    fireEvent.click(within(rowOf('Flautas')).getByRole('button', { name: 'Más Flautas' }))
    await flush()
    expect(vi.mocked(quote).mock.lastCall![1]).toEqual([{ productId: 'p1', quantity: 2, modifiers: [] }])
    fireEvent.click(within(rowOf('Flautas')).getByRole('button', { name: 'Menos Flautas' }))
    await flush()
    expect(vi.mocked(quote).mock.lastCall![1]).toEqual([{ productId: 'p1', quantity: 1, modifiers: [] }])
    expect(screen.queryByRole('button', { name: 'Quitar' })).toBeNull()
    fireEvent.click(within(rowOf('Flautas')).getByRole('button', { name: 'Quitar Flautas' }))
    expect(s.cart.value).toEqual([])
    expect(screen.getByText('Tu pedido está vacío.')).toBeTruthy()
  })

  it('con cantidad 1 el «−» es «Quitar {name}» y quita el renglón; con 2 baja a 1', async () => {
    const s = await show([flautas, tacos], quoteOf(200))
    // Con 2: el «−» es «Menos», baja a 1 (no quita) y entonces pasa a ser «Quitar Flautas».
    expect(within(rowOf('Flautas')).queryByRole('button', { name: 'Quitar Flautas' })).toBeNull()
    fireEvent.click(within(rowOf('Flautas')).getByRole('button', { name: 'Menos Flautas' }))
    expect(qtyOf(s, 'a')).toBe(1)
    expect(within(rowOf('Flautas')).queryByRole('button', { name: 'Menos Flautas' })).toBeNull()
    expect(within(rowOf('Flautas')).getByRole('button', { name: 'Quitar Flautas' })).toBeTruthy()
    // Con 1 (Tacos): el «−» ya es el bote, un ícono sin texto, y quita SÓLO ese renglón.
    const trash = within(rowOf('Tacos')).getByRole('button', { name: 'Quitar Tacos' })
    expect(trash.querySelector('svg[aria-hidden="true"]')).toBeTruthy()
    expect(trash.textContent).toBe('')
    fireEvent.click(trash)
    expect(s.cart.value.map(l => l.lineId)).toEqual(['a'])
    expect(screen.queryByRole('listitem', { name: 'Tacos' })).toBeNull()
  })

  it('en 20 el «+» queda aria-disabled (no disabled: el foco no se pierde) y ignora el toque; en 19 vuelve a estar activo', async () => {
    const s = await show([{ ...flautas, quantity: 20 }], quoteOf(1700))
    const more = within(rowOf('Flautas')).getByRole('button', { name: 'Más Flautas' }) as HTMLButtonElement
    more.focus()
    expect(more.getAttribute('aria-disabled')).toBe('true')
    expect(more.disabled).toBe(false)
    fireEvent.click(more)
    expect(qtyOf(s, 'a')).toBe(20)
    expect(document.activeElement).toBe(more)
    fireEvent.click(within(rowOf('Flautas')).getByRole('button', { name: 'Menos Flautas' }))
    expect(qtyOf(s, 'a')).toBe(19)
    expect(within(rowOf('Flautas')).getByRole('button', { name: 'Más Flautas' }).getAttribute('aria-disabled')).toBeNull()
  })

  it('la cantidad de cada renglón es un grupo «Cantidad» con su valor, en el stepper de línea del carrito', async () => {
    await show([flautas], quoteOf(170))
    const group = within(rowOf('Flautas')).getByRole('group', { name: 'Cantidad' })
    expect(group.classList.contains('avq-o-stepper--line')).toBe(true)
    expect(group.textContent).toBe('2')
  })

  it('el total de cada renglón es el de la cotización, cuando llega: antes no se calcula con los precios del carrito ni de la carta', async () => {
    const s = makeStore(infoOf(), menuOf(product())) // la carta dice $85 por pieza
    s.cart.value = [flautas] // 2 × $85 = $170 con los precios del carrito
    vi.mocked(quote).mockResolvedValue(quoteOf(190, { lines: [qline('p1', 190)] })) // el servidor cobra $190
    s.go('cart')
    render(withStore(s, <CartScreen />))
    expect(rowOf('Flautas').textContent).not.toMatch(/\$\d/)
    await flush()
    expect(within(rowOf('Flautas')).getByText('$190')).toBeTruthy()
    expect(rowOf('Flautas').textContent).not.toMatch(/\$170|\$85/)
  })

  it('una respuesta vieja de la cotización no pisa a la nueva', async () => {
    let answerOld!: (q: Quote) => void
    vi.mocked(quote).mockReturnValueOnce(new Promise<Quote>(r => { answerOld = r }))
    const s = makeStore(infoOf(), menuOf())
    s.cart.value = [{ ...flautas, quantity: 1 }]
    s.go('cart')
    render(withStore(s, <CartScreen />))
    await flush() // la primera cotización sale y queda esperando
    vi.mocked(quote).mockResolvedValueOnce(quoteOf(170))
    fireEvent.click(within(rowOf('Flautas')).getByRole('button', { name: 'Más Flautas' }))
    await flush() // la segunda sale y llega
    expect(s.quote.value?.total).toBe(170)
    await act(async () => { answerOld(quoteOf(85)) }) // la vieja llega tarde
    expect(s.quote.value?.total).toBe(170)
    expect(totalText()).toContain('$170')
  })

  it('tarjeta «Recoges en Avoqado Full» con la dirección y sus iniciales cuando no hay logo', async () => {
    await show([flautas], quoteOf(170), infoOf({
      venue: { slug: 'a', name: 'Avoqado Full', timezone: 'America/Mexico_City', currency: 'MXN' },
      contact: { address: 'Av. Insurgentes Sur 1234, Col. Del Valle', phone: null },
    }))
    const card = screen.getByText('Recoges en Avoqado Full').closest('.avq-o-pickup') as HTMLElement
    expect(within(card).getByText('Av. Insurgentes Sur 1234, Col. Del Valle')).toBeTruthy()
    expect(card.querySelector('.avq-o-mark')!.textContent).toBe('AF')
    expect(card.querySelector('img')).toBeNull()
  })

  it('la tarjeta con logo lo muestra; si la imagen falla, cae a las iniciales sin dejar hueco', async () => {
    await show([flautas], quoteOf(170), infoOf({
      venue: { slug: 'a', name: 'Avoqado Full', timezone: 'America/Mexico_City', currency: 'MXN' },
      brand: { logo: 'https://x/logo.png', logoFull: null, primaryColor: null, secondaryColor: null },
    }))
    const card = screen.getByText('Recoges en Avoqado Full').closest('.avq-o-pickup') as HTMLElement
    const img = card.querySelector('img') as HTMLImageElement
    expect(img.getAttribute('src')).toBe('https://x/logo.png')
    expect(img.getAttribute('alt')).toBe('')
    fireEvent.error(img)
    expect(card.querySelector('img')).toBeNull()
    expect(card.querySelector('.avq-o-mark')!.textContent).toBe('AF')
  })

  it('sin dirección la tarjeta sólo lleva el nombre; sin nombre ni dirección no hay tarjeta', async () => {
    await show([flautas], quoteOf(170), infoOf({ contact: { address: null, phone: null } }))
    const card = screen.getByText('Recoges en Flautas').closest('.avq-o-pickup') as HTMLElement
    expect(card.querySelector('.avq-o-pickup__addr')).toBeNull()
    cleanup()
    await show([flautas], quoteOf(170), infoOf({ venue: { slug: 'a', name: null, timezone: null, currency: 'MXN' }, contact: { address: null, phone: null } }))
    expect(document.querySelector('.avq-o-pickup')).toBeNull()
    expect(document.body.textContent).not.toMatch(/Recoges en|cart\./)
  })

  it('«Agregar algo más» y la flecha de volver llevan a la carta; la flecha tiene su propia etiqueta «Volver a la carta»', async () => {
    const s = await show([flautas], quoteOf(170))
    fireEvent.click(screen.getByRole('button', { name: 'Agregar algo más' }))
    expect(s.screen.value).toBe('menu')
    s.go('cart')
    // «Ver la carta» es del carrito vacío: con renglones, la flecha se llama «Volver a la carta» (como en la maqueta).
    expect(screen.queryByRole('button', { name: 'Ver la carta' })).toBeNull()
    const back = screen.getByRole('button', { name: 'Volver a la carta' })
    expect(back.classList.contains('avq-o-back')).toBe(true)
    expect(back.textContent).toBe('')
    fireEvent.click(back)
    expect(s.screen.value).toBe('menu')
  })

  it('el «−» y el «+» de cada renglón llevan el nombre del producto («Menos Flautas»), en español y en inglés; el bote ya lo llevaba', async () => {
    await show([flautas, tacos], quoteOf(200))
    expect(within(rowOf('Flautas')).getByRole('button', { name: 'Menos Flautas' })).toBeTruthy()
    expect(within(rowOf('Flautas')).getByRole('button', { name: 'Más Flautas' })).toBeTruthy()
    expect(within(rowOf('Tacos')).getByRole('button', { name: 'Quitar Tacos' })).toBeTruthy()
    expect(within(rowOf('Tacos')).getByRole('button', { name: 'Más Tacos' })).toBeTruthy()
    // Ya no hay botones "Más" / "Menos" sueltos: cada uno dice de qué producto es.
    expect(screen.queryByRole('button', { name: 'Más' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Menos' })).toBeNull()
    cleanup()
    const s = makeStore(infoOf(), menuOf(), 'en')
    s.cart.value = [flautas, tacos]
    vi.mocked(quote).mockResolvedValue(quoteOf(200))
    s.go('cart')
    render(withStore(s, <CartScreen />))
    await flush()
    expect(within(rowOf('Flautas')).getByRole('button', { name: 'Less Flautas' })).toBeTruthy()
    expect(within(rowOf('Flautas')).getByRole('button', { name: 'More Flautas' })).toBeTruthy()
    expect(within(rowOf('Tacos')).getByRole('button', { name: 'Remove Tacos' })).toBeTruthy()
    expect(within(rowOf('Tacos')).getByRole('button', { name: 'More Tacos' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Back to the menu' })).toBeTruthy()
  })

  it('carrito vacío: la misma flecha y el título «Tu pedido» de siempre, el mensaje centrado y «Ver la carta» (primario), que lleva a la carta (sin cotizar nada)', async () => {
    const s = await show([], quoteOf(0))
    const back = screen.getByRole('button', { name: 'Volver a la carta' })
    const title = screen.getByRole('heading', { name: 'Tu pedido' })
    const message = screen.getByText('Tu pedido está vacío.')
    const goMenu = screen.getByRole('button', { name: 'Ver la carta' })
    // De arriba abajo, como el carrito con renglones: la flecha, el título, el mensaje y el botón.
    const order = [back, title, message, goMenu]
    for (let i = 1; i < order.length; i++) expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING, String(i)).toBeTruthy()
    expect(back.classList.contains('avq-o-back')).toBe(true)
    expect(title.classList.contains('avq-o-title')).toBe(true)
    expect(title.getAttribute('tabindex')).toBe('-1')
    expect(message.getAttribute('role')).toBe('status')
    expect(message.parentElement!.className).toBe('avq-o-cart__empty') // el bloque centrado con aire (theme.test)
    expect(goMenu.parentElement).toBe(message.parentElement)
    expect(goMenu.classList.contains('avq-o-btn--primary')).toBe(true)
    expect(quote).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /^Continuar/ })).toBeNull()
    expect(screen.queryByText('Recoges en Flautas')).toBeNull() // sin la tarjeta de recolección: no hay nada que recoger
    // La flecha y el botón llevan a la carta.
    fireEvent.click(back)
    expect(s.screen.value).toBe('menu')
    s.go('cart')
    fireEvent.click(goMenu)
    expect(s.screen.value).toBe('menu')
  })

  it('texto fijo de pago y nota para el restaurante de hasta 300 caracteres', async () => {
    const s = await show([flautas], quoteOf(170))
    expect(screen.getByText('IVA incluido. Pagas al recoger.')).toBeTruthy()
    const note = screen.getByLabelText('Nota para el restaurante') as HTMLTextAreaElement
    expect(note.maxLength).toBe(300)
    fireEvent.input(note, { target: { value: 'Paso a las 2' } })
    expect(checkoutOf(s).draft.value.note).toBe('Paso a las 2')
  })

  it('W5: en inglés los motivos salen por código, con los valores de la respuesta; un código desconocido usa el message', async () => {
    const withGroup = product({
      modifierGroups: [{
        id: 'g1', name: 'Salsa', required: true, allowMultiple: true, minSelections: 2, maxSelections: 3,
        modifiers: [{ id: 'm1', name: 'Verde', price: 0 }],
      }],
    })
    const s = makeStore(infoOf(), menuOf(withGroup), 'en')
    s.cart.value = [flautas, tacos]
    vi.mocked(quote).mockResolvedValue(quoteOf(170, {
      ok: false,
      minOrderAmount: 100,
      issues: [
        { code: 'MODIFIER_GROUP_REQUIRED', productId: 'p1', groupId: 'g1', lineIndex: 0, message: 'En «Salsa» elige al menos 2 opciones.' },
        { code: 'MODIFIER_GROUP_MAX', productId: 'p1', groupId: 'g1', lineIndex: 0, message: 'En «Salsa» puedes elegir hasta 3.' },
        { code: 'PRODUCT_UNAVAILABLE', productId: 'p2', lineIndex: 1, message: 'Un platillo de tu pedido ya no está disponible.' },
        { code: 'QUANTITY_INVALID', productId: 'p2', lineIndex: 1, message: 'La cantidad debe ser un entero entre 1 y 20.' },
        { code: 'BELOW_MINIMUM', message: 'El pedido mínimo es de $100.00.' },
        { code: 'ALGO_NUEVO', message: 'Aviso nuevo del servidor.' } as any,
      ],
    }))
    s.go('cart')
    render(withStore(s, <CartScreen />))
    await flush()
    const flautasRow = rowOf('Flautas')
    expect(within(flautasRow).getByText('In “Salsa” choose at least 2 options.')).toBeTruthy()
    expect(within(flautasRow).getByText('In “Salsa” you can choose up to 3.')).toBeTruthy()
    const tacosRow = rowOf('Tacos')
    expect(within(tacosRow).getByText('A dish in your order is no longer available.')).toBeTruthy()
    expect(within(tacosRow).getByText('The quantity must be a whole number from 1 to 20.')).toBeTruthy()
    expect(screen.getByText('The minimum order is $100.')).toBeTruthy()
    expect(screen.getByText('Aviso nuevo del servidor.')).toBeTruthy()
    // Los textos nuevos de la pantalla también salen en inglés.
    expect(screen.getByText('Pickup at Flautas')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add something else' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Back to the menu' })).toBeTruthy()
    expect(within(tacosRow).getByRole('button', { name: 'Remove Tacos' })).toBeTruthy()
    // «Continuar» también va en inglés y lleva el total de la cotización.
    expect((screen.getByRole('button', { name: /^Continue/ }) as HTMLButtonElement).textContent).toBe('Continue $170')
    expect(screen.getByText('VAT included. Pay at pickup.')).toBeTruthy()
    expect(screen.getByLabelText('Note for the restaurant')).toBeTruthy()
    expect(screen.getByText('Total')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/elige|platillo|pedido mínimo|cart\./)
  })

  it('toques seguidos ⇒ UNA cotización nueva (~300 ms después del último): el límite es 60/min por IP', async () => {
    await show([{ ...flautas, quantity: 1 }], quoteOf(85))
    expect(quote).toHaveBeenCalledTimes(1)
    for (let i = 0; i < 3; i++) {
      fireEvent.click(within(rowOf('Flautas')).getByRole('button', { name: 'Más Flautas' }))
      await act(async () => { await vi.advanceTimersByTimeAsync(100) })
    }
    expect(quote).toHaveBeenCalledTimes(1)
    await flush()
    expect(quote).toHaveBeenCalledTimes(2)
    expect(vi.mocked(quote).mock.lastCall![1]).toEqual([{ productId: 'p1', quantity: 4, modifiers: [] }])
  })
})

describe('«Continuar» pegado abajo, dentro de la tienda', () => {
  it('va en un pie pegajoso (sticky, abajo 0, con el margen seguro) dentro de la raíz de la tienda; nunca position fixed', async () => {
    const s = makeStore(infoOf(), menuOf())
    s.cart.value = [flautas]
    vi.mocked(quote).mockResolvedValue(quoteOf(170))
    s.go('cart')
    const { container } = render(withStore(s, <OrderApp />))
    await flush()
    const foot = continueBtn().closest('.avq-o-cartfoot') as HTMLElement
    expect(container.firstElementChild!.contains(foot)).toBe(true)
    expect(foot.parentElement!.classList.contains('avq-o-cart')).toBe(true)
    expect(getComputedStyle(foot).position).toBe('sticky')
    expect(getComputedStyle(foot).bottom).toMatch(/^0(px)?$/)
    expect(STORE_CSS).toMatch(/\.avq-o-cartfoot\{[^}]*padding:12px 16px calc\(24px \+ env\(safe-area-inset-bottom,0px\)\)/)
    // Es el último hijo de la pantalla: al final del desplazamiento descansa en el borde real de la tienda.
    expect(foot.parentElement!.lastElementChild).toBe(foot)
    expect(STORE_CSS).not.toMatch(/position:\s*fixed/)
    for (const el of Array.from(container.querySelectorAll('*'))) expect(getComputedStyle(el).position).not.toBe('fixed')
  })

  it('el acento de la tienda llega a «Continuar» (var(--avq-accent) dentro de la raíz de OrderApp)', async () => {
    const s = makeStore(infoOf({ brand: { logo: null, logoFull: null, primaryColor: '#14532D', secondaryColor: null } }), menuOf())
    s.cart.value = [flautas]
    vi.mocked(quote).mockResolvedValue(quoteOf(170))
    s.go('cart')
    const { container } = render(withStore(s, <OrderApp />))
    await flush()
    expect(continueBtn().classList.contains('avq-o-btn--primary')).toBe(true)
    const root = continueBtn().closest('.avq-o-root') as HTMLElement
    expect(root).toBe(container.firstElementChild)
    expect(root.style.getPropertyValue('--avq-accent')).toBe('#14532D')
    expect(STORE_CSS).toMatch(/\.avq-o-btn--primary\{background:var\(--avq-accent/)
  })
})

describe('al quitar un renglón con el bote', () => {
  // El foco cae en un elemento NEUTRO: el renglón mismo (<li tabindex="-1">, sin contorno), nunca en un botón. Un Enter mantenido repite
  // el clic sobre lo que tiene el foco: en el bote del siguiente renglón vaciaría el carrito renglón por renglón.

  it('el foco pasa al renglón que sube a su lugar (el siguiente), que es neutro: un <li> con tabindex -1, no un botón', async () => {
    const s = await show([flautas1, tacos, refresco], quoteOf(140))
    trashOf('Tacos').focus()
    fireEvent.click(trashOf('Tacos'))
    expect(s.cart.value.map(l => l.name)).toEqual(['Flautas', 'Refresco'])
    const focused = document.activeElement as HTMLElement
    expect(focused).toBe(rowOf('Refresco'))
    expect(focused.tagName).toBe('LI')
    expect(focused.getAttribute('tabindex')).toBe('-1')
    expect(focused.closest('button')).toBeNull()
    expect(focused.matches('button, a, input, textarea, select')).toBe(false)
  })

  it('si era el último, el foco pasa al renglón anterior (también neutro)', async () => {
    const s = await show([flautas1, tacos, refresco], quoteOf(140))
    fireEvent.click(trashOf('Refresco'))
    expect(s.cart.value.map(l => l.name)).toEqual(['Flautas', 'Tacos'])
    expect(document.activeElement).toBe(rowOf('Tacos'))
    expect(document.activeElement!.tagName).toBe('LI')
  })

  it('un Enter o un clic repetido sobre lo enfocado NO sigue vaciando el carrito: con tres renglones de 1, el bote del primero deja 2, no 1', async () => {
    const s = await show([flautas1, tacos, refresco], quoteOf(140))
    trashOf('Flautas').focus()
    fireEvent.click(trashOf('Flautas'))
    // Lo que hace un Enter mantenido: en CADA repetición, tecla repetida y un clic sobre lo que tiene el foco en ese momento.
    for (let i = 0; i < 3; i++) {
      const focused = document.activeElement as HTMLElement
      fireEvent.keyDown(focused, { key: 'Enter', repeat: i > 0 })
      fireEvent.click(focused)
    }
    fireEvent.keyUp(document.activeElement!, { key: 'Enter' })
    expect(s.cart.value.map(l => l.name)).toEqual(['Tacos', 'Refresco'])
    expect(s.screen.value).toBe('cart')
    expect(document.activeElement).toBe(rowOf('Tacos'))
  })

  it('todo renglón puede recibir el foco por programa (tabindex -1) pero ninguno entra en el orden del Tab', async () => {
    await show([flautas1, tacos, refresco], quoteOf(140))
    for (const name of ['Flautas', 'Tacos', 'Refresco']) expect(rowOf(name).getAttribute('tabindex'), name).toBe('-1')
  })

  it('si era el único, el carrito queda vacío y el foco va a «Ver la carta» (sin mover la página: preventScroll)', async () => {
    const s = await show([tacos], quoteOf(30))
    const focus = vi.spyOn(HTMLElement.prototype, 'focus')
    try {
      fireEvent.click(trashOf('Tacos'))
      expect(s.cart.value).toEqual([])
      expect(screen.getByText('Tu pedido está vacío.')).toBeTruthy()
      const goMenu = screen.getByRole('button', { name: 'Ver la carta' })
      expect(document.activeElement).toBe(goMenu)
      expect(focus.mock.calls[focus.mock.contexts.lastIndexOf(goMenu)][0]).toEqual({ preventScroll: true })
      // El título y la flecha siguen ahí, y el foco no se fue a ninguno de los dos.
      expect(screen.getByRole('heading', { name: 'Tu pedido' })).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Volver a la carta' })).toBeTruthy()
    } finally {
      focus.mockRestore()
    }
  })

  it('bajar la cantidad (3 → 2) no mueve el foco: sigue en el mismo botón', async () => {
    const s = await show([{ ...flautas, quantity: 3 }, tacos], quoteOf(285))
    const less = within(rowOf('Flautas')).getByRole('button', { name: 'Menos Flautas' }) as HTMLButtonElement
    less.focus()
    fireEvent.click(less)
    expect(qtyOf(s, 'a')).toBe(2)
    expect(document.activeElement).toBe(less)
  })

  it('el foco llega sin mover la página (preventScroll); sólo se centra si el control queda arriba de la ventana o bajo el pie pegajoso', async () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    const focus = vi.spyOn(HTMLElement.prototype, 'focus')
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    const at = (top: number, bottom: number) => ({ top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top, toJSON() {} }) as DOMRect
    // La ventana de jsdom mide 768; el pie, pegado abajo, empieza en 676. `where` es dónde queda el control que hereda el foco.
    const where = (top: number, bottom: number) =>
      rect.mockImplementation(function (this: HTMLElement) { return this.classList.contains('avq-o-cartfoot') ? at(676, 768) : at(top, bottom) })
    const removeTacos = async () => {
      await show([flautas1, tacos, refresco], quoteOf(140))
      scrollIntoView.mockClear()
      focus.mockClear()
      fireEvent.click(trashOf('Tacos'))
    }
    try {
      where(300, 344) // a la vista
      await removeTacos()
      expect(focus).toHaveBeenCalledWith({ preventScroll: true })
      expect(document.activeElement).toBe(rowOf('Refresco'))
      expect(scrollIntoView).not.toHaveBeenCalled()
      cleanup()
      where(-60, -16) // arriba de la ventana
      await removeTacos()
      expect(scrollIntoView).toHaveBeenCalledTimes(1)
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' })
      cleanup()
      where(700, 744) // dentro de la ventana, pero TAPADO por el pie (empieza en 676)
      await removeTacos()
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' })
    } finally {
      focus.mockRestore()
      rect.mockRestore()
      delete (Element.prototype as any).scrollIntoView
    }
  })
})

describe('el logo que no cargó (nunca un hueco, ni se reintenta al cambiar de pantalla)', () => {
  it('se recuerda en toda la tienda: la cabecera compacta de los datos y la tarjeta del carrito nacen ya con las iniciales', async () => {
    const venue = { slug: 'a', name: 'Avoqado Full', timezone: 'America/Mexico_City', currency: 'MXN' }
    const brand = (logo: string) => ({ logo, logoFull: null, primaryColor: null, secondaryColor: null })
    const s = makeStore(infoOf({ venue, brand: brand('https://x/logo.png') }), menuOf())
    s.cart.value = [flautas]
    vi.mocked(quote).mockResolvedValue(quoteOf(170))
    const { container } = render(withStore(s, <OrderApp />))
    // La portada de la carta: el logo falla y cae a las iniciales.
    fireEvent.error(container.querySelector('.avq-o-hero .avq-o-mark img')!)
    expect(container.querySelector('.avq-o-hero .avq-o-mark')!.textContent).toBe('AF')
    // Los datos: la cabecera compacta ni siquiera vuelve a pedir la imagen.
    await act(async () => { s.go('details') })
    expect(container.querySelector('.avq-o-head img')).toBeNull()
    expect(container.querySelector('.avq-o-head .avq-o-mark--sm')!.textContent).toBe('AF')
    // El carrito: la tarjeta «Recoges en» tampoco.
    await act(async () => { s.go('cart') })
    await flush()
    expect(container.querySelector('.avq-o-pickup img')).toBeNull()
    expect(container.querySelector('.avq-o-pickup .avq-o-mark')!.textContent).toBe('AF')
    // Una liga NUEVA (otro /info) sí se intenta de nuevo.
    await act(async () => { s.info.value = infoOf({ venue, brand: brand('https://x/otro.png') }) })
    expect(container.querySelector('.avq-o-pickup img')!.getAttribute('src')).toBe('https://x/otro.png')
  })
})

describe('la cotización vieja nunca se pinta', () => {
  // El navegador pinta cuando se vacían las microtareas, antes de cualquier temporizador o cuadro de animación (aquí falsos: no
  // avanzan). Preact repinta en microtareas; lo que quede en el DOM en ese punto es lo que alcanzaría a verse.
  const untilPaint = async () => { for (let i = 0; i < 6; i++) await Promise.resolve() }

  it('tras quitar un renglón no se ve ni un cuadro con los importes viejos: ni el del renglón que queda ni «Continuar $viejo»', async () => {
    // $170 el primer renglón y $30 el segundo. Al quitar el primero, el que queda NO debe heredar los $170 (la cuenta por posición de
    // `lines` se desfasa) ni «Continuar $200». Hoy lo garantiza el almacén: checkout.ts anula la cotización EN EL MISMO LOTE del cambio
    // del carrito (store.cart.subscribe), antes de que la pantalla se repinte; esta prueba lo fija desde la pantalla.
    const s = await show([flautas1, tacos], quoteOf(200, { lines: [qline('p1', 170), qline('p2', 30)] }))
    expect(within(rowOf('Tacos')).getByText('$30')).toBeTruthy()
    expect(continueBtn().textContent).toBe('Continuar $200')
    trashOf('Flautas').click() // un toque "crudo", sin act: nada se vacía por nosotros
    await untilPaint()
    expect(s.cart.value.map(l => l.name)).toEqual(['Tacos'])
    expect(within(rowOf('Tacos')).queryByText(/\$/)).toBeNull()
    expect(document.body.textContent).not.toMatch(/\$170|\$200/)
    expect(continueBtn().textContent).toBe('Continuar')
    expect(continueBtn().disabled).toBe(true)
    expect(s.quote.value).toBeNull()
    // Cuando llega la cotización nueva, vuelve a pintarse con sus importes (se deja correr más de un debounce: el toque crudo no pasó
    // por act, y los efectos normales esperan sus temporizadores).
    vi.mocked(quote).mockResolvedValue(quoteOf(30, { lines: [qline('p2', 30)] }))
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(within(rowOf('Tacos')).getByText('$30')).toBeTruthy()
    expect(continueBtn().textContent).toBe('Continuar $30')
  })

  it('al entrar al carrito no se pinta ni un cuadro con la cotización que dejó la visita anterior: se reinicia antes de pintar', async () => {
    // La cotización vive en el almacén y sobrevive a salir del carrito; el efecto de la pantalla la reinicia y pide otra. Si ese
    // reinicio ocurre DESPUÉS de pintar, se ve un cuadro con «Continuar $999» que enseguida desaparece.
    const s = makeStore(infoOf(), menuOf())
    s.cart.value = [flautas1]
    s.quote.value = quoteOf(999, { lines: [qline('p1', 999)] })
    vi.mocked(quote).mockResolvedValue(quoteOf(85))
    s.go('cart')
    const host = document.createElement('div')
    document.body.appendChild(host)
    try {
      mount(withStore(s, <CartScreen />), host) // directo, sin act: los efectos "normales" esperan al siguiente cuadro
      await untilPaint()
      expect(host.textContent).not.toMatch(/\$999/)
      expect(host.textContent).toContain('Calculando el total…')
      expect(host.querySelector('.avq-o-cartfoot button')!.textContent).toBe('Continuar')
      expect(s.quote.value).toBeNull()
      // Y la cotización nueva llega y se pinta.
      await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
      expect(host.querySelector('.avq-o-cartfoot button')!.textContent).toBe('Continuar $85')
    } finally {
      mount(null, host)
      host.remove()
    }
  })
})
