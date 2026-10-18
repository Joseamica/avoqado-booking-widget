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
