import { h } from 'preact'
import { useContext, useEffect, useState } from 'preact/hooks'
import { OrderStoreContext } from '../store'
import { ApiError, getTracking } from '../api'
import { createOrderT } from '../i18n'
import { clearLastOrder, loadLastOrder } from '../session'
import { isFinalStatus } from '../types'
import { emitStoreLoaded } from '../events'
import { MenuScreen } from './MenuScreen'
import { CartScreen } from './CartScreen'
import { DetailsScreen } from './DetailsScreen'
import { OtpScreen } from './OtpScreen'
import { CheckoutStatus } from './CheckoutStatus'
import { TrackingScreen } from './TrackingScreen'
import { banner, btn } from './ui'
import { STORE_CSS, accentFor, loadStoreFonts } from './theme'

/**
 * Raíz de la tienda. La marca sale de `/info` (no de reservas); `accentColor` es el respaldo del atributo `accent-color`.
 * Pinta la hoja de estilos de la tienda (`STORE_CSS`) dentro de su raíz y pide las tipografías una sola vez.
 */
export function OrderApp({ accentColor }: { accentColor?: string }) {
  const store = useContext(OrderStoreContext)!
  const t = createOrderT(store.locale)
  const token = store.trackingToken.value
  useEffect(() => { loadStoreFonts() }, [])
  // También al salir del seguimiento («Pedir algo más»): ahí todavía no se había pedido la carta.
  useEffect(() => { if (!store.menu.value) void store.load() }, [store, token])
  // ¿Queda un pedido en curso de este comensal? Aquí y no en la carta: con el plan vencido, la tienda apagada o `/info`
  // caído también tiene que poder volver a su pedido. Final o 404 ⇒ se olvida (y el 404 se avisa). Se vuelve a mirar al
  // salir del seguimiento: el pedido que se acaba de hacer también es «el pedido en curso».
  const [active, setActive] = useState<string | null>(null)
  useEffect(() => {
    const last = loadLastOrder(store.slug)
    if (!last) return void setActive(null)
    if (last.trackingToken === token) return
    let off = false
    getTracking(store.slug, last.trackingToken).then(
      r => {
        if (off) return
        if (isFinalStatus(r.status)) {
          clearLastOrder(store.slug)
          setActive(null)
        } else setActive(last.trackingToken)
      },
      e => {
        if (off || !(e instanceof ApiError) || e.status !== 404) return
        clearLastOrder(store.slug)
        setActive(null)
        store.notice.value = t('tracking.notFound')
      },
    )
    return () => { off = true }
  }, [store, token])
  const info = store.info.value
  const name = info?.venue.name || null
  // La página hospedada pone el nombre real en su título (no el que adivina del slug).
  useEffect(() => { if (name && store.host) emitStoreLoaded(store.host, { slug: store.slug, name }) }, [store, name])
  // El color de la marca (o del atributo) sólo se usa si da 4.5:1 con el texto blanco del botón; si no, negro.
  const accent = accentFor(info?.brand.primaryColor || accentColor)
  const logo = info?.brand.logo || info?.brand.logoFull
  const notice = store.notice.value
  const screen = store.screen.value
  return (
    <div class="avq-o-root" style={{ ['--avq-accent' as any]: accent }}>
      <style>{STORE_CSS}</style>
      {/* De quién es la tienda, arriba de todo; el seguimiento ya trae el nombre en su título. */}
      {screen !== 'tracking' && (name || logo) && (
        <header style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: '0 0 12px' }}>
          {logo && <img src={logo} alt="" style={{ height: '40px', maxWidth: '160px', objectFit: 'contain', borderRadius: '8px' }}
            onError={(e: any) => { e.currentTarget.style.display = 'none' }} />}
          {name && <strong style={{ fontSize: '18px' }}>{name}</strong>}
        </header>
      )}
      {notice && (
        <div role="status" style={{ ...banner, display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
          <span>{notice}</span>
          <button type="button" style={btn()} onClick={() => { store.notice.value = null }}>{t('common.close')}</button>
        </div>
      )}
      {active && screen !== 'tracking' && (
        <p role="status" style={{ ...banner, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
          <span>{t('tracking.inProgress')}</span>
          <button type="button" style={btn()} onClick={() => { store.trackingToken.value = active; store.go('tracking') }}>{t('tracking.view')}</button>
        </p>
      )}
      {/* Datos y código pintan el estado del envío junto a su botón; las demás, arriba. */}
      {(screen === 'menu' || screen === 'product' || screen === 'cart') && <CheckoutStatus />}
      {(screen === 'menu' || screen === 'product') && <MenuScreen />}
      {screen === 'cart' && <CartScreen />}
      {screen === 'details' && <DetailsScreen />}
      {screen === 'otp' && <OtpScreen />}
      {screen === 'tracking' && <TrackingScreen />}
    </div>
  )
}
