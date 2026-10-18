import { h } from 'preact'
import { useContext } from 'preact/hooks'
import { OrderStoreContext } from '../store'
import { createOrderT } from '../i18n'
import { API_BASE } from '../api'
import { buildOrderBody, checkoutOf, send } from '../checkout'
import { formatMXN } from '../money'
import { phoneE164 } from '../phone'
import { CountryPhoneInput } from '../../components/ui/CountryPhoneInput'
import { StoreStatusBanner } from './StoreStatusBanner'
import { CheckoutStatus } from './CheckoutStatus'
import { btn, muted } from './ui'

const field = { display: 'block', width: '100%', boxSizing: 'border-box', font: 'inherit', padding: '10px', borderRadius: '10px', border: '1px solid var(--avq-border, #e8eaed)' } as const
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Nombre, teléfono (el mismo texto que se verifica por WhatsApp), correo opcional, aviso simplificado y «Confirmar pedido». */
export function DetailsScreen() {
  const store = useContext(OrderStoreContext)!
  const t = createOrderT(store.locale)
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

  const confirm = () => {
    if (!canSend) return
    void send(store, buildOrderBody(store, { customer: { name, phone, ...(email ? { email } : {}) }, note: d.note || null }))
  }
  const venue = info?.venue.name || t('details.theRestaurant')
  const label = (text: string, input: any) => (
    <label style={{ display: 'block', margin: '0 0 10px' }}><span style={muted}>{text}</span>{input}</label>
  )

  return (
    <div>
      <button type="button" style={{ ...btn(), marginBottom: '10px' }} onClick={() => store.go('cart')}>{t('details.back')}</button>
      <h2 style={{ margin: '0 0 10px', fontSize: '18px' }}>{t('details.title')}</h2>
      {label(t('details.name'), <input type="text" autoComplete="name" maxLength={80} value={d.name} style={field}
        onInput={(e: any) => set({ name: e.currentTarget.value })} />)}
      <div style={{ margin: '0 0 10px' }}>
        <span style={muted}>{t('details.phone')}</span>
        <CountryPhoneInput dialCode={d.dial} nationalNumber={d.national}
          onDialCodeChange={dial => set({ dial })} onNationalNumberChange={national => set({ national })}
          numberPlaceholder={t('details.phonePlaceholder')} searchPlaceholder={t('details.countrySearch')} noResultsText={t('details.countryNoResults')} />
      </div>
      {label(t('details.email'), <input type="email" autoComplete="email" maxLength={120} value={d.email} style={field}
        onInput={(e: any) => set({ email: e.currentTarget.value })} />)}

      <p style={{ ...muted, margin: '12px 0 4px' }}>{t('details.privacy', { venue })}</p>
      {info?.privacyNoticePath && (
        <a href={API_BASE + info.privacyNoticePath} target="_blank" rel="noopener noreferrer" style={{ fontSize: '13px' }}>{t('details.privacyLink')}</a>
      )}
      <label style={{ display: 'flex', gap: '8px', alignItems: 'center', margin: '10px 0' }}>
        <input type="checkbox" checked={d.accepted} onChange={(e: any) => set({ accepted: e.currentTarget.checked })} />
        <span>{t('details.accept')}</span>
      </label>

      <div style={{ ...muted, margin: '10px 0' }}>
        {info?.contact?.address && <p style={{ margin: '0 0 2px' }}>{info.contact.address}</p>}
        {info?.contact?.phone && <p style={{ margin: '0 0 6px' }}>{info.contact.phone}</p>}
        <p style={{ margin: '0 0 2px' }}>{t('details.cancelPolicy')}</p>
        <p style={{ margin: 0 }}>{t('details.updates')}</p>
      </div>

      {q && (
        <p style={{ display: 'flex', justifyContent: 'space-between', margin: '12px 0 4px', fontSize: '16px' }}>
          <span>{t('cart.total')}</span><strong>{formatMXN(q.total, store.locale)}</strong>
        </p>
      )}
      <p style={muted}>{t('cart.payAtPickup')}</p>
      <StoreStatusBanner />
      <CheckoutStatus />
      {missing && <p style={muted}>{missing}</p>}
      <button type="button" style={{ ...btn(true), width: '100%', opacity: canSend ? 1 : 0.5 }} disabled={!canSend} onClick={confirm}>
        {busy ? t('details.sending') : t('details.confirm')}
      </button>
    </div>
  )
}
