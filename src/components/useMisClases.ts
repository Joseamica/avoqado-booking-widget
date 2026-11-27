/**
 * Task 10: lo que la clienta ya tiene en ESTE estudio (su saldo y sus clases reservadas en la ventana del horario), por instancia de
 * `<avoqado-booking>`. Nunca en las señales compartidas de cuenta: con dos estudios en la misma página cada widget lee con la sesión de
 * SU estudio, guarda cada lectura con su `slug` e `identidadDe(sesión)`, descarta la que llega cuando ya no coinciden y la borra al
 * cambiar de cuenta en el mismo estudio (r2 sobre r1 #11).
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import * as api from '../api/booking'
import type { CustomerCreditBalance, MiReservaDeClase, Product, PublicClassSessionSlot } from '../types'
import type { CustomerInfo } from '../state/booking'
import { alCambiarLaPagina, identidadDe, leerSesion, paginaDe } from '../lib/sesionDeCliente'
import { opcionesQueCubren, type OpcionDePaquete } from '../lib/eleccionDePaquete'
import type { CubreSesion, EstadoDeMiReserva, MiReserva, ReservaEnLaSesion } from './ListaDelHorario'

/** Las fechas que pidió el horario (las mismas se mandan a sus reservas). */
export interface VentanaDelHorario {
  dateFrom: string
  dateTo: string
}

/** La cuenta con que ESTE estudio manda en la página. */
export interface CuentaDelEstudio {
  slug: string
  /** El token de la sesión del estudio en la página (`request` lo valida y sigue su renovación). */
  token: string
  /** `identidadDe(sesión)` (o `hoy:reservas|<token>` con un token de antes): cambia si entra otra cuenta. */
  identidad: string
  cliente: CustomerInfo | null
}

/**
 * La sesión de reservas de ESE estudio en la página (`paginaDe`, una por negocio; nunca la de las señales compartidas, que son del
 * último estudio montado), contrastada con lo guardado (`leerSesion(slug)`): si otra pestaña salió o entró con otra cuenta, aquí ya no
 * hay cuenta (su siguiente petición tampoco saldría con ella).
 */
export function cuentaDelEstudio(slug: string): CuentaDelEstudio | null {
  if (!slug) return null
  const p = paginaDe(slug, 'reservas')
  if (!p) return null
  const guardada = leerSesion(slug)
  if (guardada ? identidadDe(guardada) !== p.identidad : !p.identidad.startsWith('hoy:')) return null
  const cliente = (p.datos as CustomerInfo | null | undefined) ?? guardada?.customer ?? null
  return { slug, token: p.token, identidad: p.identidad, cliente }
}

/** r2 B5: confirmada o ya llegó ⇒ «Reservada»; `PENDING` con el depósito pendiente ⇒ «Falta pagar»; otro `PENDING` ⇒ «Por aprobar». */
export function estadoDeMiReserva(r: Pick<MiReservaDeClase, 'status' | 'depositStatus'>): EstadoDeMiReserva {
  if (r.status !== 'PENDING') return 'reservada'
  return r.depositStatus === 'PENDING' ? 'faltaPagar' : 'porAprobar'
}

/** Su lugar en una clase: lo que enseña el horario y, para el detalle (Task 11), todas sus reservas de esa clase. */
export interface MiLugarEnLaClase extends ReservaEnLaSesion {
  estado: EstadoDeMiReserva
  /** La que se enseña: una confirmada antes que una que falta pagar, y ésta antes que una por aprobar. */
  principal: MiReservaDeClase
  /** Todas las suyas en esa clase (p. ej. otro lugar que apartó para alguien), con su `cancelSecret`. */
  reservas: MiReservaDeClase[]
}

const PRIORIDAD: Record<EstadoDeMiReserva, number> = { reservada: 0, faltaPagar: 1, porAprobar: 2 }

export function miLugarEn(reservas: MiReservaDeClase[]): MiLugarEnLaClase | null {
  if (reservas.length === 0) return null
  const principal = [...reservas].sort((a, b) => PRIORIDAD[estadoDeMiReserva(a)] - PRIORIDAD[estadoDeMiReserva(b)])[0]
  const estado = estadoDeMiReserva(principal)
  // Los lugares de sus reservas en el mismo estado: dos lugares confirmados dicen «lugares 3, 4».
  const lugares = reservas.filter(r => estadoDeMiReserva(r) === estado).flatMap(r => r.spotIds)
  return { lugar: lugares[0] ?? null, ...(lugares.length > 1 ? { lugares } : {}), estado, principal, reservas }
}

