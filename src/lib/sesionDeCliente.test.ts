import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { aplicarRenovacion, borrarSesion, guardarSesion, leerSesion, type SesionDeCliente } from './sesionDeCliente'
import { createOrder } from '../order/api'
import { createReservation, getCustomerCredits, getCustomerPortal, updateCustomerProfile } from '../api/booking'
import { loadSession } from '../order/session'
import * as estado from '../state/booking'

// La ventana de jsdom de vitest: cambiar de página sin perder las cookies (el mismo «navegador»).
const dom = (globalThis as any).jsdom as { reconfigure(o: { url: string }): void; cookieJar: any }
const irA = (url: string) => dom.reconfigure({ url })

const S: SesionDeCliente = {
  token: 'tok-1',
  customer: { id: 'ccust0000000000000000001', firstName: 'Ana', lastName: null, email: null, phone: '+525512345678' },
  contactos: [{ tipo: 'PHONE', valor: '+525512345678', metodo: 'WHATSAPP', probadoEn: 1_794_000_000 }],
  guardadaEn: Date.now(),
}

beforeEach(() => {
  irA('http://localhost:3000/')
  localStorage.clear()
  dom.cookieJar.removeAllCookiesSync()
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  estado.clearCustomerSession('mindform') // «Salir»: lo guardado y la página
})

