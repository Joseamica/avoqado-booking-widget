// Sistema visual de la tienda de pedidos en línea (<avoqado-order>): tokens, hoja de estilos con clases `avq-o-*`, color de
// acento legible, iniciales y tipografías. Los valores salen del spec (§4, §9, §10.3) y de la maqueta aprobada
// (docs/audit/2026-10-19-tienda-pedidos-rediseno/maqueta/*.dc.html).

/** Colores del spec §4. Cada texto sobre el fondo en que se usa da 4.5:1 o más (lo vigila theme.test.ts). */
export const T = {
  ink: '#000000', // títulos, nombres, botón principal por omisión
  text2: '#4A4A4A', // direcciones y subtítulos
  muted: '#5E5E5E', // descripciones y ayudas
  divider: '#EEEEEE', // líneas entre productos y renglones
  fieldBorder: '#DADADA', // inputs y stepper del carrito
  surface: '#F3F3F3', // buscador, chips, stepper y botones secundarios
  card: '#F4F4F4', // ticket del folio y tarjeta de «Recoges en»
  okBg: '#EAF6EE', okFg: '#0B6B36', okDot: '#12A150', // abierto
  warnBg: '#FFF4DE', warnFg: '#6B4300', // pausa o cerrado
  errBg: '#FDECEA', errFg: '#B3261E', // problemas de un renglón y fallos
} as const

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
 * Hoja de estilos de la tienda. `OrderApp` la pinta como primer hijo de su raíz y la ficha de producto, en su portal, trae una
 * copia: por eso todo cuelga de `.avq-o-root` o de una clase `avq-o-*` y no depende de nada de afuera.
 * - `.avq-o-root` fija las variables `--avq-*` a sus valores claros: la tienda es clara aunque el contenedor diga
 *   `data-avq-theme="dark"` (spec §10.3). `--avq-o-display` es la tipografía de los títulos.
 * - El acento llega en `--avq-accent` (lo pone `accentFor` en la raíz).
 * - Modificadores de uso: `.avq-o-btn` + `--primary|--neutral|--quiet`, `.avq-o-notice` + `--neutral|--warn|--error`,
 *   `.avq-o-chip` (+ `--ok`), `.avq-o-stepper` (+ `--line`, el del carrito), `.avq-o-bar` (+ `--neutral`) y `.avq-o-sheet`
 *   (la capa que cubre la ventana) con `.avq-o-sheet__panel` (la hoja).
 * Cada tarea puede AGREGAR clases; las que ya están no se cambian ni se quitan.
 */
