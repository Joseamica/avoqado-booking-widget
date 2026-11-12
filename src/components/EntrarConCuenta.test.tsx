import { h } from 'preact'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EntrarConCuenta } from './EntrarConCuenta'
import * as api from '../api/booking'
import { createT } from '../i18n'
import { borrarSesion, guardarSesion, leerSesion, type ContactoProbado } from '../lib/sesionDeCliente'
import { bindCustomerSessionToVenue, clearCustomerSession } from '../state/booking'
import es from '../i18n/es.json'
import en from '../i18n/en.json'

vi.mock('../api/booking', async importOriginal => {
  const real = await importOriginal<typeof import('../api/booking')>()
  return { ...real, requestOtp: vi.fn(), verifyOtp: vi.fn(), entrarConGoogle: vi.fn(), crearFichaNueva: vi.fn() }
})

const dom = (globalThis as any).jsdom as { reconfigure(o: { url: string }): void; cookieJar: any }
const SLUG = 'mindform'
const TEL: ContactoProbado = { tipo: 'PHONE', valor: '+525544422262', metodo: 'WHATSAPP', probadoEn: 1 }
const CORREO: ContactoProbado = { tipo: 'EMAIL', valor: 'ana@correo.mx', metodo: 'EMAIL_CODE', probadoEn: 1 }
const sesion = (contactos: ContactoProbado[] = [TEL], extra: object = {}) => ({
  token: 'tok-sesion',
  customer: { id: 'c1', firstName: 'Ana', lastName: null, email: null, phone: '+525544422262' },
  contactos,
  otraFicha: null,
  ...extra,
})
/** Un error como los que lanza `api/booking` (`request`). */
const fallo = (status: number, data: { message: string; code?: string }) => Object.assign(new Error(data.message), { status, data })
/** Un id token de Google de mentira: sólo importa el correo de su parte del medio. */
const idToken = (email: string) => `h.${btoa(JSON.stringify({ email })).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')}.f`

let onEntro: ReturnType<typeof vi.fn<(s: unknown) => void>>
function show(locale: 'es' | 'en' = 'es') {
  onEntro = vi.fn<(s: unknown) => void>()
  return render(<EntrarConCuenta slug={SLUG} negocio="Mindform" t={createT(locale)} onEntro={onEntro} />)
}
const boton = (name: string | RegExp) => screen.getByRole('button', { name })
const escribir = (el: HTMLElement, value: string) => fireEvent.input(el, { target: { value } })
async function codigoPorWhatsApp(numero = '5544422262') {
  fireEvent.click(boton('Seguir con WhatsApp'))
  escribir(screen.getByPlaceholderText('Tu número de teléfono'), numero)
  fireEvent.click(boton('Enviar código'))
  await screen.findByText(/^Pedimos tu código por WhatsApp/)
}
const teclearCodigo = (code = '123456') => escribir(screen.getAllByRole('textbox')[0], code)

