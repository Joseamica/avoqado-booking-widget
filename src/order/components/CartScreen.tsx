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

const MAX_QTY = 20
const issueStyle = { color: 'var(--avq-danger, #b91c1c)', fontSize: '13px', margin: '4px 0 0' }

/** Carrito: la tienda pinta SUS renglones; el total (y lo que se manda) es el de la cotización del servidor. */
export function CartScreen() {
  const store = useContext(OrderStoreContext)!
  const t = createOrderT(store.locale)
  const draft = checkoutOf(store).draft
  const cart = store.cart.value
  const q = store.quote.value
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  // Cada cambio del carrito vuelve a cotizar; una respuesta vieja no pisa a la nueva.
  // ponytail: sin debounce; si los toques rápidos topan el límite de 60/min, agregar uno de ~300 ms.
  useEffect(() => {
    store.quote.value = null
    setError(null)
    if (cart.length === 0) return
    let live = true
    fetchQuote(store.slug, toQuoteItems(cart)).then(
      r => { if (live) store.quote.value = r },
      e => { if (live) setError(errorText(t, e)) },
    )
    return () => { live = false }
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
            {lineIssues(i).map((x, j) => <p key={j} role="alert" style={issueStyle}>{x.message}</p>)}
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
      {q?.issues.filter(x => x.lineIndex === undefined).map((x, j) => <p key={j} role="alert" style={issueStyle}>{x.message}</p>)}
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
          onClick={() => store.go('details')}>{t('cart.continue')}</button>
      </div>
    </div>
  )
}
