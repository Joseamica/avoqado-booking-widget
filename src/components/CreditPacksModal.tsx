import { h } from 'preact'
import { useEffect } from 'preact/hooks'
import type { CreditPackPublic } from '../types'
import type { TFunction } from '../i18n'
import { precio } from '../lib/precio'
import { ordenarPaquetes } from '../lib/paquetes'
import { EtiquetaDestacada, LineaDePrecio, atributosDePaquete, bordeDePaquete } from './ui/PaqueteExtras'

interface CreditPacksModalProps {
  packs: CreditPackPublic[]
  buyingPackId: string | null
  onBuy: (packId: string) => void
  onClose: () => void
  locale: 'en' | 'es'
  t: TFunction
}

function formatPrice(amount: number, currency: string): string {
  return precio(amount, currency) // diseño 18-nov: un solo formato (src/lib/precio.ts)
}

/**
 * Modal that lists every credit pack available at the venue and lets the
 * customer pick one to buy. Triggered by the hosted page's "Comprar créditos"
 * top-nav CTA. Picking a pack closes this modal and hands off to the existing
 * CheckoutModal (phone/email collection → Stripe checkout).
 */
export function CreditPacksModal({
  packs,
  buyingPackId,
  onBuy,
  onClose,
  locale,
  t,
}: CreditPacksModalProps) {
  const tx = locale === 'en'
    ? {
      title: 'Buy credits',
      empty: 'No packs available right now.',
      validity: (d: number) => `Valid for ${d} ${d === 1 ? 'day' : 'days'}`,
      noExpiry: 'No expiration',
      buy: 'Buy',
      processing: 'Processing…',
    }
    : {
      title: 'Comprar créditos',
      empty: 'No hay paquetes disponibles ahora mismo.',
      validity: (d: number) => `Válido por ${d} ${d === 1 ? 'día' : 'días'}`,
      noExpiry: 'Sin expiración',
      buy: 'Comprar',
      processing: 'Procesando…',
    }

  // En el celular, que el dedo mueva la lista y no la página de atrás (hz:d46b99a0:D6).
  useEffect(() => {
    const raiz = document.documentElement
    const antes = raiz.style.overflow
    raiz.style.overflow = 'hidden'
    return () => { raiz.style.overflow = antes }
  }, [])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={tx.title}
      class="avq-credit-packs-modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 250,
        background: 'rgba(15,15,16,0.45)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        animation: 'avq-fadeIn 0.15s ease both',
      }}
    >
      {/* hz:d46b99a0:D6: en el celular «vh» mide la pantalla sin las barras del navegador y el último paquete quedaba
          debajo de ellas; «dvh» mide lo que sí se ve («vh» queda de respaldo para navegadores viejos). */}
      <style>{`
        .avq-credit-packs-modal { max-height: 92vh; max-height: 92dvh; overscroll-behavior: contain; }
        @media (min-width: 640px) {
          .avq-credit-packs-modal-overlay { align-items: center !important; }
          .avq-credit-packs-modal { border-radius: 16px !important; max-height: 88vh !important; max-height: 88dvh !important; }
        }
      `}</style>
      <div
        class="avq-credit-packs-modal"
        style={{
          width: 'min(100%, 460px)',
          background: 'var(--avq-bg, #fff)',
          borderRadius: '16px 16px 0 0',
          padding: '20px 20px calc(20px + env(safe-area-inset-bottom))',
          boxShadow: '0 -8px 32px rgba(15,15,16,0.16)',
          overflowY: 'auto',
          display: 'flex', flexDirection: 'column', gap: '14px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{
            margin: 0, fontSize: '18px', fontWeight: '700',
            color: 'var(--avq-fg, #111827)', letterSpacing: '-0.3px',
          }}>
            {tx.title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            style={{
              width: '34px', height: '34px', borderRadius: '50%',
              border: '1px solid var(--avq-border, #e8eaed)',
              background: 'transparent',
              color: 'var(--avq-fg, #111827)',
              cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {packs.length === 0 ? (
          <p style={{ margin: 0, fontSize: '14px', color: 'var(--avq-muted-fg, #6b7280)', textAlign: 'center', padding: '24px 0' }}>
            {tx.empty}
          </p>
        ) : (
          ordenarPaquetes(packs).map(pack => {
            const isBuying = buyingPackId === pack.id
            return (
              <div
                key={pack.id}
                {...atributosDePaquete(pack)}
                style={{
                  border: bordeDePaquete(pack),
                  borderRadius: '12px',
                  padding: '16px',
                  display: 'flex', flexDirection: 'column', gap: '10px',
                }}
              >
                <EtiquetaDestacada pack={pack} />
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '15px', fontWeight: '700', color: 'var(--avq-fg, #111827)' }}>
                      {pack.name}
                    </div>
                    {pack.description && (
                      <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--avq-muted-fg, #6b7280)', lineHeight: 1.4 }}>
                        {pack.description}
                      </p>
                    )}
                  </div>
                  <span style={{
                    fontSize: '15px', fontWeight: '700',
                    color: 'var(--avq-fg, #111827)',
                    whiteSpace: 'nowrap',
                  }}>
                    {formatPrice(pack.price, pack.currency)}
                  </span>
                </div>
                <LineaDePrecio pack={pack} packs={packs} t={t} />
                {pack.items.length > 0 && (
                  <ul style={{
                    listStyle: 'none', margin: 0, padding: 0,
                    display: 'flex', flexDirection: 'column', gap: '4px',
                    fontSize: '12px', color: 'var(--avq-muted-fg, #6b7280)',
                  }}>
                    {pack.items.map(item => (
                      <li key={item.id || item.productId} style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {item.unlimited ? t('creditPacks.unlimited') : `${item.quantity}×`} {item.product?.name ?? '—'}
                        </span>
                      </li>
                    ))}
                    {/* D687: el Ilimitado es personal. */}
                    {pack.items.some(i => i.unlimited) && <li>{t('creditPacks.unlimitedPersonal')}</li>}
                  </ul>
                )}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--avq-muted-fg, #6b7280)' }}>
                    {pack.validityDays ? tx.validity(pack.validityDays) : tx.noExpiry}
                  </span>
                  <button
                    type="button"
                    onClick={() => onBuy(pack.id)}
                    disabled={isBuying}
                    style={{
                      padding: '14px 24px', minHeight: '52px', fontSize: '16px',
                      background: 'var(--avq-accent, #2563eb)',
                      color: '#ffffff',
                      border: 0,
                      borderRadius: '10px',
                      fontWeight: '600',
                      cursor: isBuying ? 'wait' : 'pointer',
                      opacity: isBuying ? 0.6 : 1,
                      fontFamily: 'inherit',
                    }}
                  >
                    {isBuying ? tx.processing : tx.buy}
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
