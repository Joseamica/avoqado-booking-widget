// Sistema visual de la tienda de pedidos en línea (<avoqado-order>): tokens, hoja de estilos con clases `avq-o-*`, color de
// acento legible, iniciales y tipografías. Los valores salen del spec (§4, §9, §10.3) y de la maqueta aprobada
// (docs/audit/2026-10-19-tienda-pedidos-rediseno/maqueta/*.dc.html).

/** Colores del spec §4. Cada texto sobre el fondo en que se usa da 4.5:1 o más (lo vigila theme.test.ts). */
export const T = {
  ink: '#000000', // títulos, nombres, botón principal por omisión
  text2: '#4A4A4A', // direcciones (la de la portada y la de «Recoges en»: el spec §4 manda sobre el #5E5E5E de la maqueta) y subtítulos
  muted: '#5E5E5E', // descripciones y ayudas
  divider: '#EEEEEE', // líneas entre productos y renglones
  fieldBorder: '#DADADA', // inputs y stepper del carrito
  surface: '#F3F3F3', // buscador, chips, stepper y botones secundarios
  card: '#F4F4F4', // ticket del folio y tarjeta de «Recoges en»
  okBg: '#EAF6EE', okFg: '#0B6B36', okDot: '#12A150', // abierto
  warnBg: '#FFF4DE', warnFg: '#6B4300', // pausa o cerrado
  errBg: '#FDECEA', errFg: '#B3261E', // problemas de un renglón y fallos
  control: '#8A8A8A', // contorno de radios y casillas sin marcar (3:1 sobre blanco, WCAG 1.4.11) y botones deshabilitados
} as const

/** Alto (px) de las pestañas de categorías de la carta: el de la barra pegajosa, el `scroll-margin-top` de las secciones y el inicio de la franja del observador. */
export const TABS_H = 48

const FONTS_URL =
  'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600..800&family=Figtree:wght@400;500;600;700&display=swap'
const DISPLAY = "'Bricolage Grotesque',system-ui,sans-serif" // títulos: 700–800
const BODY = "'Figtree',system-ui,sans-serif" // todo lo demás: 400–700

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

