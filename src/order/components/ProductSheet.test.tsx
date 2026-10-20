import { h } from 'preact'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return { ...actual, getInfo: vi.fn(), getMenu: vi.fn() }
})
import { MenuScreen } from './MenuScreen'
import { OrderApp } from './OrderApp'
import { STORE_CSS } from './theme'
import { infoOf, makeStore, menuOf, product, withStore } from './testKit'
import type { MenuModifierGroup, MenuProduct } from '../types'

beforeEach(() => { sessionStorage.clear(); localStorage.clear() })
afterEach(cleanup)

const group = (over: Partial<MenuModifierGroup> & Pick<MenuModifierGroup, 'id' | 'name' | 'modifiers'>): MenuModifierGroup => ({
  required: false, allowMultiple: false, minSelections: 0, maxSelections: null, ...over,
})
const withSalsa = (): MenuProduct => product({
  modifierGroups: [group({
    id: 'g1', name: 'Salsa', required: true, minSelections: 1, maxSelections: 1,
    modifiers: [{ id: 'm1', name: 'Verde', price: 0 }, { id: 'm2', name: 'Queso extra', price: 12.5 }],
  })],
})
// La hamburguesa de la maqueta: Tamaño obligatorio (una) y Aderezos opcionales (varias, sin máximo).
const burger = (): MenuProduct => product({
  name: 'Hamburguesa Clásica', price: 129, description: 'Carne de res, queso cheddar y pepinillos',
  modifierGroups: [
    group({
      id: 'tam', name: 'Tamaño', required: true, minSelections: 1, maxSelections: 1,
      modifiers: [{ id: 'chico', name: 'Chico', price: 0 }, { id: 'mediano', name: 'Mediano', price: 15 }, { id: 'grande', name: 'Grande', price: 30 }],
    }),
    group({
      id: 'ader', name: 'Aderezos', allowMultiple: true,
      modifiers: [{ id: 'ranch', name: 'Ranch', price: 10 }, { id: 'bbq', name: 'BBQ', price: 12.5 }],
    }),
  ],
})
const tortillas = (): MenuModifierGroup => group({
  id: 'g2', name: 'Tortillas', required: true, allowMultiple: true, minSelections: 2, maxSelections: null,
  modifiers: [{ id: 'm9', name: 'Maíz', price: 0 }],
})
function open(p: MenuProduct, info = infoOf()) {
  const s = makeStore(info, menuOf(p))
  s.productId.value = p.id
  render(withStore(s, <MenuScreen />))
  return s
}
const addBtn = () => screen.getByRole('button', { name: /^Agregar/ }) as HTMLButtonElement
const btn = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement
const box = (name: RegExp | string) => screen.getByLabelText(name) as HTMLInputElement
const groupOf = (name: string) => screen.getByRole('heading', { name }).closest('.avq-o-group') as HTMLElement
const close = () => fireEvent.click(btn('Cerrar y volver a la carta'))
// En su tope, el botón de un stepper NO se deshabilita (el foco se perdería): queda aria-disabled e ignora el toque.
const capped = (b: HTMLButtonElement) => b.getAttribute('aria-disabled') === 'true' && !b.disabled

