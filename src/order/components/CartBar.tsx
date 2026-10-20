import { h } from 'preact'
import { useContext, useId } from 'preact/hooks'
import { OrderStoreContext } from '../store'
import { createOrderT } from '../i18n'
import { estimateCents } from '../cart'
import { formatMXN } from '../money'
import { formatTime, opensAt } from '../hours'
import type { StoreInfo } from '../types'
import { storeStatus } from './StoreStatusBanner'

/**
 * Por qué hoy no se puede pedir: «Puedes pedir desde las 15:37» cuando se conoce la hora (la pausa con hora, o la próxima apertura
 * de HOY de un negocio cerrado) y, si no, la frase del estado, la misma del aviso de arriba.
 */
function reasonOf(info: StoreInfo, locale: 'es' | 'en', t: ReturnType<typeof createOrderT>): string {
  const tz = info.venue.timezone ?? 'America/Mexico_City'
  const time =
    info.status === 'PAUSED' && info.reason === 'MANUAL_PAUSE' && info.pausedUntil ? formatTime(info.pausedUntil, tz, locale)
    : info.status === 'CLOSED' ? opensAt(info.hours, new Date(), tz)
    : null
  return time ? t('menu.orderFrom', { time }) : storeStatus(info, t, locale).text
}

/**
 * Barra del carrito: pegada abajo dentro de la tienda, con la cantidad de piezas, «Ver pedido» y el total estimado. SIEMPRE abre el
 * carrito (también con la tienda no abierta: ahí se ve, se edita y se vacía; sólo «Continuar» queda deshabilitado). Con la tienda
 * no abierta cambia a color neutro y dice el motivo debajo. No se pinta con la ficha de un producto abierta: ahí manda su pie.
 */
export function CartBar() {
  const store = useContext(OrderStoreContext)!
  const noteId = useId()
  const cart = store.cart.value
  if (cart.length === 0 || store.productId.value) return null
  const t = createOrderT(store.locale)
  const n = cart.reduce((s, l) => s + l.quantity, 0)
  const total = formatMXN(estimateCents(cart) / 100, store.locale)
  const info = store.info.value
  const open = info?.status === 'OPEN'
  const reason = info && !open ? reasonOf(info, store.locale, t) : null
  return (
    <button type="button" class={open ? 'avq-o-bar' : 'avq-o-bar avq-o-bar--neutral'}
      aria-label={n === 1 ? t('menu.viewOrderAriaOne', { total }) : t('menu.viewOrderAria', { n, total })}
      aria-describedby={reason ? noteId : undefined} onClick={() => store.go('cart')}>
      <span class="avq-o-bar__count">{n}</span>
      <span class="avq-o-bar__label">
        <span>{t('menu.viewOrderLabel')}</span>
        {reason && <span class="avq-o-bar__note" id={noteId}>{reason}</span>}
      </span>
      <span class="avq-o-bar__total">{total}</span>
    </button>
  )
}
