import { h } from 'preact'
import { cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import paginaHospedada from '../../public/index.html?raw'
import { ClassDetailView, cubreDe, type CubreLaClase } from './ClassDetailView'
import { branding, DEFAULT_BRANDING } from '../state/booking'
import { createT } from '../i18n'
import type { OpcionDePaquete } from '../lib/eleccionDePaquete'
import type { MiLugarEnLaClase } from './useMisClases'
import type { MiReservaDeClase, Product, PublicClassSessionSlot } from '../types'

// Diseño 27-nov (`pasos-con-aire-v7.html`, paso 1): cuándo · con quién y cuántos lugares · tu paquete y la regla; el botón
// «Reservar», fijo abajo en el celular. Sin «o 1 crédito», sin «Reservar con créditos» y sin política inventada.
const TZ = 'America/Mexico_City'
const t = createT('es')

const lagree = {
  id: 'clase-lagree', name: 'Lagree', price: 325, duration: 105, eventCapacity: 10, type: 'CLASS',
  description: 'Clase de Lagree en máquina, todos los niveles.', upfrontPolicy: 'required', creditCost: 1,
  requireCreditForBooking: false,
} as unknown as Product

// Jueves 26 de noviembre, 18:15 – 20:00 en CDMX (UTC−6).
const slot: PublicClassSessionSlot = {
  startsAt: '2026-11-27T00:15:00Z', endsAt: '2026-11-27T02:00:00Z', available: true, classSessionId: 's-26',
  productId: 'clase-lagree', productName: 'Lagree', capacity: 10, enrolled: 2, remaining: 8,
  instructor: { firstName: 'Fer', lastName: 'Ruiz', photoUrl: null },
}
const llena: PublicClassSessionSlot = { ...slot, available: false, remaining: 0, enrolled: 10 }

const reserva = (extra: Partial<MiReservaDeClase> = {}): MiReservaDeClase => ({
  classSessionId: 's-26', spotIds: ['3'], confirmationCode: 'C-1', cancelSecret: 'sec-1', startsAt: slot.startsAt,
  status: 'CONFIRMED', depositStatus: null, usedUnlimited: false, ...extra,
})
const miLugar = (extra: Partial<MiLugarEnLaClase> = {}): MiLugarEnLaClase => {
  const r = reserva()
  return { lugar: '3', estado: 'reservada', principal: r, reservas: [r], ...extra }
}
const CINCO: CubreLaClase = { restante: 5, nombreClase: 'Lagree', soloEstaClase: true, vencimientos: ['2026-12-11T18:00:00Z'] }
const POLITICA = 'Cancela gratis hasta el miércoles 25 a las 18:15 y la sesión regresa a tu paquete.'

function pintar(p: Partial<Parameters<typeof ClassDetailView>[0]> = {}) {
  const fns = { onBook: vi.fn(), onBack: vi.fn(), onOtroLugar: vi.fn(), onVerMiReserva: vi.fn() }
  const r = render(
    <ClassDetailView
      slot={slot}
      product={lagree}
      timezone={TZ}
      politica={null}
      cubre={null}
      puedeEscribir={false}
      t={t}
      {...fns}
      {...p}
    />,
  )
  return { ...r, ...fns }
}
const texto = () => document.body.textContent ?? ''
const boton = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement
const css = () => Array.from(document.querySelectorAll('style')).map(x => x.textContent ?? '').join('\n')

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-26T18:00:00Z')) // jueves 26, 12:00 en CDMX
  branding.value = DEFAULT_BRANDING
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  branding.value = DEFAULT_BRANDING
})

