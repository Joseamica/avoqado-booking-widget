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

  // Diseño 27-nov: con clases ya no hay pestaña de paquetes en la portada (la portada es el horario), y en /<negocio> el
  // enlace `#packs` sólo cambiaba el «#» sin recargar: «Paquetes» (arriba, en el menú y en la barra de abajo) abre la lista
  // ahí mismo en cualquier pantalla.
  it('en la portada «Paquetes» también abre la lista ahí mismo, también desde la barra de abajo', async () => {
    new Function(scriptDeLaPagina())()
    await esperar()
    const abrir = vi.fn()
    ;(widget() as unknown as { showCreditPacks: () => void }).showCreditPacks = abrir
    for (const sel of ['#topnav a[data-route="packs"]', '#bottombar a[data-route="packs"]']) {
      const evento = new MouseEvent('click', { bubbles: true, cancelable: true })
      document.querySelector<HTMLAnchorElement>(sel)!.dispatchEvent(evento)
      expect(evento.defaultPrevented).toBe(true)
    }
    expect(abrir).toHaveBeenCalledTimes(2)
  })
  it('⌘ o ctrl en «Paquetes» la deja abrirse en otra pestaña del navegador', async () => {
    new Function(scriptDeLaPagina())()
    await esperar()
    const abrir = vi.fn()
    ;(widget() as unknown as { showCreditPacks: () => void }).showCreditPacks = abrir
    const evento = new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true })
    const frenar = (e: Event) => e.preventDefault() // jsdom no navega: se frena al final, después de los oyentes de la página
    window.addEventListener('click', frenar)
    document.querySelector<HTMLAnchorElement>('#topnav a[data-route="packs"]')!.dispatchEvent(evento)
    window.removeEventListener('click', frenar)
    expect(abrir).not.toHaveBeenCalled()
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
    for (const sel of ['#topnav a[data-route="book"]', '#topnav a[data-route="packs"]', '#drawer a[data-route="book"]', '#bottombar a[data-route="book"]', '#nav-brand']) tocar(sel)
    expect(salir).toHaveBeenCalledTimes(5)
  })

  it('abrirla en otra pestaña del navegador (⌘ o ctrl) no cierra la que está viendo', async () => {
    new Function(scriptDeLaPagina())()
    await esperar()
    const salir = vi.fn()
    ;(widget() as unknown as { leaveManageBooking: () => void }).leaveManageBooking = salir
    tocar('#topnav a[data-route="book"]', { metaKey: true })
    tocar('#topnav a[data-route="book"]', { ctrlKey: true })
    expect(salir).not.toHaveBeenCalled()
  })

  // Diseño 27-nov: la cabecera ya no lleva «Citas» ni «Clases» (se eligen dentro, con «Clases | Citas»), así que un estudio
  // que sólo da clases nunca ve «Citas» (D684b). La portada se llama «Horario» si sólo da clases y «Reservar» si da citas.
  const portada = () => Array.from(document.querySelectorAll<HTMLElement>('#topnav a[data-route="book"], #drawer a[data-route="book"], #bottombar a[data-route="book"] span'))
  const avisar = (tipo: string, detail: Record<string, unknown>) => widget().dispatchEvent(new CustomEvent(tipo, { detail }))

  it('🔴 la cabecera, el menú y la barra no tienen «Citas» ni «Clases»: «Horario · Paquetes»', async () => {
    new Function(scriptDeLaPagina())()
    await esperar()
    expect(document.querySelectorAll('a[data-route="appointments"], a[data-route="classes"]')).toHaveLength(0)
    expect(portada().map(x => x.textContent!.trim())).toEqual(['Horario', 'Horario', 'Horario'])
  })

  it('estudio que sólo da clases: «Horario»; con servicios, sin productos o sin el dato: «Reservar»', async () => {
    new Function(scriptDeLaPagina())()
    await esperar()
    avisar('avoqado:venue-loaded', { venue: { name: 'Un estudio', hasClasses: true, hasAppointments: false } })
    portada().forEach(x => expect(x.textContent!.trim()).toBe('Horario'))
    avisar('avoqado:venue-loaded', { venue: { name: 'Un estudio', hasClasses: true, hasAppointments: true } })
    portada().forEach(x => expect(x.textContent!.trim()).toBe('Reservar'))
    avisar('avoqado:venue-loaded', { venue: { name: 'Un restaurante', hasClasses: false, hasAppointments: true } })
    portada().forEach(x => expect(x.textContent!.trim()).toBe('Reservar'))
    avisar('avoqado:venue-loaded', { venue: { name: 'Widget viejo', hasClasses: true } })
    portada().forEach(x => expect(x.textContent!.trim()).toBe('Reservar'))
  })
})

