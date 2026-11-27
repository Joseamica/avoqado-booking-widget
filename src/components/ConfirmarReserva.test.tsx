import { h } from 'preact'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createT } from '../i18n'
import type { OpcionDePaquete } from '../lib/eleccionDePaquete'
import { ConfirmarReserva, RevisionDeLaReserva, cuandoCorto } from './ConfirmarReserva'

const t = createT('es')
afterEach(() => cleanup())

const paquete = (extra: Partial<OpcionDePaquete> = {}): OpcionDePaquete => ({
  balanceId: 'b5', packName: 'Paquete de 5', restante: 4, original: 5, ilimitado: false, vence: '2026-12-11T18:00:00Z',
  soloEstaClase: true, ...extra,
})
const ilimitado = paquete({ balanceId: 'u1', packName: 'Mensual Ilimitado', restante: 99998, original: 99999, ilimitado: true, vence: '2026-12-20T18:00:00Z' })

function pinta(extra: Partial<Parameters<typeof ConfirmarReserva>[0]> = {}) {
  const props = {
    clase: 'Lagree', cuando: 'Jue 8 · 15:00', coach: 'Fer Ruiz', lugares: ['3'],
    opciones: [paquete()], elegida: 'b5', onElegir: vi.fn(), pago: 'paquete' as const, precio: 325,
    politica: null, nota: '', onNota: vi.fn(), enviando: false, onConfirmar: vi.fn(), timeZone: 'America/Mexico_City', t,
    ...extra,
  }
  const r = render(<ConfirmarReserva {...props} />)
  return { ...r, props }
}
const texto = () => document.body.textContent ?? ''

