import { h } from 'preact'
import { useContext, useEffect, useId, useState } from 'preact/hooks'
import { alCambiarLaPagina, paginaDe, sesionParaMandar, type ClienteDeSesion } from '../../lib/sesionDeCliente'
import { loadSession } from '../session'
import { OrderStoreContext } from '../store'
import { createOrderT } from '../i18n'
import { API_BASE } from '../api'
import { buildOrderBody, checkoutOf, send } from '../checkout'
import { formatMXN } from '../money'
import { phoneE164 } from '../phone'
import { CountryPhoneInput } from '../../components/ui/CountryPhoneInput'
import { ClosingSoonNotice, Notice, StoreStatusBanner } from './StoreStatusBanner'
import { CheckoutStatus } from './CheckoutStatus'
import { Back } from './icons'
import { tapTime } from './focus'
import type { PaymentMode } from '../types'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
/** W2 (a): el nombre de la ficha de una sesión de la tienda («Ana López»); la de pedidos de hoy no trae ficha: vacío. */
const nombreDe = (l: { datos?: unknown } | null | undefined): string => {
  const f = l?.datos as Partial<ClienteDeSesion> | undefined
  return [f?.firstName, f?.lastName].filter(Boolean).join(' ').trim().slice(0, 80)
}
/** Durante cuánto, al aparecer la pantalla, «Confirmar pedido» ignora los toques (ver `confirm`). */
const ENTRY_GUARD_MS = 400

/**
 * Nombre, WhatsApp (el mismo texto que se verifica por código), correo opcional, aviso simplificado y «Confirmar pedido». El botón,
 * con el total, va en un pie pegajoso DENTRO de la tienda (el mismo `.avq-o-cartfoot` del carrito, nunca `position: fixed`), con lo
 * que falta y el estado del envío arriba de él. Fase 2: con tarjeta en línea, «¿Cómo quieres pagar?» ofrece «Pagar ahora con tarjeta»
 * (primera y elegida) y, si el negocio lo acepta, «Pagar al recoger»; sólo con tarjeta no hay selector. Con tarjeta no se pide el código.
 */
