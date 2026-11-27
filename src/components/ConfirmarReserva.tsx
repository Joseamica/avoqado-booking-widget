import { h } from 'preact'
import type { ComponentChildren } from 'preact'
import { useEffect, useId, useRef, useState } from 'preact/hooks'
import type { TFunction } from '../i18n'
import type { OpcionDePaquete } from '../lib/eleccionDePaquete'
import { unidad } from '../lib/palabras'
import { precio as formatoDePrecio } from '../lib/precio'
import { fechaCorta } from './TuPaqueteFranja'
import { Icono } from './ui/Icono'
import { Spinner } from './ui/Spinner'
import type { Idioma } from './ListaDelHorario'

const K = 'reservaClases.confirmar'
const R = 'reservaClases.revisar'

export type PagoDeLaReserva = 'paquete' | 'tarjeta' | 'estudio' | 'gratis'

const mayuscula = (s: string) => s.charAt(0).toLocaleUpperCase() + s.slice(1)

/** «Jue 8 · 15:00» («Thu 8 · 3:00 PM»), en la zona que se enseña (maqueta `pasos-con-aire-v7`, paso 4). */
export function cuandoCorto(startsAt: string, timeZone: string, idioma: Idioma): string {
  try {
    const loc = idioma === 'en' ? 'en-US' : 'es-MX'
    const fecha = new Date(startsAt)
    const p = Object.fromEntries(
      new Intl.DateTimeFormat(loc, { timeZone, weekday: 'short', day: 'numeric' }).formatToParts(fecha).map(x => [x.type, x.value]),
    )
    const hora = fecha.toLocaleTimeString(loc, { hour: 'numeric', minute: '2-digit', hour12: idioma === 'en', timeZone })
    return `${mayuscula(String(p.weekday ?? '').replace(/\.$/, ''))} ${p.day} · ${hora}`
  } catch {
    return ''
  }
}

/**
 * En la página propia, el botón flotante del chat taparía el botón fijo de abajo en el celular: el elemento avisa que está en un
 * paso de la clase (`public/index.html` lo esconde ahí), como el detalle y el mapa.
 */
function useSinChatEncima() {
  const raiz = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const rootNode = raiz.current?.getRootNode()
    const host = rootNode && 'host' in rootNode ? (rootNode as ShadowRoot).host : null
    if (!host) return
    host.setAttribute('data-detalle-de-clase', '')
    return () => host.removeAttribute('data-detalle-de-clase')
  }, [])
  return raiz
}

interface ConfirmarReservaProps {
  /** «Lagree». */
  clase: string
  /** «Jue 8 · 15:00» (`cuandoCorto`). */
  cuando: string
  coach: string | null
  /** Las etiquetas de los lugares elegidos («3»); sin mapa, vacío. */
  lugares: string[]
  /** Sus paquetes que pagan ESTA reserva, el default primero (`opcionesQueCubren`). */
  opciones: OpcionDePaquete[]
  /** El `balanceId` que se mandará; `null` = sin paquete (tarjeta, en el estudio o gratis). */
  elegida: string | null
  onElegir: (balanceId: string | null) => void
  /** Cómo se paga lo elegido: con su paquete, o sin él como dice la clase. */
  pago: PagoDeLaReserva
  /** Lo que cuesta esta reserva sin paquete (precio × lugares); `null` sin precio o con `showPrices` apagado. */
  precio: number | null
  /** La regla de cancelación (`lineaDePolitica`); `null` sin política del SERVIDOR: no hay línea. */
  politica: string | null
  nota: string
  onNota: (nota: string) => void
  enviando: boolean
  onConfirmar: () => void
  t: TFunction
  /** Zona del negocio, para «vence el 11 dic». */
  timeZone?: string
  /** La clase también se paga con tarjeta en línea: «Cambiar» ofrece «Pagar $325 con tarjeta». */
  aceptaTarjeta?: boolean
  /** La clase también se paga en el estudio (fix r1 #3, como hoy `PaymentSelector`): «Cambiar» ofrece «Pagar en el estudio». */
  aceptaEstudio?: boolean
  /** Se llegó desde «Reservar otro lugar para alguien» (Task 11). */
  otroLugar?: boolean
  /** Por qué su Ilimitado no paga esta reserva (`avisoDelIlimitado`), cuando no se ofrece. */
  avisoIlimitado?: string | null
  /** Todavía se lee su paquete: no se deja confirmar (se cobraría con tarjeta a quien tiene paquete). */
  cargando?: boolean
  /**
   * Ola final W7: con sesión, no se pudo leer su paquete. «No pudimos leer tu paquete» con «Reintentar»; no se ofrece pagar con
   * tarjeta (podría tener paquete) y no se deja confirmar hasta leerlo.
   */
  sinSaldo?: boolean
  onReintentarSaldo?: () => void
  /** Sus datos (el formulario de la invitada, o «Reservando como Ana»). */
  children?: ComponentChildren
}