describe('ConfirmarReserva', () => {
  it('con un paquete de 5 con 4: resumen, «Usa 1 de tus 4 sesiones de Lagree», «A pagar hoy $0» y «Confirmar reserva»', () => {
    const { props } = pinta()
    expect(screen.getByRole('heading', { name: 'Confirma tu reserva' })).toBeTruthy()
    for (const [dato, valor] of [['Clase', 'Lagree'], ['Cuándo', 'Jue 8 · 15:00'], ['Coach', 'Fer Ruiz'], ['Lugar', '3']]) {
      expect(screen.getByText(dato).nextElementSibling?.textContent).toBe(valor)
    }
    expect(screen.getByText('Usa 1 de tus 4 sesiones de Lagree')).toBeTruthy()
    expect(screen.getByText('Paquete de 5 · vence el 11 dic')).toBeTruthy()
    expect(screen.getByText('A pagar hoy').nextElementSibling?.textContent).toBe('$0')
    // Un solo paquete y una clase que no acepta tarjeta: no hay otra forma de pagar.
    expect(screen.queryByRole('button', { name: 'Cambiar' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar reserva' }))
    expect(props.onConfirmar).toHaveBeenCalledTimes(1)
  })

  it('mientras se envía, el botón no responde', () => {
    const { props } = pinta({ enviando: true })
    const boton = screen.getByRole('button', { name: /Reservando/ }) as HTMLButtonElement
    expect(boton.disabled).toBe(true)
    fireEvent.click(boton)
    expect(props.onConfirmar).not.toHaveBeenCalled()
  })

  it('mientras carga su paquete, no deja confirmar (no se cobra con tarjeta a quien tiene paquete)', () => {
    const { props } = pinta({ cargando: true, opciones: [], elegida: null, pago: 'tarjeta' })
    expect(screen.getByText('Cargando tu paquete…')).toBeTruthy()
    const boton = screen.getByRole('button', { name: /Pagar|Confirmar/ }) as HTMLButtonElement
    expect(boton.disabled).toBe(true)
    fireEvent.click(boton)
    expect(props.onConfirmar).not.toHaveBeenCalled()
  })

  it('dos paquetes ⇒ «Cambiar» enseña los dos y elegir el otro avisa su balanceId', () => {
    const otro = paquete({ balanceId: 'b10', packName: 'Paquete de 10', restante: 9, original: 10, vence: '2027-01-20T18:00:00Z' })
    const { props } = pinta({ opciones: [paquete(), otro] })
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar' }))
    const grupo = screen.getByRole('radiogroup', { name: 'Cómo quieres pagar' })
    const radios = within(grupo).getAllByRole('radio')
    expect(radios).toHaveLength(2)
    expect(radios[0].getAttribute('aria-checked')).toBe('true')
    fireEvent.click(within(grupo).getByRole('radio', { name: /Usa 1 de tus 9 sesiones de Lagree/ }))
    expect(props.onElegir).toHaveBeenCalledWith('b10')
  })

  it('clase que acepta tarjeta: «Cambiar» también ofrece «Pagar $325 con tarjeta» (elegida = null)', () => {
    const { props } = pinta({ aceptaTarjeta: true })
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Pagar $325 con tarjeta' }))
    expect(props.onElegir).toHaveBeenCalledWith(null)
  })

  it('sin paquete y con pago en línea: «Pagar $325», y «A pagar hoy $325»', () => {
    const { props } = pinta({ opciones: [], elegida: null, pago: 'tarjeta', aceptaTarjeta: true })
    expect(screen.getByText('Pagar $325 con tarjeta')).toBeTruthy()
    expect(screen.getByText('A pagar hoy').nextElementSibling?.textContent).toBe('$325')
    expect(screen.queryByRole('button', { name: 'Cambiar' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Pagar $325' }))
    expect(props.onConfirmar).toHaveBeenCalledTimes(1)
  })

  it('se paga en el estudio: «Confirmar reserva», «A pagar hoy $0» y «A pagar en el estudio $325»', () => {
    pinta({ opciones: [], elegida: null, pago: 'estudio' })
    expect(screen.getByText('Pagas en el estudio')).toBeTruthy()
    expect(screen.getByText('A pagar hoy').nextElementSibling?.textContent).toBe('$0')
    expect(screen.getByText('A pagar en el estudio').nextElementSibling?.textContent).toBe('$325')
    expect(screen.getByRole('button', { name: 'Confirmar reserva' })).toBeTruthy()
  })

  it('clase gratis: «Confirmar reserva» y «A pagar hoy $0»', () => {
    pinta({ opciones: [], elegida: null, pago: 'gratis', precio: 0 })
    expect(screen.getByText('Clase sin costo')).toBeTruthy()
    expect(screen.getByText('A pagar hoy').nextElementSibling?.textContent).toBe('$0')
    expect(screen.getByRole('button', { name: 'Confirmar reserva' })).toBeTruthy()
  })

  it('un Ilimitado dice «Usa tu Ilimitado» y nunca su número interno', () => {
    pinta({ opciones: [ilimitado], elegida: 'u1' })
    expect(screen.getByText('Usa tu Ilimitado')).toBeTruthy()
    expect(screen.getByText('Mensual Ilimitado · vence el 20 dic')).toBeTruthy()
    expect(texto()).not.toMatch(/9999/)
  })

  it('dos lugares: «Usa 2 de tus 4 …» y «Lugares 1, 3»; con su última sesión, «Usa tu última sesión de Lagree»', () => {
    pinta({ lugares: ['1', '3'] })
    expect(screen.getByText('Usa 2 de tus 4 sesiones de Lagree')).toBeTruthy()
    expect(screen.getByText('Lugares').nextElementSibling?.textContent).toBe('1, 3')
    cleanup()
    pinta({ opciones: [paquete({ restante: 1 })] })
    expect(screen.getByText('Usa tu última sesión de Lagree')).toBeTruthy()
    cleanup()
    pinta({ opciones: [paquete({ soloEstaClase: false })] })
    expect(screen.getByText('Usa 1 de tus 4 créditos')).toBeTruthy()
  })

  it('«Otro lugar en esta clase» arriba, cuando se llegó desde «Reservar otro lugar para alguien»', () => {
    pinta({ otroLugar: true })
    expect(screen.getByText('Otro lugar en esta clase')).toBeTruthy()
  })

  it('la nota para su coach: «Agregar una nota…» abre el campo «Algo que tu coach deba saber (lesión, embarazo…)»', () => {
    const { props } = pinta()
    expect(screen.queryByLabelText('Algo que tu coach deba saber (lesión, embarazo…)')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Agregar una nota para tu coach' }))
    const campo = screen.getByLabelText('Algo que tu coach deba saber (lesión, embarazo…)') as HTMLTextAreaElement
    fireEvent.input(campo, { target: { value: 'Rodilla operada' } })
    expect(props.onNota).toHaveBeenCalledWith('Rodilla operada')
    cleanup()
    // Con una nota ya escrita el campo se ve abierto.
    pinta({ nota: 'Rodilla operada' })
    expect((screen.getByLabelText('Algo que tu coach deba saber (lesión, embarazo…)') as HTMLTextAreaElement).value).toBe('Rodilla operada')
  })

  it('la línea de política sólo si el SERVIDOR la mandó; el aviso del Ilimitado cuando no se ofrece', () => {
    pinta({ politica: 'Cancela gratis hasta el miércoles 7 a las 15:00 y la sesión regresa a tu paquete.' })
    expect(screen.getByText('Cancela gratis hasta el miércoles 7 a las 15:00 y la sesión regresa a tu paquete.')).toBeTruthy()
    cleanup()
    pinta({ opciones: [], elegida: null, pago: 'tarjeta', avisoIlimitado: 'Tu Ilimitado es personal: cubre 1 lugar a tu nombre' })
    expect(texto()).not.toMatch(/cancela/i)
    expect(screen.getByText('Tu Ilimitado es personal: cubre 1 lugar a tu nombre')).toBeTruthy()
  })

  it('sin precios (showPrices apagado): «Pagar con tarjeta» sin monto', () => {
    pinta({ opciones: [], elegida: null, pago: 'tarjeta', precio: null })
    expect(screen.getByRole('button', { name: 'Pagar con tarjeta' })).toBeTruthy()
    expect(texto()).not.toContain('$')
  })

  it('celular: fuera de `.avq-classes-main` suma 12 px por lado, botón fijo encima de la barra (`--avq-toast-offset`), 56 px', () => {
    const { container } = pinta()
    const css = container.querySelector('style')?.textContent ?? ''
    const celular = css.slice(css.indexOf('@media (max-width: 640px)'))
    expect(celular).toMatch(/\.avq-confirmar \{[^}]*padding-inline: 12px/)
    expect(celular).toMatch(/\.avq-cf-accion[^{]*\{[^}]*position: fixed[^}]*bottom: var\(--avq-toast-offset, 0px\)/)
    expect(celular).toMatch(/\.avq-cf-btn \{[^}]*min-height: 56px/)
    expect(celular).toMatch(/\.avq-cf-titulo \{[^}]*font-size: 28px/)
  })
})

describe('cuandoCorto', () => {
  it('«Jue 8 · 15:00» en la zona que se enseña', () => {
    expect(cuandoCorto('2026-10-08T21:00:00Z', 'America/Mexico_City', 'es')).toBe('Jue 8 · 15:00')
    expect(cuandoCorto('2026-10-08T21:00:00Z', 'America/Mexico_City', 'en')).toBe('Thu 8 · 3:00 PM')
  })
})

describe('RevisionDeLaReserva', () => {
  const acciones = () => ({ onIntentar: vi.fn(), onRevisar: vi.fn(), onVerMiReserva: vi.fn(), onVerMiCuenta: vi.fn(), onEscribir: vi.fn() })
  const datos = { clase: 'Lagree', dia: 'Jueves 8 de octubre', hora: '15:00', coach: 'Fer', lugares: ['3'] }

  it('revisando: sin botones', () => {
    render(<RevisionDeLaReserva estado="revisando" {...datos} puedeEscribir {...acciones()} t={t} />)
    expect(screen.getByText('Revisando si tu reserva quedó…')).toBeTruthy()
    expect(screen.getByText(/No toques nada; en un momento te decimos/)).toBeTruthy()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('quedó: «¡Tu lugar está apartado!» con la clase, el día, la hora y el lugar', () => {
    const a = acciones()
    render(<RevisionDeLaReserva estado="quedo" {...datos} puedeEscribir {...a} t={t} />)
    expect(screen.getByRole('heading', { name: '¡Tu lugar está apartado!' })).toBeTruthy()
    expect(texto()).toContain('Lagree')
    expect(texto()).toContain('Jueves 8 de octubre · 15:00')
    expect(texto()).toContain('Con Fer · Lugar 3')
    fireEvent.click(screen.getByRole('button', { name: 'Ver mi reserva' }))
    expect(a.onVerMiReserva).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: /Intentar/ })).toBeNull()
  })

  it('no quedó: el texto no afirma que no se guardó y «Intentar de nuevo» sólo al tocarlo', () => {
    const a = acciones()
    render(<RevisionDeLaReserva estado="no-quedo" {...datos} puedeEscribir {...a} t={t} />)
    expect(screen.getByText('No encontramos tu reserva')).toBeTruthy()
    expect(screen.getByText('No hay una reserva nueva a tu nombre en esta clase. Puedes intentarlo otra vez.')).toBeTruthy()
    expect(texto()).not.toMatch(/no se guardó|no se descontó|no se cobró/i)
    expect(a.onIntentar).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Intentar de nuevo' }))
    expect(a.onIntentar).toHaveBeenCalledTimes(1)
  })

  it('sin red: «Revisar de nuevo» (revisa, no reserva), nunca «Intentar de nuevo»', () => {
    const a = acciones()
    render(<RevisionDeLaReserva estado="sin-red" {...datos} puedeEscribir {...a} t={t} />)
    expect(screen.getByText('Sin conexión')).toBeTruthy()
    expect(texto()).toContain('Cuando vuelva el internet, toca «Revisar de nuevo»')
    expect(screen.queryByRole('button', { name: 'Intentar de nuevo' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Revisar de nuevo' }))
    expect(a.onRevisar).toHaveBeenCalledTimes(1)
    expect(a.onIntentar).not.toHaveBeenCalled()
  })

  it('no disponible: «Ver mi cuenta» e «Intentar de nuevo», nunca «Revisar de nuevo»', () => {
    const a = acciones()
    render(<RevisionDeLaReserva estado="no-disponible" {...datos} puedeEscribir {...a} t={t} />)
    expect(screen.getByText('No pudimos revisar si tu reserva quedó')).toBeTruthy()
    expect(screen.getByText('Antes de intentar de nuevo, revisa «Mi cuenta» o tu correo.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Revisar de nuevo' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Ver mi cuenta' }))
    fireEvent.click(screen.getByRole('button', { name: 'Intentar de nuevo' }))
    expect(a.onVerMiCuenta).toHaveBeenCalledTimes(1)
    expect(a.onIntentar).toHaveBeenCalledTimes(1)
  })

  it('cambio de cuenta: no enseña ninguna reserva', () => {
    render(<RevisionDeLaReserva estado="cambio-de-cuenta" {...datos} puedeEscribir {...acciones()} t={t} />)
    expect(screen.getByText('No pudimos confirmar tu reserva')).toBeTruthy()
    expect(screen.getByText('Revisa «Mi cuenta».')).toBeTruthy()
    expect(texto()).not.toMatch(/Lagree|Lugar 3|apartado/)
    expect(screen.queryByRole('button', { name: /Intentar/ })).toBeNull()
  })

  it.each([
    ['invitada-aviso', 'Si te llega la confirmación por correo o WhatsApp, tu lugar ya está apartado; si no te llega en unos minutos, intenta de nuevo.'],
    ['invitada-escribe', 'Escríbele al estudio antes de intentar de nuevo, para no apartar dos lugares.'],
  ] as const)('invitada (%s): su texto, «Intentar de nuevo» y «Escribir al estudio» sólo si el negocio recibe mensajes', (estado, sub) => {
    const a = acciones()
    const { unmount } = render(<RevisionDeLaReserva estado={estado} {...datos} puedeEscribir {...a} t={t} />)
    expect(screen.getByText('No pudimos confirmar si tu reserva quedó')).toBeTruthy()
    expect(screen.getByText(sub)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Escribir al estudio' }))
    expect(a.onEscribir).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Intentar de nuevo' }))
    expect(a.onIntentar).toHaveBeenCalledTimes(1)
    unmount()
    render(<RevisionDeLaReserva estado={estado} {...datos} puedeEscribir={false} {...acciones()} t={t} />)
    expect(screen.queryByRole('button', { name: 'Escribir al estudio' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Intentar de nuevo' })).toBeTruthy()
  })

  it.each([
    ['quedo-falta-pagar', 'Tu lugar quedó apartado, pero falta pagar'],
    ['quedo-por-aprobar', 'Tu reserva quedó y espera la aprobación del estudio'],
  ] as const)('%s: «%s» y «Ver mi reserva»', (estado, titulo) => {
    const a = acciones()
    render(<RevisionDeLaReserva estado={estado} {...datos} puedeEscribir {...a} t={t} />)
    expect(screen.getByRole('heading', { name: titulo })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Ver mi reserva' }))
    expect(a.onVerMiReserva).toHaveBeenCalledTimes(1)
  })
})
