import { h, Fragment } from 'preact'
import { useEffect, useRef } from 'preact/hooks'
import type { PublicClassSessionSlot, Product } from '../types'
import type { TFunction } from '../i18n'
import { branding } from '../state/booking'
import { InstructorAvatar } from './InstructorAvatar'
import { Icono } from './ui/Icono'
import { etiquetaDePrecio } from '../lib/paquetes'
import { unidad } from '../lib/palabras'
import type { OpcionDePaquete } from '../lib/eleccionDePaquete'
import { fechaCorta } from './TuPaqueteFranja'
import { idiomaDe, type Idioma } from './ListaDelHorario'
import type { MiLugarEnLaClase } from './useMisClases'

/** Lo que su paquete dice de ESTA clase («Incluida en tu paquete · Te quedan 5 sesiones de Lagree · vencen el 11 dic»). */
export interface CubreLaClase {
  /** La suma de sus sesiones que pagan la clase. En un Ilimitado es 0: nunca se enseña su número interno. */
  restante: number
  nombreClase: string
  /** Sus paquetes son sólo de esta clase («sesiones de Lagree»); si cubren varias, «créditos». */
  soloEstaClase: boolean
  ilimitado?: boolean
  /** El vencimiento de cada paquete que la paga, el que se usaría primero al principio (`null` = no vence). */
  vencimientos?: Array<string | null>
}

/** `CubreLaClase` a partir de `opcionesQueCubren` (ordenadas: la default primero). Un Ilimitado manda, como en la franja. */
export function cubreDe(opciones: OpcionDePaquete[], nombreClase: string): CubreLaClase | null {
  if (opciones.length === 0) return null
  const ilimitado = opciones.find(o => o.ilimitado)
  if (ilimitado) {
    return { restante: 0, nombreClase, soloEstaClase: ilimitado.soloEstaClase, ilimitado: true, vencimientos: [ilimitado.vence] }
  }
  return {
    restante: opciones.reduce((suma, o) => suma + o.restante, 0),
    nombreClase,
    soloEstaClase: opciones.every(o => o.soloEstaClase),
    ilimitado: false,
    vencimientos: opciones.map(o => o.vence),
  }
}

const K = 'reservaClases.detalle'

/** «Te quedan 5 sesiones de Lagree · vencen el 11 dic» / «Tienes Ilimitado de Lagree · vence el 20 dic». */
export function textoDeCubre(t: TFunction, c: CubreLaClase, timeZone: string): string {
  const fechas = (c.vencimientos ?? []).map(v => (v ? fechaCorta(t, v, timeZone) : null))
  const primera = fechas[0] ?? null
  if (c.ilimitado) {
    const base = c.soloEstaClase ? t(`${K}.tienesIlimitadoDe`, { clase: c.nombreClase }) : t(`${K}.tienesIlimitado`)
    return primera ? `${base} · ${t('reservaClases.franja.vence', { fecha: primera })}` : base
  }
  const una = c.restante === 1
  const base = t(una ? `${K}.teQueda` : `${K}.teQuedan`, {
    n: c.restante,
    unidad: unidad(t, { cantidad: c.restante, nombreClase: c.nombreClase, soloEstaClase: c.soloEstaClase }),
  })
  if (!primera) return base
  const vence = fechas.every(f => f === primera)
    ? t(una ? 'reservaClases.franja.vence' : 'reservaClases.franja.vencen', { fecha: primera })
    : t('reservaClases.franja.primerasVencen', { fecha: primera })
  return `${base} · ${vence}`
}

const mayuscula = (s: string) => s.charAt(0).toLocaleUpperCase() + s.slice(1)

/** «Jueves 26 de noviembre» («Thursday, November 26»), en la zona que se enseña; el año sólo si no es el actual. */
function fechaDeLaClase(iso: string, timeZone: string, idioma: Idioma): string {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat(idioma === 'en' ? 'en-US' : 'es-MX', {
      timeZone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    }).formatToParts(new Date(iso)).map(p => [p.type, p.value]),
  )
  const esteAnio = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric' }).format(new Date())
  const anio = partes.year !== esteAnio ? partes.year : null
  return mayuscula(idioma === 'en'
    ? `${partes.weekday}, ${partes.month} ${partes.day}${anio ? `, ${anio}` : ''}`
    : `${partes.weekday} ${partes.day} de ${partes.month}${anio ? ` de ${anio}` : ''}`)
}

