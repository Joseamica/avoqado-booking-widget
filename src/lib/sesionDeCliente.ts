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
// «Salió»: el localStorage de la OTRA página (book. o pedidos.) no se puede borrar desde ésta. Esta marca compartida le dice que
// no use su token de hoy. Dura lo que vive un token de hoy (30 días): la tienda nueva ya no fabrica tokens de hoy.
const nombreSalida = (slug: string) => `avq_salio_${encodeURIComponent(slug)}`
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

/** ¿Hay dónde guardar (la cookie en avoqado.io, el localStorage fuera)? Se prueba escribiendo y leyendo. */
function hayAlmacenamiento(): boolean {
  try {
    if (!esDeAvoqado()) {
      localStorage.setItem('avq_prueba', '1')
      localStorage.removeItem('avq_prueba')
      return true
    }
    escribirCookie('avq_prueba', '1')
    const ok = leerCookie('avq_prueba') === '1'
    escribirCookie('avq_prueba', null)
    return ok
  } catch {
    return false
  }
}

/**
 * La sesión vigente, leída AHORA de lo guardado (la única fuente de verdad: otras pestañas y la otra página la cambian). La copia en
 * memoria sólo vale si no hay ningún almacenamiento; nunca le gana a lo guardado ni sobrevive a un «Salir» guardado (codex-r2 #2).
 */
export function leerSesion(slug: string): SesionDeCliente | null {
  let crudo: string | null = null
  try {
    crudo = esDeAvoqado() ? leerCookie(nombreCookie(slug)) : localStorage.getItem(llaveLocal(slug))
  } catch {
    /* sin almacenamiento */
  }
  if (crudo) {
    try {
      return valida(JSON.parse(crudo))
    } catch {
      return null // basura
    }
  }
  if (!enMemoria.has(slug)) return null
  if (hayAlmacenamiento()) {
    enMemoria.delete(slug)
    return null
  }
  return valida(enMemoria.get(slug))
}

/** ¿«Salir» (o un 401) pasó en la otra página de avoqado.io? Entonces el token de hoy de ésta ya no se usa. */
export function salioEnOtraPagina(slug: string): boolean {
  try {
    return esDeAvoqado() && leerCookie(nombreSalida(slug)) !== null
  } catch {
    return false
  }
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
  if (guardada) return void enMemoria.delete(slug)
  // ponytail: si sí hay almacenamiento pero ESTA sesión no cupo (una cookie de más de 4 KB; hoy pesa ~1.5 KB), no queda guardada y la
  // pantalla la verá cerrada. Ninguna página debe seguir con la anterior (quizá de otra ficha): se quita si se puede.
  enMemoria.set(slug, s)
  try {
    if (esDeAvoqado()) escribirCookie(nombreCookie(slug), null)
    else localStorage.removeItem(llaveLocal(slug))
  } catch {
    /* sin almacenamiento */
  }
}

/** «Salir»: la sesión única y los dos tokens de hoy de ese negocio. */
export function borrarSesion(slug: string): void {
  enMemoria.delete(slug)
  try {
    if (esDeAvoqado()) {
      escribirCookie(nombreCookie(slug), null)
      escribirCookie(nombreSalida(slug), '1')
    }
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
export function aplicarRenovacion(slug: string, headers: Headers | undefined, enviado: string): string | null {
  const nuevo = headers?.get?.('x-customer-session')
  const actual = nuevo ? leerSesion(slug) : null
  if (!nuevo || !actual || actual.token !== enviado) return null
  guardarSesion(slug, { ...actual, token: nuevo, guardadaEn: Date.now() })
  return nuevo
}
