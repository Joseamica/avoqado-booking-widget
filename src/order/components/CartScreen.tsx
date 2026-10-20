import { h } from 'preact'
import { useContext, useEffect, useId, useState } from 'preact/hooks'
import { OrderStoreContext } from '../store'
import { createOrderT } from '../i18n'
import { ApiError, quote as fetchQuote } from '../api'
import { removeLine, setQuantity, toQuoteItems } from '../cart'
import { checkoutOf, errorText } from '../checkout'
import { formatMXN } from '../money'
import { Notice, StoreStatusBanner } from './StoreStatusBanner'
import { Stepper } from './Stepper'
import { initialsOf } from './theme'
import type { Menu, Quote, QuoteIssue } from '../types'

const MAX_QTY = 20
/** `MAX_CART_LINES` del servidor. */
const MAX_LINES = 50
const QUOTE_DEBOUNCE_MS = 300

const Back = () => (
  <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M15 18l-6-6 6-6" />
  </svg>
)
const Plus = () => (
  <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
    <path d="M12 5v14M5 12h14" />
  </svg>
)

/**
 * El motivo en el idioma de la tienda, por CÓDIGO (el `message` del servidor siempre viene en español): el monto sale de la
 * cotización y el nombre y los límites del grupo, de la carta. Un código que la tienda no conoce usa el `message` tal cual.
 */
function issueText(t: ReturnType<typeof createOrderT>, x: QuoteIssue, q: Quote, menu: Menu | null, locale: 'es' | 'en'): string {
  let key = `cart.issues.${x.code}`
  if (t(key) === key) return x.message
  let vars: Record<string, string | number> = { n: x.code === 'TOO_MANY_LINES' ? MAX_LINES : MAX_QTY, amount: formatMXN(q.minOrderAmount, locale) }
  if (x.groupId) {
    const g = menu?.categories.flatMap(c => c.products).find(p => p.id === x.productId)?.modifierGroups.find(gr => gr.id === x.groupId)
    if (!g) return t('cart.issues.checkOptions')
    // La misma cuenta que el cotizador (quote.service.ts): obligatorio = al menos 1.
    const min = g.required ? Math.max(1, g.minSelections) : g.minSelections
    vars = { group: g.name, n: x.code === 'MODIFIER_GROUP_REQUIRED' ? min : g.maxSelections ?? '' }
    if (x.code === 'MODIFIER_GROUP_REQUIRED' && min > 1) key += '_MANY'
  }
  return t(key, vars)
}

/** El logo del restaurante en la tarjeta de recolección; sin logo (o con la liga rota), sus iniciales: nunca un hueco. */
function PickupMark({ name, logo }: { name: string | null; logo: string | null }) {
  const [bad, setBad] = useState<string | null>(null)
  const showLogo = !!logo && bad !== logo
  const initials = initialsOf(name)
  if (!showLogo && !initials) return null
  return (
    <span class="avq-o-mark" aria-hidden={showLogo ? undefined : 'true'}>
      {showLogo ? <img src={logo!} alt="" onError={() => setBad(logo)} /> : initials}
    </span>
  )
}

/**
 * Tu pedido: la tienda pinta SUS renglones; el total (y lo que se manda) es el de la cotización del servidor. Con la tienda no
 * abierta el carrito se ve, se edita y se vacía igual: sólo «Continuar» queda deshabilitado. «Continuar» y el total van en un pie
 * pegajoso DENTRO de la tienda (nunca `position: fixed`: la tienda puede estar incrustada en el sitio de un restaurante).
 */
