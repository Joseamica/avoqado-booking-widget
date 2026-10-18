import { h } from 'preact'
import { useContext, useEffect, useState } from 'preact/hooks'
import { OrderStoreContext } from '../store'
import { createOrderT } from '../i18n'
import { formatMXN } from '../money'
import { StoreStatusBanner } from './StoreStatusBanner'
import { ProductSheet } from './ProductSheet'
import { CartBar } from './CartBar'
import { banner, btn, muted } from './ui'

/** Sin acentos ni mayúsculas, para buscar «flauta» y encontrar «FLÁUTA». */
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export function MenuScreen() {
  const store = useContext(OrderStoreContext)!
  const t = createOrderT(store.locale)
  const [query, setQuery] = useState('')
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const info = store.info.value
  const err = store.infoError.value
  const menu = store.menu.value

  const pid = store.productId.value
  const stale = !!pid && !!menu && !menu.categories.some(c => c.products.some(p => p.id === pid))
  // La carta se recargó y el producto de la ficha ya no está: de vuelta a la carta.
  useEffect(() => { if (stale) store.productId.value = null }, [stale])

  const retry = () => (
    <button type="button" style={btn()} onClick={() => void store.load()}>{t('common.retry')}</button>
  )
  const text = (s: string) => <p role="status" style={{ margin: '16px 0' }}>{s}</p>

  if (err?.status === 403 && err.code === 'PLAN_REQUIRED') return text(t('store.disabled'))
  if (err?.status === 404 && err.code === 'VENUE_NOT_FOUND') return text(t('store.notFound'))
  // Con la carta ya cargada, un refresco fallido no la reemplaza: sólo un aviso chico.
  if (err && !menu) return <div>{text(err.network ? t('common.offline') : err.message || t('store.loadFailed'))}{retry()}</div>
  if (info?.status === 'DISABLED') return text(t('store.disabled'))
  if (!info || !menu) return null

  const open = info.status === 'OPEN'
  const q = fold(query.trim())
  const cats = menu.categories
    .filter(c => !categoryId || c.id === categoryId)
    .map(c => ({ ...c, products: c.products.filter(p => !q || fold(p.name).includes(q)) }))
    .filter(c => c.products.length > 0)
  const product = store.productId.value ? menu.categories.flatMap(c => c.products).find(p => p.id === store.productId.value) : undefined

  return (
    <div>
      {err && <p role="status" style={{ ...muted, margin: '0 0 8px' }}>{err.network ? t('store.reconnecting') : err.message || t('store.reconnecting')}</p>}
      <StoreStatusBanner />
      {menu.truncated && <p style={banner}>{t('menu.truncated')}</p>}
      {menu.categories.length === 0 ? text(t('menu.empty')) : product ? (
        <ProductSheet key={product.id} product={product} />
      ) : (
        <div>
          <input type="search" role="searchbox" aria-label={t('menu.search')} placeholder={t('menu.search')} value={query}
            onInput={(e: any) => setQuery(e.currentTarget.value)}
            style={{ width: '100%', boxSizing: 'border-box', font: 'inherit', padding: '10px', borderRadius: '10px', border: '1px solid var(--avq-border, #e8eaed)' }} />
          <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', margin: '10px 0' }}>
            <button type="button" aria-pressed={!categoryId} style={{ ...btn(!categoryId), borderRadius: '999px' }} onClick={() => setCategoryId(null)}>{t('menu.all')}</button>
            {menu.categories.map(c => (
              <button key={c.id} type="button" aria-pressed={categoryId === c.id} style={{ ...btn(categoryId === c.id), borderRadius: '999px', whiteSpace: 'nowrap' }}
                onClick={() => setCategoryId(c.id)}>{c.name}</button>
            ))}
          </div>
          {cats.length === 0 && text(t('menu.noResults'))}
          {cats.map(c => (
            <section key={c.id}>
              <h3 style={{ margin: '14px 0 6px' }}>{c.name}</h3>
              {c.products.map(p => (
                <button key={p.id} type="button" disabled={!open} onClick={() => { if (open) store.productId.value = p.id }}
                  style={{ ...btn(), display: 'flex', width: '100%', textAlign: 'left', gap: '10px', marginBottom: '8px', alignItems: 'center', opacity: open ? 1 : 0.6 }}>
                  <span style={{ flex: 1 }}>
                    <strong style={{ display: 'block' }}>{p.name}</strong>
                    {p.description && <span style={muted}>{p.description}</span>}
                    {p.soldOut && <span style={{ ...muted, display: 'block' }}>{t('menu.soldOut')}</span>}
                  </span>
                  <span>{formatMXN(p.price, store.locale)}</span>
                  {p.imageUrl && <img src={p.imageUrl} alt="" style={{ width: '56px', height: '56px', objectFit: 'cover', borderRadius: '8px' }} />}
                </button>
              ))}
            </section>
          ))}
        </div>
      )}
      <CartBar />
    </div>
  )
}
