import { h } from 'preact'
import { useEffect, useRef } from 'preact/hooks'
import type { TFunction } from '../i18n'
import type { SesionEmitida } from '../lib/sesionDeCliente'
import { EntrarConCuenta } from './EntrarConCuenta'

interface CheckoutModalProps {
  /** Negocio de la tienda: la cuenta es la de ESTE negocio (la misma de «Mi cuenta» y de pedidos.avoqado.io). */
  slug: string
  negocio?: string | null
  /** Ya entró (EntrarConCuenta guardó la sesión): quien la monta adopta esa sesión. */
  onEntro: (s: SesionEmitida) => void
  /** Con qué cuenta entró («Ana · ana@gmail.com»); mientras sea null, se enseña «Entra a tu cuenta». */
  entroComo: string | null
  /** Nombre del paquete que va a pagar. */
  paquete: string | null
  /** Su toque en «Ir al pago»: el pago nunca arranca solo al entrar (una entrada tardía no manda a pagar). */
  onIrAlPago: () => void
  /** «Usar otra cuenta»: la que entró no es ella; sale de esa cuenta y vuelve a «Entra a tu cuenta». */
  onOtraCuenta: () => void
  onClose: () => void
  t: TFunction
}

/**
 * «Antes de pagar» un paquete sin sesión (founder 18-nov, «A» con más de una opción): la clienta entra a su cuenta con WhatsApp,
 * correo o Google —la misma pantalla de «Mi cuenta» y de pedidos.avoqado.io— y los créditos quedan a su nombre por su sesión.
 * Antes pedía un teléfono escrito a mano, sin verificar: un error de dedo dejaba los créditos en otra ficha, y quien entró con
 * Google (sin teléfono) tenía que inventar uno.
 *
 * Accesibilidad: role=dialog + aria-modal; Escape y el fondo cierran; Tab no sale de la ventana.
 */
export function CheckoutModal({ slug, negocio, onEntro, entroComo, paquete, onIrAlPago, onOtraCuenta, onClose, t }: CheckoutModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = 'avq-checkout-title'

  useEffect(() => {
    panelRef.current?.querySelector<HTMLElement>('button:not([disabled]), input:not([disabled])')?.focus()
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel) return
      const focusables = panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'color-mix(in srgb, #000 45%, transparent)',
        backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '16px',
        animation: 'avq-fadeIn 0.2s var(--avq-ease)',
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{
          position: 'relative',
          background: 'var(--avq-bg, #ffffff)', borderRadius: '18px',
          padding: '24px', width: '100%', maxWidth: '380px', maxHeight: 'calc(100vh - 32px)', overflowY: 'auto',
          boxShadow: '0 20px 50px -12px color-mix(in srgb, #000 30%, transparent)',
          border: '1px solid var(--avq-border, #e8eaed)',
        }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label={t('actions.close')}
          style={{
            position: 'absolute', top: '12px', right: '12px', width: '32px', height: '32px',
            borderRadius: '999px', border: 'none', background: 'transparent', cursor: 'pointer',
            fontSize: '20px', lineHeight: '1', color: 'var(--avq-muted-fg, #6b7280)',
          }}
        >
          <span aria-hidden="true">×</span>
        </button>
        <p id={titleId} style={{ fontSize: '12px', fontWeight: '600', color: 'var(--avq-muted-fg, #6b7280)', margin: '0 0 12px', paddingRight: '32px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          {t('creditPacks.checkoutTitle')}
        </p>
        {entroComo ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div>
              <p style={{ fontSize: '18px', fontWeight: '700', color: 'var(--avq-fg, #111827)', margin: '0 0 6px' }}>
                {t('creditPacks.entrasteComo', { quien: entroComo })}
              </p>
              {paquete && <p style={{ fontSize: '14px', color: 'var(--avq-muted-fg, #6b7280)', margin: 0 }}>{paquete}</p>}
            </div>
            <button
              type="button"
              onClick={onIrAlPago}
              style={{
                width: '100%', height: '44px', borderRadius: 'var(--avq-btn-radius, 12px)', border: 'none',
                background: 'var(--avq-accent, #6366f1)', fontSize: '14px', fontWeight: '600', color: '#ffffff', cursor: 'pointer',
              }}
            >
              {t('creditPacks.continueToPayment')}
            </button>
            <button
              type="button"
              onClick={onOtraCuenta}
              style={{
                background: 'none', border: 'none', padding: '4px', cursor: 'pointer', fontSize: '13px',
                color: 'var(--avq-muted-fg, #6b7280)', textDecoration: 'underline',
              }}
            >
              {t('creditPacks.usarOtraCuenta')}
            </button>
          </div>
        ) : (
          <EntrarConCuenta slug={slug} negocio={negocio} t={t} onEntro={onEntro} />
        )}
        <p style={{ fontSize: '12px', color: 'var(--avq-muted-fg, #6b7280)', margin: '16px 0 0', lineHeight: '1.5' }}>
          {t('creditPacks.checkoutSubtitle')}
        </p>
      </div>
    </div>
  )
}