describe('ficha del producto', () => {
  it('grupo obligatorio sin elegir deshabilita Agregar; al elegir se habilita', () => {
    open(withSalsa())
    expect(addBtn().disabled).toBe(true)
    fireEvent.click(box('Verde'))
    expect(addBtn().disabled).toBe(false)
    expect(addBtn().textContent).toBe('Agregar $85')
  })
  it('modificador de 12.5 se ve +$12.50 y suma al botón; sin llaves crudas', () => {
    open(withSalsa())
    expect(screen.getByText('+$12.50')).toBeTruthy()
    expect(screen.getByText(/Obligatorio/)).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/modifiers\.|sheet\.|menu\./)
    fireEvent.click(box(/Queso extra/))
    expect(addBtn().textContent).toBe('Agregar $97.50')
  })
  it('agregar guarda el renglón, cierra la ficha y actualiza CartBar', () => {
    const s = open(withSalsa())
    fireEvent.click(box(/Queso extra/))
    fireEvent.click(btn('Más'))
    fireEvent.input(screen.getByLabelText('Indicaciones para la cocina'), { target: { value: 'sin cebolla' } })
    fireEvent.click(addBtn())
    expect(s.productId.value).toBeNull()
    expect(s.cart.value).toHaveLength(1)
    expect(s.cart.value[0]).toMatchObject({ productId: 'p1', quantity: 2, note: 'sin cebolla', modifiers: [{ modifierId: 'm2', name: 'Queso extra', price: 12.5, quantity: 1 }] })
    expect(screen.getByRole('button', { name: 'Ver pedido: 2 productos, $195' })).toBeTruthy()
  })
  it('cantidad entre 1 y 20, nota con maxlength 300 y su ejemplo', () => {
    open(product())
    expect(capped(btn('Menos'))).toBe(true)
    for (let i = 0; i < 25; i++) fireEvent.click(btn('Más'))
    expect(capped(btn('Más'))).toBe(true)
    expect(addBtn().textContent).toBe('Agregar $1,700')
    const note = screen.getByLabelText('Indicaciones para la cocina') as HTMLTextAreaElement
    expect(note.maxLength).toBe(300)
    expect(note.placeholder).toBe('Ejemplo: sin cebolla')
  })
  it('si el carrito topa en 20 avisa «Máximo 20 por producto»', () => {
    const s = makeStore(infoOf(), menuOf(product()))
    s.cart.value = [{ lineId: 'l', productId: 'p1', name: 'F', unitPrice: 85, quantity: 19, modifiers: [], note: null }]
    s.productId.value = 'p1'
    render(withStore(s, <MenuScreen />))
    fireEvent.click(btn('Más'))
    fireEvent.click(addBtn())
    expect(s.cart.value[0].quantity).toBe(20)
    expect(s.notice.value).toBe('Máximo 20 por producto')
  })
  it('con 50 renglones distintos Agregar queda deshabilitado con su explicación', () => {
    const s = makeStore(infoOf(), menuOf(product()))
    s.cart.value = Array.from({ length: 50 }, (_, i) => ({ lineId: `l${i}`, productId: `x${i}`, name: 'X', unitPrice: 1, quantity: 1, modifiers: [], note: null }))
    s.productId.value = 'p1'
    render(withStore(s, <MenuScreen />))
    expect(addBtn().disabled).toBe(true)
    expect(screen.getByText('Tu pedido llegó al máximo de 50 productos distintos')).toBeTruthy()
  })
  it('con la tienda cerrada no se puede agregar aunque la ficha esté abierta', () => {
    open(product(), infoOf({ status: 'CLOSED' }))
    expect(addBtn().disabled).toBe(true)
  })
  it('Agotado: el botón dice «Agotado» y está deshabilitado', () => {
    open(product({ soldOut: true }))
    expect(btn('Agotado').disabled).toBe(true)
    expect(screen.queryByRole('button', { name: /^Agregar/ })).toBeNull()
  })
  it('W4: grupo de varias con mínimo 2 y sin máximo, con una sola opción: se piden 2 de esa opción (tope 20 por opción)', () => {
    const s = open(product({ modifierGroups: [tortillas()] }))
    fireEvent.click(screen.getByRole('checkbox'))
    expect(addBtn().disabled).toBe(true)
    fireEvent.click(btn('Más Maíz'))
    expect(addBtn().disabled).toBe(false)
    for (let i = 0; i < 25; i++) fireEvent.click(btn('Más Maíz'))
    expect(capped(btn('Más Maíz'))).toBe(true)
    fireEvent.click(addBtn())
    expect(s.cart.value[0].modifiers).toEqual([{ modifierId: 'm9', name: 'Maíz', price: 0, quantity: 20 }])
  })
  it('M5: la cantidad de una opción es siempre entera: sin campo de número, el stepper sube y baja de a 1', () => {
    const s = open(product({ modifierGroups: [tortillas()] }))
    fireEvent.click(screen.getByRole('checkbox'))
    expect(screen.queryByRole('spinbutton')).toBeNull()
    fireEvent.click(btn('Más Maíz'))
    fireEvent.click(btn('Más Maíz'))
    fireEvent.click(btn('Menos Maíz'))
    fireEvent.click(addBtn())
    expect(s.cart.value[0].modifiers[0].quantity).toBe(2)
  })
  it('Cerrar regresa a la carta', () => {
    const s = open(product())
    close()
    expect(s.productId.value).toBeNull()
  })
})

