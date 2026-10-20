import { h } from 'preact'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OtpInput } from './OtpInput'

afterEach(cleanup)

// jsdom (igual que un navegador) devuelve #RRGGBB como rgb(): el valor esperado se escribe en hex y pasa por el mismo CSSOM.
const css = (prop: string, value: string) => {
  const el = document.createElement('i')
  el.style.setProperty(prop, value)
  return el.style.getPropertyValue(prop)
}
const decls = (el: Element) => (el.getAttribute('style') ?? '').split(/;\s*/).filter(Boolean)
const vars = (el: Element) => el.outerHTML.match(/var\(--avq-[a-z-]+/g) ?? []

function show(look?: 'tienda') {
  render(<OtpInput value="" onChange={vi.fn()} onComplete={vi.fn()} look={look} />)
  return screen.getAllByRole('textbox') as HTMLInputElement[]
}

const ACCENT_2PX = '2px solid var(--avq-accent, #000)'

describe('OtpInput', () => {
  it('OtpInput sin look conserva el estilo de hoy', () => {
    const [first] = show()
    const today = { wrapper: decls(first.parentElement!), box: decls(first) }
    expect(today).toMatchInlineSnapshot(`
      {
        "box": [
          "width: 100%",
          "height: 52px",
          "text-align: center",
          "font-size: 22px",
          "font-weight: 600",
          "font-variant-numeric: tabular-nums",
          "border-radius: 12px",
          "border: 1.5px solid var(--avq-border, #e8eaed)",
          "background: var(--avq-bg, #ffffff)",
          "color: var(--avq-fg, #111827)",
          "outline: none",
          "box-sizing: border-box",
          "transition: border-color 0.2s ease, box-shadow 0.2s ease",
        ],
        "wrapper": [
          "display: flex",
          "gap: 8px",
          "justify-content: space-between",
        ],
      }
    `)
    // hoy no hay estado de foco: enfocar una caja no cambia nada
    act(() => first.focus())
    expect({ wrapper: decls(first.parentElement!), box: decls(first) }).toEqual(today)
  })

  it('OtpInput look=tienda: caja de 60px y radio 12', () => {
    const boxes = show('tienda')
    expect(boxes).toHaveLength(6)
    const { style } = boxes[0]
    expect(style.height).toBe('60px')
    expect(style.borderRadius).toBe('12px')
    expect(style.border).toBe(css('border', '1px solid #DADADA'))
    expect(style.fontSize).toBe('26px')
    expect(style.fontWeight).toBe('700')
    expect(style.fontFamily).toBe('inherit') // un input no hereda la tipografía de la tienda (Figtree) si no se pide
  })

  it('OtpInput look=tienda: colores fijos (#000000 sobre #FFFFFF), sin leer el tema salvo el acento', () => {
    const boxes = show('tienda')
    expect(boxes[0].style.color).toBe(css('color', '#000000'))
    expect(boxes[0].style.background).toBe(css('background', '#FFFFFF'))
    const wrapper = boxes[0].parentElement!
    expect(vars(wrapper)).toEqual([]) // ni --avq-fg ni --avq-bg: un contenedor oscuro no la vuelve blanco sobre blanco
    act(() => boxes[2].focus())
    expect(new Set(vars(wrapper))).toEqual(new Set(['var(--avq-accent']))
  })

  it('OtpInput look=tienda: la caja con foco lleva borde de 2px de acento y las demás conservan #DADADA', () => {
    const boxes = show('tienda')
    const idle = css('border', '1px solid #DADADA')
    expect(boxes.map(b => b.style.border)).toEqual(Array(6).fill(idle))
    act(() => boxes[1].focus())
    expect(boxes[1].style.border).toBe(ACCENT_2PX)
    expect(boxes.filter(b => b !== boxes[1]).map(b => b.style.border)).toEqual(Array(5).fill(idle))
    // Tab o flecha: el foco pasa a otra caja y el borde de acento la sigue
    act(() => boxes[2].focus())
    expect(boxes[1].style.border).toBe(idle)
    expect(boxes[2].style.border).toBe(ACCENT_2PX)
    act(() => boxes[2].blur())
    expect(boxes[2].style.border).toBe(idle)
  })

  it('OtpInput look=tienda: al deshabilitarse con foco (verificando el código) la caja suelta el borde de acento', () => {
    const idle = css('border', '1px solid #DADADA')
    const props = { value: '123456', onChange: vi.fn(), onComplete: vi.fn(), look: 'tienda' as const }
    const { rerender } = render(<OtpInput {...props} />)
    const boxes = screen.getAllByRole('textbox') as HTMLInputElement[]
    act(() => boxes[5].focus())
    expect(boxes[5].style.border).toBe(ACCENT_2PX)
    // el navegador no siempre avisa con blur cuando el input con foco se deshabilita: sin esto la caja se quedaría resaltada
    rerender(<OtpInput {...props} disabled />)
    expect(boxes[5].style.border).toBe(idle)
    rerender(<OtpInput {...props} />) // vuelve a habilitarse (código equivocado): ninguna sigue resaltada aunque el foco se perdió
    expect(boxes.map(b => b.style.border)).toEqual(Array(6).fill(idle))
  })

  it('OtpInput look=tienda: al escribir un dígito el borde de acento pasa a la siguiente caja', () => {
    const onChange = vi.fn()
    render(<OtpInput value="" onChange={onChange} onComplete={vi.fn()} look="tienda" />)
    const boxes = screen.getAllByRole('textbox') as HTMLInputElement[]
    act(() => boxes[0].focus())
    act(() => { fireEvent.input(boxes[0], { target: { value: '4' } }) })
    expect(onChange).toHaveBeenCalledWith('4')
    expect(document.activeElement).toBe(boxes[1])
    expect(boxes[0].style.border).toBe(css('border', '1px solid #DADADA'))
    expect(boxes[1].style.border).toBe(ACCENT_2PX)
  })
})
