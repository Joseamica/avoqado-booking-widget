import { h } from 'preact'
import { useContext, useId, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { OrderStoreContext } from '../store'
import { createOrderT } from '../i18n'
import { addLine } from '../cart'
import { toCents, formatMXN } from '../money'
import { areRequiredModifiersSatisfied } from '../../state/modifierValidation'
import type { ModifierSelection } from '../../types'
import type { MenuProduct } from '../types'
import { OptionGroup } from './OptionGroup'
import { Stepper } from './Stepper'

const MAX_QTY = 20
const MAX_LINES = 50
const MAX_OPTIONS = 30

const Close = () => (
  <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
)

/**
 * Ficha de un producto: una VISTA dentro de la tienda que ocupa el lugar de la carta (spec §11.1), no una capa sobre la página.
 * Foto con la X, nombre, precio y descripción; los grupos de opciones; las indicaciones; y el pie pegado abajo (`sticky`, dentro
 * del componente) con la cantidad y «Agregar» + el total. Sin `position: fixed`, portal, `inert`, `aria-modal` ni bloqueo del
 * scroll: no toca nada fuera de la tienda. Se monta con el producto ya elegido (key = id). Al desmontarse avisa a `onLeave` si el
 * foco estaba dentro (para devolverlo a la fila sólo en ese caso).
 */
export function ProductSheet({ product, onLeave }: { product: MenuProduct; onLeave?: (hadFocus: boolean) => void }) {
  const store = useContext(OrderStoreContext)!
  const t = createOrderT(store.locale)
  const [selections, setSelections] = useState<ModifierSelection[]>([])
  const [qty, setQty] = useState(1)
  const [note, setNote] = useState('')
  const [badImg, setBadImg] = useState<string | null>(null)
  const sheet = useRef<HTMLElement>(null)
  const title = useRef<HTMLHeadingElement>(null)
  const added = useRef(false)
  const titleId = useId()
  const noteId = useId()

  // Al abrir, el foco va al título sin mover la página. Si la ficha empieza arriba de la ventana (la X y la foto quedarían fuera;
  // pasa tras un scroll corto, porque la portada se oculta) o el título queda abajo, la ficha (ella, nunca el host) sube a su
  // inicio, como un enlace dentro de la página (spec §12.2 y §12.3). Antes de pintar, para que no se vea el salto.
  // Al desmontarse (la DOM sigue puesta), dice si el foco estaba dentro: se lee en la raíz de la ficha (la sombra de la tienda),
  // porque `document.activeElement` sólo ve el host.
  useLayoutEffect(() => {
    const el = sheet.current!
    title.current!.focus({ preventScroll: true })
    if (el.getBoundingClientRect().top < 0 || title.current!.getBoundingClientRect().top > innerHeight) el.scrollIntoView({ block: 'start' })
    return () => onLeave?.(el.contains((el.getRootNode() as Document | ShadowRoot).activeElement))
  }, [])

  const mods = product.modifierGroups.flatMap(g => g.modifiers)
  const picked = selections.map(s => ({ ...s, mod: mods.find(m => m.id === s.modifierId)! })).filter(s => s.mod)
  const options = picked.reduce((n, s) => n + s.quantity, 0)
  const unitCents = toCents(product.price) + picked.reduce((n, s) => n + toCents(s.mod.price) * s.quantity, 0)

  const cart = store.cart.value
  const open = store.info.value?.status === 'OPEN'
  const full = cart.length >= MAX_LINES
  const tooMany = options > MAX_OPTIONS
  const blocker = full ? t('sheet.maxLines') : tooMany ? t('sheet.maxOptions') : null
  // El primer grupo que falta, con la regla de reservas grupo por grupo: si no falta ninguno, la ficha está completa.
  const missing = product.modifierGroups.find(g => !areRequiredModifiersSatisfied([g], product.id, selections))
  const canAdd = open && !product.soldOut && !blocker && !missing
  const photo = product.imageUrl && product.imageUrl !== badImg ? product.imageUrl : null

  const close = () => { store.productId.value = null }
  const add = () => {
    // Doble toque: el segundo llega cuando ya se agregó (y la ficha quizá ya se fue). Se agrega una sola vez.
    if (added.current) return
    added.current = true
    const current = store.cart.value
    const before = current.filter(l => l.productId === product.id).reduce((n, l) => n + l.quantity, 0)
    const next = addLine(current, {
      productId: product.id, name: product.name, unitPrice: product.price, quantity: qty, note: note.trim() || null,
      modifiers: picked.map(s => ({ modifierId: s.modifierId, name: s.mod.name, price: s.mod.price, quantity: s.quantity })),
    })
    const after = next.filter(l => l.productId === product.id).reduce((n, l) => n + l.quantity, 0)
    store.cart.value = next
    if (after - before < qty) store.notice.value = t('sheet.maxQty')
    close()
  }

  return (
    // `tabIndex=-1`: tocar texto que no recibe foco (la descripción, la foto) deja el foco en la ficha, y Escape la sigue cerrando.
    <section ref={sheet} class={photo ? 'avq-o-sheet avq-o-sheet--media' : 'avq-o-sheet'} aria-labelledby={titleId} tabIndex={-1}
      onKeyDown={e => {
        // Con un teclado de composición (IME), Escape sólo cancela lo que se está escribiendo: no cierra ni pierde la nota. Algunos
        // navegadores no ponen `isComposing` en ese keydown, pero sí `keyCode` 229.
        if (e.key !== 'Escape' || e.isComposing || e.keyCode === 229) return
        // Escape cierra ESTA vista y se queda aquí: no cierra también, por ejemplo, un <dialog> del sitio que contenga la tienda.
        e.preventDefault()
        e.stopPropagation()
        close()
      }}>
      {photo && <img class="avq-o-sheet__img" src={photo} alt="" onError={() => setBadImg(photo)} />}
      <button type="button" class="avq-o-sheet__close" aria-label={t('sheet.closeAria')} onClick={close}><Close /></button>
      <div class="avq-o-sheet__head">
        <h2 ref={title} id={titleId} class="avq-o-sheet__title" tabIndex={-1}>{product.name}</h2>
        <span class="avq-o-sheet__price">{formatMXN(product.price, store.locale)}</span>
        {product.description && <p class="avq-o-sheet__desc">{product.description}</p>}
      </div>
      <div class="avq-o-sheet__gap" />
      {product.modifierGroups.map(g => (
        <OptionGroup key={g.id} productId={product.id} group={g} selections={selections} onChange={setSelections} t={t} maxPerOption={MAX_QTY} />
      ))}
      <div class="avq-o-sheet__note">
        <label for={noteId}>{t('sheet.note')}</label>
        <textarea id={noteId} class="avq-o-input" rows={3} maxLength={300} placeholder={t('sheet.notePlaceholder')} value={note}
          onInput={(e: any) => setNote(e.currentTarget.value)} />
      </div>
      <div class="avq-o-sheet__foot">
        {/* Arriba del botón, lo que impide agregar: un tope (alerta) o el primer grupo que falta («Elige Tamaño»). */}
        {blocker ? <p key="b" role="alert" class="avq-o-sheet__msg avq-o-sheet__msg--error">{blocker}</p>
          : missing && open && !product.soldOut && <p key="m" role="status" class="avq-o-sheet__msg">{t('sheet.missing', { group: missing.name })}</p>}
        <div class="avq-o-sheet__actions">
          <Stepper value={qty} label={t('sheet.qty')} lessLabel={t('sheet.less')} moreLabel={t('sheet.more')}
            onLess={qty > 1 ? () => setQty(q => Math.max(1, q - 1)) : undefined}
            onMore={qty < MAX_QTY ? () => setQty(q => Math.min(MAX_QTY, q + 1)) : undefined} />
          <button type="button" class="avq-o-btn avq-o-btn--primary avq-o-sheet__add" disabled={!canAdd} onClick={add}>
            {product.soldOut ? <span>{t('menu.soldOut')}</span> : (
              <>
                <span>{t('sheet.addLabel')}</span> <span>{formatMXN((unitCents * qty) / 100, store.locale)}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </section>
  )
}
