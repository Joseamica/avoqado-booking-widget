import { h } from 'preact'
import { useContext, useId, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { OrderStoreContext } from '../store'
import { createOrderT } from '../i18n'
import { ApiError } from '../api'
import { removeLine, setQuantity, toQuoteItems } from '../cart'
import { checkoutOf, cotizar, errorText } from '../checkout'
import { formatMXN } from '../money'
import { Notice, StoreStatusBanner } from './StoreStatusBanner'
import { Stepper } from './Stepper'
import { VenueMark } from './VenueMark'
import { Back, Plus } from './icons'
import { optionsText } from './lineOptions'
import type { EleccionDeBeneficios, Menu, Quote, QuoteIssue } from '../types'

const MAX_QTY = 20
/** `MAX_CART_LINES` del servidor. */
const MAX_LINES = 50
const QUOTE_DEBOUNCE_MS = 300

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

/**
 * Tu pedido: la tienda pinta SUS renglones; el total (y lo que se manda) es el de la cotización del servidor. Con la tienda no
 * abierta el carrito se ve, se edita y se vacía igual: sólo «Continuar» queda deshabilitado. «Continuar» y el total van en un pie
 * pegajoso DENTRO de la tienda (nunca `position: fixed`: la tienda puede estar incrustada en el sitio de un restaurante).
 */
/** «Café gratis» ⇒ «café gratis» dentro de una frase («¡Tienes café gratis!»). */
const enFrase = (s: string) => s.charAt(0).toLocaleLowerCase('es') + s.slice(1)

/**
 * W3 (mockups 1h y 1h·2): sólo con sesión y sólo lo que el negocio tiene prendido (`oferta`). El premio con la pregunta del founder y
 * «Sí»/«Quitar»; «Más beneficios» junta puntos (si alcanza el mínimo) y cupón. Cambiar la elección vuelve a cotizar. Lo descartado se
 * dice junto a su control. «Va en tu <producto>» no: el SERVIDOR no dice en qué producto cae el premio (hallazgo aparte).
 */
function Beneficios({ q }: { q: Quote }) {
  const store = useContext(OrderStoreContext)!
  const t = createOrderT(store.locale)
  const c = checkoutOf(store)
  const e = c.eleccion.value
  const set = (patch: EleccionDeBeneficios) => {
    const next: EleccionDeBeneficios = { ...e, ...patch }
    for (const k of Object.keys(next) as (keyof EleccionDeBeneficios)[]) if (next[k] === undefined) delete next[k]
    c.eleccion.value = next
  }
  const couponId = useId()
  const [abierto, setAbierto] = useState(false)
  const [cupon, setCupon] = useState(e.cupon ?? '')
  const o = q.oferta
  if (!o) return null
  const fuera = q.descartados ?? []
  const premio = o.premio
  const usaPremio = !!premio && e.premioId === premio.id && !fuera.includes('PREMIO')
  const puntos = o.puntos
  const conCupon = !!e.cupon && !fuera.includes('CUPON')
  return (
    <div class="avq-o-ben">
      {premio && (usaPremio
        ? <Notice tone="ok" title={t('cart.benefits.premioOn', { premio: premio.etiqueta })} text={t('cart.benefits.premioOnText')}
            action={{ label: t('cart.benefits.remove'), onClick: () => set({ premioId: undefined }) }} />
        : <Notice tone="neutral" text={t('cart.benefits.premioAsk', { premio: enFrase(premio.etiqueta) })}
            action={{ label: t('cart.benefits.premioYes'), onClick: () => set({ premioId: premio.id }) }} />)}
      {e.premioId && fuera.includes('PREMIO') && <p class="avq-o-ben__msg">{t('cart.benefits.premioBad')}</p>}
      {(puntos || o.cupon) && <p class="avq-o-ben__title">{t('cart.benefits.more')}</p>}
      {puntos && (
        <label class="avq-o-ben__opt">
          <input type="checkbox" class="avq-o-opt__input" checked={!!e.puntos && !fuera.includes('PUNTOS')}
            onChange={(ev: any) => set({ puntos: ev.currentTarget.checked ? puntos.maxPuntos : undefined })} />
          <span>{t('cart.benefits.points', { n: puntos.maxPuntos, amount: formatMXN(Math.round(puntos.maxPuntos * puntos.valorPorPunto * 100) / 100, store.locale) })}</span>
        </label>
      )}
      {e.puntos && fuera.includes('PUNTOS') && <p class="avq-o-ben__msg">{t('cart.benefits.pointsBad')}</p>}
      {o.cupon && (conCupon
        ? <div class="avq-o-ben__opt"><span class="avq-o-ben__grow">{t('cart.benefits.couponApplied', { code: e.cupon! })}</span>
            <button type="button" class="avq-o-btn avq-o-btn--quiet" onClick={() => { setCupon(''); set({ cupon: undefined }) }}>{t('cart.benefits.remove')}</button></div>
        : abierto || e.cupon
          ? <form class="avq-o-ben__coupon" onSubmit={(ev: Event) => { ev.preventDefault(); const v = cupon.trim(); if (v) set({ cupon: v }) }}>
              <label for={couponId} class="avq-o-ben__label">{t('cart.benefits.couponLabel')}</label>
              <div class="avq-o-ben__row">
                <input id={couponId} class="avq-o-input" maxLength={50} autoComplete="off" value={cupon} onInput={(ev: any) => setCupon(ev.currentTarget.value)} />
                <button type="submit" class="avq-o-btn avq-o-btn--quiet" disabled={!cupon.trim()}>{t('cart.benefits.couponApply')}</button>
              </div>
            </form>
          : <button type="button" class="avq-o-ben__opt avq-o-ben__link" onClick={() => setAbierto(true)}>
              <span class="avq-o-ben__grow">{t('cart.benefits.coupon')}</span><span aria-hidden="true">›</span>
            </button>)}
      {e.cupon && fuera.includes('CUPON') && <p class="avq-o-ben__msg">{t('cart.benefits.couponBad')}</p>}
    </div>
  )
}

export function CartScreen() {
  const store = useContext(OrderStoreContext)!
  const t = createOrderT(store.locale)
  const noteId = useId()
  const draft = checkoutOf(store).draft
  const cart = store.cart.value
  const q = store.quote.value
  // W3: lo elegido también vuelve a cotizar (con la sesión de la página).
  const eleccion = checkoutOf(store).eleccion.value
  const sesionCerrada = checkoutOf(store).sesionCerrada.value
  // `offline` = no hubo respuesta usable: es un estado normal, no una falla (tarjeta ámbar con la nube tachada, como en la carta).
  const [error, setError] = useState<{ text: string; offline: boolean } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const addMore = useRef<HTMLButtonElement>(null)
  const goMenu = useRef<HTMLButtonElement>(null)
  // Índice del renglón que acaba de quitar el bote: pasado el repintado, el foco debe ir a otro lado (el botón que lo tenía ya no existe).
  const removedAt = useRef<number | null>(null)

  // Cada cambio del carrito reinicia la cotización y vuelve a cotizar, ~300 ms después del último toque (el límite de /quote es
  // 60/min por IP, y con CGNAT muchos comparten IP); una respuesta vieja no pisa a la nueva. Es un efecto de layout: el reinicio
  // ocurre ANTES de pintar. (Al CAMBIAR el carrito, checkout.ts ya anula la cotización en el mismo lote, antes de repintar. Lo que el
  // efecto evita de verdad es volver a entrar al carrito con la cotización de la visita anterior —`store.quote` sobrevive a salir de
  // la pantalla—: un «Continuar $viejo» que enseguida desaparece. El aviso de error, en cambio, nace vacío en cada visita: aquí sólo
  // se limpia al cambiar el carrito.)
  useLayoutEffect(() => {
    store.quote.value = null
    setError(null)
    if (cart.length === 0) return
    let live = true
    const timer = setTimeout(() => {
      cotizar(store, toQuoteItems(cart)).then(
        r => { if (live) store.quote.value = r },
        e => { if (live) setError({ text: errorText(t, e), offline: !(e instanceof ApiError) || e.network }) },
      )
    }, QUOTE_DEBOUNCE_MS)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [cart, attempt, eleccion, sesionCerrada])

  // Quitar un renglón con el bote destruye el botón que tenía el foco. El foco pasa al RENGLÓN que sube a ese lugar (el siguiente; si
  // era el último, el anterior), nunca a un botón suyo: un Enter mantenido repite clics sobre lo que tiene el foco, y en el bote del
  // siguiente vaciaría el carrito renglón por renglón. El <li> es neutro (tabindex -1, sin contorno) y un Tab desde ahí entra a su
  // stepper. Si no queda ningún renglón, a «Ver la carta» del carrito vacío («Agregar algo más» si por algo no hubiera renglón): esos
  // dos sólo navegan. Sin mover la página: sólo si queda arriba de la ventana, o bajo el pie pegajoso, se centra.
  useLayoutEffect(() => {
    const i = removedAt.current
    if (i === null) return
    removedAt.current = null
    const rows = Array.from(root.current?.querySelectorAll<HTMLElement>('.avq-o-line') ?? [])
    const target = rows[Math.min(i, rows.length - 1)] ?? addMore.current ?? goMenu.current
    if (!target) return
    target.focus({ preventScroll: true })
    const r = target.getBoundingClientRect()
    const foot = root.current?.querySelector('.avq-o-cartfoot')
    if (r.top < 0 || r.bottom > Math.min(innerHeight, foot?.getBoundingClientRect().top ?? innerHeight)) target.scrollIntoView({ block: 'center' })
  }, [cart])

  const info = store.info.value
  const open = info?.status === 'OPEN'
  const name = info?.venue.name || null
  const address = info?.contact?.address || null
  const lineIssues = (i: number) => q?.issues.filter(x => x.lineIndex === i) ?? []
  // El servidor omite de `lines` los renglones con problema y respeta el orden del carrito (quote.service.ts:131-224).
  let k = 0
  const lineTotals = cart.map((_, i) => (q && lineIssues(i).length === 0 ? q.lines[k++]?.lineTotal : undefined))

  // Vacío: la misma flecha y el mismo título que con renglones (sin la tarjeta de recolección: no hay nada que recoger), el mensaje
  // centrado con aire y «Ver la carta», que es el que hereda el foco al quitar el último renglón (arriba).
  if (cart.length === 0)
    return (
      <div ref={root} class="avq-o-cart">
        <button type="button" class="avq-o-back" aria-label={t('cart.backAria')} onClick={() => store.go('menu')}><Back /></button>
        <div class="avq-o-cart__intro">
          <h2 class="avq-o-title" tabIndex={-1}>{t('cart.title')}</h2>
        </div>
        <div class="avq-o-cart__empty">
          <p role="status">{t('cart.empty')}</p>
          <button ref={goMenu} type="button" class="avq-o-btn avq-o-btn--primary" onClick={() => store.go('menu')}>{t('cart.goToMenu')}</button>
        </div>
      </div>
    )

  return (
    <div ref={root} class="avq-o-cart">
      <StoreStatusBanner />
      <button type="button" class="avq-o-back" aria-label={t('cart.backAria')} onClick={() => store.go('menu')}><Back /></button>
      <div class="avq-o-cart__intro">
        <h2 class="avq-o-title" tabIndex={-1}>{t('cart.title')}</h2>
        {(name || address) && (
          <div class="avq-o-pickup">
            <VenueMark />
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
          const options = optionsText(l.modifiers)
          return (
            <li key={l.lineId} aria-label={l.name} class="avq-o-line" tabIndex={-1}>
              <div class="avq-o-line__info">
                <span class="avq-o-line__name">{l.name}</span>
                {options && <span class="avq-o-line__sub">{options}</span>}
                {l.note && <span class="avq-o-line__sub">{l.note}</span>}
                {/* Sólo el importe de la cotización, cuando llega: nunca se calcula con los precios de la carta ni del carrito. */}
                {lineTotals[i] !== undefined && <span class="avq-o-line__price">{formatMXN(lineTotals[i]!, store.locale)}</span>}
              </div>
              {/* Con cantidad 1 el «−» es un bote de basura que quita el renglón; en 20 el «+» queda aria-disabled. Los tres botones
                  llevan el nombre del producto (el stepper es de ESE renglón). */}
              <Stepper line trash={last} value={l.quantity} label={t('sheet.qty')}
                lessLabel={last ? t('cart.removeAria', { name: l.name }) : t('modifiers.less', { name: l.name })}
                moreLabel={t('modifiers.more', { name: l.name })}
                onLess={() => {
                  if (last) removedAt.current = i
                  store.cart.value = last ? removeLine(cart, l.lineId) : setQuantity(cart, l.lineId, l.quantity - 1)
                }}
                onMore={l.quantity < MAX_QTY ? () => { store.cart.value = setQuantity(cart, l.lineId, l.quantity + 1) } : undefined} />
              {lineIssues(i).map((x, j) => <p key={j} role="alert" class="avq-o-issue">{issueText(t, x, q!, store.menu.value, store.locale)}</p>)}
            </li>
          )
        })}
      </ul>
      <button ref={addMore} type="button" class="avq-o-btn avq-o-btn--quiet avq-o-more" onClick={() => store.go('menu')}><Plus />{t('cart.addMore')}</button>
      {/* En «Nadie» la nota se escribe en «Tus datos» (una sola vez). */}
      {store.info.value?.requiresAcceptance !== false && (
        <div class="avq-o-cart__note">
          <label for={noteId}>{t('cart.note')}</label>
          <textarea id={noteId} class="avq-o-input" rows={2} maxLength={300} value={draft.value.note}
            onInput={(e: any) => { draft.value = { ...draft.value, note: e.currentTarget.value } }} />
        </div>
      )}
      {q && <Beneficios q={q} />}
      {sesionCerrada && (
        <Notice role="alert" tone="warn" title={t('cart.benefits.sessionTitle')} text={t('cart.benefits.sessionText')}
          action={{ label: t('cart.benefits.signInAgain'), onClick: () => store.go('entrar') }} />
      )}
      {q?.issues.filter(x => x.lineIndex === undefined).map((x, j) => <p key={j} role="alert" class="avq-o-issue">{issueText(t, x, q, store.menu.value, store.locale)}</p>)}
      {error && (
        <Notice tone={error.offline ? 'warn' : 'error'} icon={error.offline ? 'cloudOff' : 'alert'} text={error.text}
          action={{ label: t('common.retry'), onClick: () => setAttempt(a => a + 1) }} />
      )}
      <div class="avq-o-total">
        {/* W3 (1h·2): con beneficios aplicados, el desglose: subtotal, cada uno con su monto y el total. */}
        {q?.aplicados?.length ? <>
          <p class="avq-o-total__row avq-o-total__row--sub"><span>{t('cart.benefits.subtotal')}</span><span>{formatMXN(q.subtotal, store.locale)}</span></p>
          {q.aplicados.map((a, i) => (
            <p key={i} class="avq-o-total__row avq-o-total__row--ben">
              <span>{a.tipo === 'PREMIO' ? t('cart.benefits.premioRow', { premio: a.nombre }) : a.nombre}</span>
              <span>−{formatMXN(a.monto, store.locale)}</span>
            </p>
          ))}
        </> : null}
        <p class="avq-o-total__row">
          <span>{t('cart.totalShort')}</span>
          {q ? <span>{formatMXN(q.total, store.locale)}</span> : !error && <span class="avq-o-total__wait">{t('cart.quoting')}</span>}
        </p>
        {/* Con tarjeta en línea (fase 2) se elige cómo pagar en «Tus datos»: aquí sólo el IVA. */}
        {q?.beneficios?.calculados === false && <p class="avq-o-total__tax">{t('cart.benefits.later')}</p>}
        <p class="avq-o-total__tax">{info?.paymentModes.cardOnline ? t('details.taxIncluded') : t('cart.taxPickup')}</p>
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
