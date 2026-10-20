import { h } from 'preact'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return { ...actual, getTracking: vi.fn(), cancelOrder: vi.fn(), getInfo: vi.fn(), getMenu: vi.fn() }
})
import { ApiError, cancelOrder, getTracking } from '../api'
import { TrackingScreen } from './TrackingScreen'
import { makeStore, withStore } from './testKit'
import type { OnlineOrderStatus, Tracking } from '../types'

let visibility = 'visible'
beforeEach(() => {
  vi.useFakeTimers()
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
  vi.mocked(getTracking).mockReset()
  vi.mocked(cancelOrder).mockReset()
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