/**
 * «Confirma tu reserva» (diseño 27-nov, `pasos-con-aire-v7.html`, paso 4): el resumen en renglones con aire, la forma de pago (por
 * default el paquete que vence primero) y el total. Nada se reserva hasta el botón: «Confirmar reserva», o «Pagar $325» cuando la
 * clase se paga en línea sin paquete.
 */
export function ConfirmarReserva({
  clase, cuando, coach, lugares, opciones, elegida, onElegir, pago, precio, politica, nota, onNota, enviando, onConfirmar, t,
  timeZone = 'America/Mexico_City', aceptaTarjeta = false, aceptaEstudio = false, otroLugar = false, avisoIlimitado = null, cargando = false,
  sinSaldo = false, onReintentarSaldo, children,
}: ConfirmarReservaProps) {
  const raiz = useSinChatEncima()
  const [cambiando, setCambiando] = useState(false)
  const [conNota, setConNota] = useState(!!nota)
  const idNota = useId()
  const idGrupo = useId()
  const n = Math.max(lugares.length, 1)
  const plata = (monto: number) => formatoDePrecio(monto, 'MXN', t('cuenta.intl').startsWith('en') ? 'en' : 'es')

  const opcion = opciones.find(o => o.balanceId === elegida) ?? null
  // Sin paquete hay a lo más una forma (la de la clase): con tarjeta en línea, o en el estudio.
  const sinPaquete = aceptaTarjeta ? 'tarjeta' : aceptaEstudio ? 'estudio' : null
  const formas = opciones.length + (sinPaquete ? 1 : 0)

  const queUsa = (o: OpcionDePaquete): string => {
    if (o.ilimitado) return t(`${K}.usaIlimitado`)
    const u = (cantidad: number) => unidad(t, { cantidad, nombreClase: clase, soloEstaClase: o.soloEstaClase })
    // «crédito» es masculino: «Usa tu último crédito» (como `Confirmation`), no «Usa tu última crédito».
    if (o.restante <= n && !o.soloEstaClase) return n === 1 ? t(`${K}.usaUltimoCredito`) : t(`${K}.usaUltimosCreditos`, { n })
    if (o.restante <= n) return n === 1 ? t(`${K}.usaUltima`, { unidad: u(1) }) : t(`${K}.usaUltimas`, { n, unidad: u(n) })
    return t(`${K}.usaDe`, { n, restante: o.restante, unidad: u(o.restante) })
  }
  const deQuePaquete = (o: OpcionDePaquete): string => {
    const fecha = o.vence ? fechaCorta(t, o.vence, timeZone) : null
    return fecha ? t(`${K}.venceEl`, { paquete: o.packName, fecha }) : o.packName
  }
  const conTarjeta = precio != null ? t(`${K}.conTarjeta`, { precio: plata(precio) }) : t(`${K}.conTarjetaSinPrecio`)

  // Lo que dice la caja de pago: el paquete elegido, o cómo se paga sin él.
  const caja = opcion
    ? { icono: 'paquete' as const, titulo: queUsa(opcion), sub: deQuePaquete(opcion) }
    : pago === 'tarjeta'
      ? { icono: 'tarjeta' as const, titulo: conTarjeta, sub: null }
      : pago === 'estudio'
        ? { icono: 'tienda' as const, titulo: t(`${K}.enElEstudio`), sub: precio != null ? t('reservaClases.claseSuelta', { precio: plata(precio) }) : null }
        : pago === 'gratis'
          ? { icono: 'check' as const, titulo: t(`${K}.gratis`), sub: null }
          : null

  const hoy = pago === 'tarjeta' ? precio : 0
  const enElEstudio = pago === 'estudio' ? precio : null
  // Cargando o sin poder leer su paquete: ni forma de pago, ni totales, ni botón que reserve.
  const espera = cargando || sinSaldo
  const etiqueta = enviando
    ? t(`${K}.enviando`)
    : pago === 'tarjeta' && !sinSaldo
      ? (precio != null ? t(`${K}.pagar`, { precio: plata(precio) }) : t(`${K}.pagarSinPrecio`))
      : t(`${K}.confirmar`)

  const elegir = (balanceId: string | null) => {
    setCambiando(false)
    if (balanceId !== elegida) onElegir(balanceId)
  }

  return (
    <div ref={raiz} class="avq-confirmar avq-animate-in">
      {otroLugar && <p class="avq-cf-antes">{t(`${K}.otroLugar`)}</p>}
      <h1 class="avq-cf-titulo">{t(`${K}.titulo`)}</h1>

      <dl class="avq-cf-filas">
        <div class="avq-cf-fila"><dt>{t(`${K}.clase`)}</dt><dd>{clase}</dd></div>
        <div class="avq-cf-fila"><dt>{t(`${K}.cuando`)}</dt><dd>{cuando}</dd></div>
        {coach && <div class="avq-cf-fila"><dt>{t(`${K}.coach`)}</dt><dd>{coach}</dd></div>}
        {lugares.length > 0 && (
          <div class="avq-cf-fila">
            <dt>{t(lugares.length > 1 ? `${K}.lugares` : `${K}.lugar`)}</dt>
            <dd>{lugares.join(', ')}</dd>
          </div>
        )}
      </dl>

      {children && <div class="avq-cf-datos">{children}</div>}

      <div class="avq-cf-sep" />

      {cargando ? (
        <p class="avq-cf-cargando" role="status"><Spinner size={18} />{t(`${K}.cargando`)}</p>
      ) : sinSaldo ? (
        <div class="avq-cf-pago" role="status">
          <Icono nombre="alerta" size={22} />
          <div class="avq-cf-pago-que">
            <strong>{t(`${K}.sinSaldo`)}</strong>
          </div>
          {onReintentarSaldo && (
            <button type="button" class="avq-cf-cambiar" onClick={onReintentarSaldo}>
              {t(`${K}.reintentarSaldo`)}
            </button>
          )}
        </div>
      ) : caja && (
        <div class="avq-cf-pago">
          <Icono nombre={caja.icono} size={22} />
          <div class="avq-cf-pago-que">
            <strong>{caja.titulo}</strong>
            {caja.sub && <span>{caja.sub}</span>}
          </div>
          {formas > 1 && (
            <button
              type="button"
              class="avq-cf-cambiar"
              aria-expanded={cambiando}
              aria-controls={idGrupo}
              onClick={() => setCambiando(v => !v)}
            >
              {t(`${K}.cambiar`)}
            </button>
          )}
        </div>
      )}

      {!espera && cambiando && formas > 1 && (
        <div id={idGrupo} role="radiogroup" aria-label={t(`${K}.comoPagar`)} class="avq-cf-formas">
          {opciones.map(o => (
            <button
              key={o.balanceId}
              type="button"
              role="radio"
              aria-checked={o.balanceId === elegida}
              class="avq-cf-forma"
              onClick={() => elegir(o.balanceId)}
            >
              <strong>{queUsa(o)}</strong>
              <span>{deQuePaquete(o)}</span>
            </button>
          ))}
          {sinPaquete === 'tarjeta' && (
            <button type="button" role="radio" aria-checked={elegida === null} class="avq-cf-forma" onClick={() => elegir(null)}>
              <strong>{conTarjeta}</strong>
            </button>
          )}
          {sinPaquete === 'estudio' && (
            <button type="button" role="radio" aria-checked={elegida === null} class="avq-cf-forma" onClick={() => elegir(null)}>
              <strong>{t(`${K}.enElEstudioOpcion`)}</strong>
              {precio != null && <span>{t('reservaClases.claseSuelta', { precio: plata(precio) })}</span>}
            </button>
          )}
        </div>
      )}

      {!espera && avisoIlimitado && (
        <p class="avq-cf-aviso" role="status"><Icono nombre="alerta" size={20} /><span>{avisoIlimitado}</span></p>
      )}

      {!espera && hoy != null && (
        <div class="avq-cf-total"><span>{t(`${K}.aPagarHoy`)}</span><span>{plata(hoy)}</span></div>
      )}
      {!espera && enElEstudio != null && (
        <div class="avq-cf-total avq-cf-total--estudio"><span>{t(`${K}.aPagarEnElEstudio`)}</span><span>{plata(enElEstudio)}</span></div>
      )}

      {politica && (
        <p class="avq-cf-pol"><Icono nombre="reloj" size={20} /><span>{politica}</span></p>
      )}

      {conNota ? (
        <div class="avq-cf-nota">
          <label for={idNota}>{t(`${K}.nota`)}</label>
          <textarea
            id={idNota}
            rows={3}
            maxLength={2000}
            value={nota}
            onInput={e => onNota((e.target as HTMLTextAreaElement).value)}
          />
        </div>
      ) : (
        <button type="button" class="avq-cf-agregar" onClick={() => setConNota(true)}>
          <Icono nombre="lapiz" size={20} />
          {t(`${K}.agregarNota`)}
        </button>
      )}

      <div class="avq-cf-accion">
        <button
          type="button"
          class="avq-cf-btn"
          disabled={enviando || espera}
          onClick={() => { if (!enviando && !espera) onConfirmar() }}
        >
          {etiqueta}
        </button>
      </div>

      <style>{ESTILOS}</style>
    </div>
  )
}

