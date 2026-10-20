import { h } from 'preact'
import { useContext, useId, useState } from 'preact/hooks'
import { OrderStoreContext } from '../store'
import { createOrderT } from '../i18n'
import { API_BASE } from '../api'
import { buildOrderBody, checkoutOf, send } from '../checkout'
import { formatMXN } from '../money'
import { phoneE164 } from '../phone'
import { CountryPhoneInput } from '../../components/ui/CountryPhoneInput'
import { StoreStatusBanner } from './StoreStatusBanner'
import { CheckoutStatus } from './CheckoutStatus'
import { Back } from './icons'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
/** Durante cuánto, al aparecer la pantalla, «Confirmar pedido» ignora los toques (ver `confirm`). */
const ENTRY_GUARD_MS = 400

/**
 * Nombre, WhatsApp (el mismo texto que se verifica por código), correo opcional, aviso simplificado y «Confirmar pedido». El botón,
 * con el total, va en un pie pegajoso DENTRO de la tienda (el mismo `.avq-o-cartfoot` del carrito, nunca `position: fixed`), con lo
 * que falta y el estado del envío arriba de él.
 */
export function DetailsScreen() {
  const store = useContext(OrderStoreContext)!
  const t = createOrderT(store.locale)
  const id = useId()
  const [shownAt] = useState(() => performance.now())
  const c = checkoutOf(store)
  const d = c.draft.value
  const set = (patch: Partial<typeof d>) => { c.draft.value = { ...c.draft.value, ...patch } }
  const info = store.info.value
  const q = store.quote.value

  const phone = phoneE164(d.dial, d.national)
  const name = d.name.trim()
  const email = d.email.trim()
  const missing =
    name.length < 2 || name.length > 80 ? t('details.needName')
    : !(d.dial === '52' ? /^\+52\d{10}$/ : /^\+\d{8,15}$/).test(phone) ? t('details.needPhone')
    : email && (!EMAIL_RE.test(email) || email.length > 120) ? t('details.needEmail')
    : !d.accepted ? t('details.needAccept')
    : null
  const busy = c.busy.value
  const open = info?.status === 'OPEN'
  // Con un intento pendiente se manda ESE (el pedido anterior), no lo que hay en pantalla: el único camino es su «Reintentar».
  const canSend = !missing && !!q?.ok && !busy && open && !c.pending.value

  const confirm = (e: Event) => {
    // Al aparecer, «Confirmar pedido» queda donde estaba «Continuar» del carrito: con la sesión verificada y los datos ya completos,
    // el segundo toque de un doble toque crearía el pedido sin que la persona viera esta pantalla. Lo de los primeros 400 ms se ignora.
    // Cuenta la hora del TOQUE (`timeStamp`, el mismo reloj que `performance.now()`), no la de atenderlo: si el hilo se traba tras
    // «Continuar», el segundo toque espera en la cola y llegaría ya «tarde».
    // ponytail: donde el `timeStamp` no es la hora del toque, cuenta la de atenderlo, y un toque encolado tras un hilo trabado 400 ms o
    // más todavía pasa (nunca más que sin esto). Pasa en iOS WebKit (Safari y los WKWebView de otras apps), que sintetiza el click del
    // toque en el proceso web con la hora en que lo procesa, y con un `timeStamp` en 0 o de otro reloj (jsdom: Date.now()), que cae
    // a la hora de ahora. Falta confirmarlo en un iPhone real (tarea 10).
    const at = e.timeStamp > 0 && e.timeStamp <= performance.now() ? e.timeStamp : performance.now()
    if (!canSend || at - shownAt < ENTRY_GUARD_MS) return
    void send(store, buildOrderBody(store, { customer: { name, phone, ...(email ? { email } : {}) }, note: d.note || null }))
  }
  const venue = info?.venue.name || t('details.theRestaurant')
  // Piezas, como el contador de la barra del carrito.
  const n = store.cart.value.reduce((s, l) => s + l.quantity, 0)

  return (
    <div class="avq-o-details">
      <StoreStatusBanner />
      <button type="button" class="avq-o-back" aria-label={t('details.back')} onClick={() => store.go('cart')}><Back /></button>
      <div class="avq-o-form">
        <div class="avq-o-form__intro">
          <h2 class="avq-o-title">{t('details.title')}</h2>
          <p>{t('details.helper')}</p>
        </div>
        <div class="avq-o-field">
          <label for={`${id}-name`}>{t('details.name')}</label>
          <input id={`${id}-name`} class="avq-o-input" type="text" autoComplete="name" maxLength={80} value={d.name}
            onInput={(e: any) => set({ name: e.currentTarget.value })} />
        </div>
        {/* El campo es compartido con reservas (sin `id` para el número): el grupo lleva el nombre «WhatsApp». */}
        <div class="avq-o-field" role="group" aria-labelledby={`${id}-phone`}>
          <span id={`${id}-phone`} class="avq-o-field__label">{t('details.phone')}</span>
          <CountryPhoneInput look="tienda" dialCode={d.dial} nationalNumber={d.national}
            onDialCodeChange={dial => set({ dial })} onNationalNumberChange={national => set({ national })}
            numberPlaceholder={t('details.phonePlaceholder')} searchPlaceholder={t('details.countrySearch')} noResultsText={t('details.countryNoResults')} />
          <p class="avq-o-help">{t('details.phoneHelp')}</p>
        </div>
        <div class="avq-o-field">
          <label for={`${id}-email`}>{t('details.email')}</label>
          <input id={`${id}-email`} class="avq-o-input" type="email" autoComplete="email" maxLength={120} value={d.email}
            onInput={(e: any) => set({ email: e.currentTarget.value })} />
        </div>
        <div class="avq-o-privacy">
          <p class="avq-o-help">{t('details.privacy', { venue })}</p>
          {info?.privacyNoticePath && (
            <a href={API_BASE + info.privacyNoticePath} target="_blank" rel="noopener noreferrer">{t('details.privacyLink')}</a>
          )}
          <label class="avq-o-check">
            <input type="checkbox" checked={d.accepted} onChange={(e: any) => set({ accepted: e.currentTarget.checked })} />
            <span>{t('details.accept')}</span>
          </label>
        </div>
      </div>
      <div class="avq-o-foot">
        {info?.contact?.address && <p>{info.contact.address}</p>}
        {info?.contact?.phone && <p>{info.contact.phone}</p>}
        <p>{t('cart.payAtPickup')}</p>
        <p>{t('details.cancelPolicy')}</p>
        <p>{t('details.updates')}</p>
      </div>
      <div class="avq-o-cartfoot avq-o-confirm">
        <p class="avq-o-confirm__sum">
          <span>{n === 1 ? t('details.summaryOne') : t('details.summary', { n })}</span>
          <span>{t('details.taxIncluded')}</span>
        </p>
        <CheckoutStatus />
        {missing && <p class="avq-o-confirm__msg">{missing}</p>}
        <button type="button" class="avq-o-btn avq-o-btn--primary" disabled={!canSend} onClick={confirm}>
          {busy ? <span>{t('details.sending')}</span>
            : q ? <><span>{t('details.confirm')}</span> <span>{formatMXN(q.total, store.locale)}</span></>
            : <span>{t('details.confirm')}</span>}
        </button>
      </div>
    </div>
  )
}
