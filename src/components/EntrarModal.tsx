import { h } from 'preact'
import { useEffect, useId, useRef } from 'preact/hooks'
import type { TFunction } from '../i18n'
import type { SesionEmitida } from '../lib/sesionDeCliente'
import { EntrarConCuenta } from './EntrarConCuenta'
import type { Idioma } from './ListaDelHorario'
import { Icono } from './ui/Icono'

interface EntrarModalProps {
  /** Negocio de la reserva: la cuenta es la de ESTE negocio (la misma de «Mi cuenta»). */
  slug: string
  negocio?: string | null
  /** De qué clase es la reserva: «Lagree · jueves 26 · 18:15» (`contextoDeLaClase`). */
  contexto: string
  /** Por qué se pide entrar otra vez («Tu sesión se cerró…»). En ámbar: no es un error suyo. */
  aviso?: string | null
  /** Ya entró: `EntrarConCuenta` guardó la sesión; quien la monta la adopta y sigue con la MISMA clase. */
  onEntro: (s: SesionEmitida) => void
  onClose: () => void
  t: TFunction
}

const ENFOCABLES =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'

/** «Lagree · jueves 26 · 18:15» («Lagree · Thursday 26 · 6:15 PM»), en la zona que se enseña. Sin fecha legible, sólo la clase. */
export function contextoDeLaClase(clase: string, startsAt: string, timeZone: string, idioma: Idioma): string {
  try {
    const loc = idioma === 'en' ? 'en-US' : 'es-MX'
    const fecha = new Date(startsAt)
    const p = Object.fromEntries(
      new Intl.DateTimeFormat(loc, { timeZone, weekday: 'long', day: 'numeric' }).formatToParts(fecha).map(x => [x.type, x.value]),
    )
    const hora = fecha.toLocaleTimeString(loc, { hour: 'numeric', minute: '2-digit', hour12: idioma === 'en', timeZone })
    return [clase, `${p.weekday} ${p.day}`, hora].filter(Boolean).join(' · ')
  } catch {
    return clase
  }
}

/**
 * «Entra para reservar» (diseño 27-nov, `pasos-con-aire-v7`, paso 2): la clienta entra a su cuenta en una ventanita encima de la
 * clase, sin ir a «Mi cuenta» ni perder lo que eligió. Es la misma entrada de siempre (WhatsApp, correo o Google); en el celular
 * sube desde abajo, con botones y campos de 56 px.
 *
 * Accesibilidad (como `CheckoutModal`): role=dialog + aria-modal; Escape y el fondo cierran; Tab no sale de la ventanita.
 */
export function EntrarModal({ slug, negocio, contexto, aviso, onEntro, onClose, t }: EntrarModalProps) {
  const panel = useRef<HTMLDivElement>(null)
  const cerrar = useRef(onClose)
  cerrar.current = onClose
  const idTitulo = useId()
  const idContexto = useId()

  useEffect(() => {
    panel.current?.querySelector<HTMLElement>(ENFOCABLES)?.focus()
    function alTeclear(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        cerrar.current()
        return
      }
      if (e.key !== 'Tab') return
      const p = panel.current
      if (!p) return
      const enfocables = Array.from(p.querySelectorAll<HTMLElement>(ENFOCABLES))
      if (enfocables.length === 0) return
      const primero = enfocables[0]
      const ultimo = enfocables[enfocables.length - 1]
      // Dentro del widget el foco vive en su sombra: `document.activeElement` sería el elemento anfitrión.
      const activo = (p.getRootNode() as Document | ShadowRoot).activeElement
      if (e.shiftKey && (activo === primero || !p.contains(activo))) {
        e.preventDefault()
        ultimo.focus()
      } else if (!e.shiftKey && (activo === ultimo || !p.contains(activo))) {
        e.preventDefault()
        primero.focus()
      }
    }
    document.addEventListener('keydown', alTeclear)
    return () => document.removeEventListener('keydown', alTeclear)
  }, [])

  return (
    <div
      class="avq-entrar-velo"
      role="presentation"
      onClick={e => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <style>{CSS}</style>
      <div
        ref={panel}
        class="avq-entrar-hoja"
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        aria-describedby={contexto ? idContexto : undefined}
      >
        <button type="button" class="avq-entrar-cerrar" onClick={onClose} aria-label={t('actions.close')}>
          <Icono nombre="cerrar" size={22} />
        </button>
        <div class="avq-entrar-asa" aria-hidden="true" />
        <h2 id={idTitulo} class="avq-entrar-titulo">{t('reservaClases.entrar.titulo')}</h2>
        {contexto && <p id={idContexto} class="avq-entrar-contexto">{contexto}</p>}
        {aviso && <p role="status" class="avq-entrar-aviso">{aviso}</p>}
        <div class="avq-entrar-cuerpo">
          <EntrarConCuenta slug={slug} negocio={negocio} t={t} onEntro={onEntro} sinTituloAlInicio />
        </div>
      </div>
    </div>
  )
}

