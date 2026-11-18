// book.avoqado.io/<negocio> (la portada) y /<negocio>/appointments (reservar una cita) son la MISMA página: el script en
// línea de public/index.html decide el ancho y la cabecera según la dirección, y monta <avoqado-booking>. El founder
// (18-nov) vio que, tras «Citas» y luego «atrás», la página volvía a la portada angosta pero el widget seguía en la
// reserva: dos columnas apretadas en 560 px. La causa: la página seguía a la dirección, el widget no (su `flow-type`
// sólo se ponía al cargar). Esta prueba corre ESE script tal cual en el jsdom de vitest.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import paginaHospedada from '../public/index.html?raw'

function scriptDeLaPagina(): string {
  const m = /<script>([\s\S]*?)<\/script>/.exec(paginaHospedada)
  if (!m) throw new Error('no encontré el <script> en línea de public/index.html')
  return m[1]
}
function cuerpoDeLaPagina(): string {
  const m = /<body[^>]*>([\s\S]*?)<\/body>/.exec(paginaHospedada)
  if (!m) throw new Error('no encontré el <body> de public/index.html')
  return m[1].replace(/<script[\s\S]*?<\/script>/g, '')
}
async function esperar() {
  for (let i = 0; i < 6; i++) await new Promise(r => setTimeout(r, 0))
}
function widget(): Element {
  const w = document.querySelector('avoqado-booking')
  if (!w) throw new Error('no se montó <avoqado-booking>')
  return w
}
async function irAtras() {
  const llego = new Promise(r => window.addEventListener('popstate', r, { once: true }))
  window.history.back()
  await llego
  await esperar()
}
async function irAdelante() {
  const llego = new Promise(r => window.addEventListener('popstate', r, { once: true }))
  window.history.forward()
  await llego
  await esperar()
}

beforeEach(() => {
  document.body.className = ''
  document.body.innerHTML = cuerpoDeLaPagina()
  window.history.replaceState({}, '', '/mindform')
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })))
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('portada ↔ reservar con atrás y adelante (book.avoqado.io)', () => {
  it('la portada monta el widget sin flujo y la página angosta', async () => {
    new Function(scriptDeLaPagina())()
    await esperar()
    expect(widget().hasAttribute('flow-type')).toBe(false)
    expect(document.body.classList.contains('flow-appointments')).toBe(false)
  })

  it('«Citas» y luego «atrás»: el widget vuelve a la portada junto con la página', async () => {
    new Function(scriptDeLaPagina())()
    await esperar()
    // Lo que hace el widget al tocar «Citas» en la portada (BookingFlow → onPickAppointments).
    window.history.pushState({}, '', '/mindform/appointments')
    await esperar()
    expect(document.body.classList.contains('flow-appointments')).toBe(true)
    expect(widget().getAttribute('flow-type')).toBe('appointments')

    await irAtras()
    expect(window.location.pathname).toBe('/mindform')
    expect(document.body.classList.contains('flow-appointments')).toBe(false)
    expect(widget().hasAttribute('flow-type')).toBe(false)

    await irAdelante()
    expect(window.location.pathname).toBe('/mindform/appointments')
    expect(document.body.classList.contains('flow-appointments')).toBe(true)
    expect(widget().getAttribute('flow-type')).toBe('appointments')
  })

  it('«Clases» y «atrás» hacen lo mismo', async () => {
    new Function(scriptDeLaPagina())()
    await esperar()
    window.history.pushState({}, '', '/mindform/classes')
    await esperar()
    expect(widget().getAttribute('flow-type')).toBe('classes')
    await irAtras()
    expect(widget().hasAttribute('flow-type')).toBe(false)
    expect(document.body.classList.contains('flow-classes')).toBe(false)
  })

  it('el detalle de un servicio sigue siendo «appointments»', async () => {
    window.history.replaceState({}, '', '/mindform/appointments')
    new Function(scriptDeLaPagina())()
    await esperar()
    window.history.pushState({}, '', '/mindform/appointments/services/p1')
    await esperar()
    expect(widget().getAttribute('flow-type')).toBe('appointments')
  })
})

describe('una sola cabecera (diseño 18-nov): «Comprar paquetes» dentro de la reserva abre la lista ahí mismo', () => {
  it('en /appointments el enlace de la cabecera abre los paquetes sin salir de la reserva', async () => {
    window.history.replaceState({}, '', '/mindform/appointments')
    new Function(scriptDeLaPagina())()
    await esperar()
    const abrir = vi.fn()
    ;(widget() as unknown as { showCreditPacks: () => void }).showCreditPacks = abrir
    const enlace = document.querySelector<HTMLAnchorElement>('#topnav a[data-route="packs"]')!
    const evento = new MouseEvent('click', { bubbles: true, cancelable: true })
    enlace.dispatchEvent(evento)
    expect(abrir).toHaveBeenCalledTimes(1)
    expect(evento.defaultPrevented).toBe(true)
    expect(window.location.pathname).toBe('/mindform/appointments')
  })

  it('en la portada el enlace sigue llevando a la pestaña de paquetes (no se intercepta)', async () => {
    new Function(scriptDeLaPagina())()
    await esperar()
    const abrir = vi.fn()
    ;(widget() as unknown as { showCreditPacks: () => void }).showCreditPacks = abrir
    const evento = new MouseEvent('click', { bubbles: true, cancelable: true })
    document.querySelector<HTMLAnchorElement>('#topnav a[data-route="packs"]')!.dispatchEvent(evento)
    expect(abrir).not.toHaveBeenCalled()
    expect(evento.defaultPrevented).toBe(false)
  })
})
