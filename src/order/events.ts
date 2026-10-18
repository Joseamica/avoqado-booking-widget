// Eventos públicos de `<avoqado-order>` (la página del negocio los escucha). Los de reservas no se renombran.
import type { CreatedOrder } from './types'

export const ORDER_CREATED = 'avoqado:pedido-creado'
export interface OrderCreatedDetail { orderNumber: string; trackingToken: string; trackingUrl: string }

/** Espejo de `ORDERING_STOREFRONT_BASE_URL` del servidor: en un host `pedidos.*` (staging incluido) se usa el propio origen. */
const storefront = () => (location.hostname.startsWith('pedidos.') ? location.origin : 'https://pedidos.avoqado.io')

export function emitOrderCreated(target: EventTarget, slug: string, order: Pick<CreatedOrder, 'orderNumber' | 'trackingToken'>): void {
  const detail: OrderCreatedDetail = {
    orderNumber: order.orderNumber,
    trackingToken: order.trackingToken,
    trackingUrl: `${storefront()}/${encodeURIComponent(slug)}/pedido/${encodeURIComponent(order.trackingToken)}`,
  }
  target.dispatchEvent(new CustomEvent(ORDER_CREATED, { detail, bubbles: true, composed: true }))
}

/** La tienda ya sabe el nombre real del restaurante (llegó `/info`): la página hospedada lo pone en su título. */
export const STORE_LOADED = 'avoqado:tienda-cargada'
export interface StoreLoadedDetail { slug: string; name: string }

export function emitStoreLoaded(target: EventTarget, detail: StoreLoadedDetail): void {
  target.dispatchEvent(new CustomEvent(STORE_LOADED, { detail, bubbles: true, composed: true }))
}