const CSS = `
  .avq-entrar-velo {
    position: fixed; inset: 0; z-index: 100; display: flex; align-items: center; justify-content: center; padding: 16px;
    background: color-mix(in srgb, #000 45%, transparent); animation: avq-entrar-velo 0.2s ease-out;
  }
  .avq-entrar-hoja {
    position: relative; box-sizing: border-box; width: 100%; max-width: 420px; max-height: calc(100vh - 32px); max-height: calc(100dvh - 32px); overflow-y: auto; overscroll-behavior: contain;
    padding: 28px 24px 24px; border-radius: 20px; background: var(--avq-bg, #ffffff); color: var(--avq-fg, #111827);
    border: 1px solid var(--avq-border, #e8eaed); box-shadow: 0 20px 50px -12px color-mix(in srgb, #000 30%, transparent);
  }
  .avq-entrar-asa { display: none; }
  .avq-entrar-cerrar {
    position: absolute; top: 12px; right: 12px; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center;
    padding: 0; border: 0; border-radius: 999px; background: transparent; color: var(--avq-muted-fg, #6b7280); cursor: pointer;
  }
  .avq-entrar-cerrar:hover { background: var(--avq-muted, #f8f9fb); }
  .avq-entrar-cerrar:focus-visible { outline: 2px solid var(--avq-accent, #6366f1); outline-offset: 2px; }
  .avq-entrar-titulo { margin: 0; padding-right: 44px; font-size: 24px; font-weight: 700; line-height: 1.2; letter-spacing: -0.01em; }
  .avq-entrar-contexto { margin: 6px 0 0; font-size: 16px; line-height: 1.4; color: var(--avq-muted-fg, #6b7280); }
  .avq-entrar-aviso {
    margin: 16px 0 0; padding: 12px 14px; border-radius: 12px; font-size: 15px; line-height: 1.45;
    background: var(--avq-warning-bg, #fffbeb); border: 1px solid var(--avq-warning-border, #fde68a); color: var(--avq-warning-fg, #92400e);
  }
  .avq-entrar-cuerpo { margin-top: 24px; }
  @keyframes avq-entrar-velo { from { opacity: 0; } to { opacity: 1; } }
  @keyframes avq-entrar-sube { from { transform: translateY(100%); } to { transform: translateY(0); } }
  /* Celular (≤ 640 px): sube desde abajo, a todo lo ancho, con su asa; botones y campos de 56 px (fáciles de tocar). */
  @media (max-width: 640px) {
    .avq-entrar-velo { align-items: flex-end; padding: 0; }
    .avq-entrar-hoja {
      max-width: none; max-height: 92vh; max-height: 92dvh; border: 0; border-radius: 28px 28px 0 0;
      padding: 14px 24px max(32px, calc(16px + env(safe-area-inset-bottom, 0px)));
      --avq-btn-alto: 56px; --avq-campo-alto: 56px;
      animation: avq-entrar-sube 0.25s var(--avq-ease, ease-out);
    }
    .avq-entrar-asa { display: block; width: 44px; height: 5px; margin: 0 auto 22px; border-radius: 999px; background: var(--avq-border, #d6d3d1); }
    .avq-entrar-cerrar { top: 6px; right: 8px; }
  }
`
