import { h } from 'preact'
import { useContext } from 'preact/hooks'
import { OrderStoreContext } from '../store'
import { createOrderT } from '../i18n'
import { checkoutOf, retry, send } from '../checkout'
import { formatMXN } from '../money'
import { Notice } from './StoreStatusBanner'

/** «Café gratis» ⇒ «café gratis» dentro de una frase. */
const enFrase = (s: string) => s.charAt(0).toLocaleLowerCase('es') + s.slice(1)

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
  // codex-w3-r1 #1: el pedido anterior salió con su sesión y quizá ya se creó: sólo se termina entrando otra vez (nunca se repite sin ella).
  if (f?.kind === 'sesionParaTerminar')
    return (
      <Notice role="alert" tone="warn" title={t('cart.benefits.sessionTitle')} text={t('checkout.finishSignedIn')}
        action={{ label: t('cart.benefits.signInAgain'), onClick: () => store.go('entrar') }} />
    )
  // W3 (1h·4): la sesión se cerró entre cotizar y pedir. Entrar otra vez es lo primero (es lo que ella quería).
  if (f?.kind === 'priceChanged' && f.motivo === 'SIN_SESION')
    return (
      <div class="avq-o-why">
        <Notice role="alert" tone="warn" title={t('cart.benefits.sessionTitle')} text={t('cart.benefits.sessionText')} />
        <button type="button" class="avq-o-btn avq-o-btn--primary" onClick={() => store.go('entrar')}>{t('cart.benefits.signInAgain')}</button>
        <button type="button" class="avq-o-btn avq-o-btn--quiet" onClick={() => void send(store, f.body)}>
          {t('checkout.orderWithout', { total: formatMXN(f.total, store.locale) })}
        </button>
      </div>
    )
  // W3 (1h·3): un beneficio ya no está (otro pedido usó el premio): dice POR QUÉ cambió y nunca crea un folio más caro sin el toque.
  if (f?.kind === 'priceChanged' && f.motivo) {
    const title =
      f.motivo === 'PREMIO' ? (f.premio ? t('checkout.premioUsed', { premio: enFrase(f.premio) }) : t('checkout.premioUsedGeneric'))
      : f.motivo === 'PUNTOS' ? t('checkout.pointsGone') : t('checkout.couponGone')
    return (
      <div class="avq-o-why">
        <Notice role="alert" tone="warn" title={title} text={t('checkout.newTotal', { total: formatMXN(f.total, store.locale) })} />
        <button type="button" class="avq-o-btn avq-o-btn--primary" onClick={() => void send(store, f.body)}>
          <span>{t('checkout.confirmNewTotal')}</span> <span>{formatMXN(f.total, store.locale)}</span>
        </button>
        <button type="button" class="avq-o-btn avq-o-btn--quiet" onClick={() => { c.feedback.value = null; store.go('cart') }}>{t('checkout.backToOrder')}</button>
      </div>
    )
  }
  if (f?.kind === 'priceChanged')
    return (
      <Notice role="alert" tone="warn" text={t('checkout.priceChanged', { total: formatMXN(f.total, store.locale) })}
        action={{ label: t('checkout.confirmNewTotal'), onClick: () => void send(store, f.body) }} />
    )
  if (f?.kind === 'error') {
    // Por el texto (es lo único que trae): el envío sin red llega con `common.offline` (`errorText`), y «el precio cambió; revisa tu
    // pedido» (checkout.ts, un intento viejo con otro carrito) tampoco es un fallo. Los dos van en ámbar; lo demás, en rojo.
    const offline = f.message === t('common.offline')
    const warn = offline || f.message === t('checkout.priceChangedReview') || f.message === t('checkout.needsPhone')
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