export const STORE_CSS = `
.avq-o-root{--avq-bg:#FFFFFF;--avq-fg:${T.ink};--avq-muted:${T.surface};--avq-muted-fg:${T.muted};--avq-border:${T.fieldBorder};--avq-o-display:${DISPLAY};box-sizing:border-box;background:#FFFFFF;color:${T.ink};font-family:${BODY};font-size:15px;font-variant-numeric:tabular-nums;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}
.avq-o-root *,.avq-o-root *::before,.avq-o-root *::after{box-sizing:border-box}
.avq-o-root :focus-visible{outline:2px solid var(--avq-accent,${T.ink});outline-offset:2px}
@media (prefers-reduced-motion:reduce){.avq-o-root *,.avq-o-root *::before,.avq-o-root *::after{animation:none!important;transition:none!important}}
.avq-o-title{margin:0;font-family:var(--avq-o-display);font-weight:800;font-size:30px;line-height:1.1}
.avq-o-section-title{margin:0 0 2px;font-family:var(--avq-o-display);font-weight:700;font-size:22px}
.avq-o-row{display:flex;gap:16px;width:100%;margin:0;padding:16px 0;border:0;border-bottom:1px solid ${T.divider};background:transparent;color:inherit;font:inherit;text-align:left;text-decoration:none;word-break:break-word;overflow-wrap:anywhere;cursor:pointer}
.avq-o-chip{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border-radius:999px;background:${T.surface};color:#333333;font-size:14px;font-weight:500;white-space:nowrap}
.avq-o-chip--ok{background:${T.okBg};color:${T.okFg};font-weight:600}
.avq-o-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:52px;padding:0 20px;border:0;border-radius:14px;font:inherit;font-size:16px;font-weight:700;text-decoration:none;cursor:pointer}
.avq-o-btn--primary{background:var(--avq-accent,${T.ink});color:#FFFFFF}
.avq-o-btn--neutral{background:${T.surface};color:${T.ink}}
.avq-o-btn--quiet{min-height:44px;padding:0 8px;background:transparent;color:${T.ink};font-weight:600}
.avq-o-btn:disabled{color:#8A8A8A;cursor:not-allowed}
.avq-o-btn--primary:disabled{background:#EDEDED}
.avq-o-input{width:100%;min-height:52px;padding:0 14px;border:1px solid ${T.fieldBorder};border-radius:12px;background:#FFFFFF;color:${T.ink};font:inherit;font-size:16px}
textarea.avq-o-input{min-height:0;padding:12px 14px;resize:none}
.avq-o-input::placeholder{color:${T.muted};opacity:1}
.avq-o-stepper{display:inline-flex;align-items:center;height:52px;border-radius:999px;background:${T.surface}}
.avq-o-stepper button{display:flex;align-items:center;justify-content:center;width:48px;height:52px;padding:0;border:0;background:transparent;color:${T.ink};font:inherit;cursor:pointer}
.avq-o-stepper button:disabled{color:#8A8A8A;cursor:not-allowed}
.avq-o-stepper>span{min-width:20px;text-align:center;font-size:16px;font-weight:700}
.avq-o-stepper--line{height:40px;background:transparent;border:1px solid ${T.fieldBorder}}
.avq-o-stepper--line button{width:44px;height:44px}
.avq-o-stepper--line>span{min-width:16px;font-size:15px}
.avq-o-notice{display:flex;align-items:flex-start;gap:12px;margin:4px 16px 12px;padding:14px 16px;border-radius:16px;line-height:1.4}
.avq-o-notice--neutral{background:${T.surface};color:${T.ink}}
.avq-o-notice--warn{background:${T.warnBg};color:${T.warnFg}}
.avq-o-notice--error{background:${T.errBg};color:${T.errFg}}
.avq-o-notice>svg{flex:none;margin-top:1px}
.avq-o-sheet{position:fixed;top:0;right:0;bottom:0;left:0;z-index:2147483000;display:flex;justify-content:center;background:rgba(0,0,0,.45)}
.avq-o-sheet__panel{display:flex;flex-direction:column;width:100%;max-height:100%;overflow:hidden;background:#FFFFFF;animation:avq-o-up .28s cubic-bezier(.2,.8,.2,1)}
@media (min-width:768px){.avq-o-sheet{align-items:center;padding:24px}.avq-o-sheet__panel{width:520px;border-radius:20px;animation-name:avq-o-pop}}
@keyframes avq-o-up{from{transform:translateY(100%)}to{transform:none}}
@keyframes avq-o-pop{from{opacity:0;transform:scale(.98)}to{opacity:1;transform:none}}
.avq-o-bar{position:sticky;bottom:calc(24px + env(safe-area-inset-bottom,0px));z-index:2;display:flex;align-items:center;gap:12px;width:calc(100% - 32px);min-height:58px;margin:0 16px;padding:0 18px 0 12px;border:0;border-radius:16px;background:var(--avq-accent,${T.ink});color:#FFFFFF;font:inherit;font-size:16px;font-weight:700;text-align:left;text-decoration:none;box-shadow:0 8px 24px rgba(0,0,0,.22);cursor:pointer}
.avq-o-bar--neutral{min-height:64px;padding-top:10px;padding-bottom:10px;background:#EDEDED;color:${T.text2};box-shadow:none}
`
