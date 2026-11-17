import { h } from 'preact'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api/booking'
import { venueInfo, isLoading } from '../state/booking'
import { PortalApp } from './PortalApp'

vi.mock('../api/booking', async importOriginal => ({ ...(await importOriginal<typeof import('../api/booking')>()), getVenueInfo: vi.fn() }))
// El portal adentro no es lo que se mide: basta saber que se pintó.
vi.mock('./CustomerPortal', () => ({ CustomerPortal: () => <p>portal listo</p> }))

const flushAll = () => act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve() })
const MUCHA_GENTE = 'Hay mucha gente entrando en este momento. Espera unos segundos y vuelve a intentar.'

beforeEach(() => {
  venueInfo.value = null
  isLoading.value = false
})
afterEach(() => cleanup())

// D10 (16-nov, Codex r13 #2 de asistencia verificada): si leer el negocio fallaba, el portal se quedaba girando para siempre (el
// error se tragaba). Con el tope de lecturas por red (WiFi del estudio), eso le pasaba a la alumna 21 del minuto.
describe('PortalApp: el negocio no se pudo leer', () => {
  it('429 ⇒ «Hay mucha gente entrando…» con Reintentar (no gira para siempre); al reintentar, abre', async () => {
    vi.mocked(api.getVenueInfo)
      .mockRejectedValueOnce(Object.assign(new Error('Too many requests'), { status: 429, data: {} }))
      .mockResolvedValueOnce({ slug: 'mindform', name: 'Mindform', timezone: 'America/Mexico_City' } as any)
    render(<PortalApp venue="mindform" locale="es" theme="light" />)
    await flushAll()
    expect(screen.getByText(MUCHA_GENTE)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Intentar de Nuevo' }))
    await flushAll()
    expect(api.getVenueInfo).toHaveBeenCalledTimes(2)
    expect(screen.getByText('portal listo')).toBeTruthy()
  })

  it('sin red ⇒ «Sin conexión…»; otro error ⇒ el genérico. Los dos con Reintentar', async () => {
    vi.mocked(api.getVenueInfo).mockRejectedValueOnce(new TypeError('Failed to fetch'))
    render(<PortalApp venue="mindform" locale="es" theme="light" />)
    await flushAll()
    expect(screen.getByText('Sin conexión. Revisa tu internet y vuelve a intentar.')).toBeTruthy()
    cleanup()
    vi.mocked(api.getVenueInfo).mockRejectedValueOnce(Object.assign(new Error('boom'), { status: 500, data: {} }))
    render(<PortalApp venue="mindform" locale="es" theme="light" />)
    await flushAll()
    expect(screen.getByText('Algo salió mal. Por favor intenta de nuevo.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Intentar de Nuevo' })).toBeTruthy()
  })
})
