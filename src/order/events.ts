// Eventos públicos de `<avoqado-order>` (la página del negocio los escucha). Los de reservas no se renombran.
import type { CreatedOrder } from './types'

export const ORDER_CREATED = 'avoqado:pedido-creado'
export interface OrderCreatedDetail { orderNumber: string; trackingToken: string; trackingUrl: string }

/** La misma liga que mandan los avisos del servidor (`ORDERING_STOREFRONT_BASE_URL`). */
const STOREFRONT = 'https://pedidos.avoqado.io'

export function emitOrderCreated(target: EventTarget, slug: string, order: Pick<CreatedOrder, 'orderNumber' | 'trackingToken'>): void {
  const detail: OrderCreatedDetail = {
    orderNumber: order.orderNumber,
    trackingToken: order.trackingToken,
    trackingUrl: `${STOREFRONT}/${encodeURIComponent(slug)}/pedido/${encodeURIComponent(order.trackingToken)}`,
  }
  target.dispatchEvent(new CustomEvent(ORDER_CREATED, { detail, bubbles: true, composed: true }))
}
