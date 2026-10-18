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
  /** El elemento `<avoqado-order>`: de ahí salen sus eventos públicos (`events.ts`). */
  host: EventTarget | null
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
  /** Detiene el sondeo de `/info` y de la carta (al quitar el elemento de la página). */
  dispose(): void
}

const POLL_MS = 60_000
// Una carta cargada pero sin un solo producto (la copia de caché de antes de abrir, o una categoría que abre más tarde).
// `null` (no cargó) no cuenta: eso lo resuelve «Reintentar».
const noProducts = (m: Menu | null) => !!m && !m.categories.some(c => c.products.length > 0)
const asApiError = (e: unknown) => (e instanceof ApiError ? e : new ApiError(String((e as Error)?.message ?? e), 0, undefined, undefined, true))

export function createOrderStore(slug: string, opts: { locale: 'es' | 'en'; trackingToken?: string | null; host?: EventTarget }): OrderStore {
  const trackingToken = signal<string | null>(opts.trackingToken ?? null)
  const info = signal<StoreInfo | null>(null)
  const infoError = signal<ApiError | null>(null)
  const menu = signal<Menu | null>(null)
  const cart = signal<Cart>(loadCart(slug))
  const screen = signal<Screen>(trackingToken.value ? 'tracking' : 'menu')
  let timer: ReturnType<typeof setTimeout> | null = null
  let disposed = false

  const unsubscribeCart = cart.subscribe(c => saveCart(slug, c))
  // ¿Hay que preguntar otra vez? Con el seguimiento no (sondea lo suyo). Abierta tampoco, salvo con la carta sin productos.
  // ponytail: una tienda abierta de verdad sin productos sondea /info + /menu cada 60 s mientras se vea la pestaña (la caché del servidor es de 60 s).
  const waiting = () => !disposed && !trackingToken.value && !!info.value && (info.value.status !== 'OPEN' || noProducts(menu.value))
  // Volver a la pestaña con la tienda no abierta (o sin carta) pregunta en el acto: el comensal no espera hasta un minuto más.
  const onVisible = () => { if (document.visibilityState === 'visible' && waiting()) void store.refreshInfo() }
  document.addEventListener('visibilitychange', onVisible)

  // UN solo temporizador (el de /info también pide la carta cuando le toca): cada 60 s, pero sólo si la pestaña se ve (una oculta no gasta red).
  function schedule() {
    if (timer) clearTimeout(timer)
    timer = null
    // Con trackingToken no se sondea: el seguimiento (tarea 10) sondea su propio estado.
    if (!waiting()) return
    timer = setTimeout(() => {
      timer = null
      if (document.visibilityState === 'visible') void store.refreshInfo()
      else schedule()
    }, POLL_MS)
  }

  const store: OrderStore = {
    slug,
    locale: opts.locale,
    host: opts.host ?? null,
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
        const wasOpen = info.value?.status === 'OPEN'
        info.value = await getInfo(slug)
        infoError.value = null
        // Acaba de abrir: la carta que se cargó cerrada pudo venir vacía (categorías con horario que aún no empezaba).
        // Si no se puede recargar, sin carta y con el error: la pantalla ofrece «Reintentar» (nunca una carta vacía muda).
        // Abierta y con la carta aún sin productos (la copia de caché de antes de abrir) se vuelve a pedir en cada vuelta;
        // si ese sondeo falla se conserva la carta vacía con el aviso, para que el siguiente intento ocurra.
        if (info.value.status === 'OPEN' && !trackingToken.value && (!wasOpen || noProducts(menu.value))) {
          try {
            menu.value = await getMenu(slug)
          } catch (e) {
            if (!wasOpen) menu.value = null
            infoError.value = asApiError(e)
          }
        }
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
      unsubscribeCart()
      document.removeEventListener('visibilitychange', onVisible)
      if (timer) clearTimeout(timer)
      timer = null
    },
  }
  return store
}

export const OrderStoreContext = createContext<OrderStore | null>(null)