/** Luminancia relativa WCAG de un `#rgb` o `#rrggbb` ya validado. */
function luminance(hex: string): number {
  let h = hex.slice(1)
  if (h.length === 3) h = h.replace(/./g, '$&$&')
  const [r, g, b] = [0, 2, 4].map(i => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/**
 * Color del botón principal y de los acentos. Es el color de la marca (o del atributo `accent-color`) sólo si es `#rgb` o
 * `#rrggbb` y da 4.5:1 o más contra el texto blanco que lleva encima; si no, negro. Un amarillo de marca nunca deja ilegible
 * el botón.
 */
export function accentFor(color: string | null | undefined): string {
  return color && HEX.test(color) && 1.05 / (luminance(color) + 0.05) >= 4.5 ? color : T.ink
}

// Palabras = tramos de letras o números de cualquier idioma, así «Tacos & Más» da «TM» y no «T&». `\p{L}` es ES2018 y el bundle
// apunta a ES2017: se arma con `new RegExp` para que un navegador viejo caiga a «tramos sin espacios» y no rompa todo el archivo.
const WORD = (() => {
  try { return new RegExp('[\\p{L}\\p{N}]+', 'gu') } catch (_e) { return /\S+/g }
})()

/** Hasta 2 letras mayúsculas de las primeras palabras del nombre («Avoqado Full» ⇒ «AF»). Para el logo que falta. */
export function initialsOf(name: string | null | undefined): string {
  const words = (name ?? '').normalize('NFC').match(WORD) ?? []
  return words.slice(0, 2).map(w => Array.from(w)[0].toUpperCase()).join('')
}

/**
 * Pide Bricolage Grotesque y Figtree a Google Fonts con UN solo `<link data-avq-store-fonts>` en `document.head` (el
 * `@font-face` de una sombra no se registra: tiene que vivir en el documento). Idempotente; sin red, queda `system-ui`.
 */
export function loadStoreFonts(): void {
  if (document.head.querySelector('link[data-avq-store-fonts]')) return
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = FONTS_URL
  link.dataset.avqStoreFonts = ''
  document.head.appendChild(link)
}

/**
 * Hoja de estilos de la tienda. `OrderApp` la pinta como primer hijo de su raíz y todo vive debajo, también la ficha de producto
 * (una vista en el flujo, no una capa): por eso todo cuelga de `.avq-o-root` o de una clase `avq-o-*` y no depende de nada de afuera.
 * - `.avq-o-root` fija las variables `--avq-*` a sus valores claros: la tienda es clara aunque el contenedor diga
 *   `data-avq-theme="dark"` (spec §10.3). `--avq-o-display` es la tipografía de los títulos.
 * - El acento llega en `--avq-accent` (lo pone `accentFor` en la raíz).
 * - Modificadores de uso: `.avq-o-btn` + `--primary|--neutral|--quiet`, `.avq-o-notice` + `--neutral|--warn|--error`,
 *   `.avq-o-chip` (+ `--ok`), `.avq-o-stepper` (+ `--line`, el del carrito; `--sm`, el de una opción) y `.avq-o-bar` (+ `--neutral`).
 * - Portada y encabezado (tarea 4): `.avq-o-hero` (+ `--cover`, con foto) con `__img`, `__id`, `__names`, `__name` y `__addr`;
 *   `.avq-o-chips` y `.avq-o-dot`; `.avq-o-mark` (+ `--sm`) es el círculo del logo o de las iniciales; `.avq-o-head` es la
 *   cabecera compacta de datos y código (el carrito no la lleva: su tarjeta «Recoges en» ya dice quién es). Los avisos llevan `.avq-o-notice__body|__title|__action`.
 * - Carta (tarea 5): `.avq-o-menu` es la raíz de la carta (deja el relleno de abajo de la barra); `.avq-o-search` el buscador;
 *   `.avq-o-tabs` y `.avq-o-tab` las pestañas pegajosas; `.avq-o-section` cada categoría; la fila (`.avq-o-row`) lleva
 *   `__text`, `__info`, `__name`, `__price`, `__desc`, `__tag` (Agotado), `__media`, `__img` y `__add` (el «+»), y `--bare` si no
 *   hay foto; `.avq-o-foot` la nota del final y `.avq-o-empty` los mensajes sueltos. La barra lleva `__count`, `__label`, `__note`
 *   y `__total`.
 * - Ficha de producto (tarea 6): `.avq-o-sheet` es la vista que reemplaza a la carta (+ `--media` si hay foto), con `__img`,
 *   `__close` (la X), `__head`, `__title`, `__price`, `__desc`, `__gap` (la franja gris), `__note`, `__foot` (el pie pegajoso),
 *   `__msg` (+ `--error`), `__actions` y `__add`. Cada grupo es `.avq-o-group` (`__head`, `__names`, `__title`, `__hint`, `__opts`)
 *   con su `.avq-o-pill` (+ `--required|--done`); cada opción, `.avq-o-opt` (`__main`, `__mark`, `__input`, `__check`, `__text`,
 *   `__sub`, `__extra`). `.avq-o-menu--sheet` quita el relleno de abajo de la carta mientras la ficha está abierta.
 * - Tu pedido (tarea 7): `.avq-o-cart` es la pantalla y `.avq-o-cartfoot` su pie de «Continuar» (pegajoso abajo DENTRO de la tienda,
 *   como el de la ficha); `.avq-o-back` la flecha de volver; `.avq-o-cart__intro` el título con la tarjeta `.avq-o-pickup` («Recoges
 *   en…»: `__text`, `__name`, `__addr`); `.avq-o-lines` > `.avq-o-line` los renglones (`__info`, `__name`, `__sub`, `__price`; tabindex -1 y sin contorno al enfocarlo: el foco llega ahí al quitar otro renglón), con su
 *   `.avq-o-stepper--line`; `.avq-o-issue` un problema (el de un renglón, radio 12; el del pedido, hijo directo de la pantalla, radio 16 como un aviso); `.avq-o-more` «Agregar algo más»;
 *   `.avq-o-cart__note` la nota; `.avq-o-total` el total (`__row`, `__wait`, `__tax`).
 * - Tus datos y código (tarea 8): `.avq-o-details` es la pantalla de datos (sin estilo propio); `.avq-o-form` sus campos (`__intro` el
 *   título con su ayuda), cada `.avq-o-field` (`__label` cuando no es un `<label>`), `.avq-o-help` la ayuda en gris, `.avq-o-privacy` el
 *   aviso con su enlace y `.avq-o-check` la casilla; la letra chica (contacto, pago, cancelación) reusa `.avq-o-foot`. Su pie es el
 *   `.avq-o-cartfoot` del carrito + `.avq-o-confirm` (`__sum` el resumen, `__msg` lo que falta; el aviso del envío va dentro, sin margen).
 *   El código: `.avq-o-otp` con `__back` («‹ Cambiar número»), `__intro`, `__code` (las cajas, «Verificando…» y el error) y `__more`
 *   (el reenvío y la ayuda).
 * Cada tarea puede AGREGAR clases; las que ya están no se cambian ni se quitan.
 */
export const STORE_CSS = `
.avq-o-root{--avq-bg:#FFFFFF;--avq-fg:${T.ink};--avq-muted:${T.surface};--avq-muted-fg:${T.muted};--avq-border:${T.fieldBorder};--avq-o-display:${DISPLAY};box-sizing:border-box;background:#FFFFFF;color:${T.ink};font-family:${BODY};font-size:15px;font-variant-numeric:tabular-nums;color-scheme:light;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}
.avq-o-root *,.avq-o-root *::before,.avq-o-root *::after{box-sizing:border-box}
.avq-o-root :focus-visible{outline:2px solid var(--avq-accent,${T.ink});outline-offset:2px}
@media (prefers-reduced-motion:reduce){.avq-o-root *,.avq-o-root *::before,.avq-o-root *::after{animation:none!important;transition:none!important}}
.avq-o-title{margin:0;font-family:var(--avq-o-display);font-weight:800;font-size:30px;line-height:1.1}
.avq-o-section-title{margin:0 0 2px;font-family:var(--avq-o-display);font-weight:700;font-size:22px;overflow-wrap:anywhere}
.avq-o-row{display:flex;gap:16px;width:100%;min-width:0;margin:0;padding:16px 0;border:0;border-bottom:1px solid ${T.divider};background:transparent;color:inherit;font:inherit;text-align:left;text-decoration:none;word-break:break-word;overflow-wrap:anywhere;cursor:pointer}
.avq-o-chip{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border-radius:999px;background:${T.surface};color:#333333;font-size:14px;font-weight:500;white-space:nowrap}
.avq-o-chip--ok{background:${T.okBg};color:${T.okFg};font-weight:600}
.avq-o-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:52px;padding:0 20px;border:0;border-radius:14px;font:inherit;font-size:16px;font-weight:700;text-decoration:none;cursor:pointer}
.avq-o-btn--primary{background:var(--avq-accent,${T.ink});color:#FFFFFF}
.avq-o-btn--neutral{background:${T.surface};color:${T.ink}}
.avq-o-btn--quiet{min-height:44px;padding:0 8px;background:transparent;color:${T.ink};font-weight:600}
.avq-o-btn:disabled{color:${T.control};cursor:not-allowed}
.avq-o-btn--primary:disabled{background:#EDEDED}
.avq-o-input{width:100%;min-height:52px;padding:0 14px;border:1px solid ${T.fieldBorder};border-radius:12px;background:#FFFFFF;color:${T.ink};font:inherit;font-size:16px}
textarea.avq-o-input{min-height:0;padding:12px 14px;resize:none}
.avq-o-input::placeholder{color:${T.muted};opacity:1}
.avq-o-stepper{display:inline-flex;align-items:center;height:52px;border-radius:999px;background:${T.surface}}
.avq-o-stepper button{display:flex;align-items:center;justify-content:center;width:48px;height:52px;padding:0;border:0;background:transparent;color:${T.ink};font:inherit;cursor:pointer}
.avq-o-stepper button:disabled,.avq-o-stepper button[aria-disabled=true]{color:${T.control};cursor:not-allowed}
.avq-o-stepper>span{min-width:20px;text-align:center;font-size:16px;font-weight:700}
.avq-o-stepper--line{height:40px;background:transparent;border:1px solid ${T.fieldBorder}}
.avq-o-stepper--line button{width:44px;height:44px}
.avq-o-stepper--line>span{min-width:16px;font-size:15px}
.avq-o-notice{display:flex;align-items:flex-start;gap:12px;margin:4px 16px 12px;padding:14px 16px;border-radius:16px;line-height:1.4}
.avq-o-notice--neutral{background:${T.surface};color:${T.ink}}
.avq-o-notice--warn{background:${T.warnBg};color:${T.warnFg}}
.avq-o-notice--error{background:${T.errBg};color:${T.errFg}}
.avq-o-notice>svg{flex:none;margin-top:1px}
.avq-o-notice__body{display:flex;flex-direction:column;gap:2px;flex:1;min-width:0;overflow-wrap:anywhere}
.avq-o-notice__title{font-weight:700}
.avq-o-notice__action{flex:none;align-self:center;min-height:44px;margin:-8px 0;padding:0 16px;border:0;border-radius:999px;background:#FFFFFF;color:${T.ink};font:inherit;font-weight:600;cursor:pointer}
.avq-o-hero{position:relative;padding-bottom:12px}
.avq-o-hero__img{display:block;width:100%;height:196px;object-fit:cover;background:#E2E2E2}
.avq-o-hero__id{display:flex;align-items:center;gap:14px;padding:16px 16px 0}
.avq-o-hero--cover .avq-o-hero__id{display:block;padding-top:48px}
.avq-o-hero__names{display:flex;flex-direction:column;gap:6px;min-width:0}
.avq-o-hero__name{margin:0;font-family:var(--avq-o-display);font-weight:800;font-size:32px;line-height:1.05;letter-spacing:-.01em;overflow-wrap:anywhere}
.avq-o-hero__addr{margin:0;color:${T.text2};line-height:1.4;overflow-wrap:anywhere}
.avq-o-chips{display:flex;flex-wrap:wrap;gap:8px;margin:14px 16px 4px}
.avq-o-dot{flex:none;width:8px;height:8px;border-radius:50%;background:${T.okDot}}
.avq-o-mark{flex:none;display:flex;align-items:center;justify-content:center;width:64px;height:64px;overflow:hidden;border-radius:50%;background:${T.ink};color:#FFFFFF;font-family:var(--avq-o-display);font-weight:800;font-size:22px;line-height:1}
.avq-o-mark img{display:block;width:100%;height:100%;object-fit:contain;background:#FFFFFF}
.avq-o-hero--cover .avq-o-mark{position:absolute;left:16px;top:152px;width:80px;height:80px;border:4px solid #FFFFFF;font-size:26px}
.avq-o-mark--sm{width:32px;height:32px;font-size:13px}
.avq-o-head{display:flex;align-items:center;gap:10px;padding:16px 16px 12px;font-weight:600}
.avq-o-head__name{min-width:0;overflow-wrap:anywhere}
@media (min-width:768px){.avq-o-hero__img{border-radius:0 0 16px 16px}}
.avq-o-bar{position:sticky;bottom:calc(24px + env(safe-area-inset-bottom,0px));z-index:2;display:flex;align-items:center;gap:12px;width:calc(100% - 32px);min-height:58px;margin:0 16px;padding:0 18px 0 12px;border:0;border-radius:16px;background:var(--avq-accent,${T.ink});color:#FFFFFF;font:inherit;font-size:16px;font-weight:700;text-align:left;text-decoration:none;box-shadow:0 8px 24px rgba(0,0,0,.22);cursor:pointer}
.avq-o-bar--neutral{min-height:64px;padding-top:10px;padding-bottom:10px;background:#EDEDED;color:${T.text2};box-shadow:none}
.avq-o-menu{padding-bottom:calc(24px + env(safe-area-inset-bottom,0px))}
.avq-o-search{display:flex;align-items:center;gap:10px;height:48px;margin:4px 16px 8px;padding:0 16px;border-radius:999px;background:${T.surface};color:${T.muted}}
.avq-o-search:focus-within{outline:2px solid var(--avq-accent,${T.ink});outline-offset:2px}
.avq-o-search>svg{flex:none}
.avq-o-search>input{flex:1;align-self:stretch;min-width:0;padding:0;border:0;background:transparent;color:${T.ink};font:inherit;font-size:16px;-webkit-appearance:none;appearance:none}
.avq-o-root .avq-o-search>input:focus-visible{outline:none}
.avq-o-search>input::placeholder{color:${T.muted};opacity:1}
.avq-o-tabs{position:sticky;top:0;z-index:3;display:flex;gap:24px;height:${TABS_H}px;padding:0 16px;overflow-x:auto;scrollbar-width:none;background:#FFFFFF;border-bottom:1px solid #E7E7E7}
.avq-o-tabs::-webkit-scrollbar{display:none}
.avq-o-tab{flex:none;display:flex;align-items:center;justify-content:center;min-width:44px;padding-top:3px;border-bottom:3px solid transparent;color:${T.muted};font-weight:600;text-decoration:none;white-space:nowrap}
.avq-o-tab[aria-current]{border-bottom-color:var(--avq-accent,${T.ink});color:${T.ink};font-weight:700}
.avq-o-root .avq-o-tab:focus-visible{outline-offset:-4px;border-radius:8px}
.avq-o-section{padding:22px 16px 0;scroll-margin-top:${TABS_H}px}
.avq-o-section+.avq-o-section{padding-top:26px}
.avq-o-section:last-of-type .avq-o-row:last-of-type{border-bottom:0}
.avq-o-row,.avq-o-search>input{scroll-margin-top:${TABS_H + 8}px}
.avq-o-row{scroll-margin-bottom:calc(96px + env(safe-area-inset-bottom,0px))}
.avq-o-row:disabled{cursor:default}
.avq-o-row--bare{align-items:center}
.avq-o-row__text{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}
.avq-o-row__info{display:flex;flex-direction:column;gap:4px;min-width:0}
.avq-o-row__name{font-size:16px;font-weight:600}
.avq-o-row__price{font-weight:500}
.avq-o-row__desc{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-clamp:2;overflow:hidden;color:${T.muted};font-size:14px;line-height:1.4}
.avq-o-row__tag{align-self:flex-start;padding:2px 10px;border-radius:999px;background:${T.surface};color:${T.text2};font-size:13px;font-weight:600}
.avq-o-row__media{position:relative;flex:none;width:112px;height:112px}
.avq-o-row__img{display:block;width:112px;height:112px;border-radius:12px;object-fit:cover;background:#EDEDED}
.avq-o-row__add{flex:none;display:flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:50%;background:${T.surface}}
.avq-o-row__media .avq-o-row__add{position:absolute;right:8px;bottom:8px;background:#FFFFFF;box-shadow:0 2px 8px rgba(0,0,0,.18)}
.avq-o-foot{margin:28px 16px 0;padding-bottom:16px;color:${T.muted};font-size:13px;line-height:1.4}
.avq-o-foot p{margin:0}
.avq-o-empty{margin:32px 16px;text-align:center;color:${T.muted}}
.avq-o-bar__count{flex:none;display:flex;align-items:center;justify-content:center;min-width:32px;height:32px;padding:0 8px;border-radius:999px;background:#FFFFFF;color:var(--avq-accent,${T.ink})}
.avq-o-bar--neutral .avq-o-bar__count{color:${T.text2}}
.avq-o-bar__label{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;overflow-wrap:anywhere}
.avq-o-bar__note{font-size:13px;font-weight:400}
.avq-o-bar__total{flex:none}
.avq-o-menu--sheet{padding-bottom:0}
.avq-o-sheet{position:relative;animation:avq-o-up .28s cubic-bezier(.2,.8,.2,1)}
.avq-o-root .avq-o-sheet:focus{outline:none}
@keyframes avq-o-up{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:none}}
.avq-o-sheet__img{display:block;width:100%;height:244px;object-fit:cover;background:#EDEDED}
.avq-o-sheet__close{display:flex;align-items:center;justify-content:center;width:44px;height:44px;margin:16px 16px 0;padding:0;border:0;border-radius:50%;background:${T.surface};color:${T.ink};cursor:pointer}
.avq-o-sheet--media .avq-o-sheet__close{position:absolute;top:16px;left:16px;margin:0;background:#FFFFFF;box-shadow:0 2px 10px rgba(0,0,0,.16)}
.avq-o-sheet__head{display:flex;flex-direction:column;gap:6px;padding:20px 16px 8px}
.avq-o-sheet__title{margin:0;font-family:var(--avq-o-display);font-weight:800;font-size:28px;line-height:1.1;overflow-wrap:anywhere}
.avq-o-sheet__price{font-size:17px;font-weight:600}
.avq-o-sheet__desc{margin:2px 0 0;color:${T.muted};line-height:1.45;overflow-wrap:anywhere}
.avq-o-sheet__gap{height:8px;margin-top:12px;background:${T.surface}}
.avq-o-group{padding:18px 16px 4px}
.avq-o-group__head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.avq-o-group__names{display:flex;flex-direction:column;gap:2px;min-width:0}
.avq-o-group__title{margin:0;font-size:17px;font-weight:700;overflow-wrap:anywhere}
.avq-o-group__hint{color:${T.muted};font-size:14px;overflow-wrap:anywhere}
.avq-o-group__opts{display:flex;flex-direction:column;margin-top:6px}
.avq-o-pill{flex:none;display:inline-flex;align-items:center;height:26px;padding:0 10px;border-radius:999px;background:${T.surface};color:${T.text2};font-size:13px;font-weight:600;white-space:nowrap}
.avq-o-pill--required{background:${T.ink};color:#FFFFFF}
.avq-o-pill--done{background:${T.okBg};color:${T.okFg}}
.avq-o-opt{display:flex;align-items:center;gap:12px;min-height:56px;border-bottom:1px solid ${T.divider}}
.avq-o-opt__main{flex:1;min-width:0;display:flex;align-items:center;gap:14px;min-height:56px;cursor:pointer}
.avq-o-opt__mark{position:relative;flex:none;display:flex}
.avq-o-opt__input{width:22px;height:22px;margin:0;border:2px solid ${T.control};background:#FFFFFF;-webkit-appearance:none;appearance:none;cursor:pointer}
.avq-o-opt__input[type=radio]{border-radius:50%}
.avq-o-opt__input[type=checkbox]{border-radius:6px}
.avq-o-opt__input[type=radio]:checked{border:7px solid var(--avq-accent,${T.ink})}
.avq-o-opt__input[type=checkbox]:checked{border:0;background:var(--avq-accent,${T.ink})}
.avq-o-opt__check{position:absolute;top:4px;left:4px;pointer-events:none}
.avq-o-opt__text{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;font-size:16px;overflow-wrap:anywhere}
.avq-o-opt__sub,.avq-o-opt__extra{color:${T.muted};font-size:15px}
.avq-o-opt__extra{flex:none}
.avq-o-stepper--sm{flex:none;height:36px}
.avq-o-stepper--sm button{position:relative;width:36px;height:36px}
.avq-o-stepper--sm button::after{content:'';position:absolute;top:-4px;right:-4px;bottom:-4px;left:-4px}
.avq-o-stepper--sm>span{min-width:16px;font-size:15px}
.avq-o-sheet__note{display:flex;flex-direction:column;gap:8px;padding:20px 16px 24px}
.avq-o-sheet__note>label{font-size:17px;font-weight:700}
.avq-o-opt__input,.avq-o-stepper--sm button,.avq-o-sheet__note>textarea{scroll-margin-bottom:calc(140px + env(safe-area-inset-bottom,0px))}
.avq-o-sheet__foot{position:sticky;bottom:0;z-index:2;padding:12px 16px calc(24px + env(safe-area-inset-bottom,0px));background:#FFFFFF;border-top:1px solid ${T.divider}}
.avq-o-sheet__msg{margin:0 0 10px;color:${T.text2};font-size:14px;font-weight:600;overflow-wrap:anywhere}
.avq-o-sheet__msg--error{color:${T.errFg}}
.avq-o-sheet__actions{display:flex;align-items:center;gap:12px}
.avq-o-sheet__add{flex:1;min-width:0;justify-content:space-between;padding:0 18px}
.avq-o-sheet__add>span:only-child{margin:0 auto}
.avq-o-cart button,.avq-o-cart textarea{scroll-margin-bottom:calc(108px + env(safe-area-inset-bottom,0px))}
.avq-o-back{display:flex;align-items:center;justify-content:center;width:44px;height:44px;margin:12px 8px 0;padding:0;border:0;border-radius:50%;background:transparent;color:${T.ink};cursor:pointer}
.avq-o-cart__intro{display:flex;flex-direction:column;gap:16px;padding:4px 16px 0}
.avq-o-pickup{display:flex;align-items:center;gap:12px;padding:14px;border-radius:16px;background:${T.card}}
.avq-o-pickup .avq-o-mark{width:40px;height:40px;font-size:15px}
.avq-o-pickup__text{display:flex;flex-direction:column;gap:2px;min-width:0;overflow-wrap:anywhere}
.avq-o-pickup__name{font-weight:600}
.avq-o-pickup__addr{color:${T.text2};font-size:14px}
.avq-o-lines{list-style:none;margin:8px 0 0;padding:0 16px}
.avq-o-line{display:flex;flex-wrap:wrap;align-items:center;column-gap:12px;padding:16px 0;border-bottom:1px solid ${T.divider}}
.avq-o-root .avq-o-line:focus{outline:none}
.avq-o-line__info{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px;overflow-wrap:anywhere}
.avq-o-line__name{font-size:16px;font-weight:600}
.avq-o-line__sub{color:${T.muted};font-size:14px}
.avq-o-line__price{margin-top:2px;font-weight:500}
.avq-o-issue{margin:0;padding:8px 12px;border-radius:12px;background:${T.errBg};color:${T.errFg};font-size:14px;font-weight:600;line-height:1.4;overflow-wrap:anywhere}
.avq-o-line>.avq-o-issue{flex:0 0 100%;margin-top:10px}
.avq-o-cart>.avq-o-issue{margin:12px 16px 0;border-radius:16px}
.avq-o-more{margin:4px 0 0 8px}
.avq-o-cart__note{display:flex;flex-direction:column;gap:8px;margin:12px 16px 0}
.avq-o-cart__note>label{font-weight:600}
.avq-o-total{display:flex;flex-direction:column;gap:6px;margin:12px 16px 0;padding-top:16px;border-top:1px solid ${T.divider}}
.avq-o-total__row{display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin:0;font-size:17px;font-weight:700}
.avq-o-total__wait{color:${T.muted};font-size:15px;font-weight:400}
.avq-o-total__tax{margin:0;color:${T.muted};font-size:14px}
.avq-o-cartfoot{position:sticky;bottom:0;z-index:2;margin-top:16px;padding:12px 16px calc(24px + env(safe-area-inset-bottom,0px));background:#FFFFFF;border-top:1px solid ${T.divider}}
.avq-o-cartfoot .avq-o-btn{width:100%;min-height:56px;justify-content:space-between}
.avq-o-cartfoot .avq-o-btn>span:only-child{margin:0 auto}
.avq-o-form{display:flex;flex-direction:column;gap:20px;padding:4px 16px 0}
.avq-o-form__intro{display:flex;flex-direction:column;gap:6px}
.avq-o-form__intro>p{margin:0;color:${T.muted};line-height:1.4}
.avq-o-field{display:flex;flex-direction:column;gap:8px;min-width:0}
.avq-o-field>label,.avq-o-field__label{font-weight:600}
.avq-o-help{margin:0;color:${T.muted};font-size:14px;line-height:1.4;overflow-wrap:anywhere}
.avq-o-privacy{display:flex;flex-direction:column;gap:4px}
.avq-o-privacy>a{align-self:flex-start;display:inline-flex;align-items:center;min-height:44px;color:${T.ink};font-weight:600}
.avq-o-check{display:flex;align-items:flex-start;gap:12px;padding:11px 0;line-height:1.4;cursor:pointer}
.avq-o-check>input{flex:none;width:20px;height:20px;margin:1px 0 0;accent-color:var(--avq-accent,${T.ink})}
.avq-o-form input,.avq-o-form button,.avq-o-form a{scroll-margin-bottom:calc(170px + env(safe-area-inset-bottom,0px))}
.avq-o-confirm{display:flex;flex-direction:column;gap:10px}
.avq-o-confirm .avq-o-notice{margin:0}
.avq-o-confirm__sum{display:flex;justify-content:space-between;gap:12px;margin:0;color:${T.text2};font-size:14px}
.avq-o-confirm__msg{margin:0;color:${T.text2};font-size:14px;font-weight:600;overflow-wrap:anywhere}
.avq-o-otp{padding-bottom:24px}
.avq-o-otp__back{margin:12px 8px 0;gap:4px}
.avq-o-otp__intro{display:flex;flex-direction:column;gap:8px;padding:8px 16px 0}
.avq-o-otp__intro>p{margin:0;color:${T.text2};line-height:1.45;overflow-wrap:anywhere}
.avq-o-otp__code{display:flex;flex-direction:column;gap:12px;margin:28px 16px 0}
.avq-o-otp__more{display:flex;flex-direction:column;align-items:flex-start;gap:4px;padding:20px 16px 0}
.avq-o-otp__more>.avq-o-btn{padding:0}
`