/** 20 páginas de 100 son mucho más que 60 días de una clienta: más que eso (o un cursor repetido) es una lectura que no terminó. */
const TOPE_DE_PAGINAS = 20

/** Ruling del controlador (fix r1): una lectura a medias nunca pasa por completa. Sin `status`: quien revisa lo toma como «no se sabe». */
const lecturaIncompleta = () =>
  Object.assign(new Error('No pudimos leer todas tus reservas de esta ventana.'), { code: 'LECTURA_INCOMPLETA' as const })

/**
 * TODAS las páginas de sus reservas de clase en la ventana. Lanza el error de la lectura tal cual (con su `status`: 401, 404 de un
 * SERVIDOR viejo, 5xx…) para que quien llame decida. Si el SERVIDOR repite un cursor o pasa del tope de páginas, lanza
 * `LECTURA_INCOMPLETA` (sin `status`) en lugar de devolver lo que alcanzó: Task 13 compara «antes» y «después», y una lista recortada
 * diría «no quedó» de una reserva que sí quedó.
 */
export async function leerMisReservasDeClase(
  slug: string,
  ventana: VentanaDelHorario,
  token: string,
): Promise<{ reservas: MiReservaDeClase[]; ilimitadoUsadoEn: string[] }> {
  const reservas: MiReservaDeClase[] = []
  const usados = new Set<string>()
  const vistos = new Set<string>()
  let cursor: string | null = null
  for (let i = 0; i < TOPE_DE_PAGINAS; i++) {
    const pagina = await api.getMisReservasDeClase(
      slug,
      cursor ? { dateFrom: ventana.dateFrom, dateTo: ventana.dateTo, cursor } : { dateFrom: ventana.dateFrom, dateTo: ventana.dateTo },
      token,
    )
    for (const r of pagina?.reservations ?? []) reservas.push(r)
    for (const id of pagina?.unlimitedUsedSessionIds ?? []) usados.add(id)
    cursor = pagina?.nextCursor ?? null
    if (!cursor) return { reservas, ilimitadoUsadoEn: [...usados] }
    if (vistos.has(cursor)) throw lecturaIncompleta()
    vistos.add(cursor)
  }
  throw lecturaIncompleta()
}

/**
 * Para Task 13 (revisar si la reserva quedó tras un error de red): la ventana del horario cargado, la última lectura de ESA ventana
 * (`antes`) y cómo volver a leerla entera (`leer`), con el `slug`, la `identidad` y la `instancia` del widget que la pidió.
 */
export interface ParaRevisarSiQuedo {
  slug: string
  identidad: string
  /** Distinta en cada `<avoqado-booking>` de la página. */
  instancia: string
  ventana: VentanaDelHorario
  /**
   * Las reservas de la última lectura BUENA (completa) de ESTA ventana; `null` si todavía no hubo ninguna (o la ventana creció y su
   * lectura no ha llegado). Una relectura que falla no la toca: se queda la anterior.
   */
  ultima: readonly MiReservaDeClase[] | null
  /**
   * Vuelve a leer TODAS las páginas de la misma ventana con el token de este estudio y devuelve las filas (con la forma de
   * `ReservaPropia`). Lanza el error de la lectura con su `status`, o `LECTURA_INCOMPLETA` (sin `status`) si no pudo leerlas todas:
   * nunca devuelve una lista a medias. Si sigue siendo la misma cuenta, también refresca las marcas y `ultima`.
   */
  leer: () => Promise<MiReservaDeClase[]>
}

