import { h } from 'preact'
import { useEffect, useMemo, useRef } from 'preact/hooks'
import type { LayoutConfig, LayoutSpot } from '../types'
import type { TFunction } from '../i18n'
import { Icono } from './ui/Icono'

interface SeatPickerProps {
  layout: LayoutConfig
  takenSpotIds: string[]
  selectedSpotIds: string[]
  onToggleSpot: (spotId: string) => void
  onConfirm: () => void
  /**
   * Cuántos lugares quedan en la clase (`remaining`). Con más elegidos que ésos se dice «Sólo queda 1 lugar» y no se sigue hasta
   * quitar uno (también tras un 409 `CLASS_FULL`). `null`/sin dato: sin tope.
   */
  libres?: number | null
  /** El nombre de la coach, para la franja del frente («Frente · Fer (coach)»). */
  coach?: string | null
  /** De qué clase es el mapa («Lagree · jueves 26 · 18:15»). */
  contexto?: string | null
  /**
   * En la reserva de una clase (no al cambiar de horario en «Gestionar»): en el celular el botón va fijo abajo, encima de la barra
   * de la página, y el mapa suma los 12 px de margen que la página no da.
   */
  accionFija?: boolean
  t: TFunction
}

function SpotIcon({ type, size = 18 }: { type: string; size?: number }) {
  switch (type) {
    case 'bike':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <circle cx="5" cy="18" r="3" /><circle cx="19" cy="18" r="3" />
          <path d="M12 18V8l-3 3m3-3 3 3" /><circle cx="12" cy="5" r="2" />
        </svg>
      )
    case 'mat':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <rect x="3" y="6" width="18" height="12" rx="2" />
          <line x1="3" y1="12" x2="21" y2="12" />
        </svg>
      )
    case 'reformer':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <rect x="2" y="8" width="20" height="8" rx="1.5" />
          <line x1="7" y1="8" x2="7" y2="16" /><line x1="17" y1="8" x2="17" y2="16" />
          <circle cx="4" cy="19" r="1" /><circle cx="20" cy="19" r="1" />
        </svg>
      )
    case 'bed':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <path d="M2 4v16" /><path d="M22 4v16" />
          <path d="M2 8h20" /><path d="M2 16h20" />
          <path d="M6 8v8" />
        </svg>
      )
    case 'chair':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <path d="M6 19v-3" /><path d="M18 19v-3" />
          <rect x="5" y="10" width="14" height="6" rx="2" />
          <path d="M5 10V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v4" />
        </svg>
      )
    case 'circle':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10" />
        </svg>
      )
    default:
      return <Icono nombre="asiento" size={size} />
  }
}

const K = 'reservaClases.mapa'

/** «1 y 3» / «1, 3 y 5» («1 and 3»): los lugares elegidos, en el orden del mapa. */
function lista(etiquetas: string[], y: string): string {
  if (etiquetas.length <= 1) return etiquetas.join('')
  return `${etiquetas.slice(0, -1).join(', ')} ${y} ${etiquetas[etiquetas.length - 1]}`
}

/** Medidas de cada casilla: en la computadora se achican con muchas columnas; en el celular nunca menos de 72 px (se desliza). */
function medidas(cols: number) {
  return {
    celda: cols <= 3 ? 80 : cols <= 6 ? 72 : cols <= 10 ? 56 : 44,
    celdaMovil: cols <= 3 ? 80 : 72,
    hueco: cols <= 3 ? 22 : 12,
    huecoMovil: cols <= 3 ? 22 : 10,
  }
}

/**
 * «Elige tu lugar» (diseño 27-nov, `pasos-con-aire-v7`, paso 3): la franja del frente, las máquinas grandes y separadas (con
 * sus huecos), la leyenda «Libre · Ocupado · Tu lugar» y «Continuar con el lugar 3».
 */
