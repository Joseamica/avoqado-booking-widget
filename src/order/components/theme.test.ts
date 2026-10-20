import { h } from 'preact'
import { cleanup, render } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return { ...actual, getInfo: vi.fn(), getMenu: vi.fn(), getTracking: vi.fn() }
})
import { OrderApp } from './OrderApp'
import { infoOf, makeStore, menuOf, product, withStore } from './testKit'
import { STORE_CSS, T, accentFor, initialsOf, loadStoreFonts } from './theme'

const fontLinks = () => document.head.querySelectorAll('link[data-avq-store-fonts]')
beforeEach(() => { sessionStorage.clear(); localStorage.clear(); fontLinks().forEach(l => l.remove()) })
afterEach(cleanup)

// Oráculo propio (no reusa el de theme.ts): contraste WCAG entre dos colores #rrggbb.
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map(i => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

describe('tokens', () => {
  it('T trae los valores del spec §4', () => {
    expect(T).toEqual({
      ink: '#000000', text2: '#4A4A4A', muted: '#5E5E5E', divider: '#EEEEEE', fieldBorder: '#DADADA', surface: '#F3F3F3', card: '#F4F4F4',
      okBg: '#EAF6EE', okFg: '#0B6B36', okDot: '#12A150', warnBg: '#FFF4DE', warnFg: '#6B4300', errBg: '#FDECEA', errFg: '#B3261E',
    })
  })
  it('los textos de los tokens dan 4.5:1 sobre sus fondos (también los grises chicos)', () => {
    const white = '#FFFFFF'
    const pairs: [string, string][] = [
      [T.ink, white], [T.ink, T.surface], [T.text2, white], [T.text2, T.surface], [T.text2, T.card],
      [T.muted, white], [T.muted, T.surface], [T.muted, T.card],
      [T.okFg, T.okBg], [T.warnFg, T.warnBg], [T.errFg, T.errBg],
    ]
    for (const [fg, bg] of pairs) expect(ratio(fg, bg), `${fg} sobre ${bg}`).toBeGreaterThanOrEqual(4.5)
  })
})

describe('accentFor', () => {
  it('accentFor: color oscuro se queda, claro o inválido cae a negro', () => {
    expect(accentFor('#14532D')).toBe('#14532D')
    expect(accentFor('#7F1D1D')).toBe('#7F1D1D')
    expect(accentFor('#FFD600')).toBe('#000000')
    expect(accentFor('#ffffff')).toBe('#000000')
    expect(accentFor('#abc')).toBe('#000000') // 3 dígitos claros
    expect(accentFor('red')).toBe('#000000') // sólo hex
    expect(accentFor(null)).toBe('#000000')
  })
  it('un 3 dígitos oscuro se queda tal cual y las minúsculas no cambian', () => {
    expect(accentFor('#123')).toBe('#123')
    expect(accentFor('#14532d')).toBe('#14532d')
  })
  it('el umbral es 4.5:1 contra blanco (#767676 pasa, #777777 no)', () => {
    expect(accentFor('#767676')).toBe('#767676')
    expect(accentFor('#777777')).toBe('#000000')
  })
  it('sólo #rgb o #rrggbb: lo demás cae a negro', () => {
    for (const bad of ['', undefined, '14532D', '#12345', '#14532DFF', '#gggggg', 'rgb(20,83,45)', ' #14532D']) expect(accentFor(bad)).toBe('#000000')
  })
})

describe('initialsOf', () => {
  it('initialsOf', () => {
    expect(initialsOf('Avoqado Full')).toBe('AF')
    expect(initialsOf('flautas coyoacán del centro')).toBe('FC')
    expect(initialsOf('Ñandú')).toBe('Ñ')
    expect(initialsOf('  ')).toBe('')
    expect(initialsOf(null)).toBe('')
  })
  it('salta signos y emoji sueltos, aguanta espacios de más y deja los números', () => {
    expect(initialsOf('Tacos & Más')).toBe('TM')
    expect(initialsOf('  flautas   coyoacán ')).toBe('FC')
    expect(initialsOf('🌮 Tacos El Güero')).toBe('TE')
    expect(initialsOf('3 Amigos')).toBe('3A')
    expect(initialsOf('&')).toBe('')
    expect(initialsOf(undefined)).toBe('')
  })
})

describe('loadStoreFonts', () => {
  it('loadStoreFonts agrega un solo link aunque se llame dos veces', () => {
    loadStoreFonts(); loadStoreFonts()
    expect(fontLinks().length).toBe(1)
  })
  it('el link pide Bricolage Grotesque y Figtree a Google Fonts, con swap', () => {
    loadStoreFonts()
    const link = fontLinks()[0] as HTMLLinkElement
    expect(link.rel).toBe('stylesheet')
    expect(link.getAttribute('href')).toBe(
      'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600..800&family=Figtree:wght@400;500;600;700&display=swap',
    )
  })
})

describe('STORE_CSS', () => {
  it('STORE_CSS fija las --avq-* claras en .avq-o-root', () => {
    expect(STORE_CSS).toMatch(/\.avq-o-root\s*\{[^}]*--avq-fg:\s*#000000/)
    const rule = STORE_CSS.match(/\.avq-o-root\s*\{([^}]*)\}/)?.[1] ?? ''
    const light = { bg: '#FFFFFF', fg: '#000000', muted: '#F3F3F3', 'muted-fg': '#5E5E5E', border: '#DADADA' }
    for (const [name, value] of Object.entries(light)) expect(rule).toMatch(new RegExp(`--avq-${name}:\\s*${value}(?![0-9A-Fa-f])`))
  })
  it('trae las clases que usan las pantallas, el foco visible y el movimiento reducido', () => {
    const classes = [
      'avq-o-root', 'avq-o-title', 'avq-o-section-title', 'avq-o-row', 'avq-o-chip', 'avq-o-btn', 'avq-o-btn--primary', 'avq-o-btn--neutral',
      'avq-o-btn--quiet', 'avq-o-input', 'avq-o-stepper', 'avq-o-notice', 'avq-o-notice--warn', 'avq-o-notice--error', 'avq-o-notice--neutral',
      'avq-o-sheet', 'avq-o-bar',
    ]
    for (const c of classes) expect(STORE_CSS, `.${c}`).toMatch(new RegExp(`\\.${c}[\\s,{:>.\\[]`))
    expect(STORE_CSS).toContain(':focus-visible')
    expect(STORE_CSS).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/)
  })
  it('la tienda es clara siempre: color-scheme light en la raíz (barras y casillas nativas no se vuelven oscuras en un sitio oscuro)', () => {
    expect(STORE_CSS.match(/\.avq-o-root\s*\{([^}]*)\}/)?.[1] ?? '').toMatch(/color-scheme:\s*light(?![\w-])/)
  })
  it('trae las clases del encabezado (portada, logo, chips, cabecera compacta) y de las partes del aviso', () => {
    const classes = [
      'avq-o-hero', 'avq-o-hero--cover', 'avq-o-hero__img', 'avq-o-hero__id', 'avq-o-hero__names', 'avq-o-hero__name', 'avq-o-hero__addr',
      'avq-o-chips', 'avq-o-dot', 'avq-o-mark', 'avq-o-mark--sm', 'avq-o-head', 'avq-o-head__name',
      'avq-o-notice__body', 'avq-o-notice__title', 'avq-o-notice__action',
    ]
    for (const c of classes) expect(STORE_CSS, `.${c}`).toMatch(new RegExp(`\\.${c}[\\s,{:>.\\[]`))
  })
  it('trae las clases de la carta (buscador, pestañas, secciones, filas con foto y barra del carrito)', () => {
    const classes = [
      'avq-o-menu', 'avq-o-search', 'avq-o-tabs', 'avq-o-tab', 'avq-o-section', 'avq-o-row__text', 'avq-o-row__info', 'avq-o-row__name',
      'avq-o-row__price', 'avq-o-row__desc', 'avq-o-row__tag', 'avq-o-row__media', 'avq-o-row__img', 'avq-o-row__add', 'avq-o-row--bare',
      'avq-o-foot', 'avq-o-empty', 'avq-o-bar__count', 'avq-o-bar__label', 'avq-o-bar__note', 'avq-o-bar__total',
    ]
    for (const c of classes) expect(STORE_CSS, `.${c}`).toMatch(new RegExp(`\\.${c}[\\s,{:>.\\[]`))
  })
  it('las fuentes: Figtree en el cuerpo y Bricolage Grotesque en los títulos, con respaldo del sistema', () => {
    expect(STORE_CSS).toMatch(/\.avq-o-root\s*\{[^}]*font-family:\s*'Figtree',\s*system-ui,\s*sans-serif/)
    expect(STORE_CSS).toContain("'Bricolage Grotesque',system-ui,sans-serif")
  })
})

