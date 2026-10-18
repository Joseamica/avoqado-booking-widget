import { h } from 'preact'
import { useContext, useEffect } from 'preact/hooks'
import { OrderStoreContext } from '../store'
import { createOrderT } from '../i18n'
import { MenuScreen } from './MenuScreen'
import { banner, btn } from './ui'

/** Raíz de la tienda. La marca sale de `/info` (no de reservas); `accentColor` es el respaldo del atributo `accent-color`. */
export function OrderApp({ accentColor }: { accentColor?: string }) {
  const store = useContext(OrderStoreContext)!
  const t = createOrderT(store.locale)
  useEffect(() => { if (!store.menu.value && !store.trackingToken.value) void store.load() }, [store])
  const accent = store.info.value?.brand.primaryColor || accentColor
  const notice = store.notice.value
  return (
    <div style={accent ? { ['--avq-accent' as any]: accent } : undefined}>
      {notice && (
        <div role="status" style={{ ...banner, display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
          <span>{notice}</span>
          <button type="button" style={btn()} onClick={() => { store.notice.value = null }}>{t('common.close')}</button>
        </div>
      )}
      {/* Carrito, datos, verificación y seguimiento llegan en las tareas 9 y 10. */}
      {(store.screen.value === 'menu' || store.screen.value === 'product') && <MenuScreen />}
    </div>
  )
}
