import { h } from 'preact'
import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { OrderStoreContext } from '../store'
import { createOrderT } from '../i18n'
import { formatMXN } from '../money'
import type { Menu } from '../types'
import { Notice, StoreStatusBanner } from './StoreStatusBanner'
import { ProductSheet } from './ProductSheet'
import { CartBar } from './CartBar'
import { TABS_H } from './theme'

/** Sin acentos ni mayúsculas, para buscar «flauta» y encontrar «FLÁUTA». */
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Un prefijo por carta montada: los ids de sus secciones no se repiten aunque haya dos tiendas en la misma página. */
let lists = 0

/** Quien pidió «reducir movimiento» no recibe un desplazamiento suave. */
const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

const Plus = () => (
  <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
    <path d="M12 5v14M5 12h14" />
  </svg>
)
const Magnifier = () => (
  <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </svg>
)

/**
 * Buscador, pestañas de categorías (pegajosas; llevan a su sección en lugar de filtrar), secciones con sus filas y la nota del final.
 * Vive aparte de `MenuScreen` para que sus ganchos se monten y se apaguen justo cuando la lista se pinta; la búsqueda se queda en
 * `MenuScreen` y así sobrevive a abrir y cerrar la ficha de un producto.
 */
function MenuList({ menu, open, query, onQuery }: { menu: Menu; open: boolean; query: string; onQuery: (q: string) => void }) {
  const store = useContext(OrderStoreContext)!
  const t = createOrderT(store.locale)
  const [uid] = useState(() => `avq-o-m${++lists}`)
  const [activeId, setActiveId] = useState<string | null>(null)
  // Ligas de fotos que no cargaron: la fila se pinta como si no tuviera foto (sin hueco gris). Por LIGA, así una nueva se intenta.
  const [broken, setBroken] = useState<Record<string, boolean>>({})
  const root = useRef<HTMLDivElement>(null)
  const strip = useRef<HTMLElement>(null)
  const lockedUntil = useRef(0)

  const q = fold(query.trim())
  const cats = menu.categories
    .map(c => ({ ...c, products: c.products.filter(p => !q || fold(p.name).includes(q)) }))
    .filter(c => c.products.length > 0)
  const ids = cats.map((_, i) => `${uid}-${i}`)
  const active = activeId && ids.includes(activeId) ? activeId : ids[0]

  // La sección activa es la última que toca la franja de lectura (de debajo de las pestañas al 40 % de la ventana): se vuelve la
  // siguiente cuando su título sube a esa franja. Sin IntersectionObserver (jsdom, navegadores muy viejos) se queda la primera.
  useEffect(() => {
    const el = root.current
    if (!el || q || typeof IntersectionObserver === 'undefined') return
    const sections = Array.from(el.querySelectorAll<HTMLElement>('.avq-o-section'))
    const inBand = new Set<Element>()
    const io = new IntersectionObserver(
      entries => {
        for (const e of entries) {
          if (e.isIntersecting) inBand.add(e.target)
          else inBand.delete(e.target)
        }
        const current = sections.filter(s => inBand.has(s)).pop()
        // Mientras dura el desplazamiento de una pestaña tocada, el observador no la desactiva a medio camino.
        if (current && Date.now() >= lockedUntil.current) setActiveId(current.id)
      },
      { rootMargin: `-${TABS_H}px 0px -60% 0px` },
    )
    sections.forEach(s => io.observe(s))
    return () => io.disconnect()
  }, [menu, !!q])

  // Si la pestaña activa queda fuera de la tira, se desplaza SÓLO la tira (nunca la página) para mostrarla.
  useEffect(() => {
    const bar = strip.current
    const tab = bar?.querySelector<HTMLElement>('[aria-current]')
    if (bar && tab && (tab.offsetLeft < bar.scrollLeft || tab.offsetLeft + tab.offsetWidth > bar.scrollLeft + bar.clientWidth)) bar.scrollLeft = tab.offsetLeft - 16
  }, [active])

  // La pestaña es un enlace `#id`, pero dentro de una sombra el navegador no navega a un id: se desplaza a mano, sin tocar la dirección.
  const go = (e: Event, id: string) => {
    e.preventDefault()
    lockedUntil.current = Date.now() + 1000
    setActiveId(id)
    root.current?.querySelector<HTMLElement>(`#${id}`)?.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' })
  }

  return (
    <div ref={root}>
      <label class="avq-o-search">
        <Magnifier />
        <input type="search" role="searchbox" aria-label={t('menu.search')} placeholder={t('menu.search')} value={query}
          onInput={(e: any) => onQuery(e.currentTarget.value)} />
      </label>
      {/* Con una búsqueda las pestañas sobran: sólo quedan las coincidencias. */}
      {!q && (
        <nav ref={strip} class="avq-o-tabs" aria-label={t('menu.categories')}>
          {cats.map((c, i) => (
            <a key={c.id} class="avq-o-tab" href={`#${ids[i]}`} aria-current={ids[i] === active ? 'true' : undefined} onClick={e => go(e, ids[i])}>{c.name}</a>
          ))}
        </nav>
      )}
      {cats.length === 0 && <p role="status" class="avq-o-empty">{t('menu.noResults')}</p>}
      {cats.map((c, i) => (
        <section key={c.id} id={ids[i]} class="avq-o-section">
          <h2 class="avq-o-section-title">{c.name}</h2>
          {c.products.map((p, j) => {
            const infoId = `${ids[i]}-${j}`
            const photo = p.imageUrl && !broken[p.imageUrl] ? p.imageUrl : null
            // El «+» invita a agregar: con la tienda no abierta o el producto agotado no hay nada que agregar.
            const plus = open && !p.soldOut
            return (
              // Toda la fila es el botón que abre la ficha (también un agotado); el «+» es un adorno, no un segundo botón. Su precio,
              // descripción y «Agotado» se leen como descripción. Sólo la fila que invita a agregar (la del «+») se llama «Agregar»:
              // una agotada o con la tienda no abierta se llama como el producto.
              <button key={p.id} type="button" class={photo ? 'avq-o-row' : 'avq-o-row avq-o-row--bare'} disabled={!open} data-product-id={p.id}
                aria-label={plus ? t('menu.addAria', { name: p.name }) : p.name} aria-describedby={infoId}
                onClick={() => { if (open) store.productId.value = p.id }}>
                <span class="avq-o-row__text">
                  <span class="avq-o-row__name">{p.name}</span>
                  <span class="avq-o-row__info" id={infoId}>
                    <span class="avq-o-row__price">{formatMXN(p.price, store.locale)}</span>
                    {p.description && <span class="avq-o-row__desc">{p.description}</span>}
                    {p.soldOut && <span class="avq-o-row__tag">{t('menu.soldOut')}</span>}
                  </span>
                </span>
                {photo ? (
                  <span class="avq-o-row__media">
                    <img class="avq-o-row__img" src={photo} alt="" width={112} height={112} loading="lazy"
                      onError={() => setBroken(b => ({ ...b, [photo]: true }))} />
                    {plus && <span class="avq-o-row__add" aria-hidden="true"><Plus /></span>}
                  </span>
                ) : (
                  plus && <span class="avq-o-row__add" aria-hidden="true"><Plus /></span>
                )}
              </button>
            )
          })}
        </section>
      ))}
      {cats.length > 0 && (
        <div class="avq-o-foot">
          <p>{t('menu.pricesNote')}</p>
          <p>{t('menu.poweredBy')}</p>
        </div>
      )}
    </div>
  )
}