export function SeatPicker({
  layout, takenSpotIds, selectedSpotIds, onToggleSpot, onConfirm, libres, coach, contexto, accionFija, t,
}: SeatPickerProps) {
  const raiz = useRef<HTMLDivElement>(null)
  const takenSet = useMemo(() => new Set(takenSpotIds), [takenSpotIds])
  const selectedSet = useMemo(() => new Set(selectedSpotIds), [selectedSpotIds])
  const spotGrid = useMemo(() => {
    const grid: Record<string, LayoutSpot> = {}
    for (const spot of layout.spots) grid[`${spot.row}-${spot.col}`] = spot
    return grid
  }, [layout.spots])

  // Como el detalle de la clase: en la página propia, su botón flotante del chat taparía «Continuar» en el celular; el elemento
  // avisa con la misma marca (`public/index.html` lo esconde ahí).
  useEffect(() => {
    if (!accionFija) return
    const rootNode = raiz.current?.getRootNode()
    const host = rootNode && 'host' in rootNode ? (rootNode as ShadowRoot).host : null
    if (!host) return
    host.setAttribute('data-detalle-de-clase', '')
    return () => host.removeAttribute('data-detalle-de-clase')
  }, [accionFija])

  const etiquetas = layout.spots.filter(s => selectedSet.has(s.id)).map(s => s.label)
  const sobran = typeof libres === 'number' && selectedSpotIds.length > libres
  const aviso = !sobran
    ? null
    : libres! <= 0
      ? t('reservaClases.detalle.llena')
      : t(libres === 1 ? `${K}.soloQueda` : `${K}.soloQuedan`, { n: libres! })
  const puedeSeguir = selectedSpotIds.length > 0 && !sobran
  const textoDelBoton = etiquetas.length === 0
    ? t('seats.confirm')
    : etiquetas.length === 1
      ? t(`${K}.continuarLugar`, { lugar: etiquetas[0] })
      : t(`${K}.continuarLugares`, { lugares: lista(etiquetas, t(`${K}.y`)) })
  const m = medidas(layout.cols)

  return (
    <div ref={raiz} class={`avq-seatpicker${accionFija ? ' avq-sp--fija' : ''}`}>
      <style>{CSS}</style>
      <h2 class="avq-sp-titulo">{t('seats.title')}</h2>
      {contexto && <p class="avq-sp-contexto">{contexto}</p>}
      {layout.showInstructor && (
        <div class="avq-sp-frente">
          <Icono nombre="frente" />
          <span>{coach ? t(`${K}.frenteCon`, { coach }) : t(`${K}.frente`)}</span>
        </div>
      )}
      {aviso && (
        <p role="alert" class="avq-sp-aviso">
          <Icono nombre="alerta" />
          <span>{aviso}</span>
        </p>
      )}
      <div class="avq-sp-scroll">
        <div
          class="avq-sp-mapa"
          role="group"
          aria-label={t(`${K}.grupo`)}
          style={{
            gridTemplateColumns: `repeat(${layout.cols}, var(--avq-sp-c))`,
            '--avq-sp-celda': `${m.celda}px`,
            '--avq-sp-celda-movil': `${m.celdaMovil}px`,
            '--avq-sp-hueco': `${m.hueco}px`,
            '--avq-sp-hueco-movil': `${m.huecoMovil}px`,
          } as Record<string, string>}
        >
          {Array.from({ length: layout.rows }).map((_, row) =>
            Array.from({ length: layout.cols }).map((_, col) => {
              const spot = spotGrid[`${row}-${col}`]
              // Un hueco (pasillo, columna, lugar apagado): ocupa su casilla para que el mapa se lea como el salón.
              if (!spot || !spot.enabled) return <div key={`${row}-${col}`} class="avq-sp-celda avq-sp-vacio" aria-hidden="true" />
              const isTaken = takenSet.has(spot.id)
              const isSelected = !isTaken && selectedSet.has(spot.id)
              return (
                <button
                  key={`${row}-${col}`}
                  type="button"
                  class={`avq-sp-celda avq-sp-lugar${isTaken ? ' avq-sp-lugar--ocupado' : ''}${isSelected ? ' avq-sp-lugar--mio' : ''}`}
                  disabled={isTaken}
                  aria-pressed={isTaken ? undefined : isSelected}
                  aria-label={t(isTaken ? `${K}.lugarOcupado` : `${K}.lugar`, { lugar: spot.label })}
                  onClick={() => !isTaken && onToggleSpot(spot.id)}
                >
                  <SpotIcon type={layout.iconType} size={20} />
                  <span>{spot.label}</span>
                </button>
              )
            }),
          )}
        </div>
      </div>
      <ul class="avq-sp-leyenda">
        <li><i class="avq-sp-muestra" aria-hidden="true" />{t(`${K}.libre`)}</li>
        <li><i class="avq-sp-muestra avq-sp-muestra--ocupado" aria-hidden="true" />{t(`${K}.ocupado`)}</li>
        <li><i class="avq-sp-muestra avq-sp-muestra--mio" aria-hidden="true" />{t(`${K}.tuLugar`)}</li>
      </ul>
      <div class="avq-sp-accion">
        <button type="button" class="avq-sp-btn" disabled={!puedeSeguir} onClick={() => puedeSeguir && onConfirm()}>
          {textoDelBoton}
        </button>
      </div>
    </div>
  )
}

