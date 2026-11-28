import { act } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

// hz:nube0000:na4160b6 — dos <avoqado-booking> de dos negocios en una página: el segundo no pisa al primero.
const { pendingModule } = vi.hoisted(() => ({
  pendingModule: async (load: () => Promise<any>) =>
    Object.fromEntries(Object.entries(await load()).map(([k, v]) => [k, typeof v === 'function' && !/^[A-Z]/.test(k) ? vi.fn(() => new Promise(() => {})) : v])),
}))
vi.mock('./api/booking', () => pendingModule(() => vi.importActual('./api/booking')))
vi.mock('./api/venueChat', () => pendingModule(() => vi.importActual('./api/venueChat')))
import './widget'

const flush = () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve() })
async function montar(venue: string) {
  const el = document.createElement('avoqado-booking')
  el.setAttribute('venue', venue)
  await act(async () => { document.body.appendChild(el) })
  await flush()
  return el
}
const liga = (el: Element) => el.shadowRoot!.querySelector('a[href^="https://book.avoqado.io/"]') as HTMLAnchorElement | null

afterEach(() => { document.body.innerHTML = '' })

describe('dos widgets de reservas en una página', () => {
  it('el de otro negocio no se monta encima: enseña la liga a SU página', async () => {
    const a = await montar('negocio-a')
    const b = await montar('negocio-b')
    expect(liga(a)).toBeNull()
    expect(liga(b)?.getAttribute('href')).toBe('https://book.avoqado.io/negocio-b')
    expect(b.shadowRoot!.textContent).toContain('Para reservar en este negocio')
  })

  it('dos del MISMO negocio se montan los dos (como hoy)', async () => {
    const a = await montar('negocio-a')
    const b = await montar('negocio-a')
    expect(liga(a)).toBeNull()
    expect(liga(b)).toBeNull()
  })

  it('si se quita el que mandaba, el otro ya se monta', async () => {
    const a = await montar('negocio-a')
    const b = await montar('negocio-b')
    await act(async () => { a.remove() })
    await flush()
    expect(liga(b)).toBeNull()
  })
})