function horaDeLaClase(iso: string, timeZone: string, idioma: Idioma): string {
  return new Date(iso).toLocaleTimeString(idioma === 'en' ? 'en-US' : 'es-MX', {
    hour: 'numeric', minute: '2-digit', hour12: idioma === 'en', timeZone,
  })
}

interface ClassDetailViewProps {
  /** The slot the customer tapped on the listing. */
  slot: PublicClassSessionSlot
  /** The matching product object (resolved by parent from venueInfo.products). */
  product: Product | null
  /**
   * Task 10: su lugar en ESTA clase si ya la reservó (`null` si no, o sin sesión). Se llega aquí tocando la clase marcada en el
   * horario, también si está llena: la caja «Ya tienes lugar en esta clase» con «Ver mi reserva» y, si hay cupo, «Reservar otro
   * lugar para alguien».
   */
  miLugar?: MiLugarEnLaClase | null
  /** Zona en que se enseñan las horas (la del negocio, o la de la clienta si la eligió). */
  timezone: string
  /** La regla de cancelación en una línea (`lineaDePolitica`); `null` sin política del SERVIDOR: no hay línea. */
  politica: string | null
  /** Su paquete paga esta clase (`cubreDe`); `null` si no: se enseña el precio como en el horario. */
  cubre: CubreLaClase | null
  /** El negocio recibe mensajes (`chat.canMessage`): «¿Dudas sobre esta clase? Escríbenos». */
  puedeEscribir: boolean
  /** «Reservar»: sigue al mapa o al formulario. */
  onBook: () => void
  /** «Reservar otro lugar para alguien»: el mismo flujo que «Reservar», marcado como otro lugar (Task 13). */
  onOtroLugar: () => void
  /** «Ver mi reserva»: abre «Gestionar» con su `cancelSecret`. */
  onVerMiReserva: (cancelSecret: string) => void
  /** «Horario»: regresa al horario. */
  onBack: () => void
  t: TFunction
}

/**
 * El detalle de una clase (diseño 27-nov, `pasos-con-aire-v7.html`, paso 1), entre el horario y el mapa o el formulario. Tres
 * bloques: cuándo · con quién y cuántos lugares · su paquete (o el precio) y la regla. En el celular el botón va fijo abajo,
 * encima de la barra de la página. Sin «o 1 crédito» ni política inventada: la línea sólo sale de la política del SERVIDOR.
 */