describe('W1: una sola sesión de cliente por negocio', () => {
  it('en book.avoqado.io guarda la cookie de avoqado.io y pedidos.avoqado.io la lee', () => {
    irA('https://book.avoqado.io/mindform')
    guardarSesion('mindform', S)
    expect(localStorage.getItem('avq_sesion:mindform')).toBeNull()
    const [cookie] = dom.cookieJar.getCookiesSync('https://pedidos.avoqado.io/')
    expect(cookie).toMatchObject({ key: 'avq_sesion_mindform', domain: 'avoqado.io', path: '/', secure: true, sameSite: 'lax', maxAge: 2592000 })

    irA('https://pedidos.avoqado.io/mindform')
    expect(leerSesion('mindform')).toEqual(S)
    // Otro negocio no la ve.
    expect(leerSesion('flautas')).toBeNull()
  })

  it('incrustado en otro dominio usa localStorage (no deja cookie)', () => {
    irA('https://www.mindform.mx/reservar')
    guardarSesion('mindform', S)
    expect(JSON.parse(localStorage.getItem('avq_sesion:mindform')!)).toEqual(S)
    expect(document.cookie).toBe('')
    expect(leerSesion('mindform')).toEqual(S)
  })

  it('la cabecera de renovación reemplaza la sesión (sólo si la guardada es la que se mandó)', () => {
    irA('https://pedidos.avoqado.io/mindform')
    guardarSesion('mindform', S)
    aplicarRenovacion('mindform', new Headers({ 'x-customer-session': 'tok-2' }), 'tok-1')
    expect(leerSesion('mindform')).toMatchObject({ token: 'tok-2', customer: S.customer, contactos: S.contactos })
    // Una respuesta tardía de una sesión que ya cambió no la pisa (sería volver a otra ficha o a la versión vieja).
    aplicarRenovacion('mindform', new Headers({ 'x-customer-session': 'tok-viejo-renovado' }), 'tok-1')
    expect(leerSesion('mindform')!.token).toBe('tok-2')
    // Sin cabecera, nada.
    aplicarRenovacion('mindform', new Headers(), 'tok-2')
    expect(leerSesion('mindform')!.token).toBe('tok-2')
  })

  it('la renovación llega por las dos APIs: al pedir y en «Mi cuenta»', async () => {
    guardarSesion('mindform', S)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: false, code: 'PRICE_CHANGED', error: 'Cambió el precio' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json', 'x-customer-session': 'tok-2' },
      }),
    )
    const body = { items: [], paymentMode: 'PAY_AT_PICKUP', expectedTotal: '0.00', customer: { name: 'Ana' } } as any
    await createOrder('mindform', body, { idempotencyKey: 'k'.repeat(32), token: 'tok-1' }).catch(() => {})
    expect(leerSesion('mindform')!.token).toBe('tok-2')

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ customer: S.customer }), { status: 200, headers: { 'x-customer-session': 'tok-3' } }),
    )
    estado.bindCustomerSessionToVenue('mindform')
    estado.entroAqui('mindform') // la página de reservas tiene la sesión (ya renovada)
    await getCustomerPortal('mindform', estado.customerToken.value!)
    expect(leerSesion('mindform')!.token).toBe('tok-3')
  })

  it('«Salir» borra la cookie y las dos llaves de hoy', () => {
    irA('https://book.avoqado.io/mindform')
    guardarSesion('mindform', S)
    localStorage.setItem('avq_order_session:mindform', '{"token":"pedidos-de-hoy"}')
    localStorage.setItem('avq_customer_token:mindform', 'reservas-de-hoy')
    localStorage.setItem('avq_customer_info:mindform', '{}')
    localStorage.setItem('avq_customer_token:flautas', 'otro-negocio')
    borrarSesion('mindform')
    expect(leerSesion('mindform')).toBeNull()
    // Sólo queda la marca «salió» (para que la otra página suelte su token de hoy), no la sesión.
    expect(dom.cookieJar.getCookiesSync('https://pedidos.avoqado.io/').map((c: any) => c.key)).toEqual(['avq_salio_mindform'])
    expect(localStorage.getItem('avq_order_session:mindform')).toBeNull()
    expect(localStorage.getItem('avq_customer_token:mindform')).toBeNull()
    expect(localStorage.getItem('avq_customer_info:mindform')).toBeNull()
    expect(localStorage.getItem('avq_customer_token:flautas')).toBe('otro-negocio')
  })

  it('sin almacenamiento vive en memoria (y «Salir» también la borra de ahí)', () => {
    irA('https://www.mindform.mx/')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('bloqueado') })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('bloqueado') })
    guardarSesion('mindform', S)
    expect(leerSesion('mindform')).toEqual(S)
    borrarSesion('mindform')
    expect(leerSesion('mindform')).toBeNull()
  })

  it('una cookie que el navegador no guarda (bloqueada o muy grande) ⇒ en memoria', () => {
    irA('https://book.avoqado.io/')
    vi.spyOn(Document.prototype, 'cookie', 'set').mockImplementation(() => {})
    guardarSesion('mindform', S)
    expect(leerSesion('mindform')).toEqual(S)
  })

  it('basura o una sesión de más de 30 días ⇒ null', () => {
    localStorage.setItem('avq_sesion:mindform', '{no')
    expect(leerSesion('mindform')).toBeNull()
    guardarSesion('mindform', { ...S, guardadaEn: Date.now() - 30 * 24 * 60 * 60 * 1000 })
    expect(leerSesion('mindform')).toBeNull()
  })

  describe('codex-r1', () => {
    it('#1 «Salir» en book.avoqado.io también saca a pedidos.avoqado.io de su token de hoy (y al revés)', () => {
      irA('https://book.avoqado.io/mindform')
      guardarSesion('mindform', S)
      borrarSesion('mindform')
      // El localStorage de la OTRA página no se puede borrar desde aquí: lo que dejó ahí sigue (se simula escribiéndolo después).
      irA('https://pedidos.avoqado.io/mindform')
      localStorage.setItem('avq_order_session:mindform', JSON.stringify({ token: 'pedidos-de-hoy', phone: '+525512345678', name: 'Ana', savedAt: Date.now() }))
      expect(loadSession('mindform')).toBeNull()
      expect(localStorage.getItem('avq_order_session:mindform')).toBeNull()
      localStorage.setItem('avq_customer_token:mindform', 'reservas-de-hoy')
      estado.bindCustomerSessionToVenue('mindform-otra-vez')
      estado.bindCustomerSessionToVenue('mindform')
      expect(estado.customerToken.value).toBeNull()
      // Una entrada nueva después de salir sí cuenta.
      guardarSesion('mindform', S)
      expect(loadSession('mindform')?.token).toBe('tok-1')
    })

    it('#2 si no se puede guardar la ficha nueva, la vieja guardada no reaparece', () => {
      irA('https://www.mindform.mx/')
      guardarSesion('mindform', S)
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('cuota') })
      const B = { ...S, token: 'tok-B', customer: { ...S.customer, id: 'otra-ficha' } }
      guardarSesion('mindform', B)
      expect(leerSesion('mindform')).toEqual(B)
      // Ya sin la de memoria a la vista de otras pestañas: la copia vieja se quitó.
      expect(localStorage.getItem('avq_sesion:mindform')).toBeNull()
    })

    it('#3 (alcance A) un 401 tardío de A no borra la B que otra página guardó; la página queda sin sesión y toma B al recargar', () => {
      estado.bindCustomerSessionToVenue('mindform')
      estado.setCustomerSession('mindform', 'tok-1', S.customer, null, S.contactos)
      guardarSesion('mindform', { ...S, token: 'tok-B', customer: { ...S.customer, id: 'ficha-B' } })
      estado.clearCustomerSession('mindform', 'tok-1')
      expect(leerSesion('mindform')?.token).toBe('tok-B')
      expect(estado.customerToken.value).toBeNull()
      // «Cerrar sesión» (sin token) sí borra lo guardado.
      estado.clearCustomerSession('mindform')
      expect(leerSesion('mindform')).toBeNull()
    })

    it('#4 la renovación también cambia el token que usa la pantalla de reservas', async () => {
      estado.bindCustomerSessionToVenue('mindform')
      estado.setCustomerSession('mindform', 'tok-1', S.customer, null, S.contactos)
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ customer: S.customer }), { status: 200, headers: { 'x-customer-session': 'tok-2' } }),
      ))
      await getCustomerPortal('mindform', 'tok-1')
      expect(estado.customerToken.value).toBe('tok-2')
      expect(leerSesion('mindform')?.token).toBe('tok-2')
    })
  })

  describe('codex-r2: una sola fuente de verdad (lo guardado manda; la pantalla sólo lo enseña)', () => {
    const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })

    it('#1 (alcance A) pestaña vieja: no se sincroniza en vivo; si otra salió, su siguiente petición es un 401 sin red y queda sin sesión', async () => {
      estado.bindCustomerSessionToVenue('mindform')
      estado.setCustomerSession('mindform', 'tok-1', S.customer, null, S.contactos)
      expect(estado.customerToken.value).toBe('tok-1')
      // Otra pestaña sale: lo guardado ya no está (aquí no se usa `borrarSesion`, que es de la otra pestaña).
      localStorage.removeItem('avq_sesion:mindform')
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new StorageEvent('storage', { key: 'avq_sesion:mindform' }))
      expect(estado.customerToken.value).toBe('tok-1') // límite explícito: se pone al día al recargar o al mandar
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)
      await expect(getCustomerPortal('mindform', 'tok-1')).rejects.toMatchObject({ status: 401, data: { code: 'CUSTOMER_SESSION_CLOSED' } })
      expect(fetchMock).not.toHaveBeenCalled()
      expect(estado.customerToken.value).toBeNull()
    })

    it('#2 la memoria sólo vale sin almacenamiento: no le gana a una sesión guardada después ni sobrevive a «Salir»', () => {
      irA('https://www.mindform.mx/')
      const bloquear = () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('bloqueado') })
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('bloqueado') })
      }
      bloquear()
      guardarSesion('mindform', S)
      expect(leerSesion('mindform')).toEqual(S)
      vi.restoreAllMocks()
      // Otra pestaña (ya con almacenamiento) entra con B: ésa manda.
      const B = { ...S, token: 'tok-B', customer: { ...S.customer, id: 'otra-ficha' } }
      localStorage.setItem('avq_sesion:mindform', JSON.stringify(B))
      expect(leerSesion('mindform')).toEqual(B)
      // Y sale: nadie queda adentro con la de memoria.
      localStorage.removeItem('avq_sesion:mindform')
      expect(leerSesion('mindform')).toBeNull()
    })

    it('#3 con la sesión única guardada (aunque no sirva para «Mi equipo»), el token de pedidos de hoy nunca se usa', () => {
      localStorage.setItem('avq_order_session:mindform', JSON.stringify({ token: 'legacy-A', phone: '+525512345678', name: 'Ana', savedAt: Date.now() }))
      expect(loadSession('mindform')?.token).toBe('legacy-A')
      guardarSesion('mindform', { ...S, token: 'tok-B', contactos: [{ tipo: 'EMAIL', valor: 'bea@correo.mx', metodo: 'EMAIL_CODE', probadoEn: 1 }] })
      // (d) la sesión que sólo probó un correo sí se lee (sus beneficios), sin teléfono para «Mi equipo»; el token de hoy, nunca.
      expect(loadSession('mindform')).toMatchObject({ token: 'tok-B', phone: null })
    })

    it('#4 guardar el perfil manda la sesión vigente y no regresa la pantalla al token viejo', async () => {
      estado.bindCustomerSessionToVenue('mindform')
      estado.setCustomerSession('mindform', 'tok-1', S.customer, null, S.contactos)
      guardarSesion('mindform', { ...S, token: 'tok-2' }) // otra petición lo renovó
      const fetchMock = vi.fn().mockResolvedValue(json(200, { customer: { ...S.customer, firstName: 'Anita' } }))
      vi.stubGlobal('fetch', fetchMock)
      await updateCustomerProfile('mindform', 'tok-1', { firstName: 'Anita' })
      expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer tok-2' })
      estado.setCustomerSession('mindform', 'tok-1', { ...S.customer, firstName: 'Anita' })
      expect(leerSesion('mindform')).toMatchObject({ token: 'tok-2', customer: { firstName: 'Anita' } })
      expect(estado.customerToken.value).toBe('tok-2')
    })

    it('reservar manda la sesión de la página (la renovada si otra pestaña la renovó); una invitada sigue invitada', async () => {
      estado.bindCustomerSessionToVenue('mindform')
      estado.setCustomerSession('mindform', 'tok-1', S.customer, null, S.contactos)
      guardarSesion('mindform', { ...S, token: 'tok-2' })
      const fetchMock = vi.fn().mockImplementation(async () => json(201, { confirmationCode: 'R1' }))
      vi.stubGlobal('fetch', fetchMock)
      await createReservation('mindform', {} as any, 'tok-1')
      expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer tok-2' })
      estado.clearCustomerSession('mindform')
      await createReservation('mindform', {} as any)
      expect((fetchMock.mock.calls[1][1] as RequestInit).headers).not.toHaveProperty('Authorization')
    })

    it('(alcance A) con el token de reservas de hoy y una sesión única guardada después: no la adopta; al mandar queda sin sesión y la única sigue para la próxima carga', async () => {
      localStorage.setItem('avq_customer_token:legado', 'reservas-de-hoy')
      estado.bindCustomerSessionToVenue('legado')
      expect(estado.customerToken.value).toBe('reservas-de-hoy')
      guardarSesion('legado', { ...S, token: 'tok-nueva' })
      document.dispatchEvent(new Event('visibilitychange'))
      expect(estado.customerToken.value).toBe('reservas-de-hoy')
      vi.stubGlobal('fetch', vi.fn())
      await expect(getCustomerPortal('legado', 'reservas-de-hoy')).rejects.toMatchObject({ status: 401 })
      expect(estado.customerToken.value).toBeNull()
      // La única sigue guardada para cuando la página se abra otra vez.
      expect(leerSesion('legado')?.token).toBe('tok-nueva')
      estado.clearCustomerSession('legado')
      estado.bindCustomerSessionToVenue('mindform')
    })
  })

  describe('codex-r3: H1–H7', () => {
    const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
    const TEL = S.contactos[0]
    const conToken = (token: string, extra: Partial<SesionDeCliente> = {}): SesionDeCliente => ({ ...S, token, ...extra })

    it('H1 una lectura que responde después de «Salir» (o de otra entrada) no se publica', async () => {
      estado.bindCustomerSessionToVenue('mindform')
      estado.setCustomerSession('mindform', 'tok-1', S.customer, null, S.contactos)
      let responder: (r: Response) => void = () => {}
      vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(ok => { responder = ok })))
      const pendiente = getCustomerCredits('mindform', {}, 'tok-1')
      estado.clearCustomerSession('mindform') // «Salir» mientras espera
      responder(json(200, { purchases: [{ id: 'de-Ana' }] }))
      await expect(pendiente).rejects.toMatchObject({ data: { code: 'CUSTOMER_SESSION_CHANGED' } })
    })

    it('H3 (alcance A) una pantalla invitada sigue invitada hasta abrirse otra vez: nunca reserva a nombre de quien entró en otra parte', async () => {
      estado.bindCustomerSessionToVenue('mindform')
      expect(estado.customerToken.value).toBeNull()
      guardarSesion('mindform', conToken('tok-A')) // la tienda de pedidos (misma página) entró con «Mi equipo»
      const fetchMock = vi.fn().mockImplementation(async () => json(201, { confirmationCode: 'R1' }))
      vi.stubGlobal('fetch', fetchMock)
      await createReservation('mindform', {} as any, estado.customerToken.value ?? undefined)
      expect((fetchMock.mock.calls[0][1] as RequestInit).headers).not.toHaveProperty('Authorization')
      expect(estado.customerToken.value).toBeNull()
    })

    it('H4 un 401 en cualquier llamada con sesión la cierra (o adopta la guardada), no sólo en el portal', async () => {
      estado.bindCustomerSessionToVenue('mindform')
      estado.setCustomerSession('mindform', 'tok-1', S.customer, null, S.contactos)
      vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => json(401, { message: 'Token inválido', code: 'CUSTOMER_TOKEN_INVALID' })))
      await expect(updateCustomerProfile('mindform', 'tok-1', { firstName: 'Ana' })).rejects.toMatchObject({ status: 401 })
      expect(leerSesion('mindform')).toBeNull()
      expect(estado.customerToken.value).toBeNull()
    })

    it('H5 (alcance A) una renovación conserva la página y lo cargado; otra sesión (otros contactos) la deja sin sesión y lo suelta', () => {
      estado.bindCustomerSessionToVenue('mindform')
      estado.setCustomerSession('mindform', 'tok-1', S.customer, null, S.contactos)
      const cargado = { customer: S.customer } as any
      estado.portalData.value = cargado
      estado.customerCredits.value = { purchases: [{ id: 'de-Ana-con-whatsapp' }] } as any
      estado.selectedCreditBalance.value = { balanceId: 'b1', productId: 'p1' }
      guardarSesion('mindform', conToken('tok-renovado'))
      expect(estado.tokenParaMandar('mindform')).toBe('tok-renovado')
      expect(estado.portalData.value).toBe(cargado)
      guardarSesion('mindform', conToken('tok-contrasena', { contactos: [] }))
      expect(estado.tokenParaMandar('mindform')).toBeNull()
      expect(estado.customerToken.value).toBeNull()
      expect(estado.portalData.value).toBeNull()
      expect(estado.customerCredits.value).toBeNull()
      expect(estado.selectedCreditBalance.value).toBeNull()
    })

    it('H7 si no se puede guardar la sesión única, también se van los tokens de hoy: nunca queda otra ficha', () => {
      irA('https://www.mindform.mx/')
      localStorage.setItem('avq_order_session:mindform', JSON.stringify({ token: 'LEGACY-A', phone: '+525512345678', name: 'Ana', savedAt: Date.now() }))
      localStorage.setItem('avq_customer_token:mindform', 'RESERVAS-A')
      const real = Storage.prototype.setItem
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
        if (k.startsWith('avq_sesion:')) throw new DOMException('lleno', 'QuotaExceededError')
        return real.call(this, k, v)
      })
      expect(guardarSesion('mindform', conToken('tok-B'))).toBe('fallo')
      expect(leerSesion('mindform')).toBeNull()
      expect(loadSession('mindform')).toBeNull()
      estado.bindCustomerSessionToVenue('mindform')
      expect(estado.customerToken.value).toBeNull()
      expect(localStorage.getItem('avq_customer_token:mindform')).toBeNull()
      void TEL
    })
  })

  describe('codex-r5: alcance A', () => {
    /** Un token con la forma de los del SERVIDOR (la firma no importa aquí: la tienda sólo lee su versión). */
    const jwt = (p: object) => `h.${btoa(JSON.stringify({ type: 'customer_session', ...p })).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')}.f`

    it('E2 un atributo que cambia (otro render) no hace que una página invitada tome la sesión de otra página: sólo al abrirse', () => {
      estado.bindCustomerSessionToVenue('abre-invitada')
      expect(estado.customerToken.value).toBeNull()
      guardarSesion('abre-invitada', S)
      estado.bindCustomerSessionToVenue('abre-invitada')
      expect(estado.customerToken.value).toBeNull()
      estado.clearCustomerSession('abre-invitada')
      estado.bindCustomerSessionToVenue('mindform')
    })

    it('E3 otra entrada con contraseña a la misma ficha, con la versión nueva, no es una renovación: la página revocada queda sin sesión', () => {
      const A = jwt({ sub: S.customer.id, v: 1, contactos: [] })
      const B = jwt({ sub: S.customer.id, v: 2, contactos: [] })
      estado.bindCustomerSessionToVenue('mindform')
      estado.setCustomerSession('mindform', A, S.customer, null, [])
      const epoca = estado.epocaDe('mindform')
      guardarSesion('mindform', { ...S, token: B, contactos: [] })
      expect(estado.tokenParaMandar('mindform')).toBeNull()
      expect(estado.customerToken.value).toBeNull()
      expect(estado.epocaDe('mindform')).toBe(epoca + 1)
    })

    it('E4 la época se revisa DESPUÉS de leer el cuerpo: salir mientras llega no publica los datos de antes', async () => {
      estado.bindCustomerSessionToVenue('mindform')
      estado.setCustomerSession('mindform', 'tok-1', S.customer, null, S.contactos)
      let cuerpo: (v: unknown) => void = () => {}
      vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: true, status: 200, headers: new Headers(), json: () => new Promise(ok => { cuerpo = ok }),
      })))
      const pendiente = getCustomerCredits('mindform', {}, 'tok-1')
      await new Promise(r => setTimeout(r, 0)) // ya llegaron las cabeceras; el cuerpo todavía no
      estado.clearCustomerSession('mindform')
      cuerpo({ purchases: [{ id: 'saldo-de-A' }] })
      await expect(pendiente).rejects.toMatchObject({ data: { code: 'CUSTOMER_SESSION_CHANGED' } })
    })

    it('E5 el 401 tardío de A también cierra su copia renovada A2 (la misma sesión), en la página y guardada', () => {
      estado.bindCustomerSessionToVenue('mindform')
      estado.setCustomerSession('mindform', 'tok-A', S.customer, null, S.contactos)
      guardarSesion('mindform', { ...S, token: 'tok-A2' }) // la renovación
      expect(estado.tokenParaMandar('mindform')).toBe('tok-A2')
      estado.clearCustomerSession('mindform', 'tok-A')
      expect(estado.customerToken.value).toBeNull()
      expect(leerSesion('mindform')).toBeNull()
    })

    it('E6 una petición que trae el token de una sesión anterior no sale con la sesión que la página tenga ahora', async () => {
      estado.bindCustomerSessionToVenue('mindform')
      estado.setCustomerSession('mindform', 'tok-A', S.customer, null, S.contactos)
      estado.clearCustomerSession('mindform', 'tok-A')
      estado.setCustomerSession('mindform', 'tok-B', { ...S.customer, id: 'ficha-B' }, null, S.contactos) // entró B aquí
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)
      await expect(getCustomerCredits('mindform', {}, 'tok-A')).rejects.toMatchObject({ status: 401 })
      expect(fetchMock).not.toHaveBeenCalled()
      expect(estado.customerToken.value).toBe('tok-B')
    })
  })
})
