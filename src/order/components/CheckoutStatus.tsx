import { h } from 'preact'
import { useContext } from 'preact/hooks'
import { OrderStoreContext } from '../store'
import { createOrderT } from '../i18n'
import { checkoutOf, retry, send } from '../checkout'
import { formatMXN } from '../money'
import { banner, btn } from './ui'

/**
 * Lo que quedó del último envío: «el precio cambió» (sólo se manda con el toque), el error con «Reintentar» si el intento
 * sigue vivo, o el aviso de un intento pendiente (también tras recargar). Se pinta en UN lugar por pantalla.
 */
export function CheckoutStatus() {
  const store = useContext(OrderStoreContext)!
  const t = createOrderT(store.locale)
  const c = checkoutOf(store)
  const f = c.feedback.value
  if (c.busy.value) return null
  const box = (text: string, action: string, onClick: () => void, role: 'alert' | 'status' = 'alert') => (
    <div role={role} style={banner}>
      <p style={{ margin: '0 0 6px' }}>{text}</p>
      <button type="button" style={btn()} onClick={onClick}>{action}</button>
    </div>
  )
  if (f?.kind === 'priceChanged')
    return box(t('checkout.priceChanged', { total: formatMXN(f.total, store.locale) }), t('checkout.confirmNewTotal'), () => void send(store, f.body))
  if (f?.kind === 'error')
    return f.retryable ? box(f.message, t('common.retry'), () => void retry(store)) : <div role="alert" style={banner}>{f.message}</div>
  // En la pantalla del código el intento espera la verificación, no la conexión.
  if (c.pending.value && store.screen.value !== 'otp') return box(t('checkout.pending'), t('common.retry'), () => void retry(store), 'status')
  return null
}