describe('ficha con grupos de opciones (maqueta Producto)', () => {
  it('grupo obligatorio sin elegir: pastilla «Obligatorio», botón deshabilitado y «Elige Tamaño» arriba del pie', () => {
    open(burger())
    expect(within(groupOf('Tamaño')).getByText('Elige 1')).toBeTruthy()
    expect(within(groupOf('Tamaño')).getByText('Obligatorio').className).toContain('avq-o-pill--required')
    expect(within(groupOf('Aderezos')).getByText('Elige los que quieras')).toBeTruthy()
    expect(within(groupOf('Aderezos')).getByText('Opcional')).toBeTruthy()
    expect(addBtn().disabled).toBe(true)
    const foot = addBtn().closest('.avq-o-sheet__foot') as HTMLElement
    const missing = within(foot).getByText('Elige Tamaño')
    // Arriba del pie: el aviso va antes que el botón, dentro del mismo pie pegado abajo.
    expect(missing.compareDocumentPosition(addBtn()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
  it('al elegir: pastilla «Listo», el total del botón suma el sobreprecio (129 + 15 = $144)', () => {
    open(burger())
    expect(addBtn().textContent).toBe('Agregar $129')
    fireEvent.click(box(/Mediano/))
    const done = within(groupOf('Tamaño')).getByText('Listo')
    expect(done.className).toContain('avq-o-pill--done')
    expect(within(groupOf('Tamaño')).queryByText('Obligatorio')).toBeNull()
    expect(addBtn().disabled).toBe(false)
    expect(addBtn().textContent).toBe('Agregar $144')
    expect(screen.queryByText('Elige Tamaño')).toBeNull()
  })
  it('grupo de una opción: radios; tocar la elegida la quita (igual que reservas)', () => {
    open(burger())
    const radios = within(screen.getByRole('radiogroup', { name: 'Tamaño' })).getAllByRole('radio') as HTMLInputElement[]
    expect(radios.map(r => r.checked)).toEqual([false, false, false])
    fireEvent.click(box(/Mediano/))
    fireEvent.click(box(/Grande/))
    expect(radios.map(r => r.checked)).toEqual([false, false, true])
    expect(addBtn().textContent).toBe('Agregar $159')
    fireEvent.click(box(/Grande/))
    expect(radios.map(r => r.checked)).toEqual([false, false, false])
    expect(addBtn().disabled).toBe(true)
    expect(within(groupOf('Tamaño')).getByText('Obligatorio')).toBeTruthy()
    // Las de varias son casillas, sin cantidad mientras no se marquen.
    expect(within(groupOf('Aderezos')).getAllByRole('checkbox')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'Más Ranch' })).toBeNull()
  })
  it('varias con cantidad: al marcar aparece el stepper; no pasa de min(maxSelections, 20)', () => {
    open(product({
      modifierGroups: [group({
        id: 'sal', name: 'Salsas', allowMultiple: true, maxSelections: 3,
        modifiers: [{ id: 'v', name: 'Verde', price: 5 }, { id: 'r', name: 'Roja', price: 0 }],
      })],
    }))
    expect(within(groupOf('Salsas')).getByText('Elige hasta 3')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Más Verde' })).toBeNull()
    expect(screen.getByText('+$5')).toBeTruthy()
    fireEvent.click(box(/Verde/))
    const count = () => btn('Más Verde').parentElement!.textContent
    expect(count()).toBe('1')
    // El «−» no baja de 1: para quitarla se desmarca. El sobreprecio sigue a la vista (pasa debajo del nombre).
    expect(capped(btn('Menos Verde'))).toBe(true)
    expect(screen.getByText('+$5')).toBeTruthy()
    fireEvent.click(btn('Más Verde'))
    fireEvent.click(btn('Más Verde'))
    expect(count()).toBe('3')
    expect(capped(btn('Más Verde'))).toBe(true)
    expect(addBtn().textContent).toBe('Agregar $100')
    // Con el grupo lleno, otra casilla no se marca (ni la marca el navegador): la selección no cambió.
    fireEvent.click(box('Roja'))
    expect(box('Roja').checked).toBe(false)
    expect(count()).toBe('3')
    fireEvent.click(btn('Menos Verde'))
    fireEvent.click(box('Roja'))
    expect(box('Roja').checked).toBe(true)
    expect(capped(btn('Más Verde'))).toBe(true) // 2 + 1 = 3, el máximo del grupo
  })
  it('la ayuda de cada grupo dice cuántas: «Elige al menos 2», y en inglés «Choose 1», «Required» y «Optional»', () => {
    open(product({ modifierGroups: [tortillas()] }))
    expect(within(groupOf('Tortillas')).getByText('Elige al menos 2')).toBeTruthy()
    cleanup()
    const s = makeStore(infoOf(), menuOf(burger()), 'en')
    s.productId.value = 'p1'
    render(withStore(s, <MenuScreen />))
    expect(within(groupOf('Tamaño')).getByText('Choose 1')).toBeTruthy()
    expect(within(groupOf('Tamaño')).getByText('Required')).toBeTruthy()
    expect(within(groupOf('Aderezos')).getByText('Optional')).toBeTruthy()
    expect(screen.getByText('Choose Tamaño')).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Add \$129$/ })).toBeTruthy()
  })
  it('doble toque en «Agregar» agrega UNA vez (el carrito tiene 1 renglón con la cantidad elegida)', () => {
    const s = open(product())
    fireEvent.click(btn('Más'))
    const add = addBtn()
    fireEvent.click(add)
    fireEvent.click(add)
    expect(s.cart.value).toHaveLength(1)
    expect(s.cart.value[0].quantity).toBe(2)
  })
  it('tope de 30 opciones sumando grupos: 30 permite agregar; 31 deshabilita con «Máximo 30 opciones por platillo»', () => {
    // Dos grupos de varias sin máximo: 20 de una opción (su tope) + 10 de otra = 30; una más = 31.
    open(product({
      modifierGroups: [
        group({ id: 'a', name: 'Salsas', allowMultiple: true, modifiers: [{ id: 'v', name: 'Verde', price: 0 }] }),
        group({ id: 'b', name: 'Extras', allowMultiple: true, modifiers: [{ id: 'q', name: 'Queso', price: 0 }] }),
      ],
    }))
    fireEvent.click(box('Verde'))
    for (let i = 0; i < 19; i++) fireEvent.click(btn('Más Verde'))
    expect(capped(btn('Más Verde'))).toBe(true)
    fireEvent.click(box('Queso'))
    for (let i = 0; i < 9; i++) fireEvent.click(btn('Más Queso'))
    expect(addBtn().disabled).toBe(false)
    expect(screen.queryByText('Máximo 30 opciones por platillo')).toBeNull()
    fireEvent.click(btn('Más Queso'))
    expect(addBtn().disabled).toBe(true)
    expect(screen.getByText('Máximo 30 opciones por platillo')).toBeTruthy()
  })
  it('es una vista DENTRO de la tienda: sin position fixed, sin hijos nuevos en document.body y sin tocar body.style ni inert', () => {
    const s = makeStore(infoOf(), menuOf(product({ imageUrl: 'https://x/foto.jpg' })))
    const { container } = render(withStore(s, <OrderApp />))
    const kids = document.body.children.length
    const styles = [document.body.getAttribute('style'), document.documentElement.getAttribute('style')]
    fireEvent.click(btn('Agregar Flautas de pollo'))
    const sheet = screen.getByRole('region', { name: 'Flautas de pollo' })
    expect(document.body.children.length).toBe(kids)
    expect([document.body.getAttribute('style'), document.documentElement.getAttribute('style')]).toEqual(styles)
    expect(document.querySelectorAll('[inert]')).toHaveLength(0)
    expect(document.querySelector('[aria-modal]')).toBeNull()
    expect(sheet.closest('.avq-o-root')).toBe(container.firstElementChild)
    expect(STORE_CSS).not.toMatch(/position:\s*fixed/)
    for (const el of [sheet, ...Array.from(sheet.querySelectorAll('*'))]) expect(getComputedStyle(el).position).not.toBe('fixed')
    // El pie (cantidad y «Agregar») va pegado abajo DENTRO del componente.
    const foot = addBtn().closest('.avq-o-sheet__foot') as HTMLElement
    expect(sheet.contains(foot)).toBe(true)
    expect(getComputedStyle(foot).position).toBe('sticky')
    expect(getComputedStyle(foot).bottom).toMatch(/^0(px)?$/)
    // Con la ficha abierta, la carta no deja su relleno de abajo: el pie descansa en el borde real de la tienda.
    expect(sheet.closest('.avq-o-menu')!.classList.contains('avq-o-menu--sheet')).toBe(true)
    expect(STORE_CSS).toMatch(/\.avq-o-menu--sheet\{padding-bottom:0\}/)
    // La foto arriba, con la X encima.
    const photo = sheet.querySelector('img') as HTMLImageElement
    expect(photo.getAttribute('src')).toBe('https://x/foto.jpg')
    expect(photo.getAttribute('alt')).toBe('')
  })
  it('una foto que no carga se quita sin dejar hueco y la X sigue para volver', () => {
    open(product({ imageUrl: 'https://x/rota.jpg' }))
    const sheet = screen.getByRole('region', { name: 'Flautas de pollo' })
    expect(sheet.classList.contains('avq-o-sheet--media')).toBe(true)
    fireEvent.error(sheet.querySelector('img')!)
    expect(sheet.querySelector('img')).toBeNull()
    expect(sheet.classList.contains('avq-o-sheet--media')).toBe(false)
    expect(btn('Cerrar y volver a la carta')).toBeTruthy()
  })
  it('nombres de 120 caracteres sin espacios (producto, grupo y opción) envuelven: nada se desborda a lo ancho', () => {
    const long = 'Á'.repeat(118) + '🌮🌮'
    const s = makeStore(infoOf(), menuOf(product({
      name: long,
      modifierGroups: [group({ id: 'g', name: long, required: true, minSelections: 1, maxSelections: 1, modifiers: [{ id: 'm', name: long, price: 15 }] })],
    })))
    s.productId.value = 'p1'
    const { container } = render(withStore(s, <OrderApp />))
    const css = (sel: string) => getComputedStyle(container.querySelector(sel)!)
    for (const sel of ['.avq-o-sheet__title', '.avq-o-group__title', '.avq-o-opt__text', '.avq-o-sheet__msg']) expect(css(sel).overflowWrap, sel).toBe('anywhere')
    for (const sel of ['.avq-o-group__names', '.avq-o-opt__main', '.avq-o-opt__text']) expect(css(sel).minWidth, sel).toMatch(/^0(px)?$/)
    // La pastilla no se parte y el sobreprecio sigue a la vista junto al texto largo.
    expect(css('.avq-o-pill').whiteSpace).toBe('nowrap')
    expect(screen.getByText('+$15')).toBeTruthy()
    expect(screen.getByText(`Elige ${long}`)).toBeTruthy()
  })
  it('Escape mientras se compone texto (teclado IME: isComposing o keyCode 229) no cierra la ficha ni pierde la nota; sin componer, sí cierra', () => {
    const s = open(product())
    const note = screen.getByLabelText('Indicaciones para la cocina')
    fireEvent.input(note, { target: { value: 'sin' } })
    fireEvent.keyDown(note, { key: 'Escape', isComposing: true })
    expect(s.productId.value).toBe('p1')
    fireEvent.keyDown(note, { key: 'Escape', keyCode: 229 })
    expect(s.productId.value).toBe('p1')
    expect((note as HTMLTextAreaElement).value).toBe('sin')
    fireEvent.keyDown(note, { key: 'Escape' })
    expect(s.productId.value).toBeNull()
  })
  it('cuando el mínimo y el máximo son iguales (más de 1), la ayuda dice «Elige 2» («Choose 2»)', () => {
    const pair = () => product({
      modifierGroups: [group({
        id: 'dos', name: 'Salsas', required: true, allowMultiple: true, minSelections: 2, maxSelections: 2,
        modifiers: [{ id: 'v', name: 'Verde', price: 0 }, { id: 'r', name: 'Roja', price: 0 }],
      })],
    })
    open(pair())
    expect(within(groupOf('Salsas')).getByText('Elige 2')).toBeTruthy()
    cleanup()
    const s = makeStore(infoOf(), menuOf(pair()), 'en')
    s.productId.value = 'p1'
    render(withStore(s, <MenuScreen />))
    expect(within(groupOf('Salsas')).getByText('Choose 2')).toBeTruthy()
  })
  it('la pastilla («Obligatorio» → «Listo», u «Opcional») es parte de la descripción de las opciones (aria-describedby)', () => {
    open(burger())
    const desc = (el: HTMLElement) => el.getAttribute('aria-describedby')!.split(/\s+/).map(id => document.getElementById(id)!.textContent).join(' ')
    const tam = screen.getByRole('radiogroup', { name: 'Tamaño' })
    expect(desc(tam)).toBe('Elige 1 Obligatorio')
    fireEvent.click(box(/Mediano/))
    expect(desc(tam)).toBe('Elige 1 Listo')
    expect(desc(screen.getByRole('group', { name: 'Aderezos' }))).toBe('Elige los que quieras Opcional')
  })
  it('con el teclado, al llegar al tope el foco se queda en el botón y otro toque no cambia nada (pie y opción)', () => {
    open(product({
      modifierGroups: [group({ id: 'sal', name: 'Salsas', allowMultiple: true, maxSelections: 2, modifiers: [{ id: 'v', name: 'Verde', price: 0 }] })],
    }))
    // Enter o Espacio sobre un botón con foco = su click. Un botón `disabled` perdería el foco al llegar al tope.
    const more = btn('Más')
    more.focus()
    for (let i = 0; i < 19; i++) fireEvent.click(more)
    expect(capped(more)).toBe(true)
    expect(document.activeElement).toBe(more)
    fireEvent.click(more)
    expect(addBtn().textContent).toBe('Agregar $1,700')
    const less = btn('Menos')
    less.focus()
    for (let i = 0; i < 25; i++) fireEvent.click(less)
    expect(capped(less)).toBe(true)
    expect(document.activeElement).toBe(less)
    expect(addBtn().textContent).toBe('Agregar $85')
    // El de una opción: el grupo admite 2.
    fireEvent.click(box('Verde'))
    const moreV = btn('Más Verde')
    moreV.focus()
    fireEvent.click(moreV)
    expect(capped(moreV)).toBe(true)
    expect(document.activeElement).toBe(moreV)
    fireEvent.click(moreV)
    expect(moreV.parentElement!.textContent).toBe('2')
    expect(STORE_CSS).toMatch(/\.avq-o-stepper button\[aria-disabled=true\]/)
  })
  it('Escape sigue cerrando después de tocar la descripción: la sección toma el foco (tabindex -1, sin contorno propio)', () => {
    const s = open(product())
    const sheet = screen.getByRole('region', { name: 'Flautas de pollo' })
    // Tocar algo que no recibe foco lleva el foco al ancestro enfocable más cercano (así lo hace el navegador): la sección.
    const host = screen.getByText('Con crema').closest('[tabindex]') as HTMLElement | null
    expect(host).toBe(sheet)
    expect(sheet.getAttribute('tabindex')).toBe('-1')
    sheet.focus()
    fireEvent.keyDown(sheet, { key: 'Escape' })
    expect(s.productId.value).toBeNull()
    expect(STORE_CSS).toMatch(/\.avq-o-root \.avq-o-sheet:focus\{outline:none\}/)
  })
  it('el acento llega a «Agregar» (var(--avq-accent) dentro de la raíz de OrderApp)', () => {
    const s = makeStore(infoOf({ brand: { logo: null, logoFull: null, primaryColor: '#14532D', secondaryColor: null } }), menuOf(burger()))
    s.productId.value = 'p1'
    const { container } = render(withStore(s, <OrderApp />))
    const add = addBtn()
    expect(add.classList.contains('avq-o-btn--primary')).toBe(true)
    const root = add.closest('.avq-o-root') as HTMLElement
    expect(root).toBe(container.firstElementChild)
    expect(root.style.getPropertyValue('--avq-accent')).toBe('#14532D')
    expect(STORE_CSS).toMatch(/\.avq-o-btn--primary\{background:var\(--avq-accent/)
    // La selección (radio y casilla) también lleva el acento.
    expect(STORE_CSS).toMatch(/\.avq-o-opt__input\[type=radio\]:checked\{[^}]*var\(--avq-accent/)
    expect(STORE_CSS).toMatch(/\.avq-o-opt__input\[type=checkbox\]:checked\{[^}]*var\(--avq-accent/)
  })
  it('con carrito y ficha abierta NO se pinta la barra «Ver pedido»; al cerrar vuelve', () => {
    const s = makeStore(infoOf(), menuOf(product()))
    s.cart.value = [{ lineId: 'l', productId: 'p1', name: 'Flautas', unitPrice: 85, quantity: 2, modifiers: [], note: null }]
    render(withStore(s, <MenuScreen />))
    expect(screen.getByRole('button', { name: /^Ver pedido/ })).toBeTruthy()
    fireEvent.click(btn('Agregar Flautas de pollo'))
    expect(screen.queryByRole('button', { name: /^Ver pedido/ })).toBeNull()
    close()
    expect(screen.getByRole('button', { name: /^Ver pedido/ })).toBeTruthy()
  })
})