export interface MisClases {
  /** La cuenta de ESTE estudio, o `null` (sin sesión: nada se lee ni se pinta). */
  cuenta: CuentaDelEstudio | null
  /** Su saldo, leído SIN `productId` (con él, el SERVIDOR recorta los saldos y `soloEstaClase` saldría mal). */
  creditos: CustomerCreditBalance | null
  /** Clases de la ventana donde ya usó su Ilimitado (el SERVIDOR rechaza el segundo). */
  ilimitadoUsadoEn: ReadonlySet<string>
  /** Los paquetes que pagan `lugares` lugares de esa sesión, el default primero (`opcionesQueCubren`). */
  opcionesDe: (slot: PublicClassSessionSlot, lugares?: number) => OpcionDePaquete[]
  /** «Incluida en tu paquete», por sesión. Sin saldo leído, `undefined` (el horario enseña el precio). */
  cubreSesion?: CubreSesion
  /** Su reserva en cada sesión. Sin lectura, `undefined` (sin marcas). */
  miReserva?: MiReserva
  /** Su lugar en esa clase (para el detalle de Task 11). */
  reservaDe: (slot: Pick<PublicClassSessionSlot, 'classSessionId'> | null | undefined) => MiLugarEnLaClase | null
  /** La franja de arriba del horario: el paquete de la primera clase del negocio que su saldo paga. */
  franja: { opciones: OpcionDePaquete[]; nombreClase: string } | null
  paraRevisar: ParaRevisarSiQuedo | null
  /**
   * Fix r1: vuelve a leer el saldo y, si hay ventana, sus reservas (tras comprar un paquete o al volver a la pestaña), con la cuenta
   * de AHORA de este estudio y las mismas guardas (lo que llega de otra cuenta o de otro estudio no se pinta). No hace nada si este
   * widget nunca las leyó (otro flujo) o ya no hay sesión.
   */
  refrescar: () => void
}

interface Leido<T> {
  slug: string
  identidad: string
  datos: T
}
interface ReservasLeidas {
  ventana: VentanaDelHorario
  reservas: MiReservaDeClase[]
  ilimitadoUsadoEn: ReadonlySet<string>
}

const NINGUNA: ReadonlySet<string> = new Set()
let instancias = 0

/**
 * `activo`: el horario está a la vista (cada vez que vuelve a verse se leen otra vez: después de reservar o cancelar, las marcas y el
 * saldo están al día). `ventana`: la que avisó el horario (`ClassSessionList.onVentana`).
 */
