import { h } from 'preact'
import { useContext, useEffect, useState } from 'preact/hooks'
import { OrderStoreContext } from '../store'
import { ApiError, getTracking } from '../api'
import { createOrderT } from '../i18n'
import { clearLastOrder, loadLastOrder } from '../session'
import { isFinalStatus } from '../types'
import { emitStoreLoaded } from '../events'
import { closesAt } from '../hours'
import { MenuScreen } from './MenuScreen'
import { CartScreen } from './CartScreen'
import { DetailsScreen } from './DetailsScreen'
import { OtpScreen } from './OtpScreen'
import { CheckoutStatus } from './CheckoutStatus'
import { TrackingScreen } from './TrackingScreen'
import { Notice } from './StoreStatusBanner'
import { STORE_CSS, accentFor, initialsOf, loadStoreFonts } from './theme'

/**
 * Raíz de la tienda. La marca sale de `/info` (no de reservas); `accentColor` es el respaldo del atributo `accent-color`.
 * Pinta la hoja de estilos de la tienda (`STORE_CSS`) dentro de su raíz y pide las tipografías una sola vez.
 * Encabezado: la portada completa (foto, logo, nombre, dirección y chips) sólo en la carta; en carrito, datos y código, una
 * cabecera compacta (logo y nombre); el seguimiento trae la suya, y la ficha de un producto ocupa el lugar de la tienda.
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
  const logo = info?.brand.logo || info?.brand.logoFull || null
  const cover = info?.brand.heroImageUrl || null
  // Una imagen que no carga se quita, sin dejar un hueco gris: el logo cae a las iniciales y la portada, a la cabecera sin foto.
  // Se guarda la LIGA que falló, así una liga nueva (otro /info) se intenta de nuevo.
  const [badLogo, setBadLogo] = useState<string | null>(null)
  const [badCover, setBadCover] = useState<string | null>(null)
  const showLogo = !!logo && badLogo !== logo
  const showCover = !!cover && badCover !== cover
  const initials = initialsOf(name)
  // Las iniciales no se leen en voz alta (el nombre ya va al lado); el logo es una imagen sin texto alternativo.
  const mark = (small = false) =>
    showLogo || initials ? (
      <span class={small ? 'avq-o-mark avq-o-mark--sm' : 'avq-o-mark'} aria-hidden={showLogo ? undefined : 'true'}>
        {showLogo ? <img src={logo!} alt="" onError={() => setBadLogo(logo)} /> : initials}
      </span>
    ) : null
  // «Abierto hasta las 22:00» (el cierre de la franja de ahora); sin horario, o fuera de toda franja, «Abierto» a secas. Con la
  // tienda no abierta no hay chips: el aviso de abajo (pausa, cerrado…) ocupa su lugar.
  const chips = () => {
    if (info?.status !== 'OPEN') return null
    const until = closesAt(info.hours, new Date(), info.venue.timezone ?? 'America/Mexico_City')
    return (
      <div class="avq-o-chips">
        <span class="avq-o-chip avq-o-chip--ok">
          <span class="avq-o-dot" aria-hidden="true" />
          {until ? t('store.openUntil', { time: until }) : t('store.open')}
        </span>
        {info.estimatedPrepMinutes > 0 && <span class="avq-o-chip">{t('store.readyIn', { n: info.estimatedPrepMinutes })}</span>}
        {info.paymentModes?.payAtPickup && <span class="avq-o-chip">{t('store.payAtPickupChip')}</span>}
      </div>
    )
  }
  const address = info?.contact?.address || null
  const notice = store.notice.value
  const screen = store.screen.value
  const hasBrand = !!(name || logo)
  const hero = hasBrand && (screen === 'menu' || screen === 'product') && !store.productId.value
  const compact = hasBrand && (screen === 'cart' || screen === 'details' || screen === 'otp')
  return (
    <div class="avq-o-root" style={{ ['--avq-accent' as any]: accent }}>
      <style>{STORE_CSS}</style>
      {/* De quién es la tienda, arriba de todo; el seguimiento ya trae el nombre en su título. */}
      {hero && (
        <header class={showCover ? 'avq-o-hero avq-o-hero--cover' : 'avq-o-hero'}>
          {showCover && <img class="avq-o-hero__img" src={cover!} alt="" onError={() => setBadCover(cover)} />}
          <div class="avq-o-hero__id">
            {mark()}
            {(name || address) && (
              <div class="avq-o-hero__names">
                {name && <h1 class="avq-o-hero__name">{name}</h1>}
                {address && <p class="avq-o-hero__addr">{t('store.pickupAt', { address })}</p>}
              </div>
            )}
          </div>
          {chips()}
        </header>
      )}
      {compact && (
        <header class="avq-o-head">
          {mark(true)}
          {name && <span class="avq-o-head__name">{name}</span>}
        </header>
      )}
      {notice && <Notice tone="neutral" text={notice} action={{ label: t('common.close'), onClick: () => { store.notice.value = null } }} />}
      {active && screen !== 'tracking' && (
        <Notice tone="neutral" text={t('tracking.inProgress')}
          action={{ label: t('tracking.view'), onClick: () => { store.trackingToken.value = active; store.go('tracking') } }} />
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
