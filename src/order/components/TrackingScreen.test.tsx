import { h } from 'preact'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return { ...actual, getTracking: vi.fn(), cancelOrder: vi.fn(), abandonPayment: vi.fn(), getInfo: vi.fn(), getMenu: vi.fn() }
})
import { ApiError, abandonPayment, cancelOrder, getTracking } from '../api'
import { TrackingScreen } from './TrackingScreen'
import { STORE_CSS } from './theme'
import { makeStore, withStore } from './testKit'
import { saveLastOrder } from '../session'
import type { OnlineOrderStatus, Tracking } from '../types'

let visibility = 'visible'
beforeEach(() => {
  vi.useFakeTimers()
  sessionStorage.clear() // el abandono pendiente vive ahí (fix ronda 1)
  window.history.replaceState({}, '', '/') // el widget nunca escribe la URL (fix ronda 3): se revisa que siga igual
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
  vi.mocked(getTracking).mockReset()
  vi.mocked(cancelOrder).mockReset()
  vi.mocked(abandonPayment).mockReset()
})
afterEach(() => { cleanup(); vi.useRealTimers() })

const tr = (over: Partial<Tracking> = {}): Tracking => ({
  orderNumber: '42', status: 'PENDING_ACCEPTANCE', paymentMode: 'PAY_AT_PICKUP', venueName: 'Flautas', venueSlug: 'a',
  items: [{ name: 'Flautas de pollo', quantity: 2, note: null, modifiers: [{ name: 'Crema', quantity: 1 }] }],
  total: 170, paid: false, estimatedReadyAt: null, acceptDeadlineAt: '2026-10-17T19:05:00Z', rejectReason: null,
  createdAt: '2026-10-17T19:00:00Z', canCancel: true, venueTimezone: 'America/Mexico_City',
  venueContact: { address: 'Calle 1, Coyoacán', phone: '555 123 4567' }, ...over,
})
const flush = () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve() })
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
async function show(t: Tracking | ApiError, locale: 'es' | 'en' = 'es') {
  if (t instanceof ApiError) vi.mocked(getTracking).mockRejectedValue(t)
  else vi.mocked(getTracking).mockResolvedValue(t)
  const s = makeStore(null, null, locale)
  s.trackingToken.value = 'T'.repeat(32)
  s.go('tracking')
  render(withStore(s, <TrackingScreen />))
  await flush()
  return s
}
const progress = () => screen.queryByRole('list', { name: 'Avance del pedido' })

describe('sondeo', () => {
  it('sondea cada 10 s, y para en un estado final', async () => {
    const s = await show(tr())
    expect(getTracking).toHaveBeenCalledTimes(1)
    expect(getTracking).toHaveBeenCalledWith(s.slug, 'T'.repeat(32))
    await tick(10_000)
    expect(getTracking).toHaveBeenCalledTimes(2)
    vi.mocked(getTracking).mockResolvedValue(tr({ status: 'COMPLETED', canCancel: false }))
    await tick(10_000)
    expect(getTracking).toHaveBeenCalledTimes(3)
    await tick(60_000)
    expect(getTracking).toHaveBeenCalledTimes(3)
    expect(screen.getByRole('heading', { name: 'Entregado' })).toBeTruthy()
    expect(screen.getByText('¡Gracias!')).toBeTruthy()
  })
  it('con la pestaña oculta no sondea; al volver a verse, refresca', async () => {
    await show(tr())
    visibility = 'hidden'
    await tick(40_000)
    expect(getTracking).toHaveBeenCalledTimes(1)
    visibility = 'visible'
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    await flush()
    expect(getTracking).toHaveBeenCalledTimes(2)
  })
  it('un fallo de red conserva lo último y avisa', async () => {
    await show(tr())
    vi.mocked(getTracking).mockRejectedValue(new ApiError('Sin conexión', 0, undefined, undefined, true))
    await tick(10_000)
    expect(screen.getByText('Sin conexión; reintentando…')).toBeTruthy()
    expect(screen.getByText(/Esperando que el negocio acepte/)).toBeTruthy()
    vi.mocked(getTracking).mockResolvedValue(tr())
    await tick(10_000)
    expect(screen.queryByText('Sin conexión; reintentando…')).toBeNull()
  })
  it('un 500 no es «Sin conexión»: «No pudimos actualizar tu pedido; reintentando…» y sigue sondeando', async () => {
    await show(new ApiError('x', 500))
    expect(screen.getByText('No pudimos actualizar tu pedido; reintentando…')).toBeTruthy()
    expect(screen.queryByText('Sin conexión; reintentando…')).toBeNull()
    vi.mocked(getTracking).mockResolvedValue(tr())
    await tick(10_000)
    expect(getTracking).toHaveBeenCalledTimes(2)
    vi.mocked(getTracking).mockRejectedValue(new ApiError('x', 503))
    await tick(10_000)
    expect(screen.getByText('No pudimos actualizar tu pedido; reintentando…')).toBeTruthy()
    expect(screen.getByText(/Esperando que el negocio acepte/)).toBeTruthy()
  })
  it('404: «No encontramos ese pedido.» y no sigue sondeando', async () => {
    await show(new ApiError('x', 404))
    expect(screen.getByText('No encontramos ese pedido.')).toBeTruthy()
    await tick(30_000)
    expect(getTracking).toHaveBeenCalledTimes(1)
  })
  it('«Sin conexión; reintentando…» y «No pudimos actualizar…» son avisos ámbar (sin red es un estado normal), nunca rojos', async () => {
    await show(tr())
    vi.mocked(getTracking).mockRejectedValue(new ApiError('Sin conexión', 0, undefined, undefined, true))
    await tick(10_000)
    expect(screen.getByText('Sin conexión; reintentando…').closest('.avq-o-notice')!.classList.contains('avq-o-notice--warn')).toBe(true)
    vi.mocked(getTracking).mockRejectedValue(new ApiError('x', 500))
    await tick(10_000)
    expect(screen.getByText('No pudimos actualizar tu pedido; reintentando…').closest('.avq-o-notice')!.classList.contains('avq-o-notice--warn')).toBe(true)
    expect(document.querySelector('.avq-o-notice--error')).toBeNull()
  })
})