export function useMisClases(
  slug: string,
  o: { activo: boolean; ventana: VentanaDelHorario | null; productos: Product[] },
): MisClases {
  const instancia = useRef('')
  if (!instancia.current) instancia.current = `avq-${++instancias}-${Math.random().toString(36).slice(2, 8)}`
  const [vuelta, setVuelta] = useState(0)
  const [creditos, setCreditos] = useState<Leido<CustomerCreditBalance> | null>(null)
  const [leidas, setLeidas] = useState<Leido<ReservasLeidas> | null>(null)
  const turnoCreditos = useRef(0)
  const turnoReservas = useRef(0)
  /** Este widget ya leyó lo de la clienta (estuvo en el horario): sólo entonces `refrescar` vuelve a leer. */
  const yaLeyo = useRef(false)
  const slugVivo = useRef(slug)
  slugVivo.current = slug

  // Cada cambio de la sesión de ESTE estudio en la página: si entró otra cuenta (o salió), lo de la anterior se borra y lo que tenga
  // en vuelo ya no pinta.
  useEffect(
    () =>
      alCambiarLaPagina((s, afecta, misma) => {
        if (s !== slugVivo.current || !afecta.includes('reservas')) return
        if (!misma) {
          turnoCreditos.current++
          turnoReservas.current++
          setCreditos(null)
          setLeidas(null)
        }
        setVuelta(v => v + 1)
      }),
    [],
  )

  const cuenta = useMemo(() => cuentaDelEstudio(slug), [slug, vuelta])
  const identidad = cuenta?.identidad ?? null

  /** ¿Lo pedido sigue siendo de este widget (mismo estudio) y de la misma cuenta, al llegar? */
  const sigue = (pedida: { slug: string; identidad: string }) =>
    slugVivo.current === pedida.slug && cuentaDelEstudio(pedida.slug)?.identidad === pedida.identidad

  async function leerYGuardar(c: CuentaDelEstudio, ventana: VentanaDelHorario): Promise<MiReservaDeClase[]> {
    const n = ++turnoReservas.current
    const pedida = { slug: c.slug, identidad: c.identidad }
    const r = await leerMisReservasDeClase(c.slug, ventana, c.token)
    if (n === turnoReservas.current && sigue(pedida)) {
      setLeidas({ ...pedida, datos: { ventana, reservas: r.reservas, ilimitadoUsadoEn: new Set(r.ilimitadoUsadoEn) } })
    }
    return r.reservas
  }

  async function leerSaldo(c: CuentaDelEstudio): Promise<void> {
    const n = ++turnoCreditos.current
    const pedida = { slug: c.slug, identidad: c.identidad }
    try {
      const saldo = await api.getCustomerCredits(c.slug, {}, c.token)
      if (saldo && n === turnoCreditos.current && sigue(pedida)) setCreditos({ ...pedida, datos: saldo })
    } catch {
      /* sin el saldo: el horario se ve igual, sin franja ni «Incluida» */
    }
  }
  const leerReservas = (c: CuentaDelEstudio, ventana: VentanaDelHorario) =>
    leerYGuardar(c, ventana).catch(() => {
      /* sin sus reservas (o un SERVIDOR viejo, 404, o a medias): el horario se ve igual, sin marcas nuevas ni aviso */
    })

  useEffect(() => {
    if (!o.activo || !cuenta) return
    yaLeyo.current = true
    void leerSaldo(cuenta)
  }, [slug, identidad, o.activo])

  const desde = o.ventana?.dateFrom ?? null
  const hasta = o.ventana?.dateTo ?? null
  const ventanaViva = useRef<VentanaDelHorario | null>(null)
  ventanaViva.current = desde && hasta ? { dateFrom: desde, dateTo: hasta } : null
  useEffect(() => {
    if (!o.activo || !cuenta || !desde || !hasta) return
    yaLeyo.current = true
    void leerReservas(cuenta, { dateFrom: desde, dateTo: hasta })
  }, [slug, identidad, o.activo, desde, hasta])

  const refrescar = () => {
    if (!yaLeyo.current) return
    const c = cuentaDelEstudio(slugVivo.current)
    if (!c) return
    void leerSaldo(c)
    const v = ventanaViva.current
    if (v) void leerReservas(c, v)
  }

  const deEstaCuenta = <T,>(l: Leido<T> | null): T | null =>
    l && cuenta && l.slug === slug && l.identidad === cuenta.identidad ? l.datos : null
  const misCreditos = deEstaCuenta(creditos)
  const misReservas = deEstaCuenta(leidas)
  const usados = misReservas?.ilimitadoUsadoEn ?? NINGUNA

  const porSesion = useMemo(() => {
    const m = new Map<string, MiReservaDeClase[]>()
    for (const r of misReservas?.reservas ?? []) {
      const lista = m.get(r.classSessionId)
      if (lista) lista.push(r)
      else m.set(r.classSessionId, [r])
    }
    return m
  }, [misReservas])

  const franja = useMemo(() => {
    if (!misCreditos) return null
    const ahora = new Date().toISOString()
    for (const p of o.productos) {
      if (p.type !== 'CLASS') continue
      const opciones = opcionesQueCubren(misCreditos, p.id, 1, ahora, { yaUsoIlimitadoEnLaSesion: false })
      if (opciones.length > 0) return { opciones, nombreClase: p.name }
    }
    return null
  }, [misCreditos, o.productos])

  const opcionesDe = (slot: PublicClassSessionSlot, lugares = 1): OpcionDePaquete[] =>
    misCreditos
      ? opcionesQueCubren(misCreditos, slot.productId, lugares, slot.startsAt, {
          yaUsoIlimitadoEnLaSesion: !!slot.classSessionId && usados.has(slot.classSessionId),
        })
      : []
  const reservaDe = (slot: Pick<PublicClassSessionSlot, 'classSessionId'> | null | undefined) =>
    slot?.classSessionId ? miLugarEn(porSesion.get(slot.classSessionId) ?? []) : null

  const ventana = desde && hasta ? { dateFrom: desde, dateTo: hasta } : null
  const paraRevisar: ParaRevisarSiQuedo | null =
    cuenta && ventana
      ? {
          slug,
          identidad: cuenta.identidad,
          instancia: instancia.current,
          ventana,
          ultima:
            misReservas && misReservas.ventana.dateFrom === ventana.dateFrom && misReservas.ventana.dateTo === ventana.dateTo
              ? misReservas.reservas
              : null,
          leer: () => leerYGuardar(cuenta, ventana),
        }
      : null

  return {
    cuenta,
    creditos: misCreditos,
    ilimitadoUsadoEn: usados,
    opcionesDe,
    cubreSesion: misCreditos ? slot => opcionesDe(slot).length > 0 : undefined,
    miReserva: misReservas ? slot => reservaDe(slot) : undefined,
    reservaDe,
    franja,
    paraRevisar,
    refrescar,
  }
}
