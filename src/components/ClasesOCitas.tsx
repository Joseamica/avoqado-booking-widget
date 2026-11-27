import { h } from 'preact'
import type { TFunction } from '../i18n'
import { Icono } from './ui/Icono'

type Flujo = 'classes' | 'appointments'

interface ClasesOCitasProps {
  activo: Flujo
  onCambiar: (flujo: Flujo) => void
  t: TFunction
}

/**
 * «Clases | Citas» (diseño 27-nov, `clases-y-citas-v5.html`, como el «Offerings» de Mindbody): sólo existe si el negocio
 * tiene las dos cosas. Cada lado se reserva a su manera, y la línea de abajo dice cuál es cuál para que nadie se confunda.
 */
export function ClasesOCitas({ activo, onCambiar, t }: ClasesOCitasProps) {
  const opciones: Array<{ flujo: Flujo; icono: 'grupo' | 'persona'; texto: string }> = [
    { flujo: 'classes', icono: 'grupo', texto: t('reservaClases.portada.clases') },
    { flujo: 'appointments', icono: 'persona', texto: t('reservaClases.portada.citas') },
  ]
  return (
    <div class="avq-coc">
      <style>{ESTILOS}</style>
      <div class="avq-coc-seg" role="group" aria-label={t('reservaClases.portada.tipo')}>
        {opciones.map(({ flujo, icono, texto }) => (
          <button
            key={flujo}
            type="button"
            class={flujo === activo ? 'avq-coc-op is-on' : 'avq-coc-op'}
            aria-pressed={flujo === activo}
            onClick={() => {
              if (flujo !== activo) onCambiar(flujo)
            }}
          >
            <Icono nombre={icono} size={18} />
            {texto}
          </button>
        ))}
      </div>
      <p class="avq-coc-ayuda">
        {t(activo === 'classes' ? 'reservaClases.portada.ayudaClases' : 'reservaClases.portada.ayudaCitas')}
      </p>
    </div>
  )
}

const ESTILOS = `
  .avq-coc { margin: 0 0 24px; }
  .avq-coc-seg { display: inline-flex; gap: 4px; padding: 4px; border-radius: 9999px; background: var(--avq-muted, #f3f4f6); }
  .avq-coc-op {
    display: inline-flex; align-items: center; justify-content: center; gap: 8px;
    min-height: 44px; padding: 0 20px; border: 0; border-radius: 9999px; background: transparent;
    color: var(--avq-fg, #111827); opacity: 0.72; font: inherit; font-size: 15px; font-weight: 600; cursor: pointer;
  }
  .avq-coc-op.is-on { opacity: 1; background: var(--avq-bg, #ffffff); box-shadow: 0 1px 3px rgba(0,0,0,0.12); }
  .avq-coc-op:focus-visible { outline: 2px solid var(--avq-accent, #6366f1); outline-offset: 2px; }
  .avq-coc-ayuda { margin: 10px 0 0; font-size: 15px; line-height: 1.45; color: var(--avq-muted-fg, #6b7280); }
  @media (max-width: 640px) {
    .avq-coc-seg { display: flex; }
    .avq-coc-op { flex: 1; min-height: 52px; font-size: 16px; }
    .avq-coc-ayuda { font-size: 16px; }
  }
`
