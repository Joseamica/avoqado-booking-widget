// Estado de UNA tienda (un elemento `<avoqado-order>`). Todo son señales creadas aquí dentro: dos tiendas nunca comparten
// nada (a diferencia de `src/state/booking.ts`, que es un singleton de módulo y por eso NO se reutiliza).
import { createContext } from 'preact'
import { signal, type Signal } from '@preact/signals'
import { ApiError, getInfo, getMenu } from './api'
import { loadCart, saveCart, type Cart } from './cart'
import type { Menu, Quote, StoreInfo } from './types'

export type Screen = 'menu' | 'product' | 'cart' | 'details' | 'otp' | 'tracking'

export interface OrderStore {
  slug: string
  locale: 'es' | 'en'
  screen: Signal<Screen>
  info: Signal<StoreInfo | null>
  infoError: Signal<ApiError | null>
  menu: Signal<Menu | null>
  cart: Signal<Cart>
  quote: Signal<Quote | null>
  productId: Signal<string | null>
  trackingToken: Signal<string | null>
  notice: Signal<string | null>
  load(): Promise<void>
  refreshInfo(): Promise<void>
  go(screen: Screen): void
  /** Detiene el sondeo de `/info` (al quitar el elemento de la página). */
  dispose(): void
}

const POLL_MS = 60_000
const asApiError = (e: unknown) => (e instanceof ApiError ? e : new ApiError(String((e as Error)?.message ?? e), 0, undefined, undefined, true))

export function createOrderStore(slug: string, opts: { locale: 'es' | 'en'; trackingToken?: string | null }): OrderStore {
  const trackingToken = signal<string | null>(opts.trackingToken ?? null)
  const info = signal<StoreInfo | null>(null)
  const infoError = signal<ApiError | null>(null)
  const menu = signal<Menu | null>(null)
  const cart = signal<Cart>(loadCart(slug))
  const screen = signal<Screen>(trackingToken.value ? 'tracking' : 'menu')
  let timer: ReturnType<typeof setTimeout> | null = null
  let disposed = false

  cart.subscribe(c => saveCart(slug, c))

  // Con la tienda no abierta se vuelve a preguntar cada 60 s, pero sólo si la pestaña se ve (una oculta no gasta red).
  function schedule() {
    if (timer) clearTimeout(timer)
    timer = null
    if (disposed || !info.value || info.value.status === 'OPEN') return
    timer = setTimeout(() => {
      timer = null
      if (document.visibilityState === 'visible') void store.refreshInfo()
      else schedule()
    }, POLL_MS)
  }

  const store: OrderStore = {
    slug,
    locale: opts.locale,
    screen,
    info,
    infoError,
    menu,
    cart,
    quote: signal<Quote | null>(null),
    productId: signal<string | null>(null),
    trackingToken,
    notice: signal<string | null>(null),
    go: s => {
      screen.value = s
    },
    async refreshInfo() {
      try {
        info.value = await getInfo(slug)
        infoError.value = null
      } catch (e) {
        infoError.value = asApiError(e)
      }
      schedule()
    },
    async load() {
      if (trackingToken.value) {
        // Seguimiento: sin menú, y si `/info` falla (plan vencido) el pedido se pinta igual.
        await store.refreshInfo()
        return
      }
      const [i, m] = await Promise.allSettled([getInfo(slug), getMenu(slug)])
      if (i.status === 'fulfilled') {
        info.value = i.value
        infoError.value = null
      } else infoError.value = asApiError(i.reason)
      if (m.status === 'fulfilled') menu.value = m.value
      else if (i.status === 'fulfilled') infoError.value = asApiError(m.reason)
      schedule()
    },
    dispose() {
      disposed = true
      if (timer) clearTimeout(timer)
      timer = null
    },
  }
  return store
}

export const OrderStoreContext = createContext<OrderStore | null>(null)