export function ClassDetailView({
  slot,
  product,
  miLugar = null,
  timezone,
  politica,
  cubre,
  puedeEscribir,
  onBook,
  onOtroLugar,
  onVerMiReserva,
  onBack,
  t,
}: ClassDetailViewProps) {
  const idioma = idiomaDe(t)
  const isFull = !slot.available || (slot.remaining ?? 0) === 0
  const remaining = slot.remaining ?? 0
  const raiz = useRef<HTMLDivElement>(null)

  // En la página propia, su botón flotante del chat taparía «Reservar» en el celular: el elemento avisa que está en el detalle
  // (`public/index.html` lo esconde ahí; el detalle ya trae su «Escríbenos»).
  useEffect(() => {
    const rootNode = raiz.current?.getRootNode()
    const host = rootNode && 'host' in rootNode ? (rootNode as ShadowRoot).host : null
    if (!host) return
    host.setAttribute('data-detalle-de-clase', '')
    return () => host.removeAttribute('data-detalle-de-clase')
  }, [])

  const cuando = `${horaDeLaClase(slot.startsAt, timezone, idioma)} – ${horaDeLaClase(slot.endsAt, timezone, idioma)}`
  const instructorName = slot.instructor ? `${slot.instructor.firstName} ${slot.instructor.lastName}`.trim() : null
  const heroSrc = slot.productImageUrl ?? product?.imageUrl ?? null
  const lugares = isFull
    ? t(`${K}.llena`)
    : slot.capacity
      ? t(`${K}.libres`, { libres: remaining, total: slot.capacity })
      : remaining === 1
        ? t(`${K}.libreSinTotal`)
        : t(`${K}.libresSinTotal`, { libres: remaining })

  // El mismo precio que la fila del horario («$325 · clase suelta»); con su paquete, «Incluida en tu paquete».
  const etiqueta = etiquetaDePrecio(t, {
    precio: product?.price != null ? Number(product.price) : null,
    showPrices: branding.value.showPrices,
    incluida: !!cubre,
  })

  const pendiente = miLugar?.estado === 'faltaPagar' || miLugar?.estado === 'porAprobar'
  const yaTienes = miLugar
    ? [
        t(`${K}.yaTienesLugar`),
        miLugar.lugares && miLugar.lugares.length > 1
          ? t(`${K}.lugares`, { lugares: miLugar.lugares.join(', ') })
          : miLugar.lugar
            ? t(`${K}.lugar`, { lugar: miLugar.lugar })
            : null,
      ].filter(Boolean).join(' · ')
    : null
  const otroLugar = !!miLugar && !isFull
  // Con su lugar, la caja de su reserva manda: el precio, su paquete y la regla son de una reserva nueva.
  const paquete = miLugar ? null : cubre
  const linea = miLugar ? null : politica
  const precioSuelto = miLugar || cubre ? null : etiqueta
  const tercerBloque = !!(miLugar || paquete || precioSuelto || linea || puedeEscribir)

  return (
    <div ref={raiz} class={`avq-classdetail${otroLugar ? ' avq-cd--dos' : ''}`}>
      <div class="avq-classdetail-layout">
        <div class="avq-classdetail-main avq-animate-in">
          <button type="button" class="avq-cd-volver" onClick={onBack}>
            <Icono nombre="anterior" size={20} />
            {t(`${K}.volver`)}
          </button>

          {/* 1 · Cuándo */}
          <h1 class="avq-cd-titulo">{slot.productName}</h1>
          <div class="avq-cd-cuando">
            <div>{fechaDeLaClase(slot.startsAt, timezone, idioma)}</div>
            <div>{cuando}</div>
          </div>

          {/* Si el negocio subió una foto de la clase, se enseña chica, después de la fecha. */}
          {heroSrc ? <div class="avq-cd-foto" style={{ backgroundImage: `url('${heroSrc}')` }} /> : null}

          <div class="avq-cd-sep" />

          {/* 2 · Con quién y cuántos lugares */}
          {slot.instructor && (
            <div class="avq-cd-coach">
              <InstructorAvatar instructor={slot.instructor} size={48} />
              <div>
                <div class="avq-cd-coach-nombre">{instructorName}</div>
                <div class="avq-cd-coach-rol">{t(`${K}.coach`)}</div>
              </div>
            </div>
          )}
          <div class="avq-cd-dato">
            <Icono nombre="asiento" size={20} />
            <span>{lugares}</span>
          </div>
          {branding.value.showDescriptions && product?.description && (
            <p class="avq-cd-txt">{product.description}</p>
          )}

          {/* 3 · Su lugar, su paquete (o el precio) y la regla */}
          {tercerBloque && <div class="avq-cd-sep" />}
          {miLugar && (
            <div class={`avq-cd-ok${pendiente ? ' avq-cd-ok--pendiente' : ''}`}>
              <Icono nombre={pendiente ? 'reloj' : 'check'} size={22} />
              <span>
                <strong class="avq-cd-ok-titulo">{yaTienes}</strong>
                {pendiente && (
                  <span class="avq-cd-ok-sub">
                    {t(miLugar.estado === 'faltaPagar' ? 'reservaClases.horario.faltaPagar' : 'reservaClases.horario.porAprobar')}
                  </span>
                )}
              </span>
            </div>
          )}
          {paquete && (
            <div class="avq-cd-ok">
              <Icono nombre="check" size={22} />
              <span>
                <strong class="avq-cd-ok-titulo">{etiqueta}</strong>
                <span class="avq-cd-ok-sub">{textoDeCubre(t, paquete, timezone)}</span>
              </span>
            </div>
          )}
          {precioSuelto && <p class="avq-cd-precio">{precioSuelto}</p>}
          {linea && (
            <p class="avq-cd-pol">
              <Icono nombre="reloj" size={20} />
              <span>{linea}</span>
            </p>
          )}
          {puedeEscribir && (
            <button
              type="button"
              class="avq-cd-dudas"
              // El chat que ya existe (VenueChatModal) escucha este evento en la ventana, también desde la página propia.
              onClick={() => window.dispatchEvent(new CustomEvent('avoqado:open-chat'))}
            >
              <Icono nombre="chat" size={20} />
              {t(`${K}.dudas`)}
            </button>
          )}
        </div>

        {/* La acción: tarjeta a la derecha en computadora; fija abajo en el celular. */}
        <aside class="avq-cd-accion">
          {miLugar ? (
            <Fragment>
              <button type="button" class="avq-cd-btn" onClick={() => onVerMiReserva(miLugar.principal.cancelSecret)}>
                {t(`${K}.verMiReserva`)}
              </button>
              {otroLugar && (
                <button type="button" class="avq-cd-btn avq-cd-btn--sec" onClick={onOtroLugar}>
                  {t(`${K}.otroLugar`)}
                </button>
              )}
            </Fragment>
          ) : (
            <button type="button" class="avq-cd-btn" onClick={() => { if (!isFull) onBook() }} disabled={isFull}>
              {t(`${K}.reservar`)}
            </button>
          )}
        </aside>
      </div>

      <style>{ESTILOS}</style>
    </div>
  )
}