describe('OrderApp con la hoja de la tienda', () => {
  const accentOf = (brand: string | null, attr?: string) => {
    const s = makeStore(infoOf({ brand: { logo: null, logoFull: null, primaryColor: brand, secondaryColor: null } }), menuOf(product()))
    const r = render(withStore(s, h(OrderApp, { accentColor: attr })))
    const value = (r.container.firstElementChild as HTMLElement).style.getPropertyValue('--avq-accent')
    r.unmount()
    return value
  }

  it('OrderApp pinta la hoja de la tienda y el acento ilegible cae a negro', () => {
    const s = makeStore(infoOf({ brand: { logo: null, logoFull: null, primaryColor: '#FFD600', secondaryColor: null } }), menuOf(product()))
    const { container } = render(withStore(s, h(OrderApp, { accentColor: undefined })))
    const root = container.firstElementChild as HTMLElement
    expect(root.classList.contains('avq-o-root')).toBe(true)
    // La hoja va DENTRO de la raíz (primer hijo): `[data-avq-theme] > div` sigue siendo la raíz de la tienda.
    const sheet = root.firstElementChild as HTMLElement
    expect(sheet.tagName).toBe('STYLE')
    expect(sheet.textContent).toContain('.avq-o-row')
    expect(root.style.getPropertyValue('--avq-accent')).toBe('#000000')
  })
  it('pide las fuentes al montarse y no deja la hoja suelta en el documento', () => {
    const s = makeStore(infoOf(), menuOf(product()))
    render(withStore(s, h(OrderApp, { accentColor: undefined })))
    expect(fontLinks().length).toBe(1)
    expect([...document.head.querySelectorAll('style')].some(el => el.textContent?.includes('.avq-o-'))).toBe(false)
  })
  it('acento: la marca manda; sin marca, el atributo; sin nada, negro; una marca ilegible no se cambia por el atributo', () => {
    expect(accentOf('#14532D', '#1E3A8A')).toBe('#14532D')
    expect(accentOf(null, '#1E3A8A')).toBe('#1E3A8A')
    expect(accentOf(null)).toBe('#000000')
    expect(accentOf('#FFD600', '#1E3A8A')).toBe('#000000')
  })
})
