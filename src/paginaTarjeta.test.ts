// La página del cartel del mostrador (book.avoqado.io/<negocio>/tarjeta) NO es el widget de Preact: es el script en
// línea de public/index.html (`runStampCard`). Esta prueba corre ESE script tal cual, en el jsdom de vitest y con un
// `fetch` falso, y mira qué le manda al servidor. Así se encontró, el 14-oct-2026, por qué 40 de 41 altas de
// Testarudo llegaban como '+5544422262' (sin el 52).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import paginaHospedada from '../public/index.html?raw'

const API = 'https://api.test/api/v1/public'
type RespuestaFalsa = { ok: boolean; json: () => Promise<unknown> }
const fetchMock = vi.fn<(url: string, init?: { body?: string }) => Promise<RespuestaFalsa>>()

function scriptDeLaPagina(): string {
  const m = /<script>([\s\S]*?)<\/script>/.exec(paginaHospedada)
  if (!m) throw new Error('no encontré el <script> en línea de public/index.html')
  return m[1]
}
function respuesta(body: unknown, ok = true): RespuestaFalsa {
  return { ok, json: async () => body }
}
async function esperar() {
  for (let i = 0; i < 6; i++) await new Promise(r => setTimeout(r, 0))
}
function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id)
  if (!e) throw new Error(`no está #${id}`)
  return e as T
}
function llamadas(sufijo: string): { url: string; body: any }[] {
  return fetchMock.mock.calls
    .filter(([url]) => url.endsWith(sufijo))
    .map(([url, init]) => ({ url, body: init?.body ? JSON.parse(init.body) : undefined }))
}
async function abrirPagina() {
  new Function(scriptDeLaPagina())()
  await esperar()
}
async function pedirCodigo(nombre: string, telefono: string) {
  el<HTMLInputElement>('avq-nombre').value = nombre
  el<HTMLInputElement>('avq-tel').value = telefono
  el<HTMLButtonElement>('avq-enviar').click()
  await esperar()
}
async function verificar(codigo = '123456') {
  el<HTMLInputElement>('avq-cod').value = codigo
  el<HTMLButtonElement>('avq-ver').click()
  await esperar()
}
function textoDeLaPagina(): string {
  return el<HTMLElement>('mount').textContent ?? ''
}

beforeEach(() => {
  document.body.innerHTML = '<nav id="topnav"></nav><main id="mount"></main>'
  window.history.replaceState({}, '', '/testarudo/tarjeta')
  ;(window as unknown as { AVQ_API_URL?: string }).AVQ_API_URL = API
  fetchMock.mockReset()
  fetchMock.mockImplementation(async url => {
    if (url.endsWith('/stamp-card')) {
      return respuesta({ stampsEnabled: true, stampsRequired: 7, rewardLabel: 'Un café', venue: { name: 'Testarudo', logo: null } })
    }
    if (url.endsWith('/auth/otp/verify')) return respuesta({ token: 'tok', customer: { id: 'c1' } })
    return respuesta({ ok: true })
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
  delete (window as unknown as { AVQ_API_URL?: string }).AVQ_API_URL
})

describe('página del cartel: «¿Cómo te llamas?» es obligatorio', () => {
  it('pide el nombre en el paso del teléfono, con tope de 60', async () => {
    await abrirPagina()
    expect(document.querySelector('label[for="avq-nombre"]')?.textContent).toBe('¿Cómo te llamas?')
    expect(el<HTMLInputElement>('avq-nombre').getAttribute('maxlength')).toBe('60')
  })

  it('sin nombre no pide el código, lo dice en español y no borra el teléfono', async () => {
    await abrirPagina()
    await pedirCodigo('   ', '55 4442 2262')
    expect(llamadas('/auth/otp/request')).toHaveLength(0)
    expect(textoDeLaPagina()).toContain('Escribe tu nombre.')
    expect(el<HTMLInputElement>('avq-tel').value).toBe('55 4442 2262')
  })

  it('un teléfono corto conserva el nombre escrito', async () => {
    await abrirPagina()
    await pedirCodigo('Ana', '55 44')
    expect(llamadas('/auth/otp/request')).toHaveLength(0)
    expect(textoDeLaPagina()).toContain('Escribe los 10 dígitos de tu teléfono.')
    expect(el<HTMLInputElement>('avq-nombre').value).toBe('Ana')
  })

  it('manda el nombre, sin espacios sobrantes, como firstName al verificar', async () => {
    await abrirPagina()
    await pedirCodigo('  Ana María  ', '5544422262')
    await verificar('123456')
    const [verify] = llamadas('/auth/otp/verify')
    expect(verify.body.firstName).toBe('Ana María')
    expect(verify.body.code).toBe('123456')
  })

  it('«Usar otro teléfono» regresa con el nombre ya escrito', async () => {
    await abrirPagina()
    await pedirCodigo('Ana', '5544422262')
    el<HTMLButtonElement>('avq-otro').click()
    await esperar()
    expect(el<HTMLInputElement>('avq-nombre').value).toBe('Ana')
  })
})

describe('página del cartel: el teléfono viaja con lada (antes llegaba como "+" + 10 dígitos)', () => {
  it.each([
    ['5544422262', '+525544422262'],
    ['55 4442 2262', '+525544422262'],
    ['(55) 4442-2262', '+525544422262'],
    ['525544422262', '+525544422262'],
    ['+52 55 4442 2262', '+525544422262'],
    ['5215544422262', '+525544422262'],
    ['+52 1 55 4442 2262', '+525544422262'],
  ])('escrito «%s» ⇒ %s, en request y en verify', async (escrito, esperado) => {
    await abrirPagina()
    await pedirCodigo('Ana', escrito)
    expect(llamadas('/auth/otp/request').map(l => l.body)).toEqual([{ phone: esperado }])
    await verificar()
    expect(llamadas('/auth/otp/verify')[0].body.phone).toBe(esperado)
  })

  it('un número de otro país escrito con su lada completa no se toca', async () => {
    await abrirPagina()
    await pedirCodigo('John', '+1 512 555 1234')
    expect(llamadas('/auth/otp/request')[0].body).toEqual({ phone: '+15125551234' })
  })
})