const ESTILOS = `
  .avq-classdetail-layout { display: grid; grid-template-columns: 1fr; gap: 0; }
  .avq-classdetail-main { min-width: 0; }
  .avq-classdetail-main > * { min-width: 0; }
  .avq-cd-volver {
    display: inline-flex; align-items: center; gap: 6px; min-height: 44px; margin: 0 0 8px -6px; padding: 0 6px;
    background: none; border: 0; border-radius: 8px; font: inherit; font-size: 15px; font-weight: 500;
    color: var(--avq-muted-fg, #6b7280); cursor: pointer;
  }
  .avq-cd-volver:hover { color: var(--avq-fg, #111827); }
  .avq-cd-volver:focus-visible { outline: 2px solid var(--avq-accent, #2563eb); outline-offset: 2px; }
  .avq-cd-titulo {
    margin: 0 0 8px; font-size: 32px; font-weight: 700; letter-spacing: -0.02em; line-height: 1.15;
    color: var(--avq-fg, #111827); overflow-wrap: anywhere;
  }
  .avq-cd-cuando { font-size: 16px; line-height: 1.45; color: var(--avq-fg, #111827); }
  .avq-cd-foto {
    width: 100%; aspect-ratio: 16/9; max-height: 220px; margin-top: 20px; border-radius: 12px;
    background-size: cover; background-position: center;
  }
  .avq-cd-sep { height: 1px; margin: 24px 0; background: var(--avq-border, #e8eaed); }
  .avq-cd-coach { display: flex; align-items: center; gap: 14px; margin-bottom: 18px; }
  .avq-cd-coach-nombre { font-size: 16px; font-weight: 600; color: var(--avq-fg, #111827); }
  .avq-cd-coach-rol { margin-top: 2px; font-size: 14px; color: var(--avq-muted-fg, #6b7280); }
  .avq-cd-dato { display: flex; align-items: center; gap: 12px; font-size: 16px; color: var(--avq-fg, #111827); }
  .avq-cd-txt { margin: 18px 0 0; font-size: 16px; line-height: 1.55; color: var(--avq-muted-fg, #6b7280); white-space: pre-wrap; }
  .avq-cd-ok {
    display: flex; align-items: center; gap: 12px; padding: 16px 18px; border-radius: 16px;
    background: var(--avq-success-bg, #ecfdf5); color: var(--avq-success-fg, #166534);
  }
  .avq-cd-ok--pendiente { background: var(--avq-warning-bg, #fffbeb); color: var(--avq-warning-fg, #92400e); }
  .avq-cd-ok-titulo { display: block; font-size: 16px; font-weight: 600; }
  .avq-cd-ok-sub { display: block; margin-top: 2px; font-size: 14px; font-weight: 500; }
  .avq-cd-precio { margin: 0; font-size: 17px; font-weight: 600; color: var(--avq-fg, #111827); }
  .avq-cd-pol {
    display: flex; align-items: flex-start; gap: 12px; margin: 16px 0 0;
    font-size: 15px; line-height: 1.5; color: var(--avq-muted-fg, #6b7280);
  }
  /* Lo primero del bloque ya tiene los 24 px de la raya encima. */
  .avq-cd-sep + .avq-cd-pol, .avq-cd-sep + .avq-cd-dudas { margin-top: 0; }
  .avq-cd-dudas {
    display: flex; align-items: center; gap: 12px; min-height: 44px; margin-top: 10px; padding: 0;
    background: none; border: 0; font: inherit; font-size: 16px; font-weight: 600; text-align: left;
    color: var(--avq-accent, #2563eb); cursor: pointer;
  }
  .avq-cd-dudas:focus-visible { outline: 2px solid var(--avq-accent, #2563eb); outline-offset: 2px; }
  .avq-cd-accion { margin-top: 24px; }
  .avq-cd-btn {
    display: flex; align-items: center; justify-content: center; width: 100%; min-height: 52px; padding: 0 16px;
    background: var(--avq-accent, #2563eb); color: #ffffff; border: 0; border-radius: var(--avq-btn-radius, 12px);
    font: inherit; font-size: 16px; font-weight: 600; cursor: pointer; transition: filter 0.15s ease;
  }
  .avq-cd-btn:hover:not(:disabled) { filter: brightness(0.94); }
  .avq-cd-btn:focus-visible { outline: 2px solid var(--avq-accent, #2563eb); outline-offset: 2px; }
  .avq-cd-btn:disabled { background: var(--avq-muted-fg, #9ca3af); cursor: not-allowed; }
  .avq-cd-btn--sec {
    margin-top: 12px; background: var(--avq-bg, #ffffff); color: var(--avq-fg, #111827);
    border: 1px solid var(--avq-border, #dcd8d4);
  }
  @media (min-width: 880px) {
    .avq-classdetail-layout { grid-template-columns: minmax(0, 1fr) 320px; gap: 28px; align-items: start; }
    .avq-cd-accion {
      position: sticky; top: 24px; margin-top: 0; padding: 18px; border-radius: 14px;
      background: var(--avq-bg, #ffffff); border: 1px solid var(--avq-border, #e8eaed);
    }
  }
  /* Celular (≤ 640 px): la página deja 12 px por lado y el detalle suma 12 px (24 px en total; está fuera de
     \`.avq-classes-main\`). El botón va fijo abajo, encima de la barra de la página: su alto llega en \`--avq-toast-offset\`
     (sin barra, 0); el área segura del celular sólo se suma cuando no hay barra que ya la cubra. Abajo se deja el espacio
     del botón para que no tape el final del detalle. */
  @media (max-width: 640px) {
    .avq-classdetail { padding-inline: 12px; padding-bottom: 96px; }
    .avq-classdetail.avq-cd--dos { padding-bottom: 162px; }
    .avq-cd-titulo { font-size: 28px; }
    .avq-cd-cuando { font-size: 17px; }
    .avq-cd-accion {
      position: fixed; left: 0; right: 0; bottom: var(--avq-toast-offset, 0px); z-index: 40; margin: 0;
      padding: 16px 24px max(16px, calc(16px + env(safe-area-inset-bottom, 0px) - var(--avq-toast-offset, 0px)));
      background: var(--avq-bg, #ffffff); border-top: 1px solid var(--avq-border, #e8eaed);
    }
    .avq-cd-btn { min-height: 56px; font-size: 17px; }
    .avq-cd-btn--sec { min-height: 54px; font-size: 16px; }
    /* El botón flotante del chat del widget taparía «Reservar»; aquí está «¿Dudas sobre esta clase? Escríbenos». */
    .avq-root:has(.avq-cd-accion) .avq-chat-fab { display: none; }
  }
`
