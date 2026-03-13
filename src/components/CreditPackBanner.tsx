import { h } from 'preact'
import { useState } from 'preact/hooks'
import type { CreditPackPublic } from '../types'
import type { TFunction } from '../i18n'

interface CreditPackBannerProps {
  packs: CreditPackPublic[]
  onBuy: (packId: string) => void
  buyingPackId: string | null
  t: TFunction
}

export function CreditPackBanner({ packs, onBuy, buyingPackId, t }: CreditPackBannerProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  if (packs.length === 0) return null

  return (
    <div style={{ marginTop: '24px' }}>
      {/* Section header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px',
      }}>
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--avq-accent, #6366f1)" stroke-width="2">
          <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/>
          <path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>
        </svg>
        <h3 style={{ fontSize: '14px', fontWeight: '600', color: 'var(--avq-fg, #111827)', margin: 0 }}>
          {t('creditPacks.title')}
        </h3>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {packs.map(pack => {
          const isHov = hoveredId === pack.id
          const isBuying = buyingPackId === pack.id

          // Build items summary
          const itemsSummary = pack.items
            .map(item => `${item.quantity}x ${item.product.name}`)
            .join(' + ')

          return (
            <div
              key={pack.id}
              onMouseEnter={() => setHoveredId(pack.id)}
              onMouseLeave={() => setHoveredId(null)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '12px 14px', borderRadius: '12px',
                border: '1.5px solid var(--avq-border, #e8eaed)',
                background: isHov ? 'var(--avq-muted, #f8f9fb)' : 'var(--avq-bg, #ffffff)',
                transition: 'all 0.2s ease',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '14px', fontWeight: '500', color: 'var(--avq-fg, #111827)' }}>
                    {pack.name}
                  </span>
                  <span style={{
                    fontSize: '14px', fontWeight: '600',
                    color: 'var(--avq-accent, #6366f1)',
                  }}>
                    ${Number(pack.price).toFixed(0)} {pack.currency}
                  </span>
                </div>
                <p style={{ margin: 0, fontSize: '12px', color: 'var(--avq-muted-fg, #6b7280)', lineHeight: '1.3' }}>
                  {t('creditPacks.includes')}: {itemsSummary}
                </p>
                {pack.validityDays && (
                  <p style={{ margin: 0, fontSize: '11px', color: 'var(--avq-muted-fg, #9ca3af)' }}>
                    {t('creditPacks.validity', { days: pack.validityDays })}
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={() => onBuy(pack.id)}
                disabled={isBuying}
                style={{
                  flexShrink: 0, marginLeft: '12px',
                  padding: '6px 14px', borderRadius: '8px',
                  background: isBuying ? 'var(--avq-muted, #f8f9fb)' : 'var(--avq-accent, #6366f1)',
                  color: isBuying ? 'var(--avq-muted-fg, #6b7280)' : '#ffffff',
                  border: 'none', fontSize: '12px', fontWeight: '600',
                  cursor: isBuying ? 'not-allowed' : 'pointer',
                  transition: 'opacity 0.15s ease',
                  opacity: isBuying ? 0.6 : 1,
                }}
              >
                {isBuying ? '...' : t('creditPacks.buy')}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