describe('textos por estado', () => {
  // Estados en curso y entregado: titular nuevo, su línea de hora (o ninguna) y el paso actual.
  const positives: [string, OnlineOrderStatus, Partial<Tracking>, string, string | null, string][] = [
    ['PENDING_ACCEPTANCE', 'PENDING_ACCEPTANCE', {}, 'Esperando que el negocio acepte', 'Tiene hasta las 13:05 para aceptarlo.', 'Recibido'],
    ['ACCEPTED con hora', 'ACCEPTED', { estimatedReadyAt: '2026-10-17T19:30:00Z', canCancel: false }, 'Lo están preparando', 'Estará listo como a las 13:30.', 'Preparando'],
    ['ACCEPTED sin hora', 'ACCEPTED', { canCancel: false }, 'Lo están preparando', null, 'Preparando'],
    ['READY', 'READY', { canCancel: false }, '¡Listo para recoger!', 'Pasa al mostrador con tu folio.', 'Listo'],
    ['COMPLETED', 'COMPLETED', { canCancel: false }, 'Entregado', '¡Gracias!', 'Entregado'],
  ]
  for (const [label, status, over, head, sub, step] of positives)
    it(label, async () => {
      await show(tr({ status, ...over }))
      const title = screen.getByRole('heading', { name: head })
      expect(title.parentElement!.querySelector('p')?.textContent ?? null).toBe(sub)
      expect(progress()!.querySelector('[aria-current="step"]')!.textContent).toBe(step)
    })
  // Rechazado, vencido y cancelado: la frase de hoy, literal.
  const cases: [OnlineOrderStatus, Partial<Tracking>, string][] = [
    ['REJECTED', { rejectReason: 'OUT_OF_ITEMS', canCancel: false }, 'El negocio no pudo aceptar tu pedido: Sin existencias. No se te cobró nada.'],
    ['EXPIRED', { canCancel: false }, 'El negocio no contestó a tiempo. No se te cobró nada.'],
    ['CANCELLED_BY_CUSTOMER', { canCancel: false }, 'Cancelaste tu pedido.'],
    ['CANCELLED_BY_STAFF', { canCancel: false }, 'El negocio canceló tu pedido.'],
  ]
  for (const [status, over, text] of cases)
    it(status, async () => {
      await show(tr({ status, ...over }))
      expect(screen.getByText(text)).toBeTruthy()
    })

  it('ACCEPTED con ETA: titular «Lo están preparando», «Estará listo como a las 14:35», paso «Preparando» con aria-current', async () => {
    await show(tr({ status: 'ACCEPTED', estimatedReadyAt: '2026-10-17T20:35:00Z', canCancel: false }))
    expect(screen.getByRole('heading', { name: 'Lo están preparando' })).toBeTruthy()
    expect(screen.getByText('Estará listo como a las 14:35.')).toBeTruthy()
    const list = progress()!
    expect(list.tagName).toBe('OL') // una secuencia real, en orden
    expect(list.getAttribute('role')).toBe('list') // Safari quita la semántica de lista con list-style:none
    const steps = within(list).getAllByRole('listitem')
    expect(steps.map(s => s.textContent)).toEqual(['Recibido', 'Preparando', 'Listo', 'Entregado'])
    expect(steps.map(s => s.getAttribute('aria-current'))).toEqual([null, 'step', null, null])
    // Las barras del avance (con el acento) llegan hasta el paso actual.
    expect(steps.map(s => s.classList.contains('avq-o-step--done'))).toEqual([true, true, false, false])
  })
  it('rechazado/vencido/cancelado: sin pasos; la frase de hoy literal', async () => {
    const finals: [OnlineOrderStatus, Partial<Tracking>, string][] = [
      ...cases,
      ['REJECTED', { rejectReason: null, canCancel: false }, 'El negocio no pudo aceptar tu pedido. No se te cobró nada.'],
    ]
    for (const [status, over, text] of finals) {
      await show(tr({ status, ...over }))
      expect(screen.getByRole('heading', { name: text })).toBeTruthy()
      expect(progress()).toBeNull()
      // El folio sigue (sirve si llaman al restaurante), pero no se dice que lo digan al recoger: no hay nada que recoger.
      expect(screen.getByText('42')).toBeTruthy()
      expect(screen.queryByText('Dilo en el mostrador al recoger.')).toBeNull()
      cleanup()
    }
  })
  it('un estado que la tienda no conoce: titular neutro, sin «Dilo…» ni «Pagas al recoger»; el folio y los renglones siguen, y sigue sondeando', async () => {
    await show(tr({ status: 'ON_HOLD' as OnlineOrderStatus }))
    expect(screen.getByRole('heading', { name: 'Revisando tu pedido…' })).toBeTruthy()
    expect(screen.queryByText('El negocio canceló tu pedido.')).toBeNull()
    expect(screen.queryByText('Dilo en el mostrador al recoger.')).toBeNull()
    expect(screen.queryByText(/Pagas al recoger/)).toBeNull()
    expect(progress()).toBeNull()
    expect(screen.getByText('42')).toBeTruthy()
    expect(screen.getByText(/2 × Flautas de pollo/)).toBeTruthy()
    expect(screen.getByText('Total').parentElement!.textContent).toContain('$170')
    await tick(10_000)
    expect(getTracking).toHaveBeenCalledTimes(2)
  })
  it('en inglés: titular, línea de hora, pasos y «Your order number»', async () => {
    await show(tr({ status: 'ACCEPTED', estimatedReadyAt: '2026-10-17T20:35:00Z', canCancel: false }), 'en')
    expect(screen.getByRole('heading', { name: "They're preparing it" })).toBeTruthy()
    expect(screen.getByText(/^Ready around 2:35\sPM\.$/)).toBeTruthy()
    const steps = within(screen.getByRole('list', { name: 'Order progress' })).getAllByRole('listitem')
    expect(steps.map(s => s.textContent)).toEqual(['Received', 'Preparing', 'Ready', 'Picked up'])
    expect(steps[1].getAttribute('aria-current')).toBe('step')
    expect(screen.getByText('Your order number')).toBeTruthy()
    expect(screen.getByText('Say it at the counter when you pick up.')).toBeTruthy()
    expect(screen.getByText('VAT included. Pay at pickup.')).toBeTruthy()
  })

  it('no depende de /info: sin info ni menú pinta el pedido completo', async () => {
    await show(tr({ status: 'ACCEPTED', estimatedReadyAt: '2026-10-17T19:30:00Z', canCancel: false }))
    expect(screen.getByRole('heading', { name: 'Lo están preparando' })).toBeTruthy()
    expect(screen.getByText('Tu folio')).toBeTruthy()
    expect(screen.getByText('42')).toBeTruthy()
    expect(screen.getByText(/2 × Flautas de pollo/)).toBeTruthy()
    expect(screen.getByText(/Crema/)).toBeTruthy()
    expect(screen.getByText('Total').parentElement!.textContent).toContain('$170')
    expect(screen.getByText('IVA incluido. Pagas al recoger.')).toBeTruthy()
    expect(screen.getByText('Calle 1, Coyoacán')).toBeTruthy()
    expect(screen.getByText('555 123 4567')).toBeTruthy()
  })
  it('W12: cancelado, rechazado o vencido sin cobro no dice «Pagas al recoger»', async () => {
    for (const status of ['CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_STAFF', 'REJECTED', 'EXPIRED'] as const) {
      await show(tr({ status, canCancel: false }))
      expect(screen.getByText('42')).toBeTruthy()
      expect(screen.queryByText(/Pagas al recoger/)).toBeNull()
      cleanup()
    }
  })
  it('pagado dice «Pagado»', async () => {
    await show(tr({ paid: true, status: 'READY', canCancel: false }))
    expect(screen.getByText('Pagado')).toBeTruthy()
  })
  it('sin venueTimezone cae a la de /info', async () => {
    vi.mocked(getTracking).mockResolvedValue(tr({ venueTimezone: undefined, acceptDeadlineAt: '2026-10-17T19:05:00Z' }))
    const s = makeStore({ venue: { slug: 'a', name: 'F', timezone: 'America/Tijuana', currency: 'MXN' } } as any, null)
    s.trackingToken.value = 'T'.repeat(32)
    render(withStore(s, <TrackingScreen />))
    await flush()
    expect(screen.getByText(/hasta las 12:05/)).toBeTruthy()
  })
})

