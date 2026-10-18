import { h } from 'preact'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return { ...actual, getInfo: vi.fn(), getMenu: vi.fn(), getTracking: vi.fn() }
})
import { ApiError, getInfo, getMenu, getTracking } from '../api'
import { loadLastOrder, saveLastOrder } from '../session'
import { MenuScreen } from './MenuScreen'
import { OrderApp } from './OrderApp'
import { infoOf, makeStore, menuOf, product, withStore } from './testKit'

beforeEach(() => { sessionStorage.clear(); localStorage.clear() })
afterEach(cleanup)
const flush = () => act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve() })
const show = (store: ReturnType<typeof makeStore>) => render(withStore(store, <MenuScreen />))

describe('estado de la tienda', () => {
  it('DISABLED: sin carta', () => {
    show(makeStore(infoOf({ status: 'DISABLED' }), menuOf(product())))
    expect(screen.getByText('Este restaurante no recibe pedidos en línea por el momento.')).toBeTruthy()
    expect(screen.queryByText('Flautas de pollo')).toBeNull()
  })
  it('403 PLAN_REQUIRED: igual que DISABLED', () => {
    const s = makeStore(null, null)
    s.infoError.value = new ApiError('x', 403, 'PLAN_REQUIRED')
    show(s)
    expect(screen.getByText('Este restaurante no recibe pedidos en línea por el momento.')).toBeTruthy()
  })
  it('CLOSED con horario de hoy, sin horario hoy y nocturno', () => {
    const day = (ranges: { open: string; close: string }[]) => ({ enabled: ranges.length > 0, ranges })
    const week = (d: ReturnType<typeof day>) => Object.fromEntries(['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].map(k => [k, d])) as any
    const closed = (d: ReturnType<typeof day>) => makeStore(infoOf({ status: 'CLOSED', reason: 'OUTSIDE_HOURS', hours: week(d) }), menuOf(product()))
    show(closed(day([{ open: '13:00', close: '17:00' }])))
    expect(screen.getByText('Cerrado ahora. Hoy: 13:00–17:00')).toBeTruthy()
    cleanup()
    show(closed(day([])))
    expect(screen.getByText('Cerrado ahora. Hoy no abre')).toBeTruthy()
    cleanup()
    show(closed(day([{ open: '22:00', close: '02:00' }])))
    expect(screen.getByText('Cerrado ahora. Hoy: 22:00–2:00 del día siguiente')).toBeTruthy()
  })
  it('PAUSED MANUAL_PAUSE / TOO_BUSY y OFFLINE', () => {
    show(makeStore(infoOf({ status: 'PAUSED', reason: 'MANUAL_PAUSE' }), menuOf(product())))
    expect(screen.getByText('Hoy no estamos recibiendo pedidos en línea.')).toBeTruthy()
    cleanup()
    show(makeStore(infoOf({ status: 'PAUSED', reason: 'TOO_BUSY' }), menuOf(product())))
    expect(screen.getByText('Muchos pedidos en este momento. Intenta en unos minutos.')).toBeTruthy()
    cleanup()
    show(makeStore(infoOf({ status: 'OFFLINE', reason: 'NO_DEVICE' }), menuOf(product())))
    expect(screen.getByText('El restaurante no está conectado. Intenta en unos minutos.')).toBeTruthy()
  })
  it('W6: pausa con hora (pausedUntil) dice a qué hora vuelve, en la zona del negocio; sin hora, el texto de siempre', () => {
    const paused = (pausedUntil: string | null, locale: 'es' | 'en' = 'es') =>
      makeStore(infoOf({ status: 'PAUSED', reason: 'MANUAL_PAUSE', pausedUntil }), menuOf(product()), locale)
    show(paused('2026-10-17T19:30:00Z'))
    expect(screen.getByText('En este momento no estamos recibiendo pedidos. Volvemos a recibirlos a las 13:30.')).toBeTruthy()
    cleanup()
    show(paused('2026-10-17T19:30:00Z', 'en'))
    expect(screen.getByText(/^We're not taking orders right now\. We'll be back at 1:30\sPM\.$/)).toBeTruthy()
    cleanup()
    show(paused(null))
    expect(screen.getByText('Hoy no estamos recibiendo pedidos en línea.')).toBeTruthy()
  })
  it('con la tienda no abierta se ve la carta pero no se puede agregar', () => {
    const s = makeStore(infoOf({ status: 'CLOSED' }), menuOf(product()))
    show(s)
    const btn = screen.getByRole('button', { name: /Flautas de pollo/ }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    fireEvent.click(btn)
    expect(s.productId.value).toBeNull()
  })
})

describe('errores de carga', () => {
  it('404 VENUE_NOT_FOUND', () => {
    const s = makeStore(null, null); s.infoError.value = new ApiError('no', 404, 'VENUE_NOT_FOUND')
    show(s)
    expect(screen.getByText('No encontramos este restaurante.')).toBeTruthy()
  })
  it('5xx: mensaje del servidor (o genérico) + Reintentar que llama a load()', async () => {
    vi.mocked(getInfo).mockResolvedValue(infoOf()); vi.mocked(getMenu).mockResolvedValue(menuOf(product()))
    const s = makeStore(infoOf(), null); s.infoError.value = new ApiError('Servidor ocupado', 503)
    show(s)
    expect(screen.getByText('Servidor ocupado')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    await flush()
    expect(getMenu).toHaveBeenCalled()
    expect(screen.getByText('Flautas de pollo')).toBeTruthy()
    cleanup()
    const g = makeStore(null, null); g.infoError.value = new ApiError('', 500)
    show(g)
    expect(screen.getByText('No pudimos cargar la tienda.')).toBeTruthy()
  })
  it('sin red', () => {
    const s = makeStore(null, null); s.infoError.value = new ApiError('Sin conexión', 0, undefined, undefined, true)
    show(s)
    expect(screen.getByText('Sin conexión. Revisa tu internet y vuelve a intentar.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeTruthy()
  })
  it('/info bien pero /menu falló: aviso con Reintentar, no el banner', () => {
    const s = makeStore(infoOf({ status: 'CLOSED' }), null); s.infoError.value = new ApiError('', 500)
    show(s)
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeTruthy()
    expect(screen.queryByText(/Cerrado ahora/)).toBeNull()
  })
})

describe('refresco fallido con la carta ya cargada', () => {
  it('la carta sigue visible con un aviso chico; sin carta, la pantalla de error', () => {
    const s = makeStore(infoOf({ status: 'CLOSED' }), menuOf(product()))
    s.infoError.value = new ApiError('Sin conexión', 0, undefined, undefined, true)
    show(s)
    expect(screen.getByText('Flautas de pollo')).toBeTruthy()
    expect(screen.getByText('Sin conexión; reintentando…')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Reintentar' })).toBeNull()
    cleanup()
    const t = makeStore(infoOf(), menuOf(product())); t.infoError.value = new ApiError('Servidor ocupado', 503)
    show(t)
    expect(screen.getByText('Servidor ocupado')).toBeTruthy()
    expect(screen.getByText('Flautas de pollo')).toBeTruthy()
  })
  it('/info falló pero /menu cargó: pantalla de error con Reintentar (no en blanco)', async () => {
    vi.mocked(getInfo).mockResolvedValue(infoOf()); vi.mocked(getMenu).mockResolvedValue(menuOf(product()))
    const s = makeStore(null, menuOf(product())); s.infoError.value = new ApiError('Servidor ocupado', 503)
    show(s)
    expect(screen.getByText('Servidor ocupado')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    await flush()
    expect(getInfo).toHaveBeenCalled()
  })
  it('un 404 que no es VENUE_NOT_FOUND cae en el genérico con Reintentar', () => {
    const s = makeStore(null, null); s.infoError.value = new ApiError('', 404, 'OTRA')
    show(s)
    expect(screen.queryByText('No encontramos este restaurante.')).toBeNull()
    expect(screen.getByText('No pudimos cargar la tienda.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeTruthy()
  })
  it('si el producto de la ficha ya no está en la carta recargada, se cierra', async () => {
    const s = makeStore(infoOf(), menuOf(product()))
    s.productId.value = 'p1'
    show(s)
    expect(screen.getByRole('dialog')).toBeTruthy()
    await act(async () => { s.menu.value = menuOf(product({ id: 'p2', name: 'Agua' })) })
    expect(s.productId.value).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('Agua')).toBeTruthy()
  })
})

describe('carta', () => {
  it('sin categorías y truncada', () => {
    const empty = makeStore(infoOf(), { generatedAt: '', truncated: false, categories: [] })
    show(empty)
    expect(screen.getByText('Todavía no hay productos en línea.')).toBeTruthy()
    cleanup()
    show(makeStore(infoOf(), { ...menuOf(product()), truncated: true }))
    expect(screen.getByText('Esta carta es muy grande; algunos productos no se muestran aquí.')).toBeTruthy()
  })
  it('producto con nombre, descripción, precio e imagen si hay', () => {
    show(makeStore(infoOf(), menuOf(product({ imageUrl: 'https://x/y.png' }), product({ id: 'p2', name: 'Agua', description: null, price: 25.5 }))))
    expect(screen.getByText('Con crema')).toBeTruthy()
    expect(screen.getByText('$85')).toBeTruthy()
    expect(screen.getByText('$25.50')).toBeTruthy()
    expect(document.querySelectorAll('img').length).toBe(1)
  })
  it('buscar «flauta» sin acentos ni mayúsculas', () => {
    show(makeStore(infoOf(), menuOf(product(), product({ id: 'p2', name: 'FLÁUTA dorada' }), product({ id: 'p3', name: 'Agua' }))))
    fireEvent.input(screen.getByRole('searchbox'), { target: { value: 'flauta' } })
    expect(screen.getByText('Flautas de pollo')).toBeTruthy()
    expect(screen.getByText('FLÁUTA dorada')).toBeTruthy()
    expect(screen.queryByText('Agua')).toBeNull()
  })
  it('las categorías son pastillas que filtran', () => {
    const m = menuOf(product())
    m.categories.push({ id: 'c2', name: 'Bebidas', productCount: 1, products: [product({ id: 'p9', name: 'Agua' })] })
    show(makeStore(infoOf(), m))
    fireEvent.click(screen.getByRole('button', { name: 'Bebidas' }))
    expect(screen.getByText('Agua')).toBeTruthy()
    expect(screen.queryByText('Flautas de pollo')).toBeNull()
  })
  it('abrir un producto abre su ficha; CartBar refleja el carrito', () => {
    const s = makeStore(infoOf(), menuOf(product()))
    s.cart.value = [{ lineId: 'l', productId: 'p1', name: 'Flautas', unitPrice: 85, quantity: 2, modifiers: [], note: null }]
    show(s)
    expect(screen.getByRole('button', { name: 'Ver pedido · 2 · $170' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Flautas de pollo/ }))
    expect(s.productId.value).toBe('p1')
  })
})

describe('OrderApp', () => {
  it('pone --avq-accent desde la marca, con el atributo de respaldo, y muestra el aviso', () => {
    const s = makeStore(infoOf({ brand: { logo: null, logoFull: null, primaryColor: '#112233', secondaryColor: null } }), menuOf(product()))
    s.notice.value = 'Aviso de prueba'
    const { container } = render(withStore(s, <OrderApp accentColor="#abcdef" />))
    expect((container.firstElementChild as HTMLElement).style.getPropertyValue('--avq-accent')).toBe('#112233')
    expect(screen.getByText('Aviso de prueba')).toBeTruthy()
    cleanup()
    const s2 = makeStore(infoOf(), menuOf(product()))
    const r = render(withStore(s2, <OrderApp accentColor="#abcdef" />))
    expect((r.container.firstElementChild as HTMLElement).style.getPropertyValue('--avq-accent')).toBe('#abcdef')
  })
  it('W1: cabecera con el nombre y el logo del restaurante en la carta, el carrito y los datos; no en el seguimiento', async () => {
    vi.mocked(getTracking).mockResolvedValue({
      orderNumber: '7', status: 'ACCEPTED', paymentMode: 'PAY_AT_PICKUP', venueName: 'Flautas Coyoacán', venueSlug: 'a', items: [],
      total: 0, paid: false, estimatedReadyAt: null, acceptDeadlineAt: '2026-10-17T19:05:00Z', rejectReason: null, createdAt: '', canCancel: false,
    })
    const venue = { slug: 'a', name: 'Flautas Coyoacán', timezone: 'America/Mexico_City', currency: 'MXN' }
    const s = makeStore(infoOf({ venue, brand: { logo: 'https://x/logo.png', logoFull: 'https://x/full.png', primaryColor: null, secondaryColor: null } }), menuOf(product()))
    render(withStore(s, <OrderApp />))
    const header = () => screen.getByRole('banner')
    expect(header().textContent).toBe('Flautas Coyoacán')
    expect(header().querySelector('img')!.getAttribute('src')).toBe('https://x/logo.png')
    for (const sc of ['cart', 'details'] as const) {
      await act(async () => { s.go(sc) })
      expect(header().textContent).toBe('Flautas Coyoacán')
    }
    await act(async () => { s.trackingToken.value = 'T'.repeat(32); s.go('tracking') })
    await flush()
    expect(screen.queryByRole('banner')).toBeNull()
    cleanup()
    // Sólo el logo ancho: también sirve.
    render(withStore(makeStore(infoOf({ venue, brand: { logo: null, logoFull: 'https://x/full.png', primaryColor: null, secondaryColor: null } }), menuOf(product())), <OrderApp />))
    expect(header().querySelector('img')!.getAttribute('src')).toBe('https://x/full.png')
  })
})

describe('pedido en curso (lo pinta OrderApp: se ve en TODAS las ramas)', () => {
  const trk = (status: string) => ({
    orderNumber: '7', status, paymentMode: 'PAY_AT_PICKUP', venueName: 'Flautas', venueSlug: 'a', items: [], total: 0, paid: false,
    estimatedReadyAt: null, acceptDeadlineAt: '2026-10-17T19:05:00Z', rejectReason: null, createdAt: '', canCancel: false,
  }) as any
  const withLast = (s: ReturnType<typeof makeStore>) => saveLastOrder(s.slug, { trackingToken: 'T'.repeat(32), orderNumber: '7' })
  const app = (s: ReturnType<typeof makeStore>) => render(withStore(s, <OrderApp />))
  it('no final: «Tienes un pedido en curso · Ver» lleva al seguimiento', async () => {
    const s = makeStore(infoOf(), menuOf(product())); withLast(s)
    vi.mocked(getTracking).mockResolvedValue(trk('ACCEPTED'))
    app(s); await flush()
    expect(screen.getByText('Tienes un pedido en curso')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Ver' }))
    expect(s.screen.value).toBe('tracking')
    expect(s.trackingToken.value).toBe('T'.repeat(32))
  })
  it('con el plan vencido (/info 403 PLAN_REQUIRED) igual se ve y lleva al seguimiento', async () => {
    const plan = new ApiError('x', 403, 'PLAN_REQUIRED')
    vi.mocked(getInfo).mockRejectedValue(plan); vi.mocked(getMenu).mockRejectedValue(plan)
    vi.mocked(getTracking).mockResolvedValue(trk('PENDING_ACCEPTANCE'))
    const s = makeStore(null, null); withLast(s)
    app(s); await flush()
    expect(screen.getByText('Este restaurante no recibe pedidos en línea por el momento.')).toBeTruthy()
    expect(screen.getByText('Tienes un pedido en curso')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Ver' }))
    expect(s.screen.value).toBe('tracking')
    expect(s.trackingToken.value).toBe('T'.repeat(32))
  })
  it('final: se olvida sin aviso', async () => {
    const s = makeStore(infoOf(), menuOf(product())); withLast(s)
    vi.mocked(getTracking).mockResolvedValue(trk('COMPLETED'))
    app(s); await flush()
    expect(screen.queryByText('Tienes un pedido en curso')).toBeNull()
    expect(loadLastOrder(s.slug)).toBeNull()
  })
  it('404: se olvida y avisa «No encontramos ese pedido.»', async () => {
    const s = makeStore(infoOf(), menuOf(product())); withLast(s)
    vi.mocked(getTracking).mockRejectedValue(new ApiError('x', 404))
    app(s); await flush()
    expect(loadLastOrder(s.slug)).toBeNull()
    expect(s.notice.value).toBe('No encontramos ese pedido.')
    expect(screen.getByText('No encontramos ese pedido.')).toBeTruthy()
  })
})
