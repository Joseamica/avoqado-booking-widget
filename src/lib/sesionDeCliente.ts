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

/** La versión de sesión que firmó el SERVIDOR (`v` del token; S6). `null` si el token no trae una legible. */
function versionDelToken(token: string): number | null {
  try {
    const p = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const v = JSON.parse(atob(p + '==='.slice((p.length + 3) % 4))).v
    return Number.isInteger(v) ? v : null
  } catch {
    return null
  }
}

/**
 * Qué sesión es: la ficha, la versión con que se firmó y los contactos probados. Una renovación (`x-customer-session`) conserva los
 * tres; otra entrada (otra versión tras revocar, otra prueba del contacto, otra ficha) no (codex-r5 E3).
 */
export const identidadDe = (s: SesionDeCliente): string =>
  `${s.customer.id}|v${versionDelToken(s.token) ?? ''}|${JSON.stringify(s.contactos)}`
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

/** Los dos tokens de hoy de ese negocio (pedidos y reservas). */
function quitarTokensDeHoy(slug: string): void {
  for (const k of [`avq_order_session:${slug}`, `avq_customer_token:${slug}`, `avq_customer_info:${slug}`]) {
    try {
      localStorage.removeItem(k)
    } catch {
      /* sin almacenamiento */
    }
  }
}

/**
 * `guardada`: en la cookie o el localStorage. `memoria`: no hay ningún almacenamiento, vive en esta pestaña. `fallo`: sí hay
 * almacenamiento pero esta sesión no se pudo guardar (cuota llena, cookie de más de 4 KB): no queda sesión, y como tampoco debe quedar
 * la de antes (quizá de otra ficha), se quitan la copia guardada y los tokens de hoy (codex-r3 H7). La tienda dice «No pudimos guardar
 * tu sesión en este navegador».
 */
export function guardarSesion(slug: string, s: SesionDeCliente): 'guardada' | 'memoria' | 'fallo' {
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
    /* sin almacenamiento o lleno */
  }
  enMemoria.delete(slug)
  if (guardada) return 'guardada'
  try {
    if (esDeAvoqado()) escribirCookie(nombreCookie(slug), null)
    else localStorage.removeItem(llaveLocal(slug))
  } catch {
    /* sin almacenamiento */
  }
  quitarTokensDeHoy(slug)
  if (hayAlmacenamiento()) return 'fallo'
  enMemoria.set(slug, s)
  return 'memoria'
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
  try {
    localStorage.removeItem(llaveLocal(slug))
  } catch {
    /* sin almacenamiento */
  }
  quitarTokensDeHoy(slug)
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

// ── El guardián de la página (W1, «A refinada», founder 11-nov) ───────────────────────────────────────────────────────────────────
// Cada SUPERFICIE (reservas y portal; tienda y seguimiento) toma la sesión UNA vez al montarse (al crear o montar su elemento, nunca al
// primer uso) y después vive sola, aunque el elemento se vuelva a crear (idioma, venue, pedido, canal). Entrar o salir en una superficie
// guarda en el almacenamiento para las páginas que se abran después, pero NO cambia a las otras superficies ya montadas en el mismo
// documento: ésas nunca toman la nueva (se enteran al recargar). Entre páginas se comparte sólo al abrir. Así un pedido o una cotización
// de una superficie nunca sale con la sesión que entró en otra (codex-r8 H1 y H2, imposibles por construcción).

/** Lo que una superficie lee AHORA de lo guardado: la sesión única (`identidadDe`) o su token de hoy (`hoy:<superficie>|<token>`). */
export interface Lectura { token: string; identidad: string; datos?: unknown }
export type Superficie = 'reservas' | 'pedidos'
/** `linaje`: los tokens de ESTA sesión en la superficie (el de la entrada y sus renovaciones). */
export interface Pagina { token: string; identidad: string; linaje: string[]; datos?: unknown }

/** Una entrada por negocio y superficie (`<slug>|<superficie>`). */
const paginas = new Map<string, Pagina | null>()
const epocas = new Map<string, number>()
const oyentes: Array<(slug: string, afecta: Superficie[], misma: boolean) => void> = []
const clave = (slug: string, s: Superficie) => `${slug}|${s}`

