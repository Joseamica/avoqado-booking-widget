import { h } from 'preact'
import { act, cleanup, fireEvent, render } from '@testing-library/preact'
import { afterEach, describe, expect, it } from 'vitest'
import { VenueMark, logoOf } from './VenueMark'
import { infoOf, makeStore, withStore } from './testKit'

afterEach(cleanup)

const venue = (name: string | null) => ({ slug: 'a', name, timezone: 'America/Mexico_City', currency: 'MXN' })
const brand = (logo: string | null, logoFull: string | null = null) => ({ logo, logoFull, primaryColor: null, secondaryColor: null })
const storeOf = (name: string | null, logo: string | null, logoFull: string | null = null) =>
  makeStore(infoOf({ venue: venue(name), brand: brand(logo, logoFull) }), null)

describe('VenueMark: el logo del restaurante o, sin él, sus iniciales', () => {
  it('con logo es la imagen (sin texto alternativo) en el círculo; el logo ancho sirve si no hay el cuadrado', () => {
    const a = render(withStore(storeOf('Avoqado Full', 'https://x/logo.png', 'https://x/ancho.png'), <VenueMark />))
    const img = a.container.querySelector('.avq-o-mark img') as HTMLImageElement
    expect(img.getAttribute('src')).toBe('https://x/logo.png')
    expect(img.getAttribute('alt')).toBe('')
    expect(a.container.querySelector('.avq-o-mark')!.getAttribute('aria-hidden')).toBeNull()
    cleanup()
    const b = render(withStore(storeOf('Avoqado Full', null, 'https://x/ancho.png'), <VenueMark />))
    expect(b.container.querySelector('img')!.getAttribute('src')).toBe('https://x/ancho.png')
    expect(logoOf(infoOf({ brand: brand(null, null) }))).toBeNull()
    expect(logoOf(null)).toBeNull()
  })

  it('sin logo son las iniciales, sin voz (el nombre ya va al lado); `small` es el círculo chico', () => {
    const { container } = render(withStore(storeOf('Avoqado Full', null), <VenueMark small />))
    const mark = container.querySelector('.avq-o-mark') as HTMLElement
    expect(mark.textContent).toBe('AF')
    expect(mark.getAttribute('aria-hidden')).toBe('true')
    expect(mark.classList.contains('avq-o-mark--sm')).toBe(true)
    expect(container.querySelector('img')).toBeNull()
  })

  it('sin logo y sin letras en el nombre no pinta nada (ni un círculo vacío)', () => {
    expect(render(withStore(storeOf(null, null), <VenueMark />)).container.querySelector('.avq-o-mark')).toBeNull()
    cleanup()
    expect(render(withStore(storeOf('&', null), <VenueMark />)).container.querySelector('.avq-o-mark')).toBeNull()
  })

  it('si la imagen falla cae a las iniciales; la liga rota se recuerda en TODA la tienda y una liga nueva se intenta de nuevo', async () => {
    const s = storeOf('Avoqado Full', 'https://x/logo.png')
    const first = render(withStore(s, <VenueMark />))
    fireEvent.error(first.container.querySelector('img')!)
    expect(first.container.querySelector('img')).toBeNull()
    expect(first.container.querySelector('.avq-o-mark')!.textContent).toBe('AF')
    first.unmount()
    // Otra marca de la MISMA tienda (otra pantalla) nace ya con las iniciales: no vuelve a pedir ni a parpadear la imagen rota.
    const second = render(withStore(s, <VenueMark small />))
    expect(second.container.querySelector('img')).toBeNull()
    expect(second.container.querySelector('.avq-o-mark--sm')!.textContent).toBe('AF')
    // Lo que se recuerda es la LIGA que falló: con otra (otro /info), se intenta de nuevo.
    await act(async () => { s.info.value = infoOf({ venue: venue('Avoqado Full'), brand: brand('https://x/otro.png') }) })
    expect(second.container.querySelector('img')!.getAttribute('src')).toBe('https://x/otro.png')
  })

  it('dos tiendas no comparten el recuerdo del logo roto', () => {
    const a = storeOf('Avoqado Full', 'https://x/logo.png')
    const b = storeOf('Avoqado Full', 'https://x/logo.png')
    const first = render(withStore(a, <VenueMark />))
    fireEvent.error(first.container.querySelector('img')!)
    first.unmount()
    const other = render(withStore(b, <VenueMark />))
    expect(other.container.querySelector('img')!.getAttribute('src')).toBe('https://x/logo.png')
  })
})
