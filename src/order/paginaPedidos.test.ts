// La página hospedada de la tienda (pedidos.avoqado.io/<negocio>) es el script en línea de public/index.html, no Preact:
// esta prueba corre ESE script tal cual en el jsdom de vitest (como paginaTarjeta.test.ts) y revisa `public/_headers`.
import { beforeEach, describe, expect, it } from 'vitest'
import pagina from '../../public/index.html?raw'
import headers from '../../public/_headers?raw'

const script = () => /<script>([\s\S]*?)<\/script>/.exec(pagina)![1]

beforeEach(() => {
  document.title = ''
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