beforeEach(() => {
  dom.reconfigure({ url: 'http://localhost:3000/' })
  localStorage.clear()
  borrarSesion(SLUG)
  delete (window as any).google
  vi.mocked(api.requestOtp).mockResolvedValue({ ok: true })
})
afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('W2: entrar a la cuenta', () => {
  it('WhatsApp primero; correo de respaldo; Google sólo con su id y en avoqado.io', async () => {
    show()
    expect(screen.getByRole('heading', { name: 'Entra a tu cuenta' })).toBeTruthy()
    expect(screen.getByText('Para usar tus premios, puntos y saldo en Mindform. Sin contraseña: te mandamos un código.')).toBeTruthy()
    expect(screen.getAllByRole('button').map(b => b.textContent)).toEqual(['Seguir con WhatsApp', 'Seguir con correo'])
    cleanup()

    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'cliente.apps.googleusercontent.com')
    const renderButton = vi.fn()
    ;(window as any).google = { accounts: { id: { initialize: vi.fn(), renderButton } } }
    // Incrustado en la página del negocio, Google no reconoce el origen: no se ofrece.
    dom.reconfigure({ url: 'https://www.mindform.mx/' })
    show()
    expect(renderButton).not.toHaveBeenCalled()
    cleanup()

    dom.reconfigure({ url: 'https://book.avoqado.io/mindform' })
    show()
    await act(async () => {})
    expect(renderButton).toHaveBeenCalledTimes(1)
    const lista = screen.getByTestId('avq-entrar-opciones')
    // El botón de Google va al final, debajo de WhatsApp y correo.
    expect(lista.lastElementChild?.getAttribute('data-testid')).toBe('avq-entrar-google')
  })

  it('Google oculto dentro de Instagram o Facebook: dice que abra la página en su navegador', () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'cliente.apps.googleusercontent.com')
    const renderButton = vi.fn()
    ;(window as any).google = { accounts: { id: { initialize: vi.fn(), renderButton } } }
    dom.reconfigure({ url: 'https://pedidos.avoqado.io/mindform' })
    for (const ua of [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram 300.0.0',
      'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/440.0.0]',
    ]) {
      vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua)
      show()
      expect(screen.getByText('Para entrar con Google, abre esta página en tu navegador')).toBeTruthy()
      cleanup()
    }
    expect(renderButton).not.toHaveBeenCalled()
  })

  it('Google confiable ⇒ entra; correo no confiable ⇒ el código llega a su correo y se confirma ahí', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'cliente.apps.googleusercontent.com')
    let alEntrar: (r: { credential: string }) => void = () => {}
    ;(window as any).google = {
      accounts: { id: { initialize: vi.fn(o => { alEntrar = o.callback }), renderButton: vi.fn() } },
    }
    dom.reconfigure({ url: 'https://book.avoqado.io/mindform' })
    vi.mocked(api.entrarConGoogle).mockRejectedValueOnce(
      fallo(409, { code: 'GOOGLE_EMAIL_NOT_TRUSTED', message: 'Te mandamos un código a tu correo para confirmarlo' }),
    )
    show()
    await act(async () => {}) // el script de Google (aquí, de mentira) responde después de pintar
    await act(async () => { alEntrar({ credential: idToken('ana@empresa.mx') }) })
    expect(api.entrarConGoogle).toHaveBeenCalledWith(SLUG, { idToken: idToken('ana@empresa.mx') })
    expect(await screen.findByText('Te mandamos un código a tu correo para confirmarlo')).toBeTruthy()
    expect(screen.getByText(/^Pedimos tu código por correo a ana@empresa\.mx\./)).toBeTruthy()
    // El SERVIDOR ya lo mandó: la tienda no pide otro (y no deja reenviar antes de 30 s).
    expect(api.requestOtp).not.toHaveBeenCalled()
    expect((boton(/Reenviar/) as HTMLButtonElement).disabled).toBe(true)

    vi.mocked(api.verifyOtp).mockResolvedValueOnce(sesion([{ ...CORREO, valor: 'ana@empresa.mx' }]) as any)
    teclearCodigo()
    await waitFor(() => expect(onEntro).toHaveBeenCalled())
    expect(api.verifyOtp).toHaveBeenCalledWith(SLUG, { email: 'ana@empresa.mx', code: '123456' })

    // Confiable: entra directo.
    cleanup()
    vi.mocked(api.entrarConGoogle).mockResolvedValueOnce(sesion([{ ...CORREO, metodo: 'GOOGLE' }]) as any)
    show()
    await act(async () => {})
    await act(async () => { alEntrar({ credential: idToken('ana@correo.mx') }) })
    await waitFor(() => expect(onEntro).toHaveBeenCalledTimes(1))
    expect(leerSesion(SLUG)?.contactos[0].metodo).toBe('GOOGLE')
  })

  it('codex-r8 H3: un código que se verifica después de «Cerrar sesión» no guarda nada ni entra', async () => {
    guardarSesion(SLUG, { ...sesion(), guardadaEn: Date.now() } as any)
    bindCustomerSessionToVenue(SLUG) // la página abierta con su sesión (el portal de al lado)
    let llega!: (v: unknown) => void
    vi.mocked(api.verifyOtp).mockImplementationOnce(() => new Promise(r => { llega = r }) as any)
    show()
    await codigoPorWhatsApp('52 55 4442 2262')
    teclearCodigo()
    await act(async () => { clearCustomerSession(SLUG) }) // «Cerrar sesión» en el portal mientras se verifica
    await act(async () => { llega({ ...sesion(), token: 'tok-tarde' }) })
    await act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve() })
    expect(leerSesion(SLUG)).toBeNull()
    expect(onEntro).not.toHaveBeenCalled()
  })

  it('con ficha: el código deja la sesión en W1 y avisa que entró', async () => {
    vi.mocked(api.verifyOtp).mockResolvedValueOnce(sesion() as any)
    show()
    await codigoPorWhatsApp('52 55 4442 2262')
    expect(api.requestOtp).toHaveBeenCalledWith(SLUG, { phone: '+525544422262' })
    teclearCodigo()
    await waitFor(() => expect(onEntro).toHaveBeenCalledTimes(1))
    expect(api.verifyOtp).toHaveBeenCalledWith(SLUG, { phone: '+525544422262', code: '123456' })
    expect(leerSesion(SLUG)).toEqual({
      token: 'tok-sesion', customer: sesion().customer, contactos: [TEL], guardadaEn: expect.any(Number),
    })
    expect(onEntro.mock.calls[0][0]).toMatchObject({ token: 'tok-sesion', contactos: [TEL] })
  })

  it('sin ficha ⇒ «¿Ya eres cliente…?»; «No» pide su nombre y crea la ficha con la prueba', async () => {
    vi.mocked(api.verifyOtp).mockResolvedValueOnce({ fichaNueva: true, pruebaPendiente: 'prueba-del-whatsapp' } as any)
    vi.mocked(api.crearFichaNueva).mockResolvedValueOnce(sesion() as any)
    show()
    await codigoPorWhatsApp('55 4442 2262')
    teclearCodigo()
    expect(await screen.findByRole('heading', { name: '¿Ya eres cliente de Mindform?' })).toBeTruthy()
    expect(screen.getByText(/No encontramos una cuenta con el 55 4442 2262\./)).toBeTruthy()
    const si = boton('Sí, con otro teléfono o correo')
    const no = boton('No, es mi primera vez')
    // Los dos pesan igual: un «No» por prisa le crea una ficha en cero.
    expect(si.getAttribute('style')).toBe(no.getAttribute('style'))
    expect(leerSesion(SLUG)).toBeNull()

    fireEvent.click(no)
    fireEvent.click(await screen.findByRole('button', { name: 'Crear mi cuenta' }))
    expect(await screen.findByText('Escribe tu nombre.')).toBeTruthy()
    expect(api.crearFichaNueva).not.toHaveBeenCalled()
    escribir(screen.getByLabelText('¿Cómo te llamas?'), '  Ana  ')
    fireEvent.click(boton('Crear mi cuenta'))
    await waitFor(() => expect(onEntro).toHaveBeenCalledTimes(1))
    expect(api.crearFichaNueva).toHaveBeenCalledWith(SLUG, { pruebaPendiente: 'prueba-del-whatsapp', firstName: 'Ana' })
    expect(leerSesion(SLUG)?.token).toBe('tok-sesion')
  })

  it('«Sí» prueba el otro contacto con `vincular` y entra a ESA ficha con los dos', async () => {
    vi.mocked(api.verifyOtp)
      .mockResolvedValueOnce({ fichaNueva: true, pruebaPendiente: 'prueba-del-whatsapp' } as any)
      .mockResolvedValueOnce(sesion([CORREO, TEL]) as any)
    show()
    await codigoPorWhatsApp()
    teclearCodigo()
    fireEvent.click(await screen.findByRole('button', { name: 'Sí, con otro teléfono o correo' }))
    expect(screen.getByRole('heading', { name: 'Entra con tu otro teléfono o correo' })).toBeTruthy()
    fireEvent.click(boton('Seguir con correo'))
    escribir(screen.getByPlaceholderText('tucorreo@email.com'), ' ana@correo.mx ')
    fireEvent.click(boton('Enviar código'))
    await screen.findByText(/^Pedimos tu código por correo/)
    expect(api.requestOtp).toHaveBeenLastCalledWith(SLUG, { email: 'ana@correo.mx' })
    teclearCodigo('654321')
    await waitFor(() => expect(onEntro).toHaveBeenCalledTimes(1))
    expect(api.verifyOtp).toHaveBeenLastCalledWith(SLUG, { email: 'ana@correo.mx', code: '654321', vincular: 'prueba-del-whatsapp' })
    expect(leerSesion(SLUG)?.contactos).toEqual([CORREO, TEL])
  })

  it('«Sí» con un contacto que tampoco tiene ficha ⇒ vuelve a preguntar; «No» crea con la PRIMERA prueba', async () => {
    vi.mocked(api.verifyOtp)
      .mockResolvedValueOnce({ fichaNueva: true, pruebaPendiente: 'prueba-del-whatsapp' } as any)
      .mockResolvedValueOnce({ fichaNueva: true, pruebaPendiente: 'prueba-del-correo' } as any)
    vi.mocked(api.crearFichaNueva).mockResolvedValueOnce(sesion() as any)
    show()
    await codigoPorWhatsApp()
    teclearCodigo()
    fireEvent.click(await screen.findByRole('button', { name: 'Sí, con otro teléfono o correo' }))
    fireEvent.click(boton('Seguir con correo'))
    escribir(screen.getByPlaceholderText('tucorreo@email.com'), 'otro@correo.mx')
    fireEvent.click(boton('Enviar código'))
    await screen.findByText(/^Pedimos tu código por correo/)
    teclearCodigo()
    expect(await screen.findByText(/Tampoco encontramos una cuenta con otro@correo\.mx\./)).toBeTruthy()
    fireEvent.click(boton('No, es mi primera vez'))
    escribir(screen.getByLabelText('¿Cómo te llamas?'), 'Ana')
    fireEvent.click(boton('Crear mi cuenta'))
    await waitFor(() => expect(onEntro).toHaveBeenCalled())
    expect(api.crearFichaNueva).toHaveBeenCalledWith(SLUG, { pruebaPendiente: 'prueba-del-whatsapp', firstName: 'Ana' })
  })

  it('otraFicha ⇒ «Tienes beneficios en otra ficha…» (sin prometer unirlas); «Seguir» entra, «Entrar con mi correo» va al correo', async () => {
    const conOtra = sesion([TEL], { otraFicha: { contacto: 'EMAIL', enmascarado: 'a•••@correo.mx' } })
    vi.mocked(api.verifyOtp).mockResolvedValue(conOtra as any)
    show()
    await codigoPorWhatsApp()
    teclearCodigo()
    expect(await screen.findByRole('heading', { name: 'Tienes beneficios en otra ficha' })).toBeTruthy()
    expect(screen.getByText('Con tu correo: entra con ese correo para usarlos.')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/unir|juntar/i)
    // Ya entró: la sesión está guardada aunque cierre aquí.
    expect(leerSesion(SLUG)?.token).toBe('tok-sesion')
    expect(onEntro).not.toHaveBeenCalled()
    fireEvent.click(boton('Entrar con mi correo'))
    expect(screen.getByPlaceholderText('tucorreo@email.com')).toBeTruthy()

    cleanup()
    show()
    await codigoPorWhatsApp()
    teclearCodigo()
    fireEvent.click(await screen.findByRole('button', { name: 'Seguir' }))
    expect(onEntro).toHaveBeenCalledWith(conOtra)
  })

  it('codex-r3 H6: «Seguir» en el aviso de otra ficha no revive una sesión que ya se cerró', async () => {
    vi.mocked(api.verifyOtp).mockResolvedValueOnce(sesion([TEL], { otraFicha: { contacto: 'EMAIL', enmascarado: 'a•••@correo.mx' } }) as any)
    show()
    await codigoPorWhatsApp()
    teclearCodigo()
    await screen.findByRole('heading', { name: 'Tienes beneficios en otra ficha' })
    borrarSesion(SLUG) // salió en la otra página mientras el aviso estaba abierto
    fireEvent.click(boton('Seguir'))
    expect(onEntro).not.toHaveBeenCalled()
    expect(leerSesion(SLUG)).toBeNull()
    expect(screen.getByText('Tu sesión se cerró. Entra otra vez.')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Entra a tu cuenta' })).toBeTruthy()
  })

  it('codex-r3 H7: si el navegador no deja guardar la sesión, lo dice y no entra', async () => {
    dom.reconfigure({ url: 'https://www.mindform.mx/' })
    const real = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      if (k.startsWith('avq_sesion:')) throw new DOMException('lleno', 'QuotaExceededError')
      return real.call(this, k, v)
    })
    vi.mocked(api.verifyOtp).mockResolvedValueOnce(sesion() as any)
    show()
    await codigoPorWhatsApp()
    teclearCodigo()
    expect(await screen.findByText('No pudimos guardar tu sesión en este navegador.')).toBeTruthy()
    expect(onEntro).not.toHaveBeenCalled()
  })

  it('sin red: lo dice con todas sus letras y no borra lo que escribió', async () => {
    vi.mocked(api.requestOtp).mockRejectedValueOnce(new TypeError('Failed to fetch'))
    show()
    fireEvent.click(boton('Seguir con WhatsApp'))
    const numero = screen.getByPlaceholderText('Tu número de teléfono') as HTMLInputElement
    escribir(numero, '5544422262')
    fireEvent.click(boton('Enviar código'))
    expect(await screen.findByText('Sin conexión. Revisa tu internet y vuelve a intentar.')).toBeTruthy()
    expect(numero.value).toBe('5544422262')
    expect((boton('Enviar código') as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(boton('Enviar código'))
    await screen.findByText(/^Pedimos tu código por WhatsApp/)
  })

  it('codex-r2 #6: sin red al verificar, el código escrito se queda (sólo un rechazo del servidor lo borra)', async () => {
    vi.mocked(api.verifyOtp).mockRejectedValueOnce(new TypeError('Failed to fetch'))
    show()
    await codigoPorWhatsApp()
    teclearCodigo('123456')
    expect(await screen.findByText('Sin conexión. Revisa tu internet y vuelve a intentar.')).toBeTruthy()
    expect(screen.getAllByRole('textbox').map(c => (c as HTMLInputElement).value).join('')).toBe('123456')
    vi.mocked(api.verifyOtp).mockResolvedValueOnce(sesion() as any)
    fireEvent.click(boton('Entrar'))
    await waitFor(() => expect(onEntro).toHaveBeenCalledTimes(1))
  })

  it('campo vacío ⇒ dice qué falta (no un botón gris mudo); código equivocado ⇒ el mensaje y otra oportunidad', async () => {
    show()
    fireEvent.click(boton('Seguir con WhatsApp'))
    fireEvent.click(boton('Enviar código'))
    expect(await screen.findByText('Escribe tu número de WhatsApp.')).toBeTruthy()
    expect(api.requestOtp).not.toHaveBeenCalled()
    fireEvent.click(boton('Atrás'))
    fireEvent.click(boton('Seguir con correo'))
    fireEvent.click(boton('Enviar código'))
    expect(await screen.findByText('Escribe tu correo.')).toBeTruthy()

    vi.mocked(api.verifyOtp).mockRejectedValueOnce(fallo(400, { message: 'Código incorrecto.' }))
    fireEvent.click(boton('Atrás'))
    await codigoPorWhatsApp()
    teclearCodigo('000000')
    expect(await screen.findByText('Código incorrecto.')).toBeTruthy()
    expect((screen.getAllByRole('textbox')[0] as HTMLInputElement).value).toBe('')
  })

  it('la prueba venció (15 min) ⇒ lo dice y regresa al inicio', async () => {
    vi.mocked(api.verifyOtp).mockResolvedValueOnce({ fichaNueva: true, pruebaPendiente: 'prueba-vieja' } as any)
    vi.mocked(api.crearFichaNueva).mockRejectedValueOnce(
      fallo(400, { code: 'CUSTOMER_PROOF_INVALID', message: 'Tu verificación ya no sirve. Pide un código nuevo.' }),
    )
    show()
    await codigoPorWhatsApp()
    teclearCodigo()
    fireEvent.click(await screen.findByRole('button', { name: 'No, es mi primera vez' }))
    escribir(screen.getByLabelText('¿Cómo te llamas?'), 'Ana')
    fireEvent.click(boton('Crear mi cuenta'))
    expect(await screen.findByText('Pasó mucho tiempo: pide un código nuevo para continuar.')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Entra a tu cuenta' })).toBeTruthy()
    expect(onEntro).not.toHaveBeenCalled()
  })

  it('en inglés, con las mismas llaves que en español', () => {
    show('en')
    expect(screen.getByRole('heading', { name: 'Sign in to your account' })).toBeTruthy()
    expect(boton('Continue with WhatsApp')).toBeTruthy()
    const llaves = (o: any, p = ''): string[] =>
      Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? llaves(v, `${p}${k}.`) : [`${p}${k}`])).sort()
    expect(llaves((en as any).entrar)).toEqual(llaves((es as any).entrar))
  })
})