export function CartScreen() {
  const store = useContext(OrderStoreContext)!
  const t = createOrderT(store.locale)
  const noteId = useId()
  const draft = checkoutOf(store).draft
  const cart = store.cart.value
  const q = store.quote.value
  // `offline` = no hubo respuesta usable: es un estado normal, no una falla (tarjeta ámbar con la nube tachada, como en la carta).
  const [error, setError] = useState<{ text: string; offline: boolean } | null>(null)
  const [attempt, setAttempt] = useState(0)

  // Cada cambio del carrito vuelve a cotizar, ~300 ms después del último toque (el límite de /quote es 60/min por IP, y con
  // CGNAT muchos comparten IP); una respuesta vieja no pisa a la nueva.
  useEffect(() => {
    store.quote.value = null
    setError(null)
    if (cart.length === 0) return
    let live = true
    const timer = setTimeout(() => {
      fetchQuote(store.slug, toQuoteItems(cart)).then(
        r => { if (live) store.quote.value = r },
        e => { if (live) setError({ text: errorText(t, e), offline: !(e instanceof ApiError) || e.network }) },
      )
    }, QUOTE_DEBOUNCE_MS)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [cart, attempt])

  const info = store.info.value
  const open = info?.status === 'OPEN'
  const name = info?.venue.name || null
  const address = info?.contact?.address || null
  const lineIssues = (i: number) => q?.issues.filter(x => x.lineIndex === i) ?? []
  // El servidor omite de `lines` los renglones con problema y respeta el orden del carrito (quote.service.ts:131-224).
  let k = 0
  const lineTotals = cart.map((_, i) => (q && lineIssues(i).length === 0 ? q.lines[k++]?.lineTotal : undefined))

  if (cart.length === 0)
    return (
      <div class="avq-o-empty">
        <p role="status">{t('cart.empty')}</p>
        <button type="button" class="avq-o-btn avq-o-btn--primary" onClick={() => store.go('menu')}>{t('cart.goToMenu')}</button>
      </div>
    )

  return (
    <div class="avq-o-cart">
      <StoreStatusBanner />
      <button type="button" class="avq-o-back" aria-label={t('cart.goToMenu')} onClick={() => store.go('menu')}><Back /></button>
      <div class="avq-o-cart__intro">
        <h2 class="avq-o-title">{t('cart.title')}</h2>
        {(name || address) && (
          <div class="avq-o-pickup">
            <PickupMark name={name} logo={info?.brand.logo || info?.brand.logoFull || null} />
            <div class="avq-o-pickup__text">
              {name && <span class="avq-o-pickup__name">{t('cart.pickupAt', { venue: name })}</span>}
              {address && <span class="avq-o-pickup__addr">{address}</span>}
            </div>
          </div>
        )}
      </div>
      <ul class="avq-o-lines" role="list">
        {cart.map((l, i) => {
          const last = l.quantity <= 1
          const options = l.modifiers.map(m => (m.quantity > 1 ? `${m.name} ×${m.quantity}` : m.name)).join(', ')
          return (
            <li key={l.lineId} aria-label={l.name} class="avq-o-line">
              <div class="avq-o-line__info">
                <span class="avq-o-line__name">{l.name}</span>
                {options && <span class="avq-o-line__sub">{options}</span>}
                {l.note && <span class="avq-o-line__sub">{l.note}</span>}
                {/* Sólo el importe de la cotización, cuando llega: nunca se calcula con los precios de la carta ni del carrito. */}
                {lineTotals[i] !== undefined && <span class="avq-o-line__price">{formatMXN(lineTotals[i]!, store.locale)}</span>}
              </div>
              {/* Con cantidad 1 el «−» es un bote de basura que quita el renglón; en 20 el «+» queda aria-disabled. */}
              <Stepper line trash={last} value={l.quantity} label={t('sheet.qty')}
                lessLabel={last ? t('cart.removeAria', { name: l.name }) : t('sheet.less')} moreLabel={t('sheet.more')}
                onLess={() => { store.cart.value = last ? removeLine(cart, l.lineId) : setQuantity(cart, l.lineId, l.quantity - 1) }}
                onMore={l.quantity < MAX_QTY ? () => { store.cart.value = setQuantity(cart, l.lineId, l.quantity + 1) } : undefined} />
              {lineIssues(i).map((x, j) => <p key={j} role="alert" class="avq-o-issue">{issueText(t, x, q!, store.menu.value, store.locale)}</p>)}
            </li>
          )
        })}
      </ul>
      <button type="button" class="avq-o-btn avq-o-btn--quiet avq-o-more" onClick={() => store.go('menu')}><Plus />{t('cart.addMore')}</button>
      <div class="avq-o-cart__note">
        <label for={noteId}>{t('cart.note')}</label>
        <textarea id={noteId} class="avq-o-input" rows={2} maxLength={300} value={draft.value.note}
          onInput={(e: any) => { draft.value = { ...draft.value, note: e.currentTarget.value } }} />
      </div>
      {q?.issues.filter(x => x.lineIndex === undefined).map((x, j) => <p key={j} role="alert" class="avq-o-issue">{issueText(t, x, q, store.menu.value, store.locale)}</p>)}
      {error && (
        <Notice tone={error.offline ? 'warn' : 'error'} icon={error.offline ? 'cloudOff' : 'alert'} text={error.text}
          action={{ label: t('common.retry'), onClick: () => setAttempt(a => a + 1) }} />
      )}
      <div class="avq-o-total">
        <p class="avq-o-total__row">
          <span>{t('cart.totalShort')}</span>
          {q ? <span>{formatMXN(q.total, store.locale)}</span> : !error && <span class="avq-o-total__wait">{t('cart.quoting')}</span>}
        </p>
        <p class="avq-o-total__tax">{t('cart.taxPickup')}</p>
      </div>
      <div class="avq-o-cartfoot">
        <button type="button" class="avq-o-btn avq-o-btn--primary" disabled={!q?.ok || !open}
          onClick={() => {
            // El aviso del envío anterior (p. ej. «El precio cambió; revisa tu pedido.») ya se atendió aquí, con la cotización
            // nueva: no lo arrastra a «Tus datos». Un intento pendiente se sigue viendo allá por `pending`.
            checkoutOf(store).feedback.value = null
            store.go('details')
          }}>
          {q ? <><span>{t('cart.continue')}</span> <span>{formatMXN(q.total, store.locale)}</span></> : <span>{t('cart.continue')}</span>}
        </button>
      </div>
    </div>
  )
}