describe('encabezado y ticket', () => {
  it('encabezado chico: las iniciales y el nombre del restaurante, sin depender de /info', async () => {
    await show(tr({ venueName: 'Flautas Coyoacán' }))
    const head = document.querySelector('header.avq-o-head') as HTMLElement
    expect(head.querySelector('.avq-o-mark--sm')!.textContent).toBe('FC')
    expect(within(head).getByText('Flautas Coyoacán')).toBeTruthy()
  })
  it('folio: «Tu folio» y el número en grande; «Dilo en el mostrador al recoger.»', async () => {
    await show(tr({ orderNumber: 'WM9YC' }))
    expect(screen.getByText('Tu folio')).toBeTruthy()
    const n = screen.getByText('WM9YC')
    expect(n.classList.contains('avq-o-ticket__n')).toBe(true) // el folio enorme (Bricolage 800 de 64 px: theme.test)
    expect(screen.getByText('Dilo en el mostrador al recoger.')).toBeTruthy()
    // Arriba el folio; luego la línea punteada con sus muescas; abajo los renglones y el total.
    const ticket = n.closest('.avq-o-ticket') as HTMLElement
    const tear = ticket.querySelector('.avq-o-ticket__tear')!
    expect(tear.getAttribute('aria-hidden')).toBe('true')
    expect(n.compareDocumentPosition(tear) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(tear.compareDocumentPosition(within(ticket).getByText(/2 × Flautas de pollo/)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(tear.compareDocumentPosition(within(ticket).getByText('Total')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(ticket).getByText('IVA incluido. Pagas al recoger.')).toBeTruthy()
  })
  it('sin importe por renglón: cada renglón lleva cantidad, nombre, opciones y nota; abajo el total (spec §11.2)', async () => {
    await show(tr({
      items: [
        { name: 'Hamburguesa Clásica', quantity: 1, note: 'Sin cebolla', modifiers: [{ name: 'Mediano', quantity: 1 }, { name: 'Chipotle Mayo', quantity: 2 }] },
        { name: 'Coca-Cola 600ml', quantity: 2, note: null, modifiers: [] },
      ],
      total: 184,
    }))
    const rows = within(document.querySelector('.avq-o-ticket__lines') as HTMLElement).getAllByRole('listitem')
    expect(rows.map(r => r.textContent)).toEqual(['1 × Hamburguesa ClásicaMediano, Chipotle Mayo ×2Sin cebolla', '2 × Coca-Cola 600ml'])
    for (const r of rows) expect(r.textContent).not.toContain('$')
    expect(screen.getByText('Total').parentElement!.textContent).toBe('Total$184')
  })
})

describe('dónde recoger', () => {
  it('Cómo llegar: href https://www.google.com/maps/search/?api=1&query=<dirección codificada>, target _blank, rel noopener', async () => {
    await show(tr({ venueContact: { address: 'Av. Insurgentes Sur 1234, Col. Del Valle & Co #3', phone: '+52 (55) 1234-5678' } }))
    expect(screen.getByRole('heading', { name: 'Dónde recoger' })).toBeTruthy()
    const go = screen.getByRole('link', { name: 'Cómo llegar' })
    expect(go.getAttribute('href')).toBe('https://www.google.com/maps/search/?api=1&query=Av.%20Insurgentes%20Sur%201234%2C%20Col.%20Del%20Valle%20%26%20Co%20%233')
    expect(go.getAttribute('target')).toBe('_blank')
    expect(go.getAttribute('rel')).toBe('noopener noreferrer')
    expect(screen.getByRole('link', { name: 'Llamar' }).getAttribute('href')).toBe('tel:+525512345678')
  })
  it('sin dirección no hay «Cómo llegar»; sin teléfono no hay «Llamar»; sin ninguno no hay «Dónde recoger»', async () => {
    await show(tr({ venueContact: { address: null, phone: '555 123 4567' } }))
    expect(screen.queryByRole('link', { name: 'Cómo llegar' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Llamar' })).toBeTruthy()
    cleanup()
    await show(tr({ venueContact: { address: 'Calle 1, Coyoacán', phone: null } }))
    expect(screen.getByRole('link', { name: 'Cómo llegar' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Llamar' })).toBeNull()
    cleanup()
    await show(tr({ venueContact: undefined }))
    expect(screen.queryByRole('heading', { name: 'Dónde recoger' })).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
  })
})

describe('volver a la carta', () => {
  it('W7: «Pedir algo más» deja el seguimiento y va a la carta', async () => {
    const s = await show(tr({ status: 'ACCEPTED', canCancel: false }))
    fireEvent.click(screen.getByRole('button', { name: 'Pedir algo más' }))
    expect(s.trackingToken.value).toBeNull()
    expect(s.screen.value).toBe('menu')
  })
  it('M3: si el seguimiento nunca carga (falla el servidor), también ofrece «Pedir algo más»', async () => {
    const s = await show(new ApiError('x', 500))
    expect(screen.getByText('No pudimos actualizar tu pedido; reintentando…')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Pedir algo más' }))
    expect(s.trackingToken.value).toBeNull()
    expect(s.screen.value).toBe('menu')
  })
  it('«Pedir algo más» es el botón secundario, no el del acento', async () => {
    await show(tr({ status: 'ACCEPTED', canCancel: false }))
    const more = screen.getByRole('button', { name: 'Pedir algo más' })
    expect(more.classList.contains('avq-o-btn--neutral')).toBe(true)
    expect(more.classList.contains('avq-o-btn--primary')).toBe(false)
  })
})

describe('cancelar', () => {
  it('sin canCancel no hay botón', async () => {
    await show(tr({ canCancel: false }))
    expect(screen.queryByRole('button', { name: 'Cancelar pedido' })).toBeNull()
  })
  it('pide confirmación, llama UNA vez y refresca', async () => {
    vi.mocked(cancelOrder).mockResolvedValue({ status: 'CANCELLED_BY_CUSTOMER' })
    await show(tr())
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar pedido' }))
    expect(cancelOrder).not.toHaveBeenCalled()
    vi.mocked(getTracking).mockResolvedValue(tr({ status: 'CANCELLED_BY_CUSTOMER', canCancel: false }))
    const yes = screen.getByRole('button', { name: 'Sí, cancelar' })
    fireEvent.click(yes); fireEvent.click(yes)
    await flush()
    expect(cancelOrder).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Cancelaste tu pedido.')).toBeTruthy()
  })
  it('409 ORDER_STATE_CHANGED: refresca y avisa', async () => {
    vi.mocked(cancelOrder).mockRejectedValue(new ApiError('x', 409, 'ORDER_STATE_CHANGED'))
    await show(tr())
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar pedido' }))
    vi.mocked(getTracking).mockResolvedValue(tr({ status: 'ACCEPTED', canCancel: false, estimatedReadyAt: '2026-10-17T19:30:00Z' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sí, cancelar' }))
    await flush()
    expect(screen.getByText('Tu pedido ya no se puede cancelar.')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Lo están preparando' })).toBeTruthy()
  })
  it('409 ORDER_HAS_PAYMENTS: llama al restaurante', async () => {
    vi.mocked(cancelOrder).mockRejectedValue(new ApiError('x', 409, 'ORDER_HAS_PAYMENTS'))
    await show(tr())
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar pedido' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sí, cancelar' }))
    await flush()
    expect(screen.getByText('Este pedido ya tiene un pago; llama al negocio.')).toBeTruthy()
  })
  it('«Cancelar pedido» es un botón de texto discreto; su confirmación lleva dos botones y «No» la cierra sin cancelar', async () => {
    await show(tr())
    const cancel = screen.getByRole('button', { name: 'Cancelar pedido' })
    expect(cancel.classList.contains('avq-o-btn--quiet')).toBe(true)
    fireEvent.click(cancel)
    const ask = screen.getByRole('group', { name: '¿Cancelar tu pedido?' })
    const buttons = within(ask).getAllByRole('button')
    expect(buttons.map(b => b.textContent)).toEqual(['Sí, cancelar', 'No'])
    // La pantalla no tiene acción principal (§5.6): el color de la marca no «recomienda» cancelar, ni tampoco «No». Mismo peso.
    for (const b of buttons) {
      expect(b.classList.contains('avq-o-btn--neutral'), b.textContent!).toBe(true)
      expect(b.classList.contains('avq-o-btn--primary'), b.textContent!).toBe(false)
    }
    fireEvent.click(within(ask).getByRole('button', { name: 'No' }))
    expect(screen.getByRole('button', { name: 'Cancelar pedido' })).toBeTruthy()
    expect(cancelOrder).not.toHaveBeenCalled()
  })
  it('al abrir la confirmación el foco va a «No»; al cerrarla con «No» vuelve a «Cancelar pedido» (y al cargar no se mueve)', async () => {
    await show(tr())
    expect(document.activeElement).toBe(document.body)
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar pedido' }))
    await flush()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'No' }))
    fireEvent.click(screen.getByRole('button', { name: 'No' }))
    await flush()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancelar pedido' }))
  })
  it('cancelar sin red: «Sin conexión…» en aviso ámbar, nunca rojo', async () => {
    vi.mocked(cancelOrder).mockRejectedValue(new ApiError('Sin conexión', 0, undefined, undefined, true))
    await show(tr())
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar pedido' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sí, cancelar' }))
    await flush()
    const msg = screen.getByText('Sin conexión. Revisa tu internet y vuelve a intentar.')
    expect(msg.closest('.avq-o-notice')!.classList.contains('avq-o-notice--warn')).toBe(true)
  })
})

describe('foco tras un intento de cancelar', () => {
  const offline = () => new ApiError('Sin conexión', 0, undefined, undefined, true)
  /** Abre la confirmación y deja el foco en «Sí, cancelar» (como lo deja quien lo toca o lo alcanza con el teclado). */
  async function ask() {
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar pedido' }))
    await flush()
    const yes = screen.getByRole('button', { name: 'Sí, cancelar' })
    yes.focus()
    return yes
  }
  const cancelBtn = () => screen.getByRole('button', { name: 'Cancelar pedido' })

  it('se canceló: el botón se va y el foco pasa al titular del estado (tabindex -1, sin contorno), no se pierde', async () => {
    vi.mocked(cancelOrder).mockResolvedValue({ status: 'CANCELLED_BY_CUSTOMER' })
    await show(tr())
    const yes = await ask()
    vi.mocked(getTracking).mockResolvedValue(tr({ status: 'CANCELLED_BY_CUSTOMER', canCancel: false }))
    fireEvent.click(yes)
    await flush()
    expect(screen.queryByRole('button', { name: 'Cancelar pedido' })).toBeNull()
    const title = screen.getByRole('heading', { name: 'Cancelaste tu pedido.' })
    expect(title.getAttribute('tabindex')).toBe('-1')
    expect(document.activeElement).toBe(title)
    expect(STORE_CSS).toMatch(/\.avq-o-root \.avq-o-title:focus\{outline:none\}/)
  })
  it('sin red, o con un 409 que deja el pedido cancelable: el aviso sale y, como el foco se perdió, vuelve a «Cancelar pedido»', async () => {
    for (const failure of [offline(), new ApiError('x', 409, 'ORDER_STATE_CHANGED')]) {
      vi.mocked(cancelOrder).mockRejectedValue(failure)
      await show(tr())
      const yes = await ask()
      // El refresco también falla (sin red) o trae el mismo pedido aún cancelable (409): el botón sigue en su lugar.
      if (failure.code) vi.mocked(getTracking).mockResolvedValue(tr())
      else vi.mocked(getTracking).mockRejectedValue(failure)
      fireEvent.click(yes)
      await flush()
      expect(screen.getByText(failure.code ? 'Tu pedido ya no se puede cancelar.' : 'Sin conexión. Revisa tu internet y vuelve a intentar.')).toBeTruthy()
      expect(screen.queryByRole('group', { name: '¿Cancelar tu pedido?' })).toBeNull()
      expect(document.activeElement, failure.code ?? 'sin red').toBe(cancelBtn())
      cleanup()
    }
  })
  it('cerrar la confirmación con «No» devuelve el foco a «Cancelar pedido» (el intento no interviene)', async () => {
    await show(tr())
    await ask()
    fireEvent.click(screen.getByRole('button', { name: 'No' }))
    await flush()
    expect(document.activeElement).toBe(cancelBtn())
    expect(cancelOrder).not.toHaveBeenCalled()
  })
  it('nunca jala el foco de otro lado: si durante el intento la persona pasó a otro elemento, ahí se queda (se cancele o no)', async () => {
    for (const cancels of [false, true]) {
      let settle!: () => void
      vi.mocked(cancelOrder).mockReturnValue(new Promise((resolve, reject) => { settle = () => (cancels ? resolve({ status: 'CANCELLED_BY_CUSTOMER' }) : reject(offline())) }))
      await show(tr())
      const yes = await ask()
      fireEvent.click(yes)
      await flush()
      const more = screen.getByRole('button', { name: 'Pedir algo más' })
      more.focus()
      if (cancels) vi.mocked(getTracking).mockResolvedValue(tr({ status: 'CANCELLED_BY_CUSTOMER', canCancel: false }))
      else vi.mocked(getTracking).mockRejectedValue(offline())
      settle()
      await flush()
      expect(screen.queryByRole('button', { name: 'Cancelar pedido' }) === null, 'el botón sigue sólo si no se canceló').toBe(cancels)
      expect(document.activeElement, cancels ? 'se canceló' : 'sin red').toBe(more)
      cleanup()
    }
  })
})

describe('fase 2: pagar con tarjeta', () => {
  /** Un pedido o borrador de tarjeta. */
  const card = (over: Partial<Tracking> = {}) => tr({ paymentMode: 'CARD_ONLINE', cardStatus: 'AUTHORIZED', canCancel: false, ...over })
  const draft = (over: Partial<Tracking> = {}) => card({ status: 'AWAITING_PAYMENT', orderNumber: '', cardStatus: null, ...over })
  const money = () => document.querySelector('.avq-o-total__tax')?.textContent ?? null
  const NOTHING = 'No se te cobró nada. Si viste un cargo, tu banco lo liberará en unos días.'
  const REFUND_DUE = 'Tu tarjeta se cobró; el negocio te la devolverá.'

  it('AWAITING_PAYMENT: «Confirmando tu pago…», sin avance ni folio, y sigue sondeando', async () => {
    await show(draft())
    expect(screen.getByRole('heading', { name: 'Confirmando tu pago…' })).toBeTruthy()
    expect(progress()).toBeNull()
    expect(screen.queryByText('Tu folio')).toBeNull()
    expect(document.querySelector('.avq-o-ticket__folio')).toBeNull()
    expect(screen.getByText(/Flautas de pollo/)).toBeTruthy() // los renglones sí
    await tick(10_000)
    expect(getTracking).toHaveBeenCalledTimes(2)
  })

  it('PAYMENT_NOT_COMPLETED: final, su texto y «Volver al menú» (lleva a la carta)', async () => {
    const s = await show(draft({ status: 'PAYMENT_NOT_COMPLETED' }))
    expect(screen.getByRole('heading', { name: 'No se completó el pago. No se te cobró nada.' })).toBeTruthy()
    expect(money()).toBeNull()
    await tick(60_000)
    expect(getTracking).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Pedir algo más' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Volver al menú' }))
    expect(s.screen.value).toBe('menu')
    expect(s.trackingToken.value).toBeNull()
  })

  it('un borrador no completado pero COBRADO afuera: no dice «No se te cobró nada»; dice que el negocio la devolverá', async () => {
    await show(draft({ status: 'PAYMENT_NOT_COMPLETED', cardStatus: 'CAPTURED' }))
    expect(screen.getByRole('heading', { name: 'No se completó el pago.' })).toBeTruthy()
    expect(money()).toBe(REFUND_DUE)
    expect(document.body.textContent).not.toContain('No se te cobró nada')
  })

  it('las líneas del dinero con tarjeta (nunca «Pagas al recoger»)', async () => {
    const cases: [Partial<Tracking>, string][] = [
      [{ status: 'PENDING_ACCEPTANCE', cardStatus: 'AUTHORIZED' }, 'Tu tarjeta está apartada; se cobra cuando el negocio acepte.'],
      [{ status: 'ACCEPTED', cardStatus: 'CAPTURED', paid: true }, 'Tu pago se cobró.'],
      [{ status: 'READY', cardStatus: 'CAPTURED', paid: true }, 'Tu pago se cobró.'],
      [{ status: 'COMPLETED', cardStatus: 'CAPTURED', paid: true }, 'Tu pago se cobró.'],
      [{ status: 'REJECTED', cardStatus: 'CAPTURED', rejectReason: 'TOO_BUSY' }, REFUND_DUE],
      [{ status: 'EXPIRED', cardStatus: 'CAPTURED' }, REFUND_DUE],
      [{ status: 'CANCELLED_BY_STAFF', cardStatus: 'CAPTURED' }, REFUND_DUE],
      [{ status: 'REJECTED', cardStatus: 'RELEASED', rejectReason: 'OUT_OF_ITEMS' }, NOTHING],
      [{ status: 'EXPIRED', cardStatus: 'RELEASED' }, NOTHING],
      [{ status: 'CANCELLED_BY_CUSTOMER', cardStatus: 'RELEASED' }, NOTHING],
      [{ status: 'REJECTED', cardStatus: 'RELEASING', rejectReason: 'CLOSED' }, 'Estamos liberando tu tarjeta…'],
    ]
    for (const [over, text] of cases) {
      vi.mocked(getTracking).mockReset()
      await show(card(over))
      expect(money(), JSON.stringify(over)).toBe(text)
      expect(document.body.textContent).not.toContain('Pagas al recoger')
      cleanup()
    }
  })

  it('rechazado o vencido con tarjeta: el titular no promete «No se te cobró nada» (lo dice la línea del dinero)', async () => {
    await show(card({ status: 'REJECTED', rejectReason: 'OUT_OF_ITEMS', cardStatus: 'CAPTURED' }))
    expect(screen.getByRole('heading', { name: 'El negocio no pudo aceptar tu pedido: Sin existencias.' })).toBeTruthy()
    expect(document.body.textContent).not.toContain('No se te cobró nada')
    cleanup()
    await show(card({ status: 'EXPIRED', cardStatus: 'CAPTURED' }))
    expect(screen.getByRole('heading', { name: 'El negocio no contestó a tiempo.' })).toBeTruthy()
    expect(document.body.textContent).not.toContain('No se te cobró nada')
  })

  it('rejectReason PAYMENT_FAILED: «No se pudo cobrar tu tarjeta.»', async () => {
    await show(card({ status: 'REJECTED', rejectReason: 'PAYMENT_FAILED', cardStatus: 'RELEASED' }))
    expect(screen.getByRole('heading', { name: 'No se pudo cobrar tu tarjeta.' })).toBeTruthy()
    expect(money()).toBe(NOTHING)
  })

  it('el sondeo NO se detiene en un final con el dinero en duda (REJECTED + RELEASING); para con RELEASED', async () => {
    await show(card({ status: 'REJECTED', rejectReason: 'CLOSED', cardStatus: 'RELEASING' }))
    await tick(10_000)
    expect(getTracking).toHaveBeenCalledTimes(2)
    vi.mocked(getTracking).mockResolvedValue(card({ status: 'REJECTED', rejectReason: 'CLOSED', cardStatus: 'RELEASED' }))
    await tick(10_000)
    expect(getTracking).toHaveBeenCalledTimes(3)
    expect(money()).toBe(NOTHING)
    await tick(60_000)
    expect(getTracking).toHaveBeenCalledTimes(3)
  })

  it('cancelado con la tarjeta apartada o confirmándose también sigue sondeando', async () => {
    for (const cardStatus of ['AUTHORIZED', 'CONFIRMING'] as const) {
      vi.mocked(getTracking).mockReset()
      await show(card({ status: 'CANCELLED_BY_CUSTOMER', cardStatus }))
      await tick(10_000)
      expect(getTracking, cardStatus).toHaveBeenCalledTimes(2)
      cleanup()
    }
  })

  it('en inglés', async () => {
    await show(draft(), 'en')
    expect(screen.getByRole('heading', { name: 'Confirming your payment…' })).toBeTruthy()
    cleanup()
    await show(card({ status: 'PENDING_ACCEPTANCE' }), 'en')
    expect(money()).toBe('Your card is on hold; it is charged when the business accepts.')
  })
})

describe('fase 2: de regreso de Stripe (?pago)', () => {
  const T = 'T'.repeat(32)
  const draft = (over: Partial<Tracking> = {}) =>
    tr({ paymentMode: 'CARD_ONLINE', status: 'AWAITING_PAYMENT', orderNumber: '', cardStatus: null, canCancel: false, ...over })
  function back(ret: 'returned' | 'cancelled') {
    const s = makeStore(null, null)
    s.trackingToken.value = T
    s.paymentReturn = ret
    s.go('tracking')
    const view = render(withStore(s, <TrackingScreen />))
    return { s, view }
  }

  it('?pago=1: «Confirmando tu pago…» de inmediato, antes de que conteste el seguimiento', async () => {
    vi.mocked(getTracking).mockReturnValue(new Promise(() => {}))
    back('returned')
    await flush()
    expect(screen.getByText('Confirmando tu pago…')).toBeTruthy()
    expect(screen.queryByText('Cargando tu pedido…')).toBeNull()
    expect(abandonPayment).not.toHaveBeenCalled()
  })

  it('?pago=cancelado: «Cancelando el pago…» y abandon-payment UNA vez (nunca cancel); al confirmar, «No se completó el pago»', async () => {
    let answer!: (t: Tracking) => void
    vi.mocked(abandonPayment).mockReturnValue(new Promise(r => { answer = r }))
    vi.mocked(getTracking).mockResolvedValue(draft({ status: 'PAYMENT_NOT_COMPLETED' }))
    const { s, view } = back('cancelled')
    await flush()
    expect(screen.getByRole('heading', { name: 'Cancelando el pago…' })).toBeTruthy()
    expect(abandonPayment).toHaveBeenCalledTimes(1)
    expect(abandonPayment).toHaveBeenCalledWith(s.slug, T)
    expect(getTracking).not.toHaveBeenCalled() // el sondeo no le gana a la cancelación
    expect(cancelOrder).not.toHaveBeenCalled()
    // Se lee una sola vez: volver a pintar (o volver a esta pantalla) no cancela otra vez.
    expect(s.paymentReturn).toBeNull()
    view.rerender(withStore(s, <TrackingScreen />))
    await flush()
    answer(draft({ status: 'PAYMENT_NOT_COMPLETED' }))
    await flush()
    expect(screen.getByRole('heading', { name: 'No se completó el pago. No se te cobró nada.' })).toBeTruthy()
    await tick(60_000)
    expect(abandonPayment).toHaveBeenCalledTimes(1)
    expect(getTracking).not.toHaveBeenCalled() // final: no hace falta sondear
  })

  it('?pago=cancelado pero otra pestaña ya pagó: se muestra ese pedido y se sigue sondeando', async () => {
    vi.mocked(abandonPayment).mockResolvedValue(tr({ paymentMode: 'CARD_ONLINE', cardStatus: 'AUTHORIZED', orderNumber: '42' }))
    vi.mocked(getTracking).mockResolvedValue(tr({ paymentMode: 'CARD_ONLINE', cardStatus: 'AUTHORIZED', orderNumber: '42' }))
    back('cancelled')
    await flush()
    expect(screen.getByRole('heading', { name: 'Esperando que el negocio acepte' })).toBeTruthy()
    expect(screen.getByText('Tu tarjeta está apartada; se cobra cuando el negocio acepte.')).toBeTruthy()
    await tick(10_000)
    expect(getTracking).toHaveBeenCalledTimes(1)
  })

  it('?pago=cancelado sin red o con un 5xx: sigue «Cancelando el pago…» con «Reintentar»; nunca dice que se canceló', async () => {
    vi.mocked(abandonPayment).mockRejectedValueOnce(new ApiError('Sin conexión', 0, undefined, undefined, true))
    back('cancelled')
    await flush()
    expect(screen.getByRole('heading', { name: 'Cancelando el pago…' })).toBeTruthy()
    expect(screen.getByText('Sin conexión. Revisa tu internet y vuelve a intentar.')).toBeTruthy()
    expect(document.body.textContent).not.toContain('No se completó')
    await tick(60_000)
    expect(getTracking).not.toHaveBeenCalled()
    vi.mocked(abandonPayment).mockRejectedValueOnce(new ApiError('x', 503))
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    await flush()
    expect(abandonPayment).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('heading', { name: 'Cancelando el pago…' })).toBeTruthy()
    expect(screen.getByText('Algo falló de nuestro lado. Intenta de nuevo.')).toBeTruthy()
    vi.mocked(abandonPayment).mockResolvedValueOnce(draft({ status: 'PAYMENT_NOT_COMPLETED' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    await flush()
    expect(abandonPayment).toHaveBeenCalledTimes(3)
    expect(screen.getByRole('heading', { name: 'No se completó el pago. No se te cobró nada.' })).toBeTruthy()
  })
})

describe('fix ronda 1 (Codex r1): nunca «No se te cobró nada» con el dinero en duda; el abandono sobrevive a recargar', () => {
  const T = 'T'.repeat(32)
  const draft = (over: Partial<Tracking> = {}) =>
    tr({ paymentMode: 'CARD_ONLINE', status: 'AWAITING_PAYMENT', orderNumber: '', cardStatus: null, canCancel: false, ...over })
  const money = () => document.querySelector('.avq-o-total__tax')?.textContent ?? null
  const NOTHING = /No se te cobró nada/
  /** Una instancia NUEVA del seguimiento (como al recargar la pestaña): tienda nueva, sin `?pago`. */
  function mount(ret: 'cancelled' | null = null) {
    const s = makeStore(null, null)
    s.trackingToken.value = T
    s.paymentReturn = ret
    s.go('tracking')
    render(withStore(s, <TrackingScreen />))
    return s
  }

  it('PAYMENT_NOT_COMPLETED + RELEASING y luego CAPTURED: nunca «No se te cobró nada»; el sondeo sigue mientras se libera', async () => {
    await show(draft({ status: 'PAYMENT_NOT_COMPLETED', cardStatus: 'RELEASING' }))
    expect(screen.getByRole('heading', { name: 'No se completó el pago.' })).toBeTruthy()
    expect(money()).toBe('Estamos liberando tu tarjeta…')
    expect(document.body.textContent).not.toMatch(NOTHING)
    vi.mocked(getTracking).mockResolvedValue(draft({ status: 'PAYMENT_NOT_COMPLETED', cardStatus: 'CAPTURED' }))
    await tick(10_000)
    expect(getTracking).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('heading', { name: 'No se completó el pago.' })).toBeTruthy()
    expect(money()).toBe('Tu tarjeta se cobró; el negocio te la devolverá.')
    expect(document.body.textContent).not.toMatch(NOTHING)
    await tick(60_000)
    expect(getTracking).toHaveBeenCalledTimes(2) // cobrada: ya no está en duda
  })

  it('cerrado con la tarjeta apartada o confirmándose: titular sin promesa y «Estamos liberando tu tarjeta…» (nunca «se cobra al aceptar»)', async () => {
    const cases: Partial<Tracking>[] = [
      { status: 'PAYMENT_NOT_COMPLETED', orderNumber: '', cardStatus: 'AUTHORIZED' },
      { status: 'PAYMENT_NOT_COMPLETED', orderNumber: '', cardStatus: 'CONFIRMING' },
      { status: 'CANCELLED_BY_CUSTOMER', cardStatus: 'AUTHORIZED' },
      { status: 'REJECTED', rejectReason: 'CLOSED', cardStatus: 'CONFIRMING' },
      { status: 'EXPIRED', cardStatus: 'AUTHORIZED' },
    ]
    for (const over of cases) {
      vi.mocked(getTracking).mockReset()
      await show(tr({ paymentMode: 'CARD_ONLINE', canCancel: false, ...over }))
      expect(money(), JSON.stringify(over)).toBe('Estamos liberando tu tarjeta…')
      expect(document.body.textContent).not.toMatch(NOTHING)
      if (over.status === 'PAYMENT_NOT_COMPLETED') expect(screen.getByRole('heading', { name: 'No se completó el pago.' })).toBeTruthy()
      cleanup()
    }
  })

  it('el abandono pendiente se guarda ANTES de llamar; si falla y se recarga, la instancia nueva lo reintenta con «Cancelando el pago…»', async () => {
    let savedBeforeCall: string | null = null
    vi.mocked(abandonPayment).mockImplementationOnce(async () => {
      savedBeforeCall = JSON.stringify({ ...sessionStorage })
      throw new ApiError('HTTP 502', 502)
    })
    mount('cancelled')
    await flush()
    expect(savedBeforeCall).toContain(T)
    expect(screen.getByRole('heading', { name: 'Cancelando el pago…' })).toBeTruthy()
    cleanup()
    // Recarga: la URL ya no trae `?pago` y la tienda es nueva, pero la intención sigue guardada.
    vi.mocked(abandonPayment).mockRejectedValueOnce(new ApiError('Sin conexión', 0, undefined, undefined, true))
    mount()
    await flush()
    expect(abandonPayment).toHaveBeenCalledTimes(2)
    expect(abandonPayment).toHaveBeenLastCalledWith(expect.any(String), T)
    expect(screen.getByRole('heading', { name: 'Cancelando el pago…' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeTruthy()
    expect(getTracking).not.toHaveBeenCalled()
    // El servidor contesta: se borra y la siguiente recarga ya no cancela.
    vi.mocked(abandonPayment).mockResolvedValueOnce(draft({ status: 'PAYMENT_NOT_COMPLETED' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    await flush()
    expect(screen.getByRole('heading', { name: 'No se completó el pago. No se te cobró nada.' })).toBeTruthy()
    cleanup()
    vi.mocked(getTracking).mockResolvedValue(draft({ status: 'PAYMENT_NOT_COMPLETED' }))
    mount()
    await flush()
    expect(abandonPayment).toHaveBeenCalledTimes(3)
    expect(getTracking).toHaveBeenCalledTimes(1)
  })

  it('sin `?pago` (volvió con «atrás»): en AWAITING_PAYMENT, «Si ya pagaste, espera unos segundos.» y «Cancelar el pago» hace el mismo abandono', async () => {
    vi.mocked(getTracking).mockResolvedValue(draft())
    mount()
    await flush()
    expect(screen.getByRole('heading', { name: 'Confirmando tu pago…' })).toBeTruthy()
    expect(screen.getByText('Si ya pagaste, espera unos segundos.')).toBeTruthy()
    const btn = screen.getByRole('button', { name: 'Cancelar el pago' })
    expect(btn.classList.contains('avq-o-btn--primary')).toBe(false) // secundario
    let answer!: (t: Tracking) => void
    vi.mocked(abandonPayment).mockReturnValueOnce(new Promise(r => { answer = r }))
    fireEvent.click(btn)
    fireEvent.click(btn) // doble toque: una sola llamada
    await flush()
    expect(abandonPayment).toHaveBeenCalledTimes(1)
    expect(abandonPayment).toHaveBeenCalledWith(expect.any(String), T)
    expect(cancelOrder).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: 'Cancelando el pago…' })).toBeTruthy()
    expect(JSON.stringify({ ...sessionStorage })).toContain(T)
    await tick(30_000)
    expect(getTracking).toHaveBeenCalledTimes(1) // mientras se cancela, el sondeo no corre
    answer(draft({ status: 'PAYMENT_NOT_COMPLETED' }))
    await flush()
    expect(screen.getByRole('heading', { name: 'No se completó el pago. No se te cobró nada.' })).toBeTruthy()
    expect(JSON.stringify({ ...sessionStorage })).not.toContain(T)
  })

  it('«Cancelar el pago» sólo en AWAITING_PAYMENT', async () => {
    await show(tr({ paymentMode: 'CARD_ONLINE', cardStatus: 'AUTHORIZED' }))
    expect(screen.queryByRole('button', { name: 'Cancelar el pago' })).toBeNull()
    expect(screen.queryByText('Si ya pagaste, espera unos segundos.')).toBeNull()
  })
})

describe('fix ronda 2 y 3: el sondeo nunca se queda parado; la intención de cancelar vive sólo en sessionStorage, por pedido', () => {
  const T = 'T'.repeat(32)
  const draft = (over: Partial<Tracking> = {}) =>
    tr({ paymentMode: 'CARD_ONLINE', status: 'AWAITING_PAYMENT', orderNumber: '', cardStatus: null, canCancel: false, ...over })
  const order = () => tr({ paymentMode: 'CARD_ONLINE', cardStatus: 'AUTHORIZED', orderNumber: '42', canCancel: false })
  function mount(ret: 'cancelled' | null = null) {
    const s = makeStore(null, null)
    s.trackingToken.value = T
    s.paymentReturn = ret
    s.go('tracking')
    render(withStore(s, <TrackingScreen />))
    return s
  }
  /** Lo que haría la página al recargar: `?pago=cancelado` en la URL ⇒ el atributo ⇒ la tienda arranca cancelando. */
  const fromUrl = () => (new URLSearchParams(window.location.search).get('pago') === 'cancelado' ? 'cancelled' : null)

  it('GET en vuelo + «Cancelar el pago» que devuelve el pedido: el sondeo se reprograma y llega un GET nuevo', async () => {
    vi.mocked(getTracking).mockResolvedValueOnce(draft())
    mount()
    await flush()
    let late!: (t: Tracking) => void
    vi.mocked(getTracking).mockReturnValueOnce(new Promise(r => { late = r }))
    await tick(10_000) // el segundo GET sale y se queda en camino
    expect(getTracking).toHaveBeenCalledTimes(2)
    vi.mocked(abandonPayment).mockResolvedValueOnce(order())
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar el pago' }))
    await flush()
    expect(screen.getByRole('heading', { name: 'Esperando que el negocio acepte' })).toBeTruthy()
    await tick(10_000) // el tick encuentra el GET viejo todavía en camino
    late(draft()) // llega la respuesta vieja: se descarta (no vuelve el borrador)
    await flush()
    expect(screen.getByRole('heading', { name: 'Esperando que el negocio acepte' })).toBeTruthy()
    vi.mocked(getTracking).mockResolvedValue(order())
    await tick(10_000)
    expect(getTracking).toHaveBeenCalledTimes(3)
    await tick(10_000)
    expect(getTracking).toHaveBeenCalledTimes(4)
  })

  it('ronda 3 (a): el abandono de A con 404 borra su intención y no deja nada en la URL; crear B y recargar NO cancela B', async () => {
    const A = 'A'.repeat(32), B = 'B'.repeat(32)
    window.history.replaceState({}, '', `/flautas/pedido/${A}?app=order`) // la página ya quitó `?pago=cancelado` al entrar
    vi.mocked(abandonPayment).mockRejectedValueOnce(new ApiError('No encontrado', 404))
    const a = makeStore(null, null)
    a.trackingToken.value = A
    a.paymentReturn = 'cancelled'
    a.go('tracking')
    render(withStore(a, <TrackingScreen />))
    await flush()
    expect(screen.getByText('No encontramos ese pedido.')).toBeTruthy()
    expect(window.location.search).toBe('?app=order')
    expect(JSON.stringify({ ...sessionStorage })).not.toContain(A)
    cleanup()
    // Recargar A tampoco reintenta (el 404 es definitivo).
    vi.mocked(getTracking).mockRejectedValue(new ApiError('No encontrado', 404))
    const again = makeStore(null, null)
    again.trackingToken.value = A
    again.go('tracking')
    render(withStore(again, <TrackingScreen />))
    await flush()
    expect(abandonPayment).toHaveBeenCalledTimes(1)
    cleanup()
    // B: la página lo monta con lo que traiga la URL (la de B, como la deja `avoqado:pedido-creado`).
    window.history.replaceState({}, '', `/flautas/pedido/${B}${window.location.search}`)
    vi.mocked(getTracking).mockResolvedValue(draft())
    const b = makeStore(null, null)
    b.trackingToken.value = B
    b.paymentReturn = fromUrl()
    b.go('tracking')
    render(withStore(b, <TrackingScreen />))
    await flush()
    expect(abandonPayment).not.toHaveBeenCalledWith(expect.anything(), B)
    expect(screen.getByRole('heading', { name: 'Confirmando tu pago…' })).toBeTruthy()
  })

  it('ronda 3 (b): montado en una página ajena con `?pago=pendiente`, «Cancelar el pago» no toca su URL (ni al llamar ni con la respuesta)', async () => {
    window.history.replaceState({}, '', '/tienda-ajena?pago=pendiente&x=1')
    vi.mocked(getTracking).mockResolvedValue(draft())
    mount()
    await flush()
    let urlAtCall = ''
    vi.mocked(abandonPayment).mockImplementationOnce(async () => {
      urlAtCall = window.location.search
      return draft({ status: 'PAYMENT_NOT_COMPLETED' })
    })
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar el pago' }))
    await flush()
    expect(urlAtCall).toBe('?pago=pendiente&x=1')
    expect(window.location.pathname + window.location.search).toBe('/tienda-ajena?pago=pendiente&x=1')
    expect(screen.getByRole('heading', { name: 'No se completó el pago. No se te cobró nada.' })).toBeTruthy()
  })

  it('ronda 3: un 4xx definitivo (no 429) también borra la intención; sin red, 429 o 5xx se conserva y al montar se reintenta', async () => {
    for (const [err, keeps] of [
      [new ApiError('x', 400, 'VALIDATION'), false],
      [new ApiError('x', 409, 'X'), false],
      [new ApiError('HTTP 429', 429, 'RATE_LIMIT_EXCEEDED'), true],
      [new ApiError('x', 503), true],
      [new ApiError('Sin conexión', 0, undefined, undefined, true), true],
    ] as const) {
      sessionStorage.clear()
      vi.mocked(abandonPayment).mockReset()
      vi.mocked(abandonPayment).mockRejectedValueOnce(err)
      mount('cancelled')
      await flush()
      expect(JSON.stringify({ ...sessionStorage }).includes(T), `${err.status}`).toBe(keeps)
      cleanup()
      vi.mocked(abandonPayment).mockResolvedValueOnce(draft({ status: 'PAYMENT_NOT_COMPLETED' }))
      vi.mocked(getTracking).mockResolvedValue(draft())
      mount() // recarga sin `?pago`
      await flush()
      expect(abandonPayment, `${err.status}`).toHaveBeenCalledTimes(keeps ? 2 : 1)
      cleanup()
    }
  })

  it('ronda 3: sin almacenamiento, el abandono falla y se recarga ⇒ queda «Confirmando tu pago…» con «Cancelar el pago» (la salida aceptada)', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('lleno', 'QuotaExceededError') })
    vi.mocked(abandonPayment).mockRejectedValueOnce(new ApiError('HTTP 502', 502))
    mount('cancelled')
    await flush()
    expect(screen.getByRole('heading', { name: 'Cancelando el pago…' })).toBeTruthy()
    cleanup()
    vi.mocked(getTracking).mockResolvedValue(draft())
    mount()
    await flush()
    expect(abandonPayment).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('heading', { name: 'Confirmando tu pago…' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cancelar el pago' })).toBeTruthy()
    vi.restoreAllMocks()
  })
})

// Tienda híbrida, etapa 1 (W3): el folio de «Nadie» (requiresAcceptance === false), pagado en caja.
describe('W3: seguimiento del folio', () => {
  const NOW = '2026-10-17T19:00:00Z' // 13:00 en CDMX
  const T32 = 'T'.repeat(32)
  const folio = (over: Partial<Tracking> = {}): Tracking => tr({
    orderNumber: 'W7K3P', requiresAcceptance: false, channel: 'QR', canCancel: true, total: 134,
    acceptDeadlineAt: '2026-10-17T19:30:00Z',
    items: [
      { name: 'Latte', quantity: 1, note: null, modifiers: [{ name: 'Leche de almendra', quantity: 1 }] },
      { name: 'Shake de proteína', quantity: 1, note: null, modifiers: [] },
    ],
    ...over,
  })
  async function showF(t: Tracking, locale: 'es' | 'en' = 'es', name: string | null = 'Ana') {
    vi.setSystemTime(new Date(NOW))
    localStorage.clear()
    vi.mocked(getTracking).mockResolvedValue(t)
    const s = makeStore(null, null, locale)
    if (name) saveLastOrder(s.slug, { trackingToken: T32, orderNumber: 'W7K3P', name })
    s.trackingToken.value = T32
    s.go('tracking')
    const r = render(withStore(s, <TrackingScreen />))
    await flush()
    return { s, r }
  }

  it('por pagar: «Pasa a pagar en caja», la hora, «Faltan 30 min», el folio en grande con el nombre, el total y el aviso de IVA', async () => {
    await showF(folio())
    expect(screen.getByRole('heading', { name: 'Pasa a pagar en caja' })).toBeTruthy()
    expect(screen.getByText('Se cancela solo a las 13:30 si no pasas a pagar.')).toBeTruthy()
    expect(screen.getByText('Faltan 30 min')).toBeTruthy()
    expect(screen.getByText('Tu folio')).toBeTruthy()
    const n = screen.getByText('W7K3P')
    expect(n.classList.contains('avq-o-ticket__n')).toBe(true)
    expect(screen.getByText('Ana').closest('.avq-o-ticket__folio')).toBeTruthy() // el nombre bajo el folio
    expect(screen.getByText('Enséñalo en caja o dile tu folio.')).toBeTruthy()
    expect(screen.getByText('Total').parentElement!.textContent).toContain('$134')
    expect(screen.getByText('Pagas en caja: tarjeta o efectivo. IVA incluido.')).toBeTruthy()
    expect(screen.getByText('Si cierras esta página, en caja te encuentran por tu nombre.')).toBeTruthy()
    expect(screen.queryByText(/Esperando que el negocio acepte/)).toBeNull()
    expect(screen.queryByText(/Dilo en el mostrador/)).toBeNull()
    expect(progress()!.querySelector('[aria-current="step"]')!.textContent).toBe('Pedido')
    expect(Array.from(progress()!.querySelectorAll('li')).map(li => li.textContent)).toEqual(['Pedido', 'Pagado', 'Listo', 'Entregado'])
  })
  it('sin nombre guardado, no inventa uno', async () => {
    await showF(folio(), 'es', null)
    expect(document.querySelector('.avq-o-ticket__folio')!.textContent).toBe('Tu folioW7K3PEnséñalo en caja o dile tu folio.')
  })
  it('«Faltan N min» baja cada minuto y se pone ámbar con 5 o menos (nunca rojo)', async () => {
    await showF(folio())
    expect(document.querySelector('.avq-o-chip--warn')).toBeNull()
    await tick(26 * 60_000)
    expect(screen.getByText('Faltan 4 min')).toBeTruthy()
    const chip = screen.getByText('Faltan 4 min').closest('.avq-o-chip') as HTMLElement
    expect(chip.classList.contains('avq-o-chip--warn')).toBe(true)
    expect(document.querySelector('.avq-o-chip--error, .avq-o-notice--error')).toBeNull()
  })
  it('«Cancelar mi pedido» pregunta: «¿Cancelar tu pedido?» y «Tu folio W7K3P deja de servir en caja.»', async () => {
    await showF(folio())
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar mi pedido' }))
    expect(screen.getByText('¿Cancelar tu pedido?', { selector: 'p' })).toBeTruthy()
    expect(screen.getByText('Tu folio W7K3P deja de servir en caja.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sí, cancelar' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'No' })).toBeTruthy()
  })
  it('pagado: «¡Pagado! Lo están preparando», pasos con «Pagado», «PAGADO» + folio + lo que pidió y el nombre', async () => {
    await showF(folio({ status: 'ACCEPTED', paid: true, canCancel: false, estimatedReadyAt: '2026-10-17T19:30:00Z' }))
    expect(screen.getByRole('heading', { name: '¡Pagado! Lo están preparando' })).toBeTruthy()
    expect(screen.getByText('Estará listo como a las 13:30. Enseña esta pantalla al recoger.')).toBeTruthy()
    expect(progress()!.querySelector('[aria-current="step"]')!.textContent).toBe('Pagado')
    const card = document.querySelector('.avq-o-paid') as HTMLElement
    expect(card.textContent).toContain('PAGADO')
    expect(within(card).getByText('W7K3P').classList.contains('avq-o-paid__n')).toBe(true)
    expect(card.textContent).toContain('Latte · Shake de proteína')
    expect(card.textContent).toContain('Ana · pagado hoy')
    expect(screen.queryByRole('button', { name: /Cancelar/ })).toBeNull()
    expect(screen.queryByText(/Pagas en caja/)).toBeNull()
  })
  it('«En vivo · HH:MM:SS» avanza cada segundo (también con reducir movimiento: sólo el punto deja de latir)', async () => {
    await showF(folio({ status: 'ACCEPTED', paid: true, canCancel: false }))
    expect(screen.getByText('En vivo · 13:00:00')).toBeTruthy()
    await tick(3000)
    expect(screen.getByText('En vivo · 13:00:03')).toBeTruthy()
    const css = STORE_CSS
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[^}]*\.avq-o-live__dot/)
  })
  it('listo: «¡Listo para recoger!», «Pasa por él y enseña esta pantalla.» y la pestaña «¡Listo! · Flautas» (se restaura al salir)', async () => {
    document.title = 'Pedir'
    const { r } = await showF(folio({ status: 'READY', paid: true, canCancel: false }))
    expect(screen.getByRole('heading', { name: '¡Listo para recoger!' })).toBeTruthy()
    expect(screen.getByText('Pasa por él y enseña esta pantalla.')).toBeTruthy()
    expect(progress()!.querySelector('[aria-current="step"]')!.textContent).toBe('Listo')
    expect(document.title).toBe('¡Listo! · Flautas')
    r.unmount()
    expect(document.title).toBe('Pedir')
  })
  it('entregado: «¡Gracias, Ana!», paso «Entregado» y deja de sondear', async () => {
    await showF(folio({ status: 'COMPLETED', paid: true, canCancel: false }))
    expect(screen.getByRole('heading', { name: 'Entregado' })).toBeTruthy()
    expect(screen.getByText('¡Gracias, Ana!')).toBeTruthy()
    expect(progress()!.querySelector('[aria-current="step"]')!.textContent).toBe('Entregado')
    await tick(60_000)
    expect(getTracking).toHaveBeenCalledTimes(1)
  })
  it('vencido en «Nadie»: su texto, «¿Todavía lo quieres?», folio tachado y NUNCA «No se te cobró nada»', async () => {
    await showF(folio({ status: 'EXPIRED', canCancel: false }))
    expect(screen.getByRole('heading', { name: 'Se canceló tu pedido' })).toBeTruthy()
    expect(screen.getByText('Se canceló porque no se registró el pago a tiempo. Si ya pagaste en caja, no pasa nada: muéstrale tu folio a la cajera.')).toBeTruthy()
    expect(screen.getByText('¿Todavía lo quieres?')).toBeTruthy()
    expect(screen.getByText('Pídelo directo en caja.')).toBeTruthy()
    expect(screen.getByText('W7K3P').classList.contains('avq-o-ticket__n--void')).toBe(true)
    expect(document.body.textContent).not.toMatch(/No se te cobró nada/)
    expect(progress()).toBeNull()
  })
  it('vencido: sigue consultando 2 h después de su hora, y cambia a «PAGADO» si llega el dinero', async () => {
    await showF(folio({ status: 'EXPIRED', canCancel: false }))
    expect(getTracking).toHaveBeenCalledTimes(1)
    await tick(60 * 60_000) // 1 h después: sigue
    expect(screen.getByRole('heading', { name: 'Se canceló tu pedido' })).toBeTruthy() // sigue vivo y consultando
    vi.mocked(getTracking).mockResolvedValue(folio({ status: 'EXPIRED', paid: true, canCancel: false }))
    await tick(10_000)
    expect(screen.getByRole('heading', { name: '¡Pagado! Lo están preparando' })).toBeTruthy()
    expect(document.querySelector('.avq-o-paid')!.textContent).toContain('PAGADO')
    expect(document.body.textContent).not.toMatch(/Se canceló tu pedido/)
  })
  it('vencido: pasadas 2 h de su hora deja de consultar', async () => {
    await showF(folio({ status: 'EXPIRED', canCancel: false }))
    await tick(2 * 60 * 60_000 + 40 * 60_000) // 30 min de plazo + 2 h
    const n = vi.mocked(getTracking).mock.calls.length
    await tick(10 * 60_000)
    expect(getTracking).toHaveBeenCalledTimes(n)
  })
  it('lo canceló el negocio: «Si tienes dudas, pregunta en caja.» y «Volver al menú»', async () => {
    await showF(folio({ status: 'CANCELLED_BY_STAFF', canCancel: false }))
    expect(screen.getByRole('heading', { name: 'El negocio canceló tu pedido' })).toBeTruthy()
    expect(screen.getByText('Si tienes dudas, pregunta en caja.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Volver al menú' })).toBeTruthy()
  })
  it('sin red: el folio sigue a la vista con «Sin conexión: te enseñamos lo último que supimos…», en ámbar, y sin cuenta regresiva', async () => {
    await showF(folio())
    vi.mocked(getTracking).mockRejectedValue(new ApiError('Sin conexión', 0, undefined, undefined, true))
    await tick(10_000)
    expect(screen.getByText(/Sin conexión: te enseñamos lo último que supimos/)).toBeTruthy()
    expect(screen.getByText('W7K3P')).toBeTruthy()
    expect(screen.getByText('Se cancela solo a las 13:30 si no pasas a pagar.')).toBeTruthy()
    expect(screen.queryByText(/^Faltan/)).toBeNull()
    expect(document.querySelector('.avq-o-notice--warn')).toBeTruthy()
    expect(document.querySelector('.avq-o-notice--error')).toBeNull()
  })
  it('sin red y pagado: el «PAGADO» sigue a la vista', async () => {
    await showF(folio({ status: 'ACCEPTED', paid: true, canCancel: false }))
    vi.mocked(getTracking).mockRejectedValue(new ApiError('Sin conexión', 0, undefined, undefined, true))
    await tick(10_000)
    expect(screen.getByText(/lo último que supimos/)).toBeTruthy()
    expect(document.querySelector('.avq-o-paid')!.textContent).toContain('PAGADO')
  })
  it('en inglés', async () => {
    await showF(folio(), 'en')
    expect(screen.getByRole('heading', { name: 'Go pay at the counter' })).toBeTruthy()
    expect(screen.getByText('Your order number')).toBeTruthy()
    cleanup()
    await showF(folio({ status: 'ACCEPTED', paid: true, canCancel: false }), 'en')
    expect(screen.getByRole('heading', { name: 'Paid! They are preparing it' })).toBeTruthy()
    expect(document.querySelector('.avq-o-paid')!.textContent).toContain('PAID')
  })
  it('«Mi equipo» (requiresAcceptance true o ausente) no cambia', async () => {
    for (const requiresAcceptance of [true, undefined]) {
      await showF(tr({ requiresAcceptance }))
      expect(screen.getByRole('heading', { name: 'Esperando que el negocio acepte' })).toBeTruthy()
      expect(screen.getByText('Dilo en el mostrador al recoger.')).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Cancelar pedido' })).toBeTruthy()
      expect(document.querySelector('.avq-o-paid')).toBeNull()
      cleanup()
    }
  })

  // ---- W3b ----
  it('R67: con paidAt y customerName dice «<Nombre> · pagado hoy a las HH:MM» (el nombre del servidor gana al guardado)', async () => {
    await showF(folio({ status: 'ACCEPTED', paid: true, canCancel: false, customerName: 'Ana María', paidAt: '2026-10-17T19:14:00Z' }))
    expect(document.querySelector('.avq-o-paid__who')!.textContent).toBe('Ana María · pagado hoy a las 13:14')
  })
  it('R67: con paidAt y sin ningún nombre: «Pagado hoy a las HH:MM»; sin paidAt, el texto honesto de antes', async () => {
    await showF(folio({ status: 'ACCEPTED', paid: true, canCancel: false, paidAt: '2026-10-17T19:14:00Z' }), 'es', null)
    expect(document.querySelector('.avq-o-paid__who')!.textContent).toBe('Pagado hoy a las 13:14')
    cleanup()
    await showF(folio({ status: 'ACCEPTED', paid: true, canCancel: false }))
    expect(document.querySelector('.avq-o-paid__who')!.textContent).toBe('Ana · pagado hoy')
  })
  it('R67: con unitPrice/total por renglón, el folio por pagar los muestra; sin ellos, no hay precios', async () => {
    const items = [
      { name: 'Latte', quantity: 2, note: null, modifiers: [], unitPrice: 65, total: 130 },
      { name: 'Shake', quantity: 1, note: null, modifiers: [], unitPrice: 69, total: 69 },
    ]
    await showF(folio({ items, total: 199 }))
    const rows = Array.from(document.querySelectorAll('.avq-o-ticket__lines > li'))
    expect(rows[0].textContent).toContain('$130')
    expect(rows[1].textContent).toContain('$69')
    cleanup()
    await showF(folio())
    expect(document.querySelector('.avq-o-ticket__price')).toBeNull()
  })
  it('m3: pasada la hora límite no hay «Faltan 1 min» (se oculta el chip)', async () => {
    await showF(folio())
    await tick(30 * 60_000 + 5_000)
    expect(screen.queryByText(/^Faltan/)).toBeNull()
    expect(document.querySelector('.avq-o-chip')).toBeNull()
  })
  it('m3: el reloj de 1 s no corre al entregar ni en un cancelado; sí en un pagado sin entregar', async () => {
    const spy = vi.spyOn(globalThis, 'setInterval')
    const ticks = () => spy.mock.calls.filter(c => c[1] === 1000).length
    await showF(folio({ status: 'COMPLETED', paid: true, canCancel: false }))
    expect(screen.queryByText(/^En vivo/)).toBeNull()
    expect(ticks()).toBe(0)
    cleanup()
    await showF(folio({ status: 'CANCELLED_BY_STAFF', canCancel: false }))
    expect(ticks()).toBe(0)
    cleanup()
    await showF(folio({ status: 'ACCEPTED', paid: true, canCancel: false }))
    expect(ticks()).toBe(1)
    spy.mockRestore()
  })
  it('m3: un vencido que ya está pagado deja de consultar', async () => {
    await showF(folio({ status: 'EXPIRED', paid: true, canCancel: false }))
    expect(screen.getByRole('heading', { name: '¡Pagado! Lo están preparando' })).toBeTruthy()
    await tick(60_000)
    expect(getTracking).toHaveBeenCalledTimes(1)
  })
})
