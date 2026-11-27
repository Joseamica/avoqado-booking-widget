import { h } from 'preact'
import type { PublicVenueInfo } from '../types'
import type { TFunction } from '../i18n'
import { Icono } from './ui/Icono'

interface IdentidadDelNegocioProps {
  info: PublicVenueInfo
  /** El negocio puede recibir mensajes (`chat.canMessage` del SERVIDOR). Si no, no hay «Escríbenos». */
  puedeEscribir: boolean
  t: TFunction
}

/**
 * La portada de la página propia de reservas (diseño 27-nov, `portada-v3.html`): foto de portada del negocio o, sin foto,
 * un bloque del color de su marca (nunca vacío); logo, nombre, dirección y «Escríbenos». Sólo la pinta la página propia
 * (`show-identity`): pegado en el sitio de otro negocio, ese sitio ya es su portada.
 */
export function IdentidadDelNegocio({ info, puedeEscribir, t }: IdentidadDelNegocioProps) {
  const foto = info.branding?.showHeroImage === false ? null : (info.heroImageUrl ?? null)
  const logo = info.branding?.showLogo === false ? null : info.logo
  return (
    <section class="avq-identidad" aria-label={info.name}>
      <style>{ESTILOS}</style>
      {/* Sin foto, el color de la marca va en línea; si no es un color válido, el navegador lo ignora y queda el de la clase. */}
      <div class="avq-identidad-portada" style={foto ? undefined : { backgroundColor: info.primaryColor ?? undefined }}>
        {foto && <img src={foto} alt="" />}
      </div>
      <div class="avq-identidad-fila">
        <div class="avq-identidad-logo">
          {logo ? <img src={logo} alt="" /> : <span class="avq-identidad-inicial">{info.name.charAt(0).toUpperCase()}</span>}
        </div>
        <h1 class="avq-identidad-nombre">{info.name}</h1>
      </div>
      {(info.address || puedeEscribir) && (
        <div class="avq-identidad-meta">
          {info.address && (
            <span class="avq-identidad-dir">
              <Icono nombre="lugar" size={18} />
              <span>{info.address}</span>
            </span>
          )}
          {puedeEscribir && (
            <button
              type="button"
              class="avq-identidad-escribenos"
              // El chat que ya existe (VenueChatModal) escucha este evento en la ventana, también desde la página propia.
              onClick={() => window.dispatchEvent(new CustomEvent('avoqado:open-chat'))}
            >
              <Icono nombre="chat" size={18} />
              {t('reservaClases.portada.escribenos')}
            </button>
          )}
        </div>
      )}
    </section>
  )
}

const ESTILOS = `
  .avq-identidad { margin: 0 0 24px; }
  .avq-identidad-portada {
    height: 170px; border-radius: 16px; overflow: hidden;
    background-color: var(--avq-accent, #6366f1);
    background-image: linear-gradient(120deg, rgba(255,255,255,0) 35%, rgba(255,255,255,0.2) 100%);
  }
  .avq-identidad-portada img { display: block; width: 100%; height: 100%; object-fit: cover; }
  .avq-identidad-fila { display: flex; align-items: flex-start; gap: 16px; padding: 0 20px; }
  .avq-identidad-logo {
    flex: none; width: 76px; height: 76px; margin-top: -38px; border-radius: 18px; overflow: hidden;
    border: 3px solid var(--avq-bg, #ffffff); background: var(--avq-bg, #ffffff);
    box-shadow: 0 4px 14px rgba(0,0,0,0.12);
  }
  .avq-identidad-logo img { display: block; width: 100%; height: 100%; object-fit: cover; }
  .avq-identidad-inicial {
    display: flex; align-items: center; justify-content: center; width: 100%; height: 100%;
    background: var(--avq-accent, #6366f1); color: #ffffff; font-size: 30px; font-weight: 800;
  }
  .avq-identidad-nombre {
    min-width: 0; margin: 12px 0 0; font-size: 28px; line-height: 1.15; font-weight: 700;
    letter-spacing: -0.01em; color: var(--avq-fg, #111827); overflow-wrap: anywhere;
  }
  .avq-identidad-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 20px; padding: 14px 20px 0; }
  .avq-identidad-dir {
    display: inline-flex; align-items: center; gap: 8px; min-width: 0;
    font-size: 15px; line-height: 1.4; color: var(--avq-muted-fg, #6b7280);
  }
  .avq-identidad-escribenos {
    display: inline-flex; align-items: center; justify-content: center; gap: 8px;
    min-height: 44px; padding: 0 18px; border-radius: 9999px;
    border: 1px solid var(--avq-border, #e8eaed); background: var(--avq-bg, #ffffff); color: var(--avq-fg, #111827);
    font: inherit; font-size: 15px; font-weight: 600; cursor: pointer;
  }
  .avq-identidad-escribenos:hover { border-color: var(--avq-accent, #6366f1); }
  .avq-identidad-escribenos:focus-visible { outline: 2px solid var(--avq-accent, #6366f1); outline-offset: 2px; }
  @media (max-width: 640px) {
    .avq-identidad-portada { height: 120px; border-radius: 14px; }
    .avq-identidad-fila { gap: 12px; padding: 0 16px; }
    .avq-identidad-logo { width: 64px; height: 64px; margin-top: -32px; border-radius: 16px; }
    .avq-identidad-nombre { margin-top: 10px; font-size: 26px; }
    .avq-identidad-meta { flex-direction: column; align-items: flex-start; padding: 16px 0 0; }
    .avq-identidad-dir { font-size: 16px; }
    .avq-identidad-escribenos { min-height: 52px; font-size: 16px; }
  }
`