describe('diseño 18-nov: sin clases agendadas, la cabecera no ofrece «Clases»', () => {
  // Diseño 27-nov: la cabecera ya no tiene «Clases»; sin clases agendadas, el widget no ofrece «Clases | Citas» y va a citas.
  it('ni antes ni después del aviso del widget hay un «Clases» en la cabecera, el menú o la barra', async () => {
    new Function(scriptDeLaPagina())()
    await esperar()
    widget().dispatchEvent(new CustomEvent('avoqado:classes-availability', { detail: { hayClases: false } }))
    expect(Array.from(document.querySelectorAll('#topnav a, #drawer a, #bottombar a')).map(a => a.textContent!.trim())).not.toContain('Clases')
  })
})

// Diseño 27-nov: la página propia es dueña de su liga. El widget (con `show-identity`) pide el cambio con `avoqado:navigate`;
// la página cambia la dirección y, con ella, el `flow-type` del widget. Atrás y adelante siguen funcionando.
describe('«Clases | Citas» en la página propia: la página cambia su liga y el flow-type', () => {
  const navegar = (detail: Record<string, unknown>) =>
    widget().dispatchEvent(new CustomEvent('avoqado:navigate', { bubbles: true, composed: true, detail }))

  it('el widget se monta con show-identity', async () => {
    new Function(scriptDeLaPagina())()
    await esperar()
    expect(widget().getAttribute('show-identity')).toBe('true')
  })

  it('la portada elige clases sola (replace) y luego «Citas» (push): liga, flow-type y atrás', async () => {
    window.history.replaceState({}, '', '/un-estudio')
    new Function(scriptDeLaPagina())()
    await esperar()
    const largo = window.history.length
    navegar({ flow: 'classes', replace: true })
    await esperar()
    expect(window.location.pathname).toBe('/un-estudio/classes')
    expect(window.history.length).toBe(largo) // reemplazó: /un-estudio no queda en el historial
    expect(widget().getAttribute('flow-type')).toBe('classes')
    expect(document.body.classList.contains('flow-classes')).toBe(true)

    navegar({ flow: 'appointments' })
    await esperar()
    expect(window.location.pathname).toBe('/un-estudio/appointments')
    expect(widget().getAttribute('flow-type')).toBe('appointments')
    expect(document.body.classList.contains('flow-appointments')).toBe(true)

    await irAtras()
    expect(window.location.pathname).toBe('/un-estudio/classes')
    expect(widget().getAttribute('flow-type')).toBe('classes')
  })

  it('conserva la búsqueda (?manage=…, ?locale=…) y no hace nada con un flujo que no conoce o el mismo', async () => {
    window.history.replaceState({}, '', '/un-estudio/classes?locale=es')
    new Function(scriptDeLaPagina())()
    await esperar()
    const largo = window.history.length
    navegar({ flow: 'otra-cosa' })
    navegar({ flow: 'classes' })
    await esperar()
    expect(window.location.pathname).toBe('/un-estudio/classes')
    expect(window.history.length).toBe(largo)
    navegar({ flow: 'appointments' })
    await esperar()
    expect(window.location.pathname + window.location.search).toBe('/un-estudio/appointments?locale=es')
  })
})

describe('barra fija de abajo en el celular (diseño 27-nov): Horario · Paquetes · Mi cuenta', () => {
  it('se muestra en la reserva; «Paquetes» espera a que el negocio tenga paquetes; «Mi cuenta» abre la cuenta', async () => {
    new Function(scriptDeLaPagina())()
    await esperar()
    const barra = document.getElementById('bottombar')!
    expect(barra.hidden).toBe(false)
    expect(Array.from(barra.querySelectorAll('a, button')).map(x => x.textContent!.trim())).toEqual(['Horario', 'Paquetes', 'Escríbenos', 'Mi cuenta'])
    const paquetes = barra.querySelector<HTMLAnchorElement>('a[data-route="packs"]')!
    expect(paquetes.hidden).toBe(true)
    widget().dispatchEvent(new CustomEvent('avoqado:credit-packs-loaded', { detail: { count: 3 } }))
    expect(paquetes.hidden).toBe(false)
    const cuenta = vi.fn()
    ;(widget() as unknown as { showAccount: () => void }).showAccount = cuenta
    document.getElementById('bottombar-account')!.click()
    expect(cuenta).toHaveBeenCalledTimes(1)
  })
})