describe('D17 / codex-w5w6-r1 #4: el SERVIDOR no garantiza que el código salió ⇒ la tienda no promete «Te enviamos»', () => {
  it('WhatsApp: «Pedimos tu código por WhatsApp al 55 4442 2262. Si no te llega en un minuto, revisa el número o pide otro.»', async () => {
    show()
    fireEvent.click(boton('Seguir con WhatsApp'))
    escribir(screen.getByPlaceholderText('Tu número de teléfono'), '52 55 4442 2262')
    fireEvent.click(boton('Enviar código'))
    expect(await screen.findByText('Pedimos tu código por WhatsApp al 55 4442 2262. Si no te llega en un minuto, revisa el número o pide otro.')).toBeTruthy()
    expect(screen.queryByText(/Te enviamos/)).toBeNull()
  })
  it('correo: «Pedimos tu código por correo a ana@correo.mx. Si no te llega en un minuto, revisa el correo o pide otro.»', async () => {
    show()
    fireEvent.click(boton('Seguir con correo'))
    escribir(screen.getByPlaceholderText('tucorreo@email.com'), ' ana@correo.mx ')
    fireEvent.click(boton('Enviar código'))
    expect(await screen.findByText('Pedimos tu código por correo a ana@correo.mx. Si no te llega en un minuto, revisa el correo o pide otro.')).toBeTruthy()
    expect(screen.queryByText(/Te enviamos/)).toBeNull()
  })
  it('en inglés', async () => {
    show('en')
    fireEvent.click(boton('Continue with WhatsApp'))
    escribir(screen.getByPlaceholderText('Your phone number'), '5544422262')
    fireEvent.click(boton('Send code'))
    expect(await screen.findByText("We requested your code on WhatsApp for 55 4442 2262. If it doesn't arrive within a minute, check the number or request another one.")).toBeTruthy()
  })
})