const CSS = `
  .avq-sp-titulo { margin: 0; font-size: 22px; font-weight: 700; line-height: 1.15; letter-spacing: -0.02em; color: var(--avq-fg, #111827); }
  .avq-sp-contexto { margin: 6px 0 0; font-size: 15px; line-height: 1.4; color: var(--avq-muted-fg, #6b7280); }
  .avq-sp-frente {
    display: flex; align-items: center; justify-content: center; gap: 10px; min-height: 48px; margin-top: 20px; padding: 0 16px;
    border-radius: 14px; background: var(--avq-muted, #f5f5f4); color: var(--avq-fg, #44403c); font-size: 15px; font-weight: 600;
  }
  .avq-sp-aviso {
    display: flex; align-items: center; gap: 10px; margin: 16px 0 0; padding: 12px 14px; border-radius: 12px;
    background: var(--avq-warning-bg, #fffbeb); border: 1px solid var(--avq-warning-border, #fde68a);
    color: var(--avq-warning-fg, #92400e); font-size: 15px; font-weight: 600; line-height: 1.4;
  }
  .avq-sp-scroll { margin-top: 28px; padding: 4px; overflow-x: auto; }
  .avq-sp-mapa { --avq-sp-c: var(--avq-sp-celda); display: grid; gap: var(--avq-sp-hueco); width: max-content; margin-inline: auto; }
  .avq-sp-celda { width: var(--avq-sp-c); height: var(--avq-sp-c); }
  .avq-sp-lugar {
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; padding: 0;
    border: 1.5px solid var(--avq-border, #d6d3d1); border-radius: 18px; background: var(--avq-bg, #ffffff);
    color: var(--avq-fg, #44403c); font: inherit; font-size: 17px; font-weight: 700; line-height: 1; cursor: pointer;
    transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
  }
  .avq-sp-lugar:hover:not(:disabled) { border-color: var(--avq-muted-fg, #9ca3af); }
  .avq-sp-lugar:focus-visible { outline: 2px solid var(--avq-accent, #6366f1); outline-offset: 2px; }
  .avq-sp-lugar--ocupado {
    background: var(--avq-muted, #f5f5f4); border-style: dashed; cursor: not-allowed;
    color: color-mix(in srgb, var(--avq-muted-fg, #6b7280) 55%, transparent);
  }
  .avq-sp-lugar--mio, .avq-sp-lugar--mio:hover:not(:disabled) {
    border: 2.5px solid var(--avq-accent, #6366f1); color: var(--avq-accent, #6366f1);
    background: color-mix(in srgb, var(--avq-accent, #6366f1) 10%, var(--avq-bg, #ffffff));
  }
  .avq-sp-leyenda {
    display: flex; flex-wrap: wrap; justify-content: center; gap: 10px 22px; margin: 28px 0 0; padding: 0; list-style: none;
    font-size: 15px; color: var(--avq-muted-fg, #6b7280);
  }
  .avq-sp-leyenda li { display: flex; align-items: center; gap: 8px; }
  .avq-sp-muestra {
    display: inline-block; width: 16px; height: 16px; border-radius: 5px;
    border: 1.5px solid var(--avq-border, #d6d3d1); background: var(--avq-bg, #ffffff);
  }
  .avq-sp-muestra--ocupado { background: var(--avq-muted, #f5f5f4); border-style: dashed; }
  .avq-sp-muestra--mio {
    border: 2px solid var(--avq-accent, #6366f1); background: color-mix(in srgb, var(--avq-accent, #6366f1) 10%, var(--avq-bg, #ffffff));
  }
  .avq-sp-accion { display: flex; justify-content: center; margin-top: 28px; }
  .avq-sp-btn {
    display: flex; align-items: center; justify-content: center; width: 100%; max-width: 380px; min-height: 52px; padding: 0 20px;
    border: 0; border-radius: var(--avq-btn-radius, 12px); background: var(--avq-accent, #6366f1); color: #ffffff;
    font: inherit; font-size: 16px; font-weight: 600; cursor: pointer; transition: filter 0.15s ease;
  }
  .avq-sp-btn:hover:not(:disabled) { filter: brightness(0.94); }
  .avq-sp-btn:focus-visible { outline: 2px solid var(--avq-accent, #6366f1); outline-offset: 2px; }
  .avq-sp-btn:disabled { background: var(--avq-muted-fg, #9ca3af); cursor: not-allowed; }
  /* Celular (≤ 640 px): casillas de al menos 72 px (con muchas columnas, el mapa se desliza de lado). En la reserva de una clase
     el mapa está fuera de \`.avq-classes-main\`: suma 12 px a los 12 px de la página (24 px), y «Continuar» va fijo abajo, encima
     de la barra de la página (su alto llega en \`--avq-toast-offset\`; el área segura sólo cuenta cuando no hay barra). */
  @media (max-width: 640px) {
    .avq-sp-titulo { font-size: 28px; }
    .avq-sp-mapa { --avq-sp-c: var(--avq-sp-celda-movil); gap: var(--avq-sp-hueco-movil); }
    .avq-sp--fija { padding-inline: 12px; padding-bottom: 96px; }
    .avq-sp--fija .avq-sp-accion {
      position: fixed; left: 0; right: 0; bottom: var(--avq-toast-offset, 0px); z-index: 40; margin: 0;
      padding: 16px 24px max(16px, calc(16px + env(safe-area-inset-bottom, 0px) - var(--avq-toast-offset, 0px)));
      background: var(--avq-bg, #ffffff); border-top: 1px solid var(--avq-border, #e8eaed);
    }
    .avq-sp--fija .avq-sp-btn { max-width: none; min-height: 56px; font-size: 17px; }
    /* El botón flotante del chat del widget taparía «Continuar». */
    .avq-root:has(.avq-sp--fija) .avq-chat-fab { display: none; }
  }
`
