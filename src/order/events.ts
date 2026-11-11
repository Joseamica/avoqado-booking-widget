// Eventos públicos de `<avoqado-order>` (la página del negocio los escucha). Los de reservas no se renombran.
import type { CreatedOrder, OnlineOrderStatus, Tracking } from './types'

export const ORDER_CREATED = 'avoqado:pedido-creado'
export interface OrderCreatedDetail { orderNumber: string; trackingToken: string; trackingUrl: string }

/** Espejo de `ORDERING_STOREFRONT_BASE_URL` del servidor: en un host `pedidos.*` (staging incluido) se usa el propio origen. */
const storefront = () => (location.hostname.startsWith('pedidos.') ? location.origin : 'https://pedidos.avoqado.io')

/** La página de seguimiento de un pedido (la misma liga del correo y del evento de creado). */
export const trackingUrl = (slug: string, trackingToken: string): string =>
  `${storefront()}/${encodeURIComponent(slug)}/pedido/${encodeURIComponent(trackingToken)}`

export function emitOrderCreated(target: EventTarget, slug: string, order: Pick<CreatedOrder, 'orderNumber' | 'trackingToken'>): void {
  const detail: OrderCreatedDetail = {
    orderNumber: order.orderNumber,
    trackingToken: order.trackingToken,
    trackingUrl: trackingUrl(slug, order.trackingToken),
  }
  target.dispatchEvent(new CustomEvent(ORDER_CREATED, { detail, bubbles: true, composed: true }))
}

/** La tienda ya sabe el nombre real del restaurante (llegó `/info`): la página hospedada lo pone en su título. */
export const STORE_LOADED = 'avoqado:tienda-cargada'
export interface StoreLoadedDetail { slug: string; name: string }

export function emitStoreLoaded(target: EventTarget, detail: StoreLoadedDetail): void {
  target.dispatchEvent(new CustomEvent(STORE_LOADED, { detail, bubbles: true, composed: true }))
}

/**
 * W4 (P2-6): el seguimiento (o el aviso del menú) vio que un folio cambió entre dos lecturas (pagado, vencido, cancelado…). «Mi cuenta»
 * de ese negocio, en cualquier elemento de la página, se vuelve a leer. Sale del host (o del documento) y llega al documento.
 */
export const FOLIO_CAMBIO = 'avoqado:folio-cambio'
export interface FolioCambioDetail { slug: string; trackingToken: string; status: OnlineOrderStatus; paid: boolean }

/** Avisa sólo si `antes` existe y cambió su estado o su «pagado» (la primera lectura no es un cambio). */
export function avisarSiCambio(target: EventTarget | null, slug: string, trackingToken: string, antes: Tracking | null, ahora: Tracking): void {
  if (!antes || (antes.status === ahora.status && !!antes.paid === !!ahora.paid)) return
  const detail: FolioCambioDetail = { slug, trackingToken, status: ahora.status, paid: !!ahora.paid }
  ;(target ?? document).dispatchEvent(new CustomEvent(FOLIO_CAMBIO, { detail, bubbles: true, composed: true }))
}
