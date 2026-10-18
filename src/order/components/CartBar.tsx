import { h } from 'preact'
import { useContext } from 'preact/hooks'
import { OrderStoreContext } from '../store'
import { createOrderT } from '../i18n'
import { estimateCents } from '../cart'
import { formatMXN } from '../money'
import { btn } from './ui'

export function CartBar() {
  const store = useContext(OrderStoreContext)!
  const cart = store.cart.value
  if (cart.length === 0) return null
  const t = createOrderT(store.locale)
  const n = cart.reduce((s, l) => s + l.quantity, 0)
  return (
    <div style={{ position: 'sticky', bottom: 0, padding: '10px 0' }}>
      <button type="button" style={{ ...btn(true), width: '100%' }} onClick={() => store.go('cart')}>
        {t('menu.viewOrder', { n, total: formatMXN(estimateCents(cart) / 100, store.locale) })}
      </button>
    </div>
  )
}
