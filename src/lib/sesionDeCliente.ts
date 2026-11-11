// W1 (P2-2): UNA sesión de cliente por negocio para reservas y pedidos (el token `customer_session` del SERVIDOR, S6).
// - En `*.avoqado.io` vive en una cookie de `avoqado.io`: `book.avoqado.io` y `pedidos.avoqado.io` son el mismo sitio y la comparten.
//   La escribe el WIDGET (legible por JS: la misma exposición que el `localStorage` de hoy; decisión 3 del plan).
// - Incrustado en la página de un negocio, vive en el `localStorage` de esa página.
// - Sin almacenamiento (o una cookie que el navegador no guarda), en memoria: dura lo que dura la pestaña.
// Sin sesión nueva, cada superficie sigue con su token de hoy (`avq_order_session:<slug>`, `avq_customer_token:<slug>`), sólo para lo
// de hoy. «Salir» borra la sesión y esos dos.

export interface ContactoProbado {
  tipo: 'PHONE' | 'EMAIL'
  valor: string
  metodo: 'WHATSAPP' | 'EMAIL_CODE' | 'GOOGLE'
  probadoEn: number
}
export interface ClienteDeSesion {
  id: string
  firstName: string | null
  lastName: string | null
  email: string | null
  phone: string | null
}
export interface SesionDeCliente {
  token: string
  customer: ClienteDeSesion
  contactos: ContactoProbado[]
  /** ms; la sesión dura 30 días desde que se guardó o se renovó. */
  guardadaEn: number
}
/** La respuesta de toda entrada del SERVIDOR (código, Google, ficha nueva; S7). */
export interface SesionEmitida {
  token: string
  customer: ClienteDeSesion
  contactos: ContactoProbado[]
  avisos?: Array<'FICHA_CON_OTRO_TELEFONO' | 'FICHA_CON_OTRO_CORREO'>
  otraFicha?: { contacto: 'PHONE' | 'EMAIL'; enmascarado: string } | null
}
/** Sin ficha con ese contacto y con «¿ya eres cliente?»: la prueba firmada (15 min) para crearla o ligarla después. */
export interface FichaNueva {
  fichaNueva: true
  pruebaPendiente: string
}

const TREINTA_DIAS_S = 30 * 24 * 60 * 60
const enMemoria = new Map<string, SesionDeCliente>()

export const esDeAvoqado = (host: string = location.hostname): boolean => host === 'avoqado.io' || host.endsWith('.avoqado.io')

const nombreCookie = (slug: string) => `avq_sesion_${encodeURIComponent(slug)}`
const llaveLocal = (slug: string) => `avq_sesion:${slug}`

function leerCookie(nombre: string): string | null {
  for (const parte of document.cookie.split('; ')) {
    const i = parte.indexOf('=')
    if (i > 0 && parte.slice(0, i) === nombre) return decodeURIComponent(parte.slice(i + 1))
  }
  return null
}
function escribirCookie(nombre: string, valor: string | null): void {
  const vida = valor === null ? 0 : TREINTA_DIAS_S
  document.cookie = `${nombre}=${valor === null ? '' : encodeURIComponent(valor)}; Domain=avoqado.io; Path=/; Secure; SameSite=Lax; Max-Age=${vida}`
}

function valida(x: any): SesionDeCliente | null {
  if (!x || typeof x.token !== 'string' || !x.token || typeof x.customer?.id !== 'string' || !Array.isArray(x.contactos)) return null
  if (!Number.isFinite(x.guardadaEn) || Date.now() - x.guardadaEn >= TREINTA_DIAS_S * 1000) return null
  return { token: x.token, customer: x.customer, contactos: x.contactos, guardadaEn: x.guardadaEn }
}

export function leerSesion(slug: string): SesionDeCliente | null {
  try {
    const crudo = esDeAvoqado() ? leerCookie(nombreCookie(slug)) : localStorage.getItem(llaveLocal(slug))
    const s = crudo ? valida(JSON.parse(crudo)) : null
    if (s) return s
  } catch {
    /* sin almacenamiento o basura */
  }
  return valida(enMemoria.get(slug))
}

export function guardarSesion(slug: string, s: SesionDeCliente): void {
  const texto = JSON.stringify(s)
  let guardada = false
  try {
    if (esDeAvoqado()) {
      escribirCookie(nombreCookie(slug), texto)
      // El navegador puede no guardarla (cookies bloqueadas o más de 4 KB) sin avisar: se comprueba leyéndola.
      guardada = leerCookie(nombreCookie(slug)) === texto
    } else {
      localStorage.setItem(llaveLocal(slug), texto)
      guardada = true
    }
  } catch {
    /* sin almacenamiento */
  }
  if (guardada) enMemoria.delete(slug)
  else enMemoria.set(slug, s)
}

/** «Salir»: la sesión única y los dos tokens de hoy de ese negocio. */
export function borrarSesion(slug: string): void {
  enMemoria.delete(slug)
  try {
    if (esDeAvoqado()) escribirCookie(nombreCookie(slug), null)
  } catch {
    /* sin cookies */
  }
  for (const k of [llaveLocal(slug), `avq_order_session:${slug}`, `avq_customer_token:${slug}`, `avq_customer_info:${slug}`]) {
    try {
      localStorage.removeItem(k)
    } catch {
      /* sin almacenamiento */
    }
  }
}

/**
 * S6: una sesión de más de un día vuelve con otra de 30 días en `x-customer-session` (mismos contactos y versión). Sólo reemplaza a la
 * guardada si es la que se mandó (`enviado`): una respuesta tardía de una sesión que ya cambió (otra ficha, otra versión) no la pisa.
 */
export function aplicarRenovacion(slug: string, headers: Headers | undefined, enviado: string): void {
  const nuevo = headers?.get?.('x-customer-session')
  const actual = nuevo ? leerSesion(slug) : null
  if (!nuevo || !actual || actual.token !== enviado) return
  guardarSesion(slug, { ...actual, token: nuevo, guardadaEn: Date.now() })
}