export function MenuScreen() {
  const store = useContext(OrderStoreContext)!
  const t = createOrderT(store.locale)
  const [query, setQuery] = useState('')
  const info = store.info.value
  const err = store.infoError.value
  const menu = store.menu.value

  const pid = store.productId.value
  const stale = !!pid && !!menu && !menu.categories.some(c => c.products.some(p => p.id === pid))
  // La carta se recargó y el producto de la ficha ya no está: de vuelta a la carta.
  useEffect(() => { if (stale) store.productId.value = null }, [stale])

  // Al cerrar la ficha (X, Escape, «Agregar» o porque el producto ya no está), el foco vuelve a la fila de ESE producto (si ya no
  // existe, al buscador) sin mover la página; sólo si no está a la vista se centra (spec §12.2). Antes de pintar: sin salto.
  const menuEl = useRef<HTMLDivElement>(null)
  const shown = useRef<string | null>(null)
  useLayoutEffect(() => {
    const closed = shown.current
    shown.current = pid
    if (pid || !closed) return
    const rows = Array.from(menuEl.current?.querySelectorAll<HTMLButtonElement>('[data-product-id]') ?? [])
    const target = rows.find(b => b.dataset.productId === closed && !b.disabled) ?? menuEl.current?.querySelector<HTMLElement>('.avq-o-search > input')
    if (!target) return
    target.focus({ preventScroll: true })
    const r = target.getBoundingClientRect()
    if (r.top < 0 || r.bottom > innerHeight) target.scrollIntoView({ block: 'center' })
  }, [pid])

  const retry = () => (
    <button type="button" class="avq-o-btn avq-o-btn--neutral" style={{ margin: '0 16px' }} onClick={() => void store.load()}>{t('common.retry')}</button>
  )
  // Sin red es un estado normal («Sin conexión»), no una falla: tarjeta ámbar con la nube tachada; cualquier otro fallo, roja.
  const problem = (text: string) => <Notice tone={err?.network ? 'warn' : 'error'} icon={err?.network ? 'cloudOff' : 'alert'} text={text} />

  if (err?.status === 403 && err.code === 'PLAN_REQUIRED') return <Notice tone="neutral" icon="lock" text={t('store.disabled')} />
  if (err?.status === 404 && err.code === 'VENUE_NOT_FOUND') return <Notice tone="error" icon="alert" text={t('store.notFound')} />
  // Con la carta ya cargada, un refresco fallido no la reemplaza: sólo un aviso chico.
  if (err && (!menu || !info)) return <div>{problem(err.network ? t('common.offline') : err.message || t('store.loadFailed'))}{retry()}</div>
  if (info?.status === 'DISABLED') return <Notice tone="neutral" icon="lock" text={t('store.disabled')} />
  if (!info || !menu) return null

  const product = pid ? menu.categories.flatMap(c => c.products).find(p => p.id === pid) : undefined

  return (
    // Con la ficha abierta la carta no deja el relleno de la barra: el pie pegajoso de la ficha descansa en el borde real de la tienda.
    <div ref={menuEl} class={product ? 'avq-o-menu avq-o-menu--sheet' : 'avq-o-menu'}>
      {err && problem(err.network ? t('store.reconnecting') : err.message || t('store.reconnecting'))}
      <StoreStatusBanner />
      {menu.truncated && <Notice tone="neutral" text={t('menu.truncated')} />}
      {menu.categories.length === 0 ? <p role="status" class="avq-o-empty">{t('menu.empty')}</p> : product ? (
        <ProductSheet key={product.id} product={product} />
      ) : (
        <MenuList menu={menu} open={info.status === 'OPEN'} query={query} onQuery={setQuery} />
      )}
      <CartBar />
    </div>
  )
}
