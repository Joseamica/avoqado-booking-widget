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
import type { OnlineOrderStatus, Tracking } from '../types'

let visibility = 'visible'
beforeEach(() => {
  vi.useFakeTimers()
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
    expect(screen.getByText(/Esperando que el restaurante acepte/)).toBeTruthy()
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
    expect(screen.getByText(/Esperando que el restaurante acepte/)).toBeTruthy()
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
    ['PENDING_ACCEPTANCE', 'PENDING_ACCEPTANCE', {}, 'Esperando que el restaurante acepte', 'Tiene hasta las 13:05 para aceptarlo.', 'Recibido'],
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
    ['REJECTED', { rejectReason: 'OUT_OF_ITEMS', canCancel: false }, 'El restaurante no pudo aceptar tu pedido: Sin ingredientes. No se te cobró nada.'],
    ['EXPIRED', { canCancel: false }, 'El restaurante no contestó a tiempo. No se te cobró nada.'],
    ['CANCELLED_BY_CUSTOMER', { canCancel: false }, 'Cancelaste tu pedido.'],
    ['CANCELLED_BY_STAFF', { canCancel: false }, 'El restaurante canceló tu pedido.'],
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
      ['REJECTED', { rejectReason: null, canCancel: false }, 'El restaurante no pudo aceptar tu pedido. No se te cobró nada.'],
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
    expect(screen.queryByText('El restaurante canceló tu pedido.')).toBeNull()
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
    expect(screen.getByText('Este pedido ya tiene un pago; llama al restaurante.')).toBeTruthy()
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
      [{ status: 'PENDING_ACCEPTANCE', cardStatus: 'AUTHORIZED' }, 'Tu tarjeta está apartada; se cobra cuando el restaurante acepte.'],
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
    expect(screen.getByRole('heading', { name: 'El restaurante no pudo aceptar tu pedido: Sin ingredientes.' })).toBeTruthy()
    expect(document.body.textContent).not.toContain('No se te cobró nada')
    cleanup()
    await show(card({ status: 'EXPIRED', cardStatus: 'CAPTURED' }))
    expect(screen.getByRole('heading', { name: 'El restaurante no contestó a tiempo.' })).toBeTruthy()
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
    expect(money()).toBe('Your card is on hold; it is charged when the restaurant accepts.')
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
    expect(screen.getByRole('heading', { name: 'Esperando que el restaurante acepte' })).toBeTruthy()
    expect(screen.getByText('Tu tarjeta está apartada; se cobra cuando el restaurante acepte.')).toBeTruthy()
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