export function DetailsScreen() {
  const store = useContext(OrderStoreContext)!
  const t = createOrderT(store.locale)
  const id = useId()
  const [shownAt] = useState(() => performance.now())
  const c = checkoutOf(store)
  const d = c.draft.value
  const set = (patch: Partial<typeof d>) => { c.draft.value = { ...c.draft.value, ...patch } }
  // W2 (a), conductor 11-nov: el nombre de la ficha NUNCA se escribe en el borrador. El campo enseña lo que ella tecleó (un nombre no
  // vacío del borrador siempre lo tecleó ella; `nameTouched` dice si lo borró a propósito) y, si no tecleó nada, el de la ficha que está
  // AHORA en la tienda (la sesión de la página: A refinada). Si la sesión de la página cambia con la pantalla abierta (otra tienda del
  // negocio, salir), se repinta con la de ahora.
  const [, repintar] = useState(0)
  useEffect(() => alCambiarLaPagina((slug, afecta) => { if (slug === store.slug && afecta.includes('pedidos')) repintar(n => n + 1) }), [store])
  const shownName = d.name || (d.nameTouched ? '' : nombreDe(paginaDe(store.slug, 'pedidos')))
  const info = store.info.value
  const q = store.quote.value
  // «Nadie»: sólo nombre y nota, sin teléfono ni código ni medio de pago que elegir (se paga en caja). Un servidor viejo = «Mi equipo».
  const nadie = info?.requiresAcceptance === false
  const modes = info?.paymentModes
  const choose = !nadie && !!modes?.cardOnline && modes.payAtPickup
  const payment: PaymentMode = !nadie && modes?.cardOnline && !(choose && d.payment === 'PAY_AT_PICKUP') ? 'CARD_ONLINE' : 'PAY_AT_PICKUP'
  const card = payment === 'CARD_ONLINE'

  const phone = phoneE164(d.dial, d.national)
  const name = shownName.trim()
  const email = d.email.trim()
  const missing =
    name.length < 2 || name.length > 80 ? t('details.needName')
    : nadie ? null
    : !(d.dial === '52' ? /^\+52\d{10}$/ : /^\+\d{8,15}$/).test(phone) ? t('details.needPhone')
    : email && (!EMAIL_RE.test(email) || email.length > 120) ? t('details.needEmail')
    : !d.accepted ? t('details.needAccept')
    : null
  const busy = c.busy.value
  const f = c.feedback.value
  const open = info?.status === 'OPEN'
  // Con un intento pendiente se manda ESE (el pedido anterior), no lo que hay en pantalla: el único camino es su «Reintentar».
  const canSend = !missing && !!q?.ok && !busy && open && !c.pending.value

  const confirm = (e: Event) => {
    // Al aparecer, «Confirmar pedido» queda donde estaba «Continuar» del carrito: con la sesión verificada y los datos ya completos,
    // el segundo toque de un doble toque crearía el pedido sin que la persona viera esta pantalla. Lo de los primeros 400 ms se ignora,
    // contando la hora del TOQUE (`tapTime`), no la de atenderlo. La raíz de la tienda (OrderApp) ya descarta los toques de los 400 ms que
    // siguen a un cambio de pantalla; ésta es la guarda propia del botón, medida desde que se pinta esta pantalla.
    if (!canSend || tapTime(e) - shownAt < ENTRY_GUARD_MS) return
    // W2 (a): lo que se manda es lo que se ve. Sin teclear, la ficha se lee UNA vez con la regla de mandar (`sesionParaMandar`, la misma
    // de la cotización y del pedido); si ya no es la que se ve (salió o cambió), no se manda y la pantalla se repinta con la de ahora.
    if (!d.name && nombreDe(sesionParaMandar(store.slug, 'pedidos', () => loadSession(store.slug))) !== name) return repintar(n => n + 1)
    void send(store, buildOrderBody(store, {
      customer: nadie ? { name } : { name, phone, ...(email ? { email } : {}) },
      note: d.note || null,
      paymentMode: payment,
    }))
  }
  const venue = info?.venue.name || t('details.theRestaurant')
  // Piezas, como el contador de la barra del carrito.
  const n = store.cart.value.reduce((s, l) => s + l.quantity, 0)

  return (
    <div class="avq-o-details">
      <StoreStatusBanner />
      <ClosingSoonNotice />
      <button type="button" class="avq-o-back" aria-label={t('details.back')} onClick={() => store.go('cart')}><Back /></button>
      <div class="avq-o-form">
        <div class="avq-o-form__intro">
          <h2 class="avq-o-title" tabIndex={-1}>{t('details.title')}</h2>
          <p>{t(nadie ? 'details.helperNadie' : 'details.helper')}</p>
        </div>
        <div class="avq-o-field">
          <label for={`${id}-name`}>{t('details.name')}</label>
          <input id={`${id}-name`} class="avq-o-input" type="text" autoComplete="name" maxLength={80} value={shownName}
            onInput={(e: any) => set({ name: e.currentTarget.value, nameTouched: true })} />
        </div>
        {/* El campo es compartido con reservas: `inputId` (sólo con `look="tienda"`) le pone id al número, y así «WhatsApp» es su etiqueta real. */}
        {nadie ? (<>
          <div class="avq-o-field">
            <label for={`${id}-note`}>{t('details.note')}</label>
            <textarea id={`${id}-note`} class="avq-o-input" rows={2} maxLength={300} placeholder={t('details.notePlaceholder')} value={d.note}
              onInput={(e: any) => set({ note: e.currentTarget.value })} />
          </div>
          {/* W4 (1b): sin sesión, entrar para usar sus premios en ESTE pedido (de regreso al carrito, donde se eligen). */}
          {!c.conSesion.value && (
            <div class="avq-o-why">
              <Notice tone="neutral" title={t('details.premiosTitulo', { venue })} text={t('details.premiosTexto')}
                action={{ label: t('details.premiosEntrar'), onClick: () => store.go('entrar') }} />
            </div>
          )}
        </>) : <>
        <div class="avq-o-field">
          <label for={`${id}-phone`}>{t('details.phone')}</label>
          <CountryPhoneInput look="tienda" inputId={`${id}-phone`} dialCode={d.dial} nationalNumber={d.national}
            onDialCodeChange={dial => set({ dial })} onNationalNumberChange={national => set({ national })}
            numberPlaceholder={t('details.phonePlaceholder')} searchPlaceholder={t('details.countrySearch')} noResultsText={t('details.countryNoResults')} />
          {!card && <p class="avq-o-help">{t('details.phoneHelp')}</p>}
        </div>
        <div class="avq-o-field">
          <label for={`${id}-email`}>{t('details.email')}</label>
          <input id={`${id}-email`} class="avq-o-input" type="email" autoComplete="email" maxLength={120} value={d.email}
            onInput={(e: any) => set({ email: e.currentTarget.value })} />
        </div>
        </>}
        {choose && (
          <div class="avq-o-field">
            <h3 id={`${id}-pay`} class="avq-o-group__title">{t('details.payHow')}</h3>
            <div class="avq-o-group__opts" role="radiogroup" aria-labelledby={`${id}-pay`}>
              {(['CARD_ONLINE', 'PAY_AT_PICKUP'] as const).map(m => (
                <div key={m} class="avq-o-opt">
                  <label class="avq-o-opt__main">
                    <span class="avq-o-opt__mark">
                      <input class="avq-o-opt__input" type="radio" name={`${id}-pay`} checked={payment === m} onChange={() => set({ payment: m })} />
                    </span>
                    <span class="avq-o-opt__text">{t(m === 'CARD_ONLINE' ? 'details.payCard' : 'details.payPickup')}</span>
                  </label>
                </div>
              ))}
            </div>
          </div>
        )}
        <div class="avq-o-privacy">
          <p class="avq-o-help">{t(nadie ? 'details.privacyNadie' : 'details.privacy', { venue })}</p>
          {info?.privacyNoticePath && (
            <a href={API_BASE + info.privacyNoticePath} target="_blank" rel="noopener noreferrer">{t('details.privacyLink')}</a>
          )}
          {!nadie && (
            <label class="avq-o-check">
              <input type="checkbox" checked={d.accepted} onChange={(e: any) => set({ accepted: e.currentTarget.checked })} />
              <span>{t('details.accept')}</span>
            </label>
          )}
        </div>
      </div>
      <div class="avq-o-foot">
        {info?.contact?.address && <p>{info.contact.address}</p>}
        {info?.contact?.phone && <p>{info.contact.phone}</p>}
        {!nadie && <>
          <p>{card ? t('details.payCardNote') : t('cart.payAtPickup')}</p>
          <p>{t('details.cancelPolicy')}</p>
          <p>{t('details.updates')}</p>
        </>}
      </div>
      <div class="avq-o-cartfoot avq-o-confirm">
        <p class="avq-o-confirm__sum">
          <span>{n === 1 ? t('details.summaryOne') : t('details.summary', { n })}</span>
          <span>{t('details.taxIncluded')}</span>
        </p>
        {nadie && <p class="avq-o-confirm__pay">{t('details.payAtCounter')}</p>}
        <CheckoutStatus />
        {missing && <p class="avq-o-confirm__msg">{missing}</p>}
        {/* Pulido W4 (1h·3 y 1h·4): el aviso trae sus propios botones («Confirmar» / «Pedir sin beneficios»); el del pie no compite. */}
        {!(f?.kind === 'priceChanged' && f.motivo) && (
          <button type="button" class="avq-o-btn avq-o-btn--primary" disabled={!canSend} onClick={confirm}>
            {busy ? <span>{t('details.sending')}</span>
              : q ? <><span>{t(nadie ? 'details.confirmNadie' : 'details.confirm')}</span> <span>{formatMXN(q.total, store.locale)}</span></>
              : <span>{t(nadie ? 'details.confirmNadie' : 'details.confirm')}</span>}
          </button>
        )}
      </div>
    </div>
  )
}