/** Época de la sesión de `s` en ese negocio: sube cada vez que cambia quién está adentro. Una respuesta de otra época no se pinta. */
export const epocaDe = (slug: string, s: Superficie): number => epocas.get(clave(slug, s)) ?? 0
/**
 * La época de TODO el negocio en la página (cualquier superficie). Una entrada que se pidió antes de que cambiara (salió, entró otra,
 * se soltó) llega tarde: no guarda nada (codex-r8 H3).
 */
export const epocaDelNegocio = (slug: string): string => `${epocaDe(slug, 'reservas')}|${epocaDe(slug, 'pedidos')}`
/** La sesión de la superficie `s` en esta página (sólo suya). */
export const paginaDe = (slug: string, s: Superficie): Pagina | null => paginas.get(clave(slug, s)) ?? null
/** Reservas repinta sus señales con cada cambio de SU superficie. */
export const alCambiarLaPagina = (f: (slug: string, afecta: Superficie[], misma: boolean) => void): void => { oyentes.push(f) }

/** El único que cambia la sesión de la superficie `s`: sólo la de `s`, nunca la de otra. */
export function fijarPagina(slug: string, s: Superficie, l: Lectura | null): void {
  const antes = paginaDe(slug, s)
  const misma = (antes?.identidad ?? null) === (l?.identidad ?? null)
  const linaje = !l ? [] : misma && antes ? [...antes.linaje.filter(t => t !== l.token), l.token] : [l.token]
  paginas.set(clave(slug, s), l && { token: l.token, identidad: l.identidad, linaje, datos: l.datos })
  if (!misma) epocas.set(clave(slug, s), epocaDe(slug, s) + 1)
  for (const f of oyentes) f(slug, [s], misma)
}

/** Abrir: al crear o montar el elemento de `s`. La PRIMERA vez de esa superficie en el documento toma lo guardado; después, nunca. */
export function abrirPagina(slug: string, s: Superficie, leer: () => Lectura | null): void {
  if (!paginas.has(clave(slug, s))) fijarPagina(slug, s, leer())
}

/**
 * El token con que MANDA la página desde `s`: el suyo mientras su sesión siga guardada (si otra pestaña la renovó, el renovado: es la
 * misma sesión). Si ya no (salió, entró otra ficha, se borró), queda sin sesión; nunca toma otra. `delLlamador`: un token de una sesión
 * que ya no es la de la página (un sondeo de antes de salir y volver a entrar) no sale, ni con la de ahora (codex-r5 E6).
 */
export function tokenDeLaPagina(slug: string, s: Superficie, leer: () => Lectura | null, delLlamador?: string | null): string | null {
  const p = paginaDe(slug, s)
  if (!p) return null
  if (delLlamador && !p.linaje.includes(delLlamador)) return null
  const l = leer()
  if (l && l.identidad === p.identidad) {
    if (l.token !== p.token) fijarPagina(slug, s, l)
    return l.token
  }
  fijarPagina(slug, s, null)
  return null
}

/** El SERVIDOR renovó (`x-customer-session`) un token que mandó la página: sigue con el renovado. */
export function renovarLaPagina(slug: string, s: Superficie, enviado: string, leer: () => Lectura | null): void {
  const p = paginaDe(slug, s)
  const l = leer()
  if (p?.linaje.includes(enviado) && l?.identidad === p.identidad) fijarPagina(slug, s, l)
}

/**
 * Sin `tokenQueFallo`: «Cerrar sesión». Con él: un 401. La superficie queda sin sesión (si era suya), y lo guardado se borra SÓLO si
 * sigue siendo esa misma sesión: el token que falló, o la sesión de la superficie con su renovación (misma identidad; codex-r5 E5,
 * r6 #2). Una sesión más nueva que guardó otra superficie u otra pestaña nunca se borra, y una respuesta tardía de una sesión anterior
 * no saca a la de ahora.
 */
export function soltarLaPagina(slug: string, s: Superficie, tokenQueFallo: string | undefined, leer: () => Lectura | null): void {
  const p = paginaDe(slug, s)
  const deLaPagina = tokenQueFallo === undefined || !!p?.linaje.includes(tokenQueFallo)
  const l = leer()
  const laMismaGuardada = !!p && !!l && l.identidad === p.identidad
  if ((!!tokenQueFallo && l?.token === tokenQueFallo) || (deLaPagina && laMismaGuardada)) borrarSesion(slug)
  if (deLaPagina) fijarPagina(slug, s, null)
}

/** Sólo para pruebas: un documento nuevo (cada prueba es una carga de página). */
export function documentoNuevoParaPruebas(): void {
  paginas.clear()
  epocas.clear()
}
