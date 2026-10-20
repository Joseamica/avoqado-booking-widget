// La página hospedada de la tienda (pedidos.avoqado.io/<negocio>) es el script en línea de public/index.html, no Preact:
// esta prueba corre ESE script tal cual en el jsdom de vitest (como paginaTarjeta.test.ts) y revisa `public/_headers`.
import { beforeEach, describe, expect, it } from 'vitest'
import pagina from '../../public/index.html?raw'
import headers from '../../public/_headers?raw'

const script = () => /<script>([\s\S]*?)<\/script>/.exec(pagina)![1]

beforeEach(() => {
  document.title = ''
  document.body.className = ''
  document.body.innerHTML =
    '<header class="topnav" id="topnav" hidden></header><button id="textus-fab"></button><main id="mount"></main><div id="footer"></div>'
  window.history.replaceState({}, '', '/flautas-coyoacan?app=order')
})

describe('página de pedidos (carril de la tienda en index.html)', () => {
  it('W1: el título lleva el nombre real cuando la tienda lo avisa, y la barra de reservas no se ve', () => {
    new Function(script())()
    const el = document.querySelector('avoqado-order')!
    expect(el.getAttribute('venue')).toBe('flautas-coyoacan')
    expect(document.title).toBe('Pedidos en línea · Flautas coyoacan')
    el.dispatchEvent(
      new CustomEvent('avoqado:tienda-cargada', { detail: { slug: 'flautas-coyoacan', name: 'Flautas Coyoacán' }, bubbles: true, composed: true }),
    )
    expect(document.title).toBe('Pedidos en línea · Flautas Coyoacán')
    // `.topnav { display: flex }` gana al atributo `hidden`: sin esto se veía «Reservas» y su menú arriba de la tienda.
    expect(document.getElementById('topnav')!.style.display).toBe('none')
  })
})

describe('página propia de la tienda: de orilla a orilla en el celular y columna de 600 px en computadora', () => {
  const css = /<style>([\s\S]*?)<\/style>/.exec(pagina)![1].replace(/\/\*[\s\S]*?\*\//g, '')
  const rule = (selector: string) => css.match(new RegExp(`${selector.replace(/\./g, '\\.')}\\s*\\{([^}]*)\\}`))?.[1] ?? ''

  it('sólo el carril de la tienda pone body.flow-order; el de reservas no', () => {
    new Function(script())()
    expect(document.body.classList.contains('flow-order')).toBe(true)
    // Reservas: sin `?app=order` en localhost (en producción, book.avoqado.io) no hay carril de pedidos ni su clase.
    document.body.className = ''
    window.history.replaceState({}, '', '/')
    new Function(script())()
    expect(document.querySelector('avoqado-order')).toBeNull()
    expect(document.body.classList.contains('flow-order')).toBe(false)
  })
  it('sus reglas: sin márgenes laterales (sólo el área segura del celular) y una columna de 600 px; ninguna otra regla habla de este carril', () => {
    expect(rule('body.flow-order .page')).toMatch(/^\s*padding:\s*0 env\(safe-area-inset-right, 0px\) 0 env\(safe-area-inset-left, 0px\);?\s*$/)
    expect(rule('body.flow-order .shell')).toMatch(/^\s*max-width:\s*600px;?\s*$/)
    // Las dos cuelgan de `body.flow-order`: sin esa clase (reservas) ninguna regla de la página cambia.
    expect((css.match(/[^{}]*flow-order[^{}]*(?=\{)/g) ?? []).map(r => r.trim())).toEqual(['body.flow-order .page', 'body.flow-order .shell'])
  })
})

describe('página de pedidos en inglés', () => {
  it('M6: con ?locale=en el título dice «Online ordering · …», antes y después de conocer el nombre', () => {
    window.history.replaceState({}, '', '/flautas-coyoacan?app=order&locale=en')
    new Function(script())()
    const el = document.querySelector('avoqado-order')!
    expect(el.getAttribute('locale')).toBe('en')
    expect(document.title).toBe('Online ordering · Flautas coyoacan')
    el.dispatchEvent(new CustomEvent('avoqado:tienda-cargada', { detail: { slug: 'flautas-coyoacan', name: 'Flautas Coyoacán' }, bubbles: true }))
    expect(document.title).toBe('Online ordering · Flautas Coyoacán')
  })
})

describe('public/_headers', () => {
  it('W11: la tienda se deja enmarcar desde los cuatro orígenes del panel; book.avoqado.io no lleva la cabecera', () => {
    const rule = /^https:\/\/pedidos\.avoqado\.io\/\*\n\s+Content-Security-Policy: frame-ancestors (.+)$/m.exec(headers)
    expect(rule).not.toBeNull()
    expect(rule![1].trim().split(/\s+/).sort()).toEqual(
      [
        "'self'",
        'https://dashboard.avoqado.io',
        'https://dashboardv2.avoqado.io',
        'https://demo.dashboard.avoqado.io',
        'https://staging.dashboard.avoqado.io',
      ].sort(),
    )
    expect(headers).not.toMatch(/book\.avoqado\.io/)
  })
})