export type EstadoDeLaRevision =
  | 'revisando'
  | 'quedo'
  | 'quedo-falta-pagar'
  | 'quedo-por-aprobar'
  | 'no-quedo'
  | 'sin-red'
  | 'no-disponible'
  | 'cambio-de-cuenta'
  | 'invitada-aviso'
  | 'invitada-escribe'

interface RevisionProps {
  estado: EstadoDeLaRevision
  clase: string
  /** «Jueves 8 de octubre». */
  dia: string
  /** «15:00». */
  hora: string
  /** El nombre de la coach («Con Fer»). */
  coach: string | null
  lugares: string[]
  /** El negocio recibe mensajes: «Escribir al estudio» (sólo a la invitada). */
  puedeEscribir: boolean
  onIntentar: () => void
  onRevisar: () => void
  onVerMiReserva: () => void
  onVerMiCuenta: () => void
  onEscribir: () => void
  t: TFunction
}

/**
 * Tras un error de red o un 5xx al confirmar (`revisar-si-quedo.html`): primero se revisa si la reserva quedó, sin botones; sólo si
 * no quedó se deja intentar otra vez, y sin red se ofrece «Revisar de nuevo» (pregunta; no vuelve a reservar).
 */
export function RevisionDeLaReserva({
  estado, clase, dia, hora, coach, lugares, puedeEscribir, onIntentar, onRevisar, onVerMiReserva, onVerMiCuenta, onEscribir, t,
}: RevisionProps) {
  const raiz = useSinChatEncima()
  const quedo = estado === 'quedo' || estado === 'quedo-falta-pagar' || estado === 'quedo-por-aprobar'
  const invitada = estado === 'invitada-aviso' || estado === 'invitada-escribe'

  const textos: Record<EstadoDeLaRevision, { titulo: string; sub?: string; icono: 'reloj' | 'check' | 'alerta' | 'sinRed' | 'correo' }> = {
    'revisando': { titulo: t(`${R}.revisando`), sub: t(`${R}.revisandoSub`), icono: 'reloj' },
    'quedo': { titulo: t(`${R}.quedo`), icono: 'check' },
    'quedo-falta-pagar': { titulo: t(`${R}.quedoFaltaPagar`), icono: 'reloj' },
    'quedo-por-aprobar': { titulo: t(`${R}.quedoPorAprobar`), icono: 'reloj' },
    'no-quedo': { titulo: t(`${R}.noQuedo`), sub: t(`${R}.noQuedoSub`), icono: 'alerta' },
    'sin-red': { titulo: t(`${R}.sinRed`), sub: t(`${R}.sinRedSub`), icono: 'sinRed' },
    'no-disponible': { titulo: t(`${R}.noDisponible`), sub: t(`${R}.noDisponibleSub`), icono: 'alerta' },
    'cambio-de-cuenta': { titulo: t(`${R}.cambioDeCuenta`), sub: t(`${R}.cambioDeCuentaSub`), icono: 'alerta' },
    'invitada-aviso': { titulo: t(`${R}.invitada`), sub: t(`${R}.invitadaAviso`), icono: 'correo' },
    'invitada-escribe': { titulo: t(`${R}.invitada`), sub: t(`${R}.invitadaEscribe`), icono: 'correo' },
  }
  const x = textos[estado]
  const tono = quedo ? (estado === 'quedo' ? 'ok' : 'pendiente') : estado === 'no-quedo' ? 'no' : 'gris'
  const conQuien = [
    coach ? t(`${R}.con`, { coach }) : null,
    lugares.length > 1 ? t(`${R}.lugares`, { lugares: lugares.join(', ') }) : lugares[0] ? t(`${R}.lugar`, { lugar: lugares[0] }) : null,
  ].filter(Boolean).join(' · ')

  return (
    <div ref={raiz} class="avq-revisar avq-animate-in" role={estado === 'revisando' ? 'status' : undefined} aria-live="polite">
      <div class="avq-rv-cuerpo">
        {estado === 'revisando' ? <div class="avq-rv-ico avq-rv-ico--gris"><Spinner size={28} /></div> : (
          <div class={`avq-rv-ico avq-rv-ico--${tono}`}><Icono nombre={x.icono} size={28} /></div>
        )}
        <h1 class="avq-rv-titulo">{x.titulo}</h1>
        {quedo && (
          <p class="avq-rv-det">
            <span>{clase}</span>
            <span>{`${dia} · ${hora}`}</span>
            {conQuien && <span>{conQuien}</span>}
          </p>
        )}
        {x.sub && <p class="avq-rv-sub">{x.sub}</p>}
      </div>

      {estado !== 'revisando' && estado !== 'cambio-de-cuenta' && (
        <div class="avq-rv-accion">
          {quedo && <button type="button" class="avq-cf-btn" onClick={onVerMiReserva}>{t(`${R}.verMiReserva`)}</button>}
          {estado === 'sin-red' && (
            <button type="button" class="avq-cf-btn" onClick={onRevisar}><Icono nombre="repetir" size={20} />{t(`${R}.revisarOtraVez`)}</button>
          )}
          {estado === 'no-disponible' && (
            <button type="button" class="avq-cf-btn" onClick={onVerMiCuenta}>{t(`${R}.verMiCuenta`)}</button>
          )}
          {(estado === 'no-quedo' || estado === 'no-disponible' || invitada) && (
            <button type="button" class={`avq-cf-btn${estado === 'no-disponible' ? ' avq-cf-btn--sec' : ''}`} onClick={onIntentar}>
              {estado === 'no-quedo' && <Icono nombre="repetir" size={20} />}
              {t(`${R}.intentar`)}
            </button>
          )}
          {invitada && puedeEscribir && (
            <button type="button" class="avq-cf-btn avq-cf-btn--sec" onClick={onEscribir}>
              <Icono nombre="chat" size={20} />{t(`${R}.escribir`)}
            </button>
          )}
        </div>
      )}
      {estado === 'cambio-de-cuenta' && (
        <div class="avq-rv-accion">
          <button type="button" class="avq-cf-btn" onClick={onVerMiCuenta}>{t(`${R}.verMiCuenta`)}</button>
        </div>
      )}

      <style>{ESTILOS}</style>
    </div>
  )
}