describe('ClassDetailView: el detalle de la clase (Task 11)', () => {
  it('cuándo, con quién y cuántos lugares: «Jueves 26 de noviembre», «18:15 – 20:00», la coach y «8 de 10 lugares libres»', () => {
    pintar()
    expect(screen.getByRole('heading', { name: 'Lagree' })).toBeTruthy()
    expect(screen.getByText('Jueves 26 de noviembre')).toBeTruthy()
    expect(screen.getByText('18:15 – 20:00')).toBeTruthy()
    expect(screen.getByText('Fer Ruiz')).toBeTruthy()
    expect(screen.getByText('Coach')).toBeTruthy()
    expect(screen.getByText('8 de 10 lugares libres')).toBeTruthy()
    expect(screen.getByText('Clase de Lagree en máquina, todos los niveles.')).toBeTruthy()
  })

  it('«Horario» regresa al horario', () => {
    const { onBack } = pintar()
    fireEvent.click(boton('Horario'))
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('el botón dice «Reservar» (nunca «Reservar con créditos») y no aparece «o 1 crédito», aunque la clase pida paquete', () => {
    const { onBook } = pintar({ product: { ...lagree, requireCreditForBooking: true, creditCost: 2 } as Product })
    fireEvent.click(boton('Reservar'))
    expect(onBook).toHaveBeenCalledTimes(1)
    expect(texto()).not.toMatch(/crédito/)
    expect(screen.queryByRole('button', { name: /Reservar con créditos|Reservar lugar/ })).toBeNull()
  })

  it('sin paquete enseña el precio como en el horario: «$325 · clase suelta», una sola vez', () => {
    pintar()
    expect(screen.getAllByText('$325 · clase suelta')).toHaveLength(1)
    expect(texto()).not.toContain('Incluida')
  })

  it('una clase que sólo se reserva con paquete dice «Con paquete», no «$325 · clase suelta»', () => {
    pintar({ product: { ...lagree, requireCreditForBooking: true } as Product })
    expect(screen.getAllByText('Con paquete')).toHaveLength(1)
    expect(texto()).not.toContain('clase suelta')
    expect(texto()).not.toContain('$325')
  })

  it('una clase que sólo se reserva con paquete y su paquete la cubre: «Incluida en tu paquete»', () => {
    pintar({ product: { ...lagree, requireCreditForBooking: true } as Product, cubre: CINCO })
    expect(screen.getByText('Incluida en tu paquete')).toBeTruthy()
    expect(texto()).not.toContain('Con paquete')
  })

  it('sin precios (el negocio los apaga) no hay monto', () => {
    branding.value = { ...DEFAULT_BRANDING, showPrices: false }
    pintar()
    expect(texto()).not.toContain('$')
  })

  it('con `cubre`: «Incluida en tu paquete» y «Te quedan 5 sesiones de Lagree · vencen el 11 dic», sin el precio suelto', () => {
    pintar({ cubre: CINCO })
    expect(screen.getByText('Incluida en tu paquete')).toBeTruthy()
    expect(screen.getByText('Te quedan 5 sesiones de Lagree · vencen el 11 dic')).toBeTruthy()
    expect(texto()).not.toContain('$325')
  })

  it('con una sola sesión: «Te queda 1 sesión de Lagree · vence el 11 dic»; un paquete de varias clases dice «créditos»', () => {
    const { unmount } = pintar({ cubre: { ...CINCO, restante: 1 } })
    expect(screen.getByText('Te queda 1 sesión de Lagree · vence el 11 dic')).toBeTruthy()
    unmount()
    pintar({ cubre: { ...CINCO, soloEstaClase: false, vencimientos: [null] } })
    expect(screen.getByText('Te quedan 5 créditos')).toBeTruthy()
  })

  it('sus paquetes vencen en fechas distintas: «las primeras vencen el …»', () => {
    pintar({ cubre: { ...CINCO, vencimientos: ['2026-12-11T18:00:00Z', '2027-01-05T18:00:00Z'] } })
    expect(screen.getByText('Te quedan 5 sesiones de Lagree · las primeras vencen el 11 dic')).toBeTruthy()
  })

  it('un Ilimitado nunca enseña su número interno', () => {
    pintar({ cubre: { restante: 0, nombreClase: 'Lagree', soloEstaClase: true, ilimitado: true, vencimientos: ['2026-12-20T18:00:00Z'] } })
    expect(screen.getByText('Tienes Ilimitado de Lagree · vence el 20 dic')).toBeTruthy()
    expect(texto()).not.toMatch(/9999|Te quedan/)
  })

  it('con `politica` se ve la línea; con `politica: null` no hay línea y nunca «12h»', () => {
    const { unmount } = pintar({ politica: POLITICA })
    expect(screen.getByText(POLITICA)).toBeTruthy()
    unmount()
    pintar({ politica: null })
    expect(texto()).not.toMatch(/cancela|Cancela|12\s?h/)
  })

  it('«¿Dudas sobre esta clase? Escríbenos» sólo si el negocio recibe mensajes, y abre el chat (avoqado:open-chat)', () => {
    const abrir = vi.fn()
    window.addEventListener('avoqado:open-chat', abrir)
    try {
      const { unmount } = pintar({ puedeEscribir: true })
      fireEvent.click(boton('¿Dudas sobre esta clase? Escríbenos'))
      expect(abrir).toHaveBeenCalledTimes(1)
      unmount()
      pintar({ puedeEscribir: false })
      expect(screen.queryByRole('button', { name: /Escríbenos/ })).toBeNull()
    } finally {
      window.removeEventListener('avoqado:open-chat', abrir)
    }
  })

  it('clase llena: «Clase llena» y «Reservar» no se puede tocar', () => {
    const { onBook } = pintar({ slot: llena })
    expect(screen.getByText('Clase llena')).toBeTruthy()
    const b = boton('Reservar')
    expect(b.disabled).toBe(true)
    fireEvent.click(b)
    expect(onBook).not.toHaveBeenCalled()
  })

  describe('ya tiene lugar en ESA clase', () => {
    it('«Ya tienes lugar en esta clase · lugar 3», «Ver mi reserva» con su cancelSecret y «Reservar otro lugar para alguien»', () => {
      const { onVerMiReserva, onOtroLugar, onBook } = pintar({ miLugar: miLugar(), cubre: CINCO, politica: POLITICA })
      expect(screen.getByText('Ya tienes lugar en esta clase · lugar 3')).toBeTruthy()
      fireEvent.click(boton('Ver mi reserva'))
      expect(onVerMiReserva).toHaveBeenCalledWith('sec-1')
      fireEvent.click(boton('Reservar otro lugar para alguien'))
      expect(onOtroLugar).toHaveBeenCalledTimes(1)
      expect(onBook).not.toHaveBeenCalled()
      // Su lugar manda: no se le ofrece «Reservar» a secas ni «Incluida» para la que ya tiene.
      expect(screen.queryByRole('button', { name: 'Reservar' })).toBeNull()
      expect(texto()).not.toContain('Incluida en tu paquete')
    })

    it('con la clase llena, «Reservar otro lugar» no aparece (sólo «Ver mi reserva»)', () => {
      pintar({ slot: llena, miLugar: miLugar() })
      expect(screen.getByText('Ya tienes lugar en esta clase · lugar 3')).toBeTruthy()
      expect(boton('Ver mi reserva')).toBeTruthy()
      expect(screen.queryByRole('button', { name: /otro lugar/ })).toBeNull()
    })

    it('dos lugares: «lugares 3, 4»; sin mapa: sin número', () => {
      const { unmount } = pintar({ miLugar: miLugar({ lugar: '3', lugares: ['3', '4'] }) })
      expect(screen.getByText('Ya tienes lugar en esta clase · lugares 3, 4')).toBeTruthy()
      unmount()
      pintar({ miLugar: miLugar({ lugar: null }) })
      expect(screen.getByText('Ya tienes lugar en esta clase')).toBeTruthy()
    })

    it('«Falta pagar» y «Por aprobar» se dicen debajo', () => {
      const { unmount } = pintar({ miLugar: miLugar({ estado: 'faltaPagar' }) })
      expect(screen.getByText('Falta pagar')).toBeTruthy()
      unmount()
      pintar({ miLugar: miLugar({ estado: 'porAprobar' }) })
      expect(screen.getByText('Por aprobar')).toBeTruthy()
    })
  })

  it('celular (390 px): sin margen propio (28 px en total, W2) y «Reservar» fijo abajo, de 56 px, alineado y encima de la barra', () => {
    pintar()
    const accion = document.querySelector('.avq-cd-accion') as HTMLElement
    expect(accion.contains(boton('Reservar'))).toBe(true)
    const estilos = css()
    const celular = estilos.match(/@media \(max-width: 640px\)\s*\{([\s\S]*)\}/)?.[1] ?? ''
    // W2: la página deja 12 px y el widget 16 px; el detalle ya no suma 12 px más (eran 40 px del borde).
    expect(celular).not.toMatch(/\.avq-classdetail\s*\{[^}]*padding-inline/)
    // El botón fijo queda alineado con el contenido: 28 px por lado.
    expect(celular).toMatch(/\.avq-cd-accion\s*\{[^}]*padding:\s*16px 28px/)
    // Fijo abajo, encima de la barra de abajo de la página (su alto llega en `--avq-toast-offset`).
    expect(celular).toMatch(/\.avq-cd-accion\s*\{[^}]*position:\s*fixed/)
    expect(celular).toMatch(/\.avq-cd-accion\s*\{[^}]*bottom:\s*var\(--avq-toast-offset,\s*0px\)/)
    expect(celular).toMatch(/\.avq-cd-btn\s*\{[^}]*min-height:\s*56px/)
    // El botón flotante del chat del widget no lo tapa (el detalle ya trae su «Escríbenos»).
    expect(celular).toMatch(/\.avq-chat-fab\s*\{[^}]*display:\s*none/)
  })

  it('en la página propia, el botón flotante del chat tampoco tapa «Reservar»: el detalle se anuncia en el elemento', () => {
    const host = document.createElement('avoqado-booking')
    document.body.append(host)
    const sombra = host.attachShadow({ mode: 'open' })
    const contenedor = document.createElement('div')
    sombra.append(contenedor)
    const { unmount } = render(
      <ClassDetailView slot={slot} product={lagree} timezone={TZ} politica={null} cubre={null} puedeEscribir t={t}
        onBook={vi.fn()} onBack={vi.fn()} onOtroLugar={vi.fn()} onVerMiReserva={vi.fn()} />,
      { container: contenedor },
    )
    expect(host.hasAttribute('data-detalle-de-clase')).toBe(true)
    unmount()
    expect(host.hasAttribute('data-detalle-de-clase')).toBe(false)
    host.remove()
    expect(paginaHospedada).toMatch(/@media \(max-width: 640px\)\s*\{[^}]*avoqado-booking\[data-detalle-de-clase\][^{]*\.textus-fab\s*\{\s*display:\s*none/)
  })
})

describe('cubreDe: lo que el detalle dice de su paquete', () => {
  const op = (extra: Partial<OpcionDePaquete>): OpcionDePaquete => ({
    balanceId: 'b', packName: 'Paquete', restante: 4, original: 5, ilimitado: false, vence: '2026-12-11T18:00:00Z',
    soloEstaClase: true, ...extra,
  })
  it('sin opciones, nada', () => {
    expect(cubreDe([], 'Lagree')).toBeNull()
  })
  it('suma las sesiones de sus paquetes que pagan la clase, con sus vencimientos (el default primero)', () => {
    expect(cubreDe([op({ balanceId: 'a', restante: 1 }), op({ balanceId: 'b', restante: 4, vence: null })], 'Lagree')).toEqual({
      restante: 5, nombreClase: 'Lagree', soloEstaClase: true, ilimitado: false, vencimientos: ['2026-12-11T18:00:00Z', null],
    })
  })
  it('un Ilimitado manda, sin número', () => {
    expect(cubreDe([op({ restante: 2 }), op({ balanceId: 'u', ilimitado: true, restante: 99998, vence: '2026-12-20T18:00:00Z' })], 'Lagree'))
      .toEqual({ restante: 0, nombreClase: 'Lagree', soloEstaClase: true, ilimitado: true, vencimientos: ['2026-12-20T18:00:00Z'] })
  })
})
