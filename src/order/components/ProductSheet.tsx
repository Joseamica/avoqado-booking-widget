import { h } from 'preact'
import { useContext, useState } from 'preact/hooks'
import { OrderStoreContext } from '../store'
import { createOrderT } from '../i18n'
import { addLine } from '../cart'
import { toCents, formatMXN } from '../money'
import { ModifierPicker } from '../../components/ModifierPicker'
import { areRequiredModifiersSatisfied } from '../../state/modifierValidation'
import type { ModifierSelection } from '../../types'
import type { MenuProduct } from '../types'
import { btn, muted } from './ui'

const MAX_QTY = 20
const MAX_LINES = 50
const MAX_OPTIONS = 30

/** Ficha de un producto: opciones, cantidad, nota y «Agregar». Se monta con el producto ya elegido (key = id). */
export function ProductSheet({ product }: { product: MenuProduct }) {
  const store = useContext(OrderStoreContext)!
  const t = createOrderT(store.locale)
  const [selections, setSelections] = useState<ModifierSelection[]>([])
  const [qty, setQty] = useState(1)
  const [note, setNote] = useState('')

  const mods = product.modifierGroups.flatMap(g => g.modifiers)
  const picked = selections.map(s => ({ ...s, mod: mods.find(m => m.id === s.modifierId)! })).filter(s => s.mod)
  const options = picked.reduce((n, s) => n + s.quantity, 0)
  const unitCents = toCents(product.price) + picked.reduce((n, s) => n + toCents(s.mod.price) * s.quantity, 0)

  const cart = store.cart.value
  const open = store.info.value?.status === 'OPEN'
  const full = cart.length >= MAX_LINES
  const tooMany = options > MAX_OPTIONS
  const blocker = full ? t('sheet.maxLines') : tooMany ? t('sheet.maxOptions') : null
  const canAdd = open && !product.soldOut && !blocker && areRequiredModifiersSatisfied(product.modifierGroups, product.id, selections)

  const close = () => { store.productId.value = null }
  const add = () => {
    const before = cart.filter(l => l.productId === product.id).reduce((n, l) => n + l.quantity, 0)
    const next = addLine(cart, {
      productId: product.id, name: product.name, unitPrice: product.price, quantity: qty, note: note.trim() || null,
      modifiers: picked.map(s => ({ modifierId: s.modifierId, name: s.mod.name, price: s.mod.price, quantity: s.quantity })),
    })
    const after = next.filter(l => l.productId === product.id).reduce((n, l) => n + l.quantity, 0)
    store.cart.value = next
    if (after - before < qty) store.notice.value = t('sheet.maxQty')
    close()
  }

  return (
    <div role="dialog" aria-label={product.name} style={{ border: '1px solid var(--avq-border, #e8eaed)', borderRadius: '14px', padding: '16px', background: 'var(--avq-bg, #fff)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
        <h2 style={{ margin: 0, fontSize: '18px' }}>{product.name}</h2>
        <button type="button" style={btn()} onClick={close}>{t('common.close')}</button>
      </div>
      {product.imageUrl && <img src={product.imageUrl} alt="" style={{ width: '100%', maxHeight: '200px', objectFit: 'cover', borderRadius: '10px', margin: '10px 0' }} />}
      {product.description && <p style={muted}>{product.description}</p>}
      {product.modifierGroups.map(g => (
        <ModifierPicker key={g.id} productId={product.id} group={g} selections={selections} onChange={setSelections} t={t} maxPerOption={MAX_QTY} />
      ))}
      <label style={{ display: 'block', margin: '8px 0' }}>
        <span style={muted}>{t('sheet.note')}</span>
        <textarea aria-label={t('sheet.note')} maxLength={300} value={note} onInput={(e: any) => setNote(e.currentTarget.value)}
          style={{ display: 'block', width: '100%', font: 'inherit', boxSizing: 'border-box' }} />
      </label>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: '8px 0' }}>
        <span style={muted}>{t('sheet.qty')}</span>
        <button type="button" style={btn()} aria-label={t('sheet.less')} disabled={qty <= 1} onClick={() => setQty(q => Math.max(1, q - 1))}>−</button>
        <strong>{qty}</strong>
        <button type="button" style={btn()} aria-label={t('sheet.more')} disabled={qty >= MAX_QTY} onClick={() => setQty(q => Math.min(MAX_QTY, q + 1))}>+</button>
      </div>
      {blocker && <p role="alert" style={muted}>{blocker}</p>}
      <button type="button" style={{ ...btn(true), width: '100%', opacity: canAdd ? 1 : 0.5 }} disabled={!canAdd} onClick={add}>
        {t('sheet.add', { total: formatMXN((unitCents * qty) / 100, store.locale) })}
      </button>
    </div>
  )
}