// Fix round 1 (Task 8): el aviso del widget (Toast, `position: fixed; bottom: 16px`) quedaba DEBAJO de la barra de abajo en el
// celular. La barra baja a z-index 45 (bajo el aviso, 50; sobre ella las ventanas, 100+) y la página le pasa su alto al widget
// en `--avq-toast-offset` para que el aviso suba encima; sin barra (computadora, widget pegado en otro sitio) no hay variable.
describe('el aviso del widget sube encima de la barra de abajo', () => {
  let cambiar: (celular: boolean) => void = () => {}
  function pantalla(celular: boolean) {
    const oyentes: Array<(e: { matches: boolean }) => void> = []
    const consulta = {
      matches: celular, media: '(max-width: 639px)',
      addEventListener: (_tipo: string, f: (e: { matches: boolean }) => void) => oyentes.push(f),
      removeEventListener: () => {},
    }
    ;(window as unknown as { matchMedia: unknown }).matchMedia = vi.fn(() => consulta)
    cambiar = (c: boolean) => { consulta.matches = c; oyentes.forEach(f => f({ matches: c })) }
  }
  function medirBarra(alto: number) {
    Object.defineProperty(document.getElementById('bottombar')!, 'offsetHeight', { configurable: true, get: () => alto })
  }
  const desplazamiento = () => (widget() as HTMLElement).style.getPropertyValue('--avq-toast-offset')
  afterEach(() => { delete (window as unknown as { matchMedia?: unknown }).matchMedia })

  it('en el celular, con la barra visible, el widget recibe el alto de la barra; en computadora se quita y vuelve', async () => {
    pantalla(true)
    medirBarra(74)
    new Function(scriptDeLaPagina())()
    await esperar()
    expect(desplazamiento()).toBe('74px')
    cambiar(false)
    expect(desplazamiento()).toBe('')
    cambiar(true)
    expect(desplazamiento()).toBe('74px')
  })

  it('en computadora desde el principio no hay variable: el aviso queda donde siempre', async () => {
    pantalla(false)
    medirBarra(74)
    new Function(scriptDeLaPagina())()
    await esperar()
    expect(desplazamiento()).toBe('')
  })

  it('la barra queda bajo el aviso (z-index 45 < 50)', () => {
    expect(paginaHospedada).toMatch(/\.bottombar:not\(\[hidden\]\)\s*\{[^}]*z-index:\s*45;/)
  })
})

// W1 (banco, 27-nov): a 390 px la burbuja del chat («Envíanos un mensaje», 52 px) quedaba encima del «Reservar» de una fila del
// horario. En la página propia, con su barra de abajo, la burbuja se esconde y la barra gana «Escríbenos», que abre el chat. Sale
// sólo si el negocio recibe mensajes (el mismo aviso que decide la burbuja, `avoqado:chat-availability`); sin ese dato, la barra
// queda como antes.
describe('W1: en el celular, «Escríbenos» va en la barra de abajo y la burbuja no tapa el horario', () => {
  const avisarChat = (detail?: Record<string, unknown>) =>
    window.dispatchEvent(new CustomEvent('avoqado:chat-availability', detail === undefined ? {} : { detail }))
  const escribenos = () => document.getElementById('bottombar-chat') as HTMLButtonElement

  it('con la barra de abajo (< 640 px) la burbuja flotante se esconde', () => {
    const celular = paginaHospedada.match(/@media \(max-width: 639px\)\s*\{([\s\S]*?)\n    \}/)?.[1] ?? ''
    expect(celular).toMatch(/body\.con-bottombar \.textus-fab\s*\{[^}]*display:\s*none/)
  })

  it('«Escríbenos» espera el aviso: sale si el negocio recibe mensajes y abre el chat; con «no» no sale', async () => {
    new Function(scriptDeLaPagina())()
    await esperar()
    const boton = escribenos()
    expect(boton.closest('#bottombar')).not.toBeNull()
    expect(boton.textContent!.trim()).toBe('Escríbenos')
    // El mismo ícono de chat que la burbuja, del trazo de la barra.
    expect(boton.querySelector('svg path')!.getAttribute('d')).toBe(
      document.querySelector('#textus-fab svg path')!.getAttribute('d'),
    )
    expect(boton.querySelector('svg')!.getAttribute('stroke-width')).toBe('1.75')
    expect(boton.hidden).toBe(true)

    avisarChat({ canMessage: true })
    expect(boton.hidden).toBe(false)
    const abrir = vi.fn()
    window.addEventListener('avoqado:open-chat', abrir)
    boton.click()
    window.removeEventListener('avoqado:open-chat', abrir)
    expect(abrir).toHaveBeenCalledTimes(1)

    avisarChat({ canMessage: false })
    expect(boton.hidden).toBe(true)
  })

  it('sin el dato (aviso sin detalle o que nunca llega) la barra queda como antes: Horario · Paquetes · Mi cuenta', async () => {
    new Function(scriptDeLaPagina())()
    await esperar()
    expect(escribenos().hidden).toBe(true)
    avisarChat()
    expect(escribenos().hidden).toBe(true)
    avisarChat({ otraCosa: 1 })
    expect(escribenos().hidden).toBe(true)
  })
})
