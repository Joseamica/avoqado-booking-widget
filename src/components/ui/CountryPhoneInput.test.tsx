import { h, options } from 'preact'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CountryPhoneInput } from './CountryPhoneInput'

afterEach(cleanup)

// jsdom (igual que un navegador) devuelve #RRGGBB como rgb(): el valor esperado se escribe en hex y pasa por el mismo CSSOM.
const css = (prop: string, value: string) => {
  const el = document.createElement('i')
  el.style.setProperty(prop, value)
  return el.style.getPropertyValue(prop)
}
const decls = (el: Element) => (el.getAttribute('style') ?? '').split(/;\s*/).filter(Boolean)
const vars = (el: Element) => el.outerHTML.match(/var\(--avq-[a-z-]+/g) ?? []

// jsdom descarta `border: none` al armar el atributo style (la prueba de «hoy» no lo ve): se lee lo que el componente le entrega a Preact.
function authoredStyles(draw: () => void) {
  const seen: Record<string, unknown>[] = []
  const prev = options.vnode
  options.vnode = (v: any) => { if (typeof v.type === 'string' && v.props.style) seen.push({ ...v.props.style }); prev?.(v) }
  try { draw() } finally { options.vnode = prev }
  return seen
}

const props = {
  dialCode: '52', nationalNumber: '', onDialCodeChange: vi.fn(), onNationalNumberChange: vi.fn(),
  numberPlaceholder: 'Número', searchPlaceholder: 'Buscar país', noResultsText: 'Sin resultados',
}
function show(look?: 'tienda') {
  render(<CountryPhoneInput {...props} look={look} />)
  const dial = screen.getByRole('button') as HTMLButtonElement
  return { dial, field: dial.parentElement as HTMLElement, number: screen.getByPlaceholderText('Número') as HTMLInputElement }
}
function openList() {
  act(() => { fireEvent.click(screen.getByRole('button')) })
  return {
    list: screen.getByRole('listbox'),
    search: screen.getByPlaceholderText('Buscar país') as HTMLInputElement,
    options: screen.getAllByRole('option') as HTMLElement[],
  }
}

const ACCENT_2PX = '2px solid var(--avq-accent, #000)'

describe('CountryPhoneInput', () => {
  it('CountryPhoneInput sin look conserva el estilo de hoy', () => {
    const { dial, field, number } = show()
    const idle = decls(field)
    act(() => number.focus())
    expect({ field: idle, fieldFocused: decls(field), dial: decls(dial), number: decls(number) }).toMatchInlineSnapshot(`
      {
        "dial": [
          "display: flex",
          "align-items: center",
          "gap: 6px",
          "padding: 0px 10px",
          "border-right: 1.5px solid var(--avq-border, #e8eaed)",
          "background: var(--avq-muted, #f8f9fb)",
          "cursor: pointer",
          "font-size: 15px",
          "color: var(--avq-fg, #111827)",
          "white-space: nowrap",
        ],
        "field": [
          "display: flex",
          "align-items: stretch",
          "height: 46px",
          "border-radius: 12px",
          "border: 1.5px solid var(--avq-border, #e8eaed)",
          "background: var(--avq-bg, #ffffff)",
          "overflow: hidden",
          "transition: border-color 0.2s ease",
        ],
        "fieldFocused": [
          "display: flex",
          "align-items: stretch",
          "height: 46px",
          "border-radius: 12px",
          "border: 1.5px solid var(--avq-accent, #6366f1)",
          "background: var(--avq-bg, #ffffff)",
          "overflow: hidden",
          "transition: border-color 0.2s ease",
        ],
        "number": [
          "flex: 1 1 0%",
          "min-width: 0px",
          "outline: none",
          "padding: 0px 14px",
          "font-size: 15px",
          "background: transparent",
          "color: var(--avq-fg, #111827)",
        ],
      }
    `)

    const { list, search, options } = openList()
    act(() => { fireEvent.input(search, { target: { value: 'zzzz' } }) })
    const noResults = screen.getByText('Sin resultados')
    act(() => { fireEvent.input(search, { target: { value: '' } }) })
    expect({
      list: decls(list), searchBox: decls(search.parentElement!), search: decls(search), scroller: decls(list.lastElementChild!),
      highlighted: decls(options[0]), option: decls(options[1]), optionDial: decls(options[1].lastElementChild!),
      noResults: decls(noResults),
    }).toMatchInlineSnapshot(`
      {
        "highlighted": [
          "display: flex",
          "align-items: center",
          "gap: 10px",
          "width: 100%",
          "padding: 9px 12px",
          "cursor: pointer",
          "text-align: left",
          "background: var(--avq-muted, #f8f9fb)",
          "font-size: 14px",
          "color: var(--avq-fg, #111827)",
        ],
        "list": [
          "position: absolute",
          "z-index: 50",
          "top: calc(100% + 4px)",
          "left: 0px",
          "right: 0px",
          "background: var(--avq-bg, #ffffff)",
          "border: 1.5px solid var(--avq-border, #e8eaed)",
          "border-radius: 12px",
          "box-shadow: 0 8px 24px rgba(0,0,0,0.12)",
          "overflow: hidden",
        ],
        "noResults": [
          "padding: 16px",
          "text-align: center",
          "font-size: 13px",
          "color: var(--avq-muted-fg, #6b7280)",
        ],
        "option": [
          "display: flex",
          "align-items: center",
          "gap: 10px",
          "width: 100%",
          "padding: 9px 12px",
          "cursor: pointer",
          "text-align: left",
          "background: transparent",
          "font-size: 14px",
          "color: var(--avq-fg, #111827)",
        ],
        "optionDial": [
          "color: var(--avq-muted-fg, #6b7280)",
          "font-variant-numeric: tabular-nums",
        ],
        "scroller": [
          "max-height: 240px",
          "overflow-y: auto",
        ],
        "search": [
          "width: 100%",
          "height: 38px",
          "border-radius: 8px",
          "border: 1.5px solid var(--avq-border, #e8eaed)",
          "outline: none",
          "padding: 0px 12px",
          "font-size: 14px",
          "box-sizing: border-box",
          "background: var(--avq-bg, #ffffff)",
          "color: var(--avq-fg, #111827)",
        ],
        "searchBox": [
          "padding: 8px",
          "border-bottom: 1px solid var(--avq-border, #e8eaed)",
        ],
      }
    `)
  })

  it('CountryPhoneInput la lada y el número no tienen borde nativo (border: none), con y sin look', () => {
    for (const look of [undefined, 'tienda'] as const) {
      const seen = authoredStyles(() => { render(<CountryPhoneInput {...props} look={look} />) })
      expect(seen.filter(s => s.border === 'none')).toHaveLength(2) // la lada y el número
      cleanup()
    }
  })

  it('CountryPhoneInput look=tienda: alto 52 y lada sobre #F3F3F3', () => {
    const { dial, field, number } = show('tienda')
    expect(field.style.height).toBe('52px')
    expect(field.style.boxSizing).toBe('border-box') // los 52 px incluyen el borde, sin depender del CSS del sitio
    expect(field.style.borderRadius).toBe('12px')
    expect(field.style.border).toBe(css('border', '1px solid #DADADA'))
    expect(field.style.background).toBe(css('background', '#FFFFFF'))
    expect(dial.style.background).toBe(css('background', '#F3F3F3'))
    expect(dial.style.color).toBe(css('color', '#000000'))
    expect(dial.style.borderRight).toBe(css('border-right', '0')) // sin divisor: la lada se separa por su fondo
    expect(number.style.color).toBe(css('color', '#000000'))
    // 16 px o más: iOS no hace zoom al enfocar
    expect(dial.style.fontSize).toBe('16px')
    expect(number.style.fontSize).toBe('16px')
    // botones e inputs no heredan la tipografía de la tienda (Figtree) si no se pide
    expect([dial.style.fontFamily, number.style.fontFamily]).toEqual(['inherit', 'inherit'])
  })

  it('CountryPhoneInput look=tienda: con foco en el número el borde es de 2px de acento y al salir vuelve a #DADADA', () => {
    const { field, number } = show('tienda')
    act(() => number.focus())
    expect(field.style.border).toBe(ACCENT_2PX)
    act(() => number.blur())
    expect(field.style.border).toBe(css('border', '1px solid #DADADA'))
  })

  it('CountryPhoneInput look=tienda: el anillo de foco de la lada se dibuja adentro (el campo recorta lo que sobra)', () => {
    const { dial } = show('tienda')
    expect(dial.style.outlineOffset).toBe('-4px')
  })

  it('CountryPhoneInput look=tienda: la lista de países va #000000 sobre #FFFFFF, con buscador y filas táctiles', () => {
    show('tienda')
    const { list, search, options } = openList()
    expect(list.style.background).toBe(css('background', '#FFFFFF'))
    expect(search.style.color).toBe(css('color', '#000000'))
    expect(search.style.background).toBe(css('background', '#FFFFFF'))
    expect(search.style.fontSize).toBe('16px') // es un input que se enfoca solo al abrir: 16 px evita el zoom de iOS
    expect(search.style.height).toBe('44px')
    expect(options[1].style.color).toBe(css('color', '#000000'))
    expect(options[1].style.minHeight).toBe('44px')
    expect([search.style.fontFamily, options[1].style.fontFamily]).toEqual(['inherit', 'inherit'])
    expect(options[0].style.background).toBe(css('background', '#F3F3F3')) // la resaltada
    expect(options[1].style.background).toBe('transparent')
    // el buscador conserva su anillo de foco (el de la tienda, `:focus-visible`): no lleva outline en línea
    expect(search.style.outline).toBe('')
  })

  it('CountryPhoneInput look=tienda: no lee el tema salvo el acento (ni --avq-fg, --avq-bg, --avq-muted...)', () => {
    const { field, number } = show('tienda')
    const root = field.parentElement!
    const { search } = openList()
    expect(vars(root)).toEqual([]) // campo, lada, lista, buscador, filas y sus ladas
    act(() => { fireEvent.input(search, { target: { value: 'zzzz' } }) }) // también el «Sin resultados»
    expect(screen.getByText('Sin resultados')).toBeTruthy()
    expect(vars(root)).toEqual([])
    act(() => number.focus())
    expect(new Set(vars(root))).toEqual(new Set(['var(--avq-accent']))
  })
})
