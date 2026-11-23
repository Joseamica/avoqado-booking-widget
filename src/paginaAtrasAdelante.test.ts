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

// D684 (Mindform, 22-nov): volvió de Stripe sin pagar a «Tu Reservación» y las pestañas de arriba no hacían nada. Cada pestaña
// es un enlace que recarga la página, y el widget volvía a abrir «Tu Reservación» con la reserva guardada en el navegador.
describe('D684: la cabecera desde «Tu Reservación», y «Citas» sólo si el negocio agenda citas', () => {
  function tocar(sel: string, extra: MouseEventInit = {}) {
    // jsdom no navega: se frena al final (en window, después de los oyentes de la página) para no ensuciar la salida.
    const frenar = (e: Event) => e.preventDefault()
    window.addEventListener('click', frenar)
    document.querySelector<HTMLAnchorElement>(sel)!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...extra }))
    window.removeEventListener('click', frenar)
  }

  it('tocar una pestaña (arriba o en el menú) o el nombre del negocio cierra «Tu Reservación» antes de cambiar de página', async () => {
    window.history.replaceState({}, '', '/mindform/classes')
    new Function(scriptDeLaPagina())()
    await esperar()
    const salir = vi.fn()
    ;(widget() as unknown as { leaveManageBooking: () => void }).leaveManageBooking = salir
    for (const sel of ['#topnav a[data-route="classes"]', '#topnav a[data-route="packs"]', '#drawer a[data-route="appointments"]', '#nav-brand']) tocar(sel)
    expect(salir).toHaveBeenCalledTimes(4)
  })

  it('abrirla en otra pestaña del navegador (⌘ o ctrl) no cierra la que está viendo', async () => {
    new Function(scriptDeLaPagina())()
    await esperar()
    const salir = vi.fn()
    ;(widget() as unknown as { leaveManageBooking: () => void }).leaveManageBooking = salir
    tocar('#topnav a[data-route="classes"]', { metaKey: true })
    tocar('#topnav a[data-route="classes"]', { ctrlKey: true })
    expect(salir).not.toHaveBeenCalled()
  })

  const citas = () => Array.from(document.querySelectorAll('a[data-route="appointments"]'))
  const avisar = (tipo: string, detail: Record<string, unknown>) => widget().dispatchEvent(new CustomEvent(tipo, { detail }))

  it('🔴 estudio que sólo da clases (hasAppointments false): «Citas» se esconde de la cabecera y del menú; con servicios (o sin el dato) se ve', async () => {
    new Function(scriptDeLaPagina())()
    await esperar()
    expect(citas()).toHaveLength(2)
    citas().forEach(x => expect(x.hasAttribute('hidden')).toBe(false)) // antes del aviso, como en main
    avisar('avoqado:venue-loaded', { venue: { name: 'Mindform', hasClasses: true, hasAppointments: false } })
    citas().forEach(x => expect(x.hasAttribute('hidden')).toBe(true))
    avisar('avoqado:venue-loaded', { venue: { name: 'Mindform', hasClasses: true, hasAppointments: true } })
    citas().forEach(x => expect(x.hasAttribute('hidden')).toBe(false))
    avisar('avoqado:venue-loaded', { venue: { name: 'Widget viejo', hasClasses: true } })
    citas().forEach(x => expect(x.hasAttribute('hidden')).toBe(false))
  })

  it('sin productos (un restaurante): el widget avisa hasAppointments true y «Citas» se ve', async () => {
    new Function(scriptDeLaPagina())()
    await esperar()
    avisar('avoqado:venue-loaded', { venue: { name: 'Restaurante', hasClasses: false, hasAppointments: true } })
    citas().forEach(x => expect(x.hasAttribute('hidden')).toBe(false))
  })

  it('clases sin sesiones en 30 días: sólo se esconde «Clases»; «Citas» queda como en main', async () => {
    new Function(scriptDeLaPagina())()
    await esperar()
    avisar('avoqado:venue-loaded', { venue: { name: 'Estudio', hasClasses: true, hasAppointments: true } })
    avisar('avoqado:classes-availability', { hayClases: false })
    citas().forEach(x => expect(x.hasAttribute('hidden')).toBe(false))
    document.querySelectorAll('a[data-route="classes"]').forEach(x => expect(x.hasAttribute('hidden')).toBe(true))
  })
})

describe('diseño 18-nov: sin clases agendadas, la cabecera no ofrece «Clases»', () => {
  it('el aviso del widget esconde «Clases» de la cabecera y del menú', async () => {
    new Function(scriptDeLaPagina())()
    await esperar()
    document.querySelectorAll('[data-requires="classes"]').forEach(x => x.removeAttribute('hidden'))
    widget().dispatchEvent(new CustomEvent('avoqado:classes-availability', { detail: { hayClases: false } }))
    document.querySelectorAll('[data-requires="classes"]').forEach(x => expect(x.hasAttribute('hidden')).toBe(true))
  })
})
