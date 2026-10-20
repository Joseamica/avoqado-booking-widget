import { h } from 'preact'
import { useContext } from 'preact/hooks'
import { OrderStoreContext } from '../store'
import { createOrderT } from '../i18n'
import { checkoutOf, retry, send } from '../checkout'
import { formatMXN } from '../money'
import { Notice } from './StoreStatusBanner'

/**
 * Lo que quedó del último envío: «el precio cambió» (sólo se manda con el toque), el error con «Reintentar» si el intento
 * sigue vivo, o el aviso de un intento pendiente (también tras recargar). Se pinta en UN lugar por pantalla. Son tarjetas de la
 * tienda (`Notice`): sin red es un estado normal (ámbar, nube tachada), no un fallo en rojo.
 */
export function CheckoutStatus() {
  const store = useContext(OrderStoreContext)!
  const t = createOrderT(store.locale)
  const c = checkoutOf(store)
  const f = c.feedback.value
  if (c.busy.value) return null
  if (f?.kind === 'priceChanged')
    return (
      <Notice role="alert" tone="warn" text={t('checkout.priceChanged', { total: formatMXN(f.total, store.locale) })}
        action={{ label: t('checkout.confirmNewTotal'), onClick: () => void send(store, f.body) }} />
    )
  if (f?.kind === 'error') {
    // Por el texto (es lo único que trae): el envío sin red llega con `common.offline` (`errorText`), y «el precio cambió; revisa tu
    // pedido» (checkout.ts, un intento viejo con otro carrito) tampoco es un fallo. Los dos van en ámbar; lo demás, en rojo.
    const offline = f.message === t('common.offline')
    const warn = offline || f.message === t('checkout.priceChangedReview')
    return (
      <Notice role="alert" tone={warn ? 'warn' : 'error'} icon={offline ? 'cloudOff' : warn ? undefined : 'alert'} text={f.message}
        action={f.retryable ? { label: t('common.retry'), onClick: () => void retry(store) } : undefined} />
    )
  }
  // En la pantalla del código el intento espera la verificación, no la conexión.
  if (c.pending.value && store.screen.value !== 'otp')
    return <Notice tone="warn" icon="cloudOff" text={t('checkout.pending')} action={{ label: t('common.retry'), onClick: () => void retry(store) }} />
  return null
}
