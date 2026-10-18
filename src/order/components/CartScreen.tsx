import { h } from 'preact'
import { useContext, useEffect, useState } from 'preact/hooks'
import { OrderStoreContext } from '../store'
import { createOrderT } from '../i18n'
import { quote as fetchQuote } from '../api'
import { removeLine, setQuantity, toQuoteItems } from '../cart'
import { checkoutOf, errorText } from '../checkout'
import { formatMXN } from '../money'
import { StoreStatusBanner } from './StoreStatusBanner'
import { banner, btn, muted } from './ui'
import type { Menu, Quote, QuoteIssue } from '../types'

const MAX_QTY = 20
/** `MAX_CART_LINES` del servidor. */
const MAX_LINES = 50
const QUOTE_DEBOUNCE_MS = 300
const issueStyle = { color: 'var(--avq-danger, #b91c1c)', fontSize: '13px', margin: '4px 0 0' }

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

/** Carrito: la tienda pinta SUS renglones; el total (y lo que se manda) es el de la cotización del servidor. */
export function CartScreen() {
  const store = useContext(OrderStoreContext)!
  const t = createOrderT(store.locale)
  const draft = checkoutOf(store).draft
  const cart = store.cart.value
  const q = store.quote.value
  const [error, setError] = useState<string | null>(null)
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
        e => { if (live) setError(errorText(t, e)) },
      )
    }, QUOTE_DEBOUNCE_MS)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [cart, attempt])

  const open = store.info.value?.status === 'OPEN'
  const lineIssues = (i: number) => q?.issues.filter(x => x.lineIndex === i) ?? []
  // El servidor omite de `lines` los renglones con problema y respeta el orden del carrito (quote.service.ts:131-224).
  let k = 0
  const lineTotals = cart.map((_, i) => (q && lineIssues(i).length === 0 ? q.lines[k++]?.lineTotal : undefined))

  if (cart.length === 0)
    return (
      <div>
        <p role="status">{t('cart.empty')}</p>
        <button type="button" style={btn()} onClick={() => store.go('menu')}>{t('cart.keepOrdering')}</button>
      </div>
    )

  return (
    <div>
      <StoreStatusBanner />
      <h2 style={{ margin: '0 0 10px', fontSize: '18px' }}>{t('cart.title')}</h2>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {cart.map((l, i) => (
          <li key={l.lineId} aria-label={l.name} style={{ borderBottom: '1px solid var(--avq-border, #e8eaed)', padding: '10px 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
              <strong>{l.name}</strong>
              {lineTotals[i] !== undefined && <span>{formatMXN(lineTotals[i]!, store.locale)}</span>}
            </div>
            {l.modifiers.length > 0 && <div style={muted}>{l.modifiers.map(m => (m.quantity > 1 ? `${m.name} ×${m.quantity}` : m.name)).join(', ')}</div>}
            {l.note && <div style={muted}>{l.note}</div>}
            {lineIssues(i).map((x, j) => <p key={j} role="alert" style={issueStyle}>{issueText(t, x, q!, store.menu.value, store.locale)}</p>)}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '6px' }}>
              <button type="button" style={btn()} aria-label={t('sheet.less')} disabled={l.quantity <= 1}
                onClick={() => { store.cart.value = setQuantity(cart, l.lineId, l.quantity - 1) }}>−</button>
              <span>{l.quantity}</span>
              <button type="button" style={btn()} aria-label={t('sheet.more')} disabled={l.quantity >= MAX_QTY}
                onClick={() => { store.cart.value = setQuantity(cart, l.lineId, l.quantity + 1) }}>+</button>
              <button type="button" style={{ ...btn(), marginLeft: 'auto' }}
                onClick={() => { store.cart.value = removeLine(cart, l.lineId) }}>{t('cart.remove')}</button>
            </div>
          </li>
        ))}
      </ul>
      {q?.issues.filter(x => x.lineIndex === undefined).map((x, j) => <p key={j} role="alert" style={issueStyle}>{issueText(t, x, q, store.menu.value, store.locale)}</p>)}
      <p style={{ display: 'flex', justifyContent: 'space-between', margin: '12px 0 4px', fontSize: '16px' }}>
        <span>{t('cart.total')}</span>
        <strong>{q ? formatMXN(q.total, store.locale) : error ? '' : t('cart.quoting')}</strong>
      </p>
      {error && (
        <div role="alert" style={banner}>
          <p style={{ margin: '0 0 6px' }}>{error}</p>
          <button type="button" style={btn()} onClick={() => setAttempt(a => a + 1)}>{t('common.retry')}</button>
        </div>
      )}
      <p style={muted}>{t('cart.payAtPickup')}</p>
      <label style={{ display: 'block', margin: '8px 0' }}>
        <span style={muted}>{t('cart.note')}</span>
        <textarea aria-label={t('cart.note')} maxLength={300} value={draft.value.note}
          onInput={(e: any) => { draft.value = { ...draft.value, note: e.currentTarget.value } }}
          style={{ display: 'block', width: '100%', font: 'inherit', boxSizing: 'border-box' }} />
      </label>
      <div style={{ display: 'flex', gap: '8px' }}>
        <button type="button" style={btn()} onClick={() => store.go('menu')}>{t('cart.keepOrdering')}</button>
        <button type="button" style={{ ...btn(true), flex: 1, opacity: q?.ok && open ? 1 : 0.5 }} disabled={!q?.ok || !open}
          onClick={() => {
            // El aviso del envío anterior (p. ej. «El precio cambió; revisa tu pedido.») ya se atendió aquí, con la cotización
            // nueva: no lo arrastra a «Tus datos». Un intento pendiente se sigue viendo allá por `pending`.
            checkoutOf(store).feedback.value = null
            store.go('details')
          }}>{t('cart.continue')}</button>
      </div>
    </div>
  )
}
