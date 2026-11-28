import { h } from 'preact'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createT } from '../i18n'
import { EntrarModal, contextoDeLaClase } from './EntrarModal'

// «Entra a tu cuenta» de verdad pide un código o Google; aquí sólo importa qué recibe y que avisa al entrar.
vi.mock('./EntrarConCuenta', async () => {
  const { h: hh } = await import('preact')
  return {
    EntrarConCuenta: (p: { onEntro: (s: unknown) => void }) => (((globalThis as any).__entrarProps = p), hh('div', null,
      hh('button', { type: 'button' }, 'Seguir con WhatsApp'),
      hh('button', { type: 'button', onClick: () => p.onEntro({ token: 'tok-ana' }) }, 'Simular entrar'),
    )),
  }
})

const t = createT('es')
function pintar(extra: Record<string, unknown> = {}) {
  const onEntro = vi.fn()
  const onClose = vi.fn()
  render(
    <EntrarModal slug="studio-a" negocio="Un estudio" contexto="Lagree · jueves 26 · 18:15" onEntro={onEntro} onClose={onClose} t={t}
      {...extra} />,
  )
  return { onEntro, onClose, dialogo: screen.getByRole('dialog', { name: 'Entra para reservar' }) }
}
const css = () => Array.from(document.querySelectorAll('style')).map(s => s.textContent ?? '').join('\n')

afterEach(() => {
  cleanup()
  delete (globalThis as any).__entrarProps
})

describe('EntrarModal: entrar sin salir de la clase', () => {
  it('«Entra para reservar» con la clase de contexto, y dentro la entrada de siempre (sin repetir su título)', () => {
    const { dialogo, onEntro } = pintar()
    expect(dialogo.getAttribute('aria-modal')).toBe('true')
    expect(within(dialogo).getByRole('heading', { name: 'Entra para reservar' })).toBeTruthy()
    expect(within(dialogo).getByText('Lagree · jueves 26 · 18:15')).toBeTruthy()
    const p = (globalThis as any).__entrarProps
    expect(p).toMatchObject({ slug: 'studio-a', negocio: 'Un estudio', sinTituloAlInicio: true })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Simular entrar' }))
    expect(onEntro).toHaveBeenCalledWith({ token: 'tok-ana' })
  })

  it('un aviso (su sesión se cerró) va dentro, en ámbar y sin rojo', () => {
    const { dialogo } = pintar({ aviso: 'Tu sesión se cerró. Entra otra vez.' })
    const aviso = within(dialogo).getByRole('status')
    expect(aviso.textContent).toBe('Tu sesión se cerró. Entra otra vez.')
    expect(aviso.className).toContain('avq-entrar-aviso')
    expect(css()).toMatch(/\.avq-entrar-aviso\s*\{[^}]*var\(--avq-warning-fg/)
  })

  it('Escape, el fondo y «Cerrar» la cierran; un toque dentro no', () => {
    const { dialogo, onClose } = pintar()
    fireEvent.click(dialogo)
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(dialogo.parentElement!)
    expect(onClose).toHaveBeenCalledTimes(2)
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Cerrar' }))
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('el foco entra a la ventanita y Tab no sale de ella', () => {
    const { dialogo } = pintar()
    const botones = within(dialogo).getAllByRole('button')
    const primero = botones[0]
    const ultimo = botones[botones.length - 1]
    expect(document.activeElement).toBe(primero)
    ultimo.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(primero)
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(ultimo)
  })

  it('celular (≤ 640 px): sube desde abajo, con su asa, y botones y campos de 56 px', () => {
    const { dialogo } = pintar()
    expect(dialogo.querySelector('.avq-entrar-asa')).not.toBeNull()
    const celular = css().match(/@media \(max-width: 640px\)\s*\{([\s\S]*)\}/)?.[1] ?? ''
    expect(celular).toMatch(/\.avq-entrar-velo\s*\{[^}]*align-items:\s*flex-end/)
    expect(celular).toMatch(/\.avq-entrar-hoja\s*\{[^}]*border-radius:\s*28px 28px 0 0/)
    expect(celular).toMatch(/\.avq-entrar-hoja\s*\{[^}]*--avq-btn-alto:\s*56px/)
    expect(celular).toMatch(/\.avq-entrar-hoja\s*\{[^}]*--avq-campo-alto:\s*56px/)
    expect(celular).toMatch(/\.avq-entrar-asa\s*\{[^}]*display:\s*block/)
  })
})

describe('contextoDeLaClase', () => {
  it('«Lagree · jueves 26 · 18:15» en la zona que se enseña; en inglés con su hora', () => {
    // Jueves 26 de noviembre de 2026, 18:15 en CDMX (UTC−6).
    expect(contextoDeLaClase('Lagree', '2026-11-27T00:15:00Z', 'America/Mexico_City', 'es')).toBe('Lagree · jueves 26 · 18:15')
    expect(contextoDeLaClase('Lagree', '2026-11-27T00:15:00Z', 'America/Mexico_City', 'en')).toBe('Lagree · Thursday 26 · 6:15 PM')
    // La misma hora vista desde otra zona cambia el día.
    expect(contextoDeLaClase('Lagree', '2026-11-27T00:15:00Z', 'UTC', 'es')).toBe('Lagree · viernes 27 · 00:15')
  })

  it('una zona que no se lee no rompe la ventanita: queda sólo la clase', () => {
    expect(contextoDeLaClase('Lagree', '2026-11-27T00:15:00Z', 'Zona/Inventada', 'es')).toBe('Lagree')
  })
})
