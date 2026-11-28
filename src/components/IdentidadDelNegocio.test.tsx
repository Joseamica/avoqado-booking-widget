import { h } from 'preact'
import { cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IdentidadDelNegocio } from './IdentidadDelNegocio'
import { createT } from '../i18n'
import type { PublicVenueInfo } from '../types'

afterEach(cleanup)

const estudio = {
  slug: 'un-estudio', name: 'Un Estudio', type: 'FITNESS', logo: null, address: 'Calle Uno 10, Centro', phone: null,
  timezone: 'America/Mexico_City', primaryColor: '#3b2a4a', products: [],
  publicBooking: { enabled: true, requireEmail: false, requirePhone: true },
} as PublicVenueInfo

const pintar = (info: Partial<PublicVenueInfo> = {}, puedeEscribir = true) =>
  render(<IdentidadDelNegocio info={{ ...estudio, ...info }} puedeEscribir={puedeEscribir} t={createT('es')} />)

const portada = () => document.querySelector('.avq-identidad-portada') as HTMLElement

describe('IdentidadDelNegocio: la portada de la página propia (diseño 27-nov)', () => {
  it('enseña el nombre y la dirección', () => {
    pintar()
    expect(screen.getByRole('heading', { name: 'Un Estudio' })).toBeTruthy()
    expect(screen.getByText('Calle Uno 10, Centro')).toBeTruthy()
  })

  it('sin dirección no deja un renglón vacío', () => {
    pintar({ address: null })
    expect(document.querySelector('.avq-identidad-dir')).toBeNull()
  })

  it('«Escríbenos» abre el chat que ya existe (evento de ventana avoqado:open-chat)', () => {
    const abrir = vi.fn()
    window.addEventListener('avoqado:open-chat', abrir)
    try {
      pintar()
      fireEvent.click(screen.getByRole('button', { name: 'Escríbenos' }))
      expect(abrir).toHaveBeenCalledTimes(1)
    } finally {
      window.removeEventListener('avoqado:open-chat', abrir)
    }
  })

  it('si el negocio no puede recibir mensajes, no hay «Escríbenos» (nunca un botón que no lleva a nada)', () => {
    pintar({}, false)
    expect(screen.queryByRole('button', { name: 'Escríbenos' })).toBeNull()
  })

  it('sin foto de portada, el bloque lleva el color de la marca (nunca vacío)', () => {
    pintar({ heroImageUrl: null })
    expect(portada().style.backgroundColor).toBe('rgb(59, 42, 74)')
    expect(portada().querySelector('img')).toBeNull()
  })

  it('con foto de portada, la enseña', () => {
    pintar({ heroImageUrl: 'https://img.test/portada.jpg' })
    expect(portada().querySelector('img')?.getAttribute('src')).toBe('https://img.test/portada.jpg')
  })

  it('con logo lo enseña; sin logo, la inicial del negocio', () => {
    const { unmount } = pintar({ logo: 'https://img.test/logo.png' })
    expect(document.querySelector('.avq-identidad-logo img')?.getAttribute('src')).toBe('https://img.test/logo.png')
    unmount()
    pintar({ logo: null })
    expect(document.querySelector('.avq-identidad-logo')?.textContent).toBe('U')
  })
})