const ESTILOS = `
  .avq-cf-antes { margin: 0 0 6px; font-size: 14px; font-weight: 600; letter-spacing: .02em; color: var(--avq-accent, #2563eb); }
  .avq-cf-titulo {
    margin: 0 0 6px; font-size: 26px; font-weight: 700; letter-spacing: -0.02em; line-height: 1.15; color: var(--avq-fg, #111827);
  }
  .avq-cf-filas { margin: 18px 0 0; }
  .avq-cf-fila {
    display: flex; justify-content: space-between; gap: 16px; padding: 12px 0; font-size: 16px;
    border-bottom: 1px solid var(--avq-border, #f1f3f5);
  }
  .avq-cf-fila:last-child { border-bottom: 0; }
  .avq-cf-fila dt { color: var(--avq-muted-fg, #6b7280); }
  .avq-cf-fila dd { margin: 0; font-weight: 600; color: var(--avq-fg, #111827); text-align: right; overflow-wrap: anywhere; }
  .avq-cf-datos { margin-top: 24px; }
  .avq-cf-sep { height: 1px; margin: 24px 0; background: var(--avq-border, #e8eaed); }
  .avq-cf-cargando { display: flex; align-items: center; gap: 10px; margin: 0; font-size: 16px; color: var(--avq-muted-fg, #6b7280); }
  .avq-cf-pago {
    display: flex; align-items: center; gap: 14px; padding: 16px 18px; border-radius: 18px;
    border: 2px solid var(--avq-accent, #2563eb); color: var(--avq-accent, #2563eb);
  }
  .avq-cf-pago-que { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .avq-cf-pago-que strong { font-size: 17px; color: var(--avq-fg, #111827); }
  .avq-cf-pago-que span { font-size: 14px; color: var(--avq-muted-fg, #6b7280); }
  .avq-cf-cambiar {
    min-height: 44px; padding: 0 8px; background: none; border: 0; border-radius: 8px; font: inherit; font-size: 15px;
    font-weight: 600; color: var(--avq-accent, #2563eb); cursor: pointer;
  }
  .avq-cf-cambiar:focus-visible, .avq-cf-forma:focus-visible, .avq-cf-agregar:focus-visible, .avq-cf-btn:focus-visible {
    outline: 2px solid var(--avq-accent, #2563eb); outline-offset: 2px;
  }
  .avq-cf-formas { display: flex; flex-direction: column; gap: 10px; margin-top: 12px; }
  .avq-cf-forma {
    display: flex; flex-direction: column; gap: 3px; min-height: 56px; padding: 12px 16px; text-align: left; cursor: pointer;
    background: var(--avq-bg, #ffffff); border: 1.5px solid var(--avq-border, #e8eaed); border-radius: 14px; font: inherit;
  }
  .avq-cf-forma[aria-checked="true"] { border-color: var(--avq-accent, #2563eb); }
  .avq-cf-forma strong { font-size: 16px; color: var(--avq-fg, #111827); }
  .avq-cf-forma span { font-size: 14px; color: var(--avq-muted-fg, #6b7280); }
  .avq-cf-aviso {
    display: flex; align-items: flex-start; gap: 10px; margin: 16px 0 0; padding: 12px 14px; border-radius: 12px;
    background: var(--avq-warning-bg, #fffbeb); color: var(--avq-warning-fg, #92400e); font-size: 15px; line-height: 1.5;
  }
  .avq-cf-total { display: flex; justify-content: space-between; margin-top: 22px; font-size: 19px; font-weight: 700; color: var(--avq-fg, #111827); }
  .avq-cf-total--estudio { margin-top: 8px; font-size: 16px; font-weight: 500; color: var(--avq-muted-fg, #6b7280); }
  .avq-cf-pol {
    display: flex; align-items: flex-start; gap: 12px; margin: 16px 0 0; font-size: 15px; line-height: 1.5;
    color: var(--avq-muted-fg, #6b7280);
  }
  .avq-cf-agregar {
    display: flex; align-items: center; gap: 12px; min-height: 44px; margin-top: 14px; padding: 0; background: none; border: 0;
    font: inherit; font-size: 16px; color: var(--avq-fg, #44403c); cursor: pointer; text-align: left;
  }
  .avq-cf-nota { display: flex; flex-direction: column; gap: 8px; margin-top: 18px; }
  .avq-cf-nota label { font-size: 15px; font-weight: 500; color: var(--avq-fg, #111827); }
  .avq-cf-nota textarea {
    width: 100%; box-sizing: border-box; padding: 12px 14px; border-radius: 12px; font: inherit; font-size: 16px; resize: vertical;
    border: 1.5px solid var(--avq-border, #e8eaed); background: var(--avq-bg, #ffffff); color: var(--avq-fg, #111827);
  }
  .avq-cf-nota textarea:focus { outline: none; border-color: var(--avq-accent, #2563eb); }
  .avq-cf-accion { margin-top: 24px; }
  .avq-cf-btn {
    display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%; min-height: 52px; padding: 0 16px;
    background: var(--avq-accent, #2563eb); color: #ffffff; border: 0; border-radius: var(--avq-btn-radius, 12px);
    font: inherit; font-size: 16px; font-weight: 600; cursor: pointer; transition: filter 0.15s ease;
  }
  .avq-cf-btn:hover:not(:disabled) { filter: brightness(0.94); }
  .avq-cf-btn:disabled { background: var(--avq-muted-fg, #9ca3af); cursor: not-allowed; }
  .avq-cf-btn--sec { background: var(--avq-bg, #ffffff); color: var(--avq-fg, #111827); border: 1px solid var(--avq-border, #dcd8d4); }
  .avq-rv-cuerpo { display: flex; flex-direction: column; align-items: center; text-align: center; padding: 24px 0 8px; }
  .avq-rv-ico { width: 64px; height: 64px; border-radius: 999px; display: flex; align-items: center; justify-content: center; margin-bottom: 18px; }
  .avq-rv-ico--ok { background: var(--avq-success-bg, #ecfdf5); color: var(--avq-success-fg, #166534); }
  .avq-rv-ico--pendiente { background: var(--avq-warning-bg, #fffbeb); color: var(--avq-warning-fg, #92400e); }
  .avq-rv-ico--no { background: var(--avq-danger-bg, #fef2f2); color: var(--avq-danger-fg, #991b1b); }
  .avq-rv-ico--gris { background: var(--avq-muted, #f5f5f4); color: var(--avq-muted-fg, #6b7280); }
  .avq-rv-titulo { margin: 0; font-size: 26px; font-weight: 700; letter-spacing: -0.02em; line-height: 1.2; color: var(--avq-fg, #111827); }
  .avq-rv-det { display: flex; flex-direction: column; gap: 2px; margin: 14px 0 0; font-size: 17px; line-height: 1.5; color: var(--avq-fg, #111827); }
  .avq-rv-sub { margin: 12px 0 0; max-width: 34em; font-size: 16px; line-height: 1.55; color: var(--avq-muted-fg, #6b7280); }
  .avq-rv-accion { display: flex; flex-direction: column; gap: 12px; margin-top: 24px; }
  @media (min-width: 641px) {
    .avq-rv-accion { max-width: 360px; margin-inline: auto; }
  }
  /* Celular (≤ 640 px): el margen lo ponen la página (12 px) y el widget (16 px), 28 px; aquí ya no se suman 12 px más (W2). El
     botón va fijo abajo, alineado con el contenido (28 px), encima de la barra de la página (\`--avq-toast-offset\`; el área segura
     sólo cuando no hay barra), como el detalle y el mapa. */
  @media (max-width: 640px) {
    .avq-confirmar { padding-bottom: 96px; }
    .avq-revisar { padding-bottom: 180px; }
    .avq-cf-titulo { font-size: 28px; }
    .avq-rv-titulo { font-size: 26px; }
    .avq-cf-fila, .avq-cf-agregar { font-size: 17px; }
    .avq-cf-accion, .avq-rv-accion {
      position: fixed; left: 0; right: 0; bottom: var(--avq-toast-offset, 0px); z-index: 40; margin: 0;
      padding: 16px 28px max(16px, calc(16px + env(safe-area-inset-bottom, 0px) - var(--avq-toast-offset, 0px)));
      background: var(--avq-bg, #ffffff); border-top: 1px solid var(--avq-border, #e8eaed);
    }
    .avq-cf-btn { min-height: 56px; font-size: 17px; }
    .avq-cf-btn--sec { min-height: 54px; font-size: 16px; }
    .avq-root:has(.avq-cf-accion) .avq-chat-fab, .avq-root:has(.avq-rv-accion) .avq-chat-fab { display: none; }
  }
`
