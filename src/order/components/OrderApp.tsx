import { h } from 'preact'
import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
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
import { STORE_CSS, accentFor, loadStoreFonts } from './theme'
import { VenueMark, logoOf } from './VenueMark'
import { focusLost, tapTime } from './focus'

/** Las pantallas a las que se llega «hacia adelante»: al cambiar a una de ellas la tienda sube a su inicio y se enfoca su titular. */
const ARRIVALS: ReadonlySet<string> = new Set(['cart', 'details', 'otp', 'tracking'])
/** Durante cuánto, tras cambiar la vista (la pantalla, o abrir o cerrar la ficha), la tienda ignora los toques: el segundo de un doble toque. */
const TAP_GUARD_MS = 400

/**
 * Raíz de la tienda. La marca sale de `/info` (no de reservas); `accentColor` es el respaldo del atributo `accent-color`.
 * Pinta la hoja de estilos de la tienda (`STORE_CSS`) dentro de su raíz y pide las tipografías una sola vez.
 * Encabezado: la portada completa (foto, logo, nombre, dirección y chips) sólo en la carta; en datos y código, una cabecera compacta
 * (logo y nombre); el carrito no lleva ninguna (su tarjeta «Recoges en» ya trae el logo y el nombre); el seguimiento trae la suya, y la
 * ficha de un producto ocupa el lugar de la tienda.
 * Al CAMBIAR a una pantalla de adelante (carrito, datos, código o seguimiento; no al cargar la página ni al volver a la carta) la
 * ventana conserva el scroll de la anterior y la nueva podría abrir a media página: si el borde de arriba de la tienda quedó sobre
 * la ventana, sube SÓLO la raíz de la tienda a su inicio (nunca el host ni nada del sitio; el mismo principio mínimo de la ficha, §12.2);
 * y el foco va al titular de la pantalla, sin mover la página, sólo si nadie lo tiene (el código lleva el suyo a su primera caja).
 * Tras cambiar la vista, los clics de los primeros 400 ms no llegan a nada (ver `dropEarly`).
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
  const logo = logoOf(info)
  const cover = info?.brand.heroImageUrl || null
  // Una imagen que no carga se quita, sin dejar un hueco gris: la portada cae a la cabecera sin foto (el logo, a las iniciales: lo
  // resuelve `VenueMark`). Se guarda la LIGA que falló, así una liga nueva (otro /info) se intenta de nuevo.
  const [badCover, setBadCover] = useState<string | null>(null)
  const showCover = !!cover && badCover !== cover
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
  const root = useRef<HTMLDivElement>(null)
  const from = useRef(screen)
  useLayoutEffect(() => {
    const prev = from.current
    from.current = screen
    const el = root.current
    if (!el || prev === screen || !ARRIVALS.has(screen)) return
    if (el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: 'start' })
    // El titular (`tabindex -1`, sin contorno) y, si nadie tiene el foco, ahí va. Un hijo que ya lo tomó (la primera caja del código) o
    // una persona que ya está en otro elemento, del sitio o de la tienda, se quedan como están.
    const arrive = () => {
      const title = el.querySelector<HTMLElement>('.avq-o-title')
      if (!title) return false
      if (focusLost(el)) title.focus({ preventScroll: true })
      return true
    }
    if (arrive()) return
    // El seguimiento trae sus datos al llegar: su titular aparece después. Se espera a que salga (y se deja de esperar al cambiar de pantalla).
    const watch = new MutationObserver(() => { if (arrive()) watch.disconnect() })
    watch.observe(el, { childList: true, subtree: true })
    return () => watch.disconnect()
  }, [screen])
  // Un doble toque: el primero cambia la vista (la fila abre la ficha, «Agregar» la cierra, «Continuar» lleva a los datos…) y el segundo
  // caería en lo que apareció debajo (una opción con sobreprecio, «Ver pedido»…). Se anota cuándo cambió la pantalla o la ficha (al montar
  // la tienda no cambió nada) y la raíz, en la fase de captura, descarta los clics de los 400 ms siguientes, a la hora del TOQUE (`tapTime`):
  // ni el botón ni el navegador (una casilla, un enlace) los ven. El primer toque siempre pasa, porque llega antes del cambio que provoca;
  // un toque o una tecla de verdad, más lentos que eso, también.
  const pid = store.productId.value
  const changedAt = useRef(-Infinity)
  const mounted = useRef(false)
  useLayoutEffect(() => {
    if (mounted.current) changedAt.current = performance.now()
    mounted.current = true
  }, [screen, pid])
  const dropEarly = (e: Event) => {
    if (tapTime(e) - changedAt.current >= TAP_GUARD_MS) return
    e.preventDefault()
    e.stopPropagation()
  }
  const hasBrand = !!(name || logo)
  const hero = hasBrand && (screen === 'menu' || screen === 'product') && !pid
  const compact = hasBrand && (screen === 'details' || screen === 'otp')
  return (
    <div ref={root} class="avq-o-root" style={{ ['--avq-accent' as any]: accent }} onClickCapture={dropEarly}>
      <style>{STORE_CSS}</style>
      {/* De quién es la tienda, arriba de todo; el seguimiento pinta su propia cabecera chica (TrackingScreen). */}
      {hero && (
        <header class={showCover ? 'avq-o-hero avq-o-hero--cover' : 'avq-o-hero'}>
          {showCover && <img class="avq-o-hero__img" src={cover!} alt="" onError={() => setBadCover(cover)} />}
          <div class="avq-o-hero__id">
            <VenueMark />
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
          <VenueMark small />
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
