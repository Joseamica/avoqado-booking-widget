import { h } from 'preact'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return { ...actual, getInfo: vi.fn(), getMenu: vi.fn(), getTracking: vi.fn() }
})
import { ApiError, getInfo, getMenu, getTracking } from '../api'
import { loadLastOrder, saveLastOrder } from '../session'
import { MenuScreen } from './MenuScreen'
import { OrderApp } from './OrderApp'
import { StoreStatusBanner } from './StoreStatusBanner'
import { STORE_CSS, TABS_H } from './theme'
import type { StoreInfo } from '../types'
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
  it('abrir un producto abre su ficha; CartBar refleja el carrito', () => {
    const s = makeStore(infoOf(), menuOf(product()))
    s.cart.value = [{ lineId: 'l', productId: 'p1', name: 'Flautas', unitPrice: 85, quantity: 2, modifiers: [], note: null }]
    show(s)
    expect(screen.getByRole('button', { name: 'Ver pedido: 2 productos, $170' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Flautas de pollo/ }))
    expect(s.productId.value).toBe('p1')
  })
})

describe('carta al estilo de las apps de comida: pestañas, filas y barra del carrito', () => {
  const scrollIntoView = vi.fn()
  beforeEach(() => { Element.prototype.scrollIntoView = scrollIntoView })
  afterEach(() => {
    delete (Element.prototype as any).scrollIntoView
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  // Antojitos (Flautas de pollo, Tostadas) y Bebidas (Agua).
  const twoCats = () => {
    const m = menuOf(product(), product({ id: 'p2', name: 'Tostadas', description: null, price: 60 }))
    m.categories.push({ id: 'c2', name: 'Bebidas', productCount: 1, products: [product({ id: 'p9', name: 'Agua', description: null, price: 25 })] })
    return m
  }
  const everyDay = (open: string, close: string) =>
    Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map(k => [k, { enabled: true, ranges: [{ open, close }] }])) as any
  const line2 = { lineId: 'l', productId: 'p1', name: 'Flautas', unitPrice: 92, quantity: 2, modifiers: [], note: null }
  const withCart = (s: ReturnType<typeof makeStore>) => { s.cart.value = [line2]; return s }
  const tabsNav = () => screen.getByRole('navigation', { name: 'Categorías de la carta' })
  const tabOf = (name: string) => within(tabsNav()).getByRole('link', { name }) as HTMLElement
  const sectionOf = (tab: HTMLElement) => document.getElementById(tab.getAttribute('href')!.slice(1)) as HTMLElement
  const bar = () => screen.getByRole('button', { name: /^Ver pedido/ }) as HTMLButtonElement
  // Un IntersectionObserver de mentira: la prueba decide qué secciones "entran" a la franja de lectura.
  const fakeObserver = () => {
    const made: any[] = []
    class FakeIO {
      targets: Element[] = []
      disconnected = false
      constructor(public cb: (entries: any[]) => void, public opts: any) { made.push(this) }
      observe(el: Element) { this.targets.push(el) }
      unobserve() {}
      disconnect() { this.disconnected = true }
      takeRecords() { return [] }
    }
    vi.stubGlobal('IntersectionObserver', FakeIO)
    return made
  }

  describe('pestañas', () => {
    it('las categorías son pestañas que llevan a su sección (scrollIntoView), no filtran', () => {
      show(makeStore(infoOf(), twoCats()))
      const tab = tabOf('Bebidas')
      const section = sectionOf(tab)
      expect(section.tagName).toBe('SECTION')
      expect(within(section).getByText('Agua')).toBeTruthy()
      const click = new MouseEvent('click', { bubbles: true, cancelable: true })
      fireEvent(tab, click)
      expect(scrollIntoView).toHaveBeenCalledTimes(1)
      expect(scrollIntoView.mock.contexts[0]).toBe(section)
      expect(scrollIntoView.mock.calls[0][0]).toMatchObject({ block: 'start' })
      // No filtra: los productos de las demás categorías siguen en la página, y el navegador no cambia la dirección de la página.
      expect(screen.getByText('Flautas de pollo')).toBeTruthy()
      expect(screen.getByText('Tostadas')).toBeTruthy()
      expect(screen.getByText('Agua')).toBeTruthy()
      expect(click.defaultPrevented).toBe(true)
      // «Todo» ya no existe, y la tocada queda marcada.
      expect(screen.queryByRole('button', { name: 'Todo' })).toBeNull()
      expect(tab.getAttribute('aria-current')).toBe('true')
      expect(tabOf('Antojitos').hasAttribute('aria-current')).toBe(false)
    })
    it('con «reducir movimiento» el desplazamiento no es suave', () => {
      show(makeStore(infoOf(), twoCats()))
      fireEvent.click(tabOf('Bebidas'))
      expect(scrollIntoView.mock.calls[0][0]).toMatchObject({ behavior: 'smooth' })
      vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('prefers-reduced-motion'), media: query }))
      fireEvent.click(tabOf('Antojitos'))
      expect(scrollIntoView.mock.calls[1][0]).toMatchObject({ behavior: 'auto', block: 'start' })
    })
    it('con búsqueda, las pestañas se ocultan y sólo quedan las coincidencias; al borrarla vuelven', () => {
      show(makeStore(infoOf(), twoCats()))
      const search = screen.getByRole('searchbox')
      fireEvent.input(search, { target: { value: 'agu' } })
      expect(screen.queryByRole('navigation')).toBeNull()
      expect(screen.getByText('Agua')).toBeTruthy()
      expect(screen.queryByText('Flautas de pollo')).toBeNull()
      expect(screen.queryByText('Tostadas')).toBeNull()
      // Una categoría sin coincidencias no deja ni su título.
      expect(screen.queryByRole('heading', { name: 'Antojitos' })).toBeNull()
      expect(screen.getByRole('heading', { name: 'Bebidas' })).toBeTruthy()
      fireEvent.input(search, { target: { value: '' } })
      expect(tabsNav()).toBeTruthy()
      expect(screen.getByText('Flautas de pollo')).toBeTruthy()
    })
    it('dos cartas en la misma página no repiten ids de sección, y cada pestaña lleva a una sección que existe', () => {
      render(withStore(makeStore(infoOf(), twoCats()), <MenuScreen />))
      render(withStore(makeStore(infoOf(), twoCats()), <MenuScreen />))
      const ids = [...document.querySelectorAll('section')].map(s => s.id)
      expect(ids).toHaveLength(4)
      expect(new Set(ids).size).toBe(4)
      for (const id of ids) expect(id).toMatch(/^[A-Za-z][\w-]*$/)
      const links = [...document.querySelectorAll('nav a')]
      expect(links).toHaveLength(4)
      for (const a of links) expect(document.querySelectorAll(a.getAttribute('href')!)).toHaveLength(1)
    })
    it('la pestaña activa sigue al scroll (IntersectionObserver) y el observador se apaga al desmontar', async () => {
      const made = fakeObserver()
      const { unmount } = show(makeStore(infoOf(), twoCats()))
      const io = made[made.length - 1]
      const [first, second] = io.targets as HTMLElement[]
      expect(io.targets.map((t: Element) => t.tagName)).toEqual(['SECTION', 'SECTION'])
      // La franja de lectura empieza bajo las pestañas: `-{alto}px` arriba.
      expect(io.opts.rootMargin).toMatch(new RegExp(`^-${TABS_H}px `))
      // Antes de que nadie se desplace, la primera.
      expect(tabOf('Antojitos').getAttribute('aria-current')).toBe('true')
      await act(async () => { io.cb([{ target: second, isIntersecting: true }]) })
      expect(tabOf('Bebidas').getAttribute('aria-current')).toBe('true')
      expect(tabOf('Antojitos').hasAttribute('aria-current')).toBe(false)
      // Con las dos en la franja (la frontera pasa por ella) manda la de más abajo; al salir ésta, vuelve la anterior.
      await act(async () => { io.cb([{ target: first, isIntersecting: true }]) })
      expect(tabOf('Bebidas').getAttribute('aria-current')).toBe('true')
      await act(async () => { io.cb([{ target: second, isIntersecting: false }]) })
      expect(tabOf('Antojitos').getAttribute('aria-current')).toBe('true')
      // Con una búsqueda no hay pestañas ni observador; al borrarla se vuelven a observar las secciones.
      fireEvent.input(screen.getByRole('searchbox'), { target: { value: 'agu' } })
      expect(io.disconnected).toBe(true)
      expect(made).toHaveLength(1)
      fireEvent.input(screen.getByRole('searchbox'), { target: { value: '' } })
      expect(made).toHaveLength(2)
      expect(made[1].targets).toHaveLength(2)
      unmount()
      expect(made[1].disconnected).toBe(true)
    })
    it('al tocar una pestaña queda activa aunque el observador, en pleno desplazamiento, vea otra sección', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      const made = fakeObserver()
      show(makeStore(infoOf(), twoCats()))
      const io = made[made.length - 1]
      const [first, second] = io.targets as HTMLElement[]
      await act(async () => { io.cb([{ target: first, isIntersecting: true }]) })
      fireEvent.click(tabOf('Bebidas'))
      await act(async () => { io.cb([{ target: second, isIntersecting: false }]) })
      expect(tabOf('Bebidas').getAttribute('aria-current')).toBe('true')
      // Terminado el desplazamiento, el observador vuelve a mandar.
      vi.advanceTimersByTime(1500)
      await act(async () => { io.cb([{ target: first, isIntersecting: true }]) })
      expect(tabOf('Antojitos').getAttribute('aria-current')).toBe('true')
    })
    it('si la pestaña activa queda fuera de la tira de pestañas, sólo la tira se desplaza para mostrarla', async () => {
      const made = fakeObserver()
      show(makeStore(infoOf(), twoCats()))
      const io = made[made.length - 1]
      const nav = tabsNav() as HTMLElement
      const tab = tabOf('Bebidas')
      Object.defineProperty(nav, 'clientWidth', { configurable: true, value: 300 })
      Object.defineProperty(tab, 'offsetLeft', { configurable: true, value: 500 })
      Object.defineProperty(tab, 'offsetWidth', { configurable: true, value: 100 })
      await act(async () => { io.cb([{ target: io.targets[1], isIntersecting: true }]) })
      expect(nav.scrollLeft).toBe(484) // la pestaña a 16 px del borde, como el relleno de la tira
      expect(scrollIntoView).not.toHaveBeenCalled() // la página no se mueve
    })
  })

  describe('filas', () => {
    it('nombre, precio y descripción a la izquierda; con foto, <img> de 112 px con el «+» encima', () => {
      show(makeStore(infoOf(), menuOf(product({ imageUrl: 'https://x/y.png' }))))
      const row = screen.getByRole('button', { name: 'Agregar Flautas de pollo' })
      expect(row.querySelector('.avq-o-row__text')!.textContent).toBe('Flautas de pollo$85Con crema')
      const img = row.querySelector('img') as HTMLImageElement
      expect(img.getAttribute('src')).toBe('https://x/y.png')
      expect([img.getAttribute('width'), img.getAttribute('height'), img.getAttribute('alt')]).toEqual(['112', '112', ''])
      expect(img.closest('.avq-o-row__media')!.querySelector('.avq-o-row__add')).not.toBeNull()
      // La fila entera es el botón: el «+» es un adorno, no un segundo botón.
      expect(row.querySelector('button')).toBeNull()
      expect(screen.getAllByRole('button')).toHaveLength(1)
    })
    it('sin foto no hay <img> ni hueco, sólo el «+» a la derecha; una foto que no carga se trata igual', () => {
      const { container } = show(makeStore(infoOf(), menuOf(product(), product({ id: 'p2', name: 'Agua', imageUrl: 'https://x/rota.png' }))))
      const [plain, broken] = Array.from(container.querySelectorAll('.avq-o-row'))
      expect(plain.querySelector('img')).toBeNull()
      expect(plain.querySelector('.avq-o-row__media')).toBeNull()
      expect(plain.querySelector('.avq-o-row__add')).not.toBeNull()
      expect(broken.querySelector('.avq-o-row__media')).not.toBeNull()
      fireEvent.error(broken.querySelector('img')!)
      expect(broken.querySelector('img')).toBeNull()
      expect(broken.querySelector('.avq-o-row__media')).toBeNull()
      expect(broken.querySelector('.avq-o-row__add')).not.toBeNull()
    })
    it('Agotado: etiqueta en la fila, sin «+», y la fila sí abre la ficha', () => {
      const s = makeStore(infoOf(), menuOf(product({ soldOut: true })))
      show(s)
      const row = screen.getByRole('button', { name: /Flautas de pollo/ }) as HTMLButtonElement
      expect(within(row).getByText('Agotado')).toBeTruthy()
      expect(row.querySelector('.avq-o-row__add')).toBeNull()
      expect(row.disabled).toBe(false)
      fireEvent.click(row)
      expect(s.productId.value).toBe('p1')
    })
    it('con la tienda no abierta las filas se ven completas pero sin «+», sin atenuar y deshabilitadas', () => {
      const { container } = show(makeStore(infoOf({ status: 'CLOSED' }), menuOf(product({ imageUrl: 'https://x/y.png' }))))
      const row = container.querySelector('.avq-o-row') as HTMLButtonElement
      expect(row.disabled).toBe(true)
      expect(row.querySelector('.avq-o-row__add')).toBeNull()
      expect(row.querySelector('img')).not.toBeNull()
      expect(row.getAttribute('style') ?? '').not.toMatch(/opacity/)
    })
    it('el botón de la fila se llama «Agregar {nombre}» (es y en) y su precio y descripción van de descripción accesible', () => {
      show(makeStore(infoOf(), menuOf(product())))
      const row = screen.getByRole('button', { name: 'Agregar Flautas de pollo' })
      expect(document.getElementById(row.getAttribute('aria-describedby')!)!.textContent).toBe('$85Con crema')
      cleanup()
      show(makeStore(infoOf(), menuOf(product()), 'en'))
      expect(screen.getByRole('button', { name: 'Add Flautas de pollo' })).toBeTruthy()
    })
    it('una fila sin «+» (agotada, o con la tienda no abierta) se llama como el producto, no «Agregar»; «Agotado» va en su descripción accesible', () => {
      show(makeStore(infoOf(), menuOf(product({ soldOut: true }))))
      const sold = screen.getByRole('button', { name: 'Flautas de pollo' })
      expect(document.getElementById(sold.getAttribute('aria-describedby')!)!.textContent).toBe('$85Con cremaAgotado')
      cleanup()
      show(makeStore(infoOf({ status: 'CLOSED' }), menuOf(product())))
      expect(screen.getByRole('button', { name: 'Flautas de pollo' })).toBeTruthy()
      expect(screen.queryByRole('button', { name: /Agregar/ })).toBeNull()
      cleanup()
      show(makeStore(infoOf({ status: 'PAUSED', reason: 'TOO_BUSY' }), menuOf(product()), 'en'))
      expect(screen.getByRole('button', { name: 'Flautas de pollo' })).toBeTruthy()
      expect(screen.queryByRole('button', { name: /Add/ })).toBeNull()
    })
    it('una categoría de 120 caracteres sin espacios envuelve su título (overflow-wrap:anywhere); su pestaña no envuelve pero vive en una tira con scroll horizontal', () => {
      const m = menuOf(product())
      m.categories[0].name = 'Ñ'.repeat(120)
      const { container } = render(withStore(makeStore(infoOf(), m), <OrderApp />))
      expect(getComputedStyle(container.querySelector('.avq-o-section-title')!).overflowWrap).toBe('anywhere')
      expect(getComputedStyle(container.querySelector('.avq-o-tab')!).whiteSpace).toBe('nowrap')
      expect(getComputedStyle(container.querySelector('.avq-o-tabs')!).overflowX).toBe('auto')
    })
    it('un nombre de 120 caracteres sin espacios no desborda: la fila envuelve (overflow-wrap:anywhere, min-width:0) y el precio y el «+» siguen ahí', () => {
      const name = 'Á'.repeat(118) + '🌮🌮'
      const long = menuOf(product({ name, description: 'Sin'.repeat(80), imageUrl: 'https://x/y.png' }), product({ id: 'p2', name }))
      const { container } = render(withStore(makeStore(infoOf(), long), <OrderApp />))
      const rows = Array.from(container.querySelectorAll<HTMLElement>('.avq-o-row'))
      expect(rows).toHaveLength(2)
      for (const row of rows) {
        expect(getComputedStyle(row).overflowWrap).toBe('anywhere')
        expect(getComputedStyle(row).minWidth).toMatch(/^0(px)?$/)
        const text = row.querySelector<HTMLElement>('.avq-o-row__text')!
        expect(getComputedStyle(text).minWidth).toMatch(/^0(px)?$/)
        expect(text.textContent).toContain(name)
        expect(row.querySelector('.avq-o-row__price')!.textContent).toBe('$85')
        expect(row.querySelector('.avq-o-row__add')).not.toBeNull()
      }
    })
    it('al final de la carta: «Precios con IVA incluido.» y la línea discreta «Pedidos con Avoqado» (es y en)', () => {
      const { container } = show(makeStore(infoOf(), menuOf(product())))
      expect([...container.querySelectorAll('.avq-o-foot p')].map(p => p.textContent)).toEqual(['Precios con IVA incluido.', 'Pedidos con Avoqado'])
      cleanup()
      show(makeStore(infoOf(), menuOf(product()), 'en'))
      expect(screen.getByText('Prices include VAT.')).toBeTruthy()
      expect(screen.getByText('Ordering by Avoqado')).toBeTruthy()
    })
  })

  describe('barra del carrito', () => {
    it('aria-label «Ver pedido: 2 productos, $184», círculo con la cantidad, «Ver pedido» y el total; abre el carrito', () => {
      const s = withCart(makeStore(infoOf(), menuOf(product())))
      show(s)
      const b = screen.getByRole('button', { name: 'Ver pedido: 2 productos, $184' })
      expect(b.classList.contains('avq-o-bar--neutral')).toBe(false)
      expect(b.textContent).toBe('2Ver pedido$184')
      fireEvent.click(b)
      expect(s.screen.value).toBe('cart')
    })
    it('con un solo producto el aria-label va en singular; en inglés, «View order: 2 items, $184»', () => {
      const s = makeStore(infoOf(), menuOf(product()))
      s.cart.value = [{ ...line2, quantity: 1 }]
      show(s)
      expect(screen.getByRole('button', { name: 'Ver pedido: 1 producto, $92' })).toBeTruthy()
      cleanup()
      show(withCart(makeStore(infoOf(), menuOf(product()), 'en')))
      expect(screen.getByRole('button', { name: 'View order: 2 items, $184' }).textContent).toBe('2View order$184')
    })
    it('sin nada en el carrito no hay barra; con la ficha abierta tampoco (sólo el pie de la ficha); al cerrarla vuelve', async () => {
      const s = makeStore(infoOf(), menuOf(product()))
      show(s)
      expect(screen.queryByRole('button', { name: /^Ver pedido/ })).toBeNull()
      await act(async () => { s.cart.value = [line2] })
      expect(bar()).toBeTruthy()
      await act(async () => { s.productId.value = 'p1' })
      expect(screen.queryByRole('button', { name: /^Ver pedido/ })).toBeNull()
      await act(async () => { s.productId.value = null })
      expect(bar()).toBeTruthy()
    })
    it('tienda en pausa con carrito: barra neutra con «Puedes pedir desde las 15:37» y SÍ abre el carrito', () => {
      // 15:37 en CDMX (UTC-6) = 21:37Z.
      const s = withCart(makeStore(infoOf({ status: 'PAUSED', reason: 'MANUAL_PAUSE', pausedUntil: '2026-10-19T21:37:00Z' }), menuOf(product())))
      show(s)
      const b = screen.getByRole('button', { name: 'Ver pedido: 2 productos, $184' }) as HTMLButtonElement
      expect(b.classList.contains('avq-o-bar--neutral')).toBe(true)
      expect(b.disabled).toBe(false)
      const note = within(b).getByText('Puedes pedir desde las 15:37')
      // El motivo lo lee el lector de pantalla como descripción del botón.
      expect(b.getAttribute('aria-describedby')).toBe(note.id)
      fireEvent.click(b)
      expect(s.screen.value).toBe('cart')
    })
    it('pausa con hora, en inglés: «You can order from 3:37 PM»', () => {
      show(withCart(makeStore(infoOf({ status: 'PAUSED', reason: 'MANUAL_PAUSE', pausedUntil: '2026-10-19T21:37:00Z' }), menuOf(product()), 'en')))
      expect(within(screen.getByRole('button', { name: /^View order/ })).getByText(/^You can order from 3:37\sPM$/)).toBeTruthy()
    })
    it('cerrada: dice desde qué hora se puede pedir HOY; si ya no abre hoy (o no hay hora), la frase del estado', () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      const closed = (hours: any) => withCart(makeStore(infoOf({ status: 'CLOSED', reason: 'OUTSIDE_HOURS', hours }), menuOf(product())))
      vi.setSystemTime(new Date('2026-10-19T14:00:00Z')) // lunes 08:00 en CDMX
      show(closed(everyDay('13:00', '17:00')))
      expect(within(bar()).getByText('Puedes pedir desde las 13:00')).toBeTruthy()
      expect(bar().classList.contains('avq-o-bar--neutral')).toBe(true)
      cleanup()
      vi.setSystemTime(new Date('2026-10-20T03:00:00Z')) // lunes 21:00: ya pasó la apertura de hoy
      show(closed(everyDay('13:00', '17:00')))
      expect(within(bar()).getByText('Cerrado ahora. Hoy: 13:00–17:00')).toBeTruthy()
      cleanup()
      show(closed(null)) // sin horario no hay hora que prometer
      expect(within(bar()).getByText('Cerrado ahora.')).toBeTruthy()
    })
    it('pausa sin hora, pausa por mucha demanda y restaurante desconectado: la frase del estado, y la barra sigue abriendo el carrito', () => {
      const cases: [Partial<StoreInfo>, string][] = [
        [{ status: 'PAUSED', reason: 'MANUAL_PAUSE', pausedUntil: null }, 'Hoy no estamos recibiendo pedidos en línea.'],
        [{ status: 'PAUSED', reason: 'TOO_BUSY' }, 'Muchos pedidos en este momento. Intenta en unos minutos.'],
        [{ status: 'OFFLINE', reason: 'NO_DEVICE' }, 'El restaurante no está conectado. Intenta en unos minutos.'],
      ]
      for (const [over, sentence] of cases) {
        const s = withCart(makeStore(infoOf(over), menuOf(product())))
        show(s)
        expect(within(bar()).getByText(sentence)).toBeTruthy()
        fireEvent.click(bar())
        expect(s.screen.value).toBe('cart')
        cleanup()
      }
    })
  })

  describe('lo que no cambia de lugar ni de forma', () => {
    it('el CSS de la carta: pestañas pegajosas y secciones con scroll-margin-top del mismo alto; la carta y la barra respetan el área segura', () => {
      const { container } = render(withStore(makeStore(infoOf(), twoCats()), <OrderApp />))
      const tabs = container.querySelector('.avq-o-tabs') as HTMLElement
      const section = container.querySelector('.avq-o-section') as HTMLElement
      expect(getComputedStyle(tabs).position).toBe('sticky')
      expect(getComputedStyle(tabs).height).toBe(`${TABS_H}px`)
      expect(getComputedStyle(section).getPropertyValue('scroll-margin-top')).toBe(`${TABS_H}px`)
      const rule = (sel: string) => STORE_CSS.match(new RegExp(`${sel.replace(/\./g, '\\.')}\\s*\\{([^}]*)\\}`))?.[1] ?? ''
      expect(rule('.avq-o-menu')).toMatch(/padding-bottom:\s*calc\([^;]*env\(safe-area-inset-bottom/)
      expect(rule('.avq-o-bar')).toMatch(/bottom:\s*calc\([^;]*env\(safe-area-inset-bottom/)
    })
    it('ni las pestañas ni la barra tapan el control con foco (WCAG 2.4.11): las filas y el campo de búsqueda (lo que recibe el foco) dejan margen arriba, y las filas también abajo', () => {
      const { container } = render(withStore(makeStore(infoOf(), twoCats()), <OrderApp />))
      const margin = (el: Element) => getComputedStyle(el).getPropertyValue('scroll-margin-top')
      expect(margin(container.querySelector('.avq-o-row')!)).toBe(`${TABS_H + 8}px`)
      // El margen va en el <input> (es el que se desplaza al enfocar), no en la <label> que lo envuelve; y el campo llena la píldora
      // para que su borde de arriba sea el de ella.
      const input = container.querySelector('.avq-o-search > input')!
      expect(margin(input)).toBe(`${TABS_H + 8}px`)
      expect(margin(container.querySelector('.avq-o-search')!)).toBe('')
      expect(getComputedStyle(input).alignSelf).toBe('stretch')
      expect(STORE_CSS).toMatch(/\.avq-o-row\{scroll-margin-bottom:calc\(\d+px \+ env\(safe-area-inset-bottom/)
    })
    it('los avisos de la carta (recortada, sin conexión, fallo de carga) usan las tarjetas de la tienda y «Reintentar» su botón', () => {
      const trunc = show(makeStore(infoOf(), { ...menuOf(product()), truncated: true }))
      expect(trunc.container.querySelector('.avq-o-notice')!.textContent).toBe('Esta carta es muy grande; algunos productos no se muestran aquí.')
      cleanup()
      const failed = makeStore(null, null); failed.infoError.value = new ApiError('', 500)
      const f = show(failed)
      expect(f.container.querySelector('.avq-o-notice--error')!.textContent).toBe('No pudimos cargar la tienda.')
      expect(screen.getByRole('button', { name: 'Reintentar' }).className).toBe('avq-o-btn avq-o-btn--neutral')
      cleanup()
      const offline = makeStore(null, null); offline.infoError.value = new ApiError('Sin conexión', 0, undefined, undefined, true)
      expect(show(offline).container.querySelector('.avq-o-notice--warn')!.textContent).toBe('Sin conexión. Revisa tu internet y vuelve a intentar.')
      cleanup()
      const reconnecting = makeStore(infoOf(), menuOf(product())); reconnecting.infoError.value = new ApiError('Sin conexión', 0, undefined, undefined, true)
      expect(show(reconnecting).container.querySelector('.avq-o-notice--warn')!.textContent).toBe('Sin conexión; reintentando…')
    })
    it('carta vacía y sin resultados se dicen en una línea centrada; tienda apagada, en su tarjeta', () => {
      const empty = show(makeStore(infoOf(), { generatedAt: '', truncated: false, categories: [] }))
      expect(empty.container.querySelector('.avq-o-empty')!.textContent).toBe('Todavía no hay productos en línea.')
      cleanup()
      show(makeStore(infoOf(), menuOf(product())))
      fireEvent.input(screen.getByRole('searchbox'), { target: { value: 'zzz' } })
      expect(screen.getByText('No encontramos productos con esa búsqueda.').className).toBe('avq-o-empty')
      expect(document.querySelector('.avq-o-foot')).toBeNull() // sin renglones no hay nota de precios
      cleanup()
      const off = show(makeStore(infoOf({ status: 'DISABLED' }), menuOf(product())))
      expect(off.container.querySelector('.avq-o-notice')!.textContent).toBe('Este restaurante no recibe pedidos en línea por el momento.')
    })
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
    // Sin marca, manda el atributo de respaldo; si no da 4.5:1 con texto blanco (#abcdef), el botón se queda en negro…
    const s2 = makeStore(infoOf(), menuOf(product()))
    const r = render(withStore(s2, <OrderApp accentColor="#abcdef" />))
    expect((r.container.firstElementChild as HTMLElement).style.getPropertyValue('--avq-accent')).toBe('#000000')
    cleanup()
    // …y uno legible (#1E3A8A) se respeta.
    const r2 = render(withStore(makeStore(infoOf(), menuOf(product())), <OrderApp accentColor="#1E3A8A" />))
    expect((r2.container.firstElementChild as HTMLElement).style.getPropertyValue('--avq-accent')).toBe('#1E3A8A')
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
    // En la carta es la portada completa (nombre como título y chips); en el carrito y los datos, la cabecera compacta.
    expect(within(header()).getByRole('heading', { name: 'Flautas Coyoacán' })).toBeTruthy()
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

describe('encabezado de la tienda: portada, logo, chips y avisos', () => {
  const venue = { slug: 'a', name: 'Avoqado Full', timezone: 'America/Mexico_City', currency: 'MXN' }
  const brand = (over: Partial<StoreInfo['brand']> = {}): StoreInfo['brand'] => ({ logo: null, logoFull: null, primaryColor: null, secondaryColor: null, ...over })
  const store = (over: Partial<StoreInfo> = {}, locale: 'es' | 'en' = 'es') => makeStore(infoOf({ venue, ...over }), menuOf(product()), locale)
  const app = (s: ReturnType<typeof makeStore>) => render(withStore(s, <OrderApp />))
  const header = () => screen.getByRole('banner')
  const everyDay = (open: string, close: string, ...more: [string, string][]) =>
    Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
      .map(k => [k, { enabled: true, ranges: [{ open, close }, ...more.map(([o, c]) => ({ open: o, close: c }))] }])) as any
  afterEach(() => { vi.useRealTimers() })

  it('portada: con brand.heroImageUrl hay <img> de portada; sin ella no hay hueco; si la imagen falla se quita', () => {
    const { container } = app(store({ brand: brand({ heroImageUrl: 'https://x/portada.jpg' }) }))
    const cover = () => container.querySelector('.avq-o-hero__img') as HTMLImageElement | null
    expect(cover()!.getAttribute('src')).toBe('https://x/portada.jpg')
    expect(header().classList.contains('avq-o-hero--cover')).toBe(true)
    // Una portada rota se trata como si no hubiera: se quita y el encabezado queda sin foto, sin hueco gris.
    fireEvent.error(cover()!)
    expect(cover()).toBeNull()
    expect(header().classList.contains('avq-o-hero--cover')).toBe(false)
    cleanup()
    for (const heroImageUrl of [undefined, null, '']) {
      const r = app(store({ brand: brand({ heroImageUrl }) }))
      expect(r.container.querySelector('.avq-o-hero__img')).toBeNull()
      expect(header().classList.contains('avq-o-hero--cover')).toBe(false)
      cleanup()
    }
  })
  it('una portada nueva (otra liga) se intenta aunque la anterior hubiera fallado', async () => {
    const s = store({ brand: brand({ heroImageUrl: 'https://x/rota.jpg' }) })
    const { container } = app(s)
    fireEvent.error(container.querySelector('.avq-o-hero__img')!)
    expect(container.querySelector('.avq-o-hero__img')).toBeNull()
    await act(async () => { s.info.value = infoOf({ venue, brand: brand({ heroImageUrl: 'https://x/buena.jpg' }) }) })
    expect(container.querySelector('.avq-o-hero__img')!.getAttribute('src')).toBe('https://x/buena.jpg')
  })
  it('logo: con logo, <img>; sin logo o con logo roto, iniciales «AF»', () => {
    const { container } = app(store({ brand: brand({ logo: 'https://x/logo.png' }) }))
    const img = () => container.querySelector('.avq-o-mark img') as HTMLImageElement | null
    expect(img()!.getAttribute('src')).toBe('https://x/logo.png')
    expect(screen.queryByText('AF')).toBeNull()
    fireEvent.error(img()!)
    expect(img()).toBeNull()
    expect(screen.getByText('AF')).toBeTruthy()
    cleanup()
    const none = app(store())
    expect(none.container.querySelector('.avq-o-mark img')).toBeNull()
    expect(screen.getByText('AF')).toBeTruthy()
  })
  it('las iniciales no se leen en voz alta antes del nombre (aria-hidden); el logo es una imagen sin texto alternativo', () => {
    const { container } = app(store())
    expect(container.querySelector('.avq-o-mark')!.getAttribute('aria-hidden')).toBe('true')
    cleanup()
    const withLogo = app(store({ brand: brand({ logo: 'https://x/logo.png' }) }))
    const mark = withLogo.container.querySelector('.avq-o-mark')!
    expect(mark.hasAttribute('aria-hidden')).toBe(false)
    expect(mark.querySelector('img')!.getAttribute('alt')).toBe('')
    // El nombre sí se lee: es el título de la página.
    expect(screen.getByRole('heading', { name: 'Avoqado Full' })).toBeTruthy()
    // Con el logo roto caen a las iniciales, y entonces se esconden.
    fireEvent.error(mark.querySelector('img')!)
    expect(withLogo.container.querySelector('.avq-o-mark')!.getAttribute('aria-hidden')).toBe('true')
  })
  it('el logo ancho (logoFull) también sirve, y sin nombre ni logo no hay encabezado', () => {
    const { container } = app(store({ brand: brand({ logoFull: 'https://x/full.png' }) }))
    expect(container.querySelector('.avq-o-mark img')!.getAttribute('src')).toBe('https://x/full.png')
    cleanup()
    app(makeStore(infoOf({ venue: { ...venue, name: null } }), menuOf(product())))
    expect(screen.queryByRole('banner')).toBeNull()
  })
  it('chips: «Abierto hasta las 22:00», «Listo en ~20 min» si estimatedPrepMinutes=20 y «Pagas al recoger»', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-19T18:00:00Z')) // lunes 12:00 en CDMX
    app(store({ hours: everyDay('09:00', '22:00'), estimatedPrepMinutes: 20 }))
    expect(screen.getByText('Abierto hasta las 22:00')).toBeTruthy()
    expect(screen.getByText('Listo en ~20 min')).toBeTruthy()
    expect(screen.getByText('Pagas al recoger')).toBeTruthy()
    cleanup()
    // Sin horario, «Abierto» a secas; sin tiempo de preparación ni pago al recoger, esos chips no salen.
    app(store({ hours: null, estimatedPrepMinutes: 0, paymentModes: { payAtPickup: false } }))
    expect(screen.getByText('Abierto')).toBeTruthy()
    expect(screen.queryByText(/Abierto hasta/)).toBeNull()
    expect(screen.queryByText(/Listo en/)).toBeNull()
    expect(screen.queryByText('Pagas al recoger')).toBeNull()
    cleanup()
    // El servidor dice «abierto» pero el reloj cae fuera de las franjas: no se inventa una hora.
    vi.setSystemTime(new Date('2026-10-19T08:00:00Z')) // 02:00 en CDMX
    app(store({ hours: everyDay('09:00', '22:00') }))
    expect(screen.getByText('Abierto')).toBeTruthy()
  })
  it('chip con franjas seguidas: no anuncia el cierre de una franja si otra abre de inmediato', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-19T18:00:00Z')) // lunes 12:00 en CDMX
    app(store({ hours: everyDay('09:00', '14:00', ['14:00', '22:00']) }))
    expect(screen.getByText('Abierto hasta las 22:00')).toBeTruthy()
    cleanup()
    // Con un hueco sí: cierra a las 14:00.
    app(store({ hours: everyDay('09:00', '14:00', ['15:00', '22:00']) }))
    expect(screen.getByText('Abierto hasta las 14:00')).toBeTruthy()
  })
  it('chips en inglés', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-19T18:00:00Z'))
    app(store({ hours: everyDay('09:00', '22:00'), estimatedPrepMinutes: 15 }, 'en'))
    expect(screen.getByText('Open until 22:00')).toBeTruthy()
    expect(screen.getByText('Ready in ~15 min')).toBeTruthy()
    expect(screen.getByText('Pay at pickup')).toBeTruthy()
  })
  it('dirección: «Para recoger en Av. Insurgentes Sur 1234» sólo si contact.address', () => {
    app(store({ contact: { address: 'Av. Insurgentes Sur 1234', phone: null } }))
    expect(screen.getByText('Para recoger en Av. Insurgentes Sur 1234')).toBeTruthy()
    cleanup()
    app(store({ contact: { address: 'Av. Insurgentes Sur 1234', phone: null } }, 'en'))
    expect(screen.getByText('Pickup at Av. Insurgentes Sur 1234')).toBeTruthy()
    cleanup()
    app(store({ contact: { address: null, phone: '55 1234 5678' } }))
    expect(screen.queryByText(/Para recoger en/)).toBeNull()
    cleanup()
    app(store())
    expect(screen.queryByText(/Para recoger en/)).toBeNull()
  })
  it('aviso de pausa: título «Pedidos en pausa» + la frase de hoy literal, en otro elemento, y sin chips', () => {
    app(store({ status: 'PAUSED', reason: 'MANUAL_PAUSE', pausedUntil: '2026-10-17T19:30:00Z' }))
    const title = screen.getByText('Pedidos en pausa')
    const sentence = screen.getByText('En este momento no estamos recibiendo pedidos. Volvemos a recibirlos a las 13:30.')
    expect(title).not.toBe(sentence)
    expect(screen.getByRole('status').contains(title) && screen.getByRole('status').contains(sentence)).toBe(true)
    // El aviso reemplaza al chip de estado, y con la tienda cerrada a pedidos los otros chips no prometen nada.
    expect(screen.queryByText(/^Abierto/)).toBeNull()
    expect(screen.queryByText('Pagas al recoger')).toBeNull()
    expect(screen.queryByText(/Listo en/)).toBeNull()
  })
  it('PAUSED y DISABLED llevan título; CLOSED y OFFLINE no (su frase de hoy ya empieza con él); todos con ícono sin voz y la frase de hoy literal (es y en)', () => {
    // [estado, [título o null, frase] en español, [título o null, frase] en inglés]
    const cases: [Partial<StoreInfo>, [string | null, string], [string | null, string]][] = [
      [{ status: 'PAUSED', reason: 'MANUAL_PAUSE' }, ['Pedidos en pausa', 'Hoy no estamos recibiendo pedidos en línea.'], ['Orders paused', 'We are not taking online orders today.']],
      [{ status: 'PAUSED', reason: 'TOO_BUSY' }, ['Pedidos en pausa', 'Muchos pedidos en este momento. Intenta en unos minutos.'], ['Orders paused', 'Lots of orders right now. Try again in a few minutes.']],
      [{ status: 'DISABLED', reason: 'NOT_ENABLED' }, ['Pedidos en línea apagados', 'Este restaurante no recibe pedidos en línea por el momento.'], ['Online ordering is off', 'This restaurant is not taking online orders right now.']],
      [{ status: 'CLOSED', reason: 'OUTSIDE_HOURS' }, [null, 'Cerrado ahora.'], [null, 'Closed now.']],
      [{ status: 'OFFLINE', reason: 'NO_DEVICE' }, [null, 'El restaurante no está conectado. Intenta en unos minutos.'], [null, 'The restaurant is not connected. Try again in a few minutes.']],
    ]
    for (const [over, es, en] of cases) {
      for (const [locale, [title, sentence]] of [['es', es], ['en', en]] as const) {
        const label = `${over.status}/${over.reason}/${locale}`
        const { container } = render(withStore(store(over, locale), <StoreStatusBanner />))
        const notice = screen.getByRole('status')
        // Sin título no hay elemento de título; con él, exactamente su texto. La frase de hoy va siempre en su propio elemento.
        expect(notice.querySelector('.avq-o-notice__title')?.textContent ?? null, label).toBe(title)
        expect(notice.querySelector('.avq-o-notice__body > span:not(.avq-o-notice__title)')?.textContent, label).toBe(sentence)
        expect(container.querySelector('svg[aria-hidden="true"]'), `${label} ícono`).not.toBeNull()
        cleanup()
      }
    }
  })
  it('la tienda abierta no pinta aviso', () => {
    const { container } = render(withStore(store(), <StoreStatusBanner />))
    expect(container.querySelector('.avq-o-notice')).toBeNull()
  })
  it('portada completa sólo en la carta; carrito, datos y código llevan la cabecera compacta; con la ficha abierta, ninguna', async () => {
    const s = store({ brand: brand({ logo: 'https://x/logo.png', heroImageUrl: 'https://x/portada.jpg' }), contact: { address: 'Av. Insurgentes Sur 1234', phone: null } })
    const { container } = app(s)
    expect(container.querySelector('.avq-o-hero__img')).not.toBeNull()
    expect(screen.getByRole('heading', { name: 'Avoqado Full' })).toBeTruthy()
    // La ficha de un producto ocupa el lugar de la tienda: sin encabezado encima.
    await act(async () => { s.productId.value = 'p1' })
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.queryByRole('banner')).toBeNull()
    await act(async () => { s.productId.value = null })
    expect(screen.getByRole('banner')).toBeTruthy()
    for (const sc of ['cart', 'details', 'otp'] as const) {
      await act(async () => { s.go(sc) })
      expect(container.querySelector('.avq-o-hero__img'), sc).toBeNull()
      expect(screen.queryByText(/Para recoger en/), sc).toBeNull()
      expect(screen.queryByRole('heading', { name: 'Avoqado Full' }), sc).toBeNull()
      expect(header().textContent, sc).toBe('Avoqado Full')
      expect(header().querySelector('img')!.getAttribute('src'), sc).toBe('https://x/logo.png')
    }
    // Con el logo roto, la cabecera compacta también cae a las iniciales.
    await act(async () => { s.info.value = infoOf({ venue, brand: brand({ logo: 'https://x/logo.png' }) }) })
    fireEvent.error(header().querySelector('img')!)
    expect(header().querySelector('img')).toBeNull()
    expect(header().querySelector('.avq-o-mark--sm')!.textContent).toBe('AF')
    expect(header().querySelector('.avq-o-mark--sm')!.getAttribute('aria-hidden')).toBe('true')
  })
  it('el aviso global es neutro y «Cerrar» lo quita', () => {
    const s = store(); s.notice.value = 'Aviso de prueba'
    app(s)
    const text = screen.getByText('Aviso de prueba')
    expect(text.closest('.avq-o-notice--neutral')).not.toBeNull()
    expect(text.closest('[role="status"]')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }))
    expect(s.notice.value).toBeNull()
    expect(screen.queryByText('Aviso de prueba')).toBeNull()
  })
  it('«Tienes un pedido en curso · Ver» es un aviso neutro con su botón', async () => {
    vi.mocked(getTracking).mockResolvedValue({
      orderNumber: '7', status: 'ACCEPTED', paymentMode: 'PAY_AT_PICKUP', venueName: 'Flautas', venueSlug: 'a', items: [], total: 0, paid: false,
      estimatedReadyAt: null, acceptDeadlineAt: '2026-10-17T19:05:00Z', rejectReason: null, createdAt: '', canCancel: false,
    })
    const s = store()
    saveLastOrder(s.slug, { trackingToken: 'T'.repeat(32), orderNumber: '7' })
    app(s); await flush()
    const text = screen.getByText('Tienes un pedido en curso')
    expect(text.closest('.avq-o-notice--neutral')).not.toBeNull()
    expect(within(text.closest('[role="status"]') as HTMLElement).getByRole('button', { name: 'Ver' })).toBeTruthy()
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
  it('W7: desde el seguimiento, «Pedir algo más» carga la carta y deja el aviso «Tienes un pedido en curso · Ver»', async () => {
    vi.mocked(getInfo).mockResolvedValue(infoOf()); vi.mocked(getMenu).mockResolvedValue(menuOf(product()))
    vi.mocked(getTracking).mockResolvedValue(trk('ACCEPTED'))
    const s = makeStore(null, null); withLast(s)
    s.trackingToken.value = 'T'.repeat(32); s.go('tracking')
    app(s); await flush()
    expect(getMenu).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Pedir algo más' }))
    await flush()
    expect(getMenu).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Flautas de pollo')).toBeTruthy()
    expect(screen.getByText('Tienes un pedido en curso')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Ver' }))
    expect(s.screen.value).toBe('tracking')
    expect(s.trackingToken.value).toBe('T'.repeat(32))
    s.dispose()
  })
  it('W7: si ese pedido ya terminó, al volver a la carta no queda el aviso', async () => {
    vi.mocked(getInfo).mockResolvedValue(infoOf()); vi.mocked(getMenu).mockResolvedValue(menuOf(product()))
    vi.mocked(getTracking).mockResolvedValue(trk('ACCEPTED'))
    const s = makeStore(infoOf(), menuOf(product())); withLast(s)
    app(s); await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Ver' }))
    await flush()
    vi.mocked(getTracking).mockResolvedValue(trk('CANCELLED_BY_STAFF'))
    fireEvent.click(screen.getByRole('button', { name: 'Pedir algo más' }))
    await flush()
    expect(s.screen.value).toBe('menu')
    expect(screen.queryByText('Tienes un pedido en curso')).toBeNull()
    expect(loadLastOrder(s.slug)).toBeNull()
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
