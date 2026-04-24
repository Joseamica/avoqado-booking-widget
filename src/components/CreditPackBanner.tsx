import { h } from 'preact'
import type { CreditPackPublic } from '../types'
import type { TFunction } from '../i18n'
import { Spinner } from './ui/Spinner'

interface CreditPackBannerProps {
  packs: CreditPackPublic[]
  onBuy: (packId: string) => void
  buyingPackId: string | null
  t: TFunction
}

export function CreditPackBanner({ packs, onBuy, buyingPackId, t }: CreditPackBannerProps) {
  if (packs.length === 0) return null

  return (
    <div style={{ marginTop: '28px' }}>
      {/* Eyebrow header — uppercase tracking, no icon (avoid templated-AI feel) */}
      <h3 style={{
        fontSize: '11px', fontWeight: '600',
        color: 'var(--avq-muted-fg, #6b7280)',
        textTransform: 'uppercase', letterSpacing: '0.08em',
        margin: '0 0 12px',
      }}>
        {t('creditPacks.title')}
      </h3>

      {/* Container with hairline dividers between packs (no nested cards) */}
      <div style={{
        display: 'flex', flexDirection: 'column',
        border: '1px solid var(--avq-border, #e8eaed)',
        borderRadius: '14px', overflow: 'hidden',
      }}>
        {packs.map((pack, idx) => {
          const isBuying = buyingPackId === pack.id
          return (
            <div key={pack.id} style={{
              padding: '16px',
              borderTop: idx > 0 ? '1px solid var(--avq-border, #e8eaed)' : 'none',
            }}>
              {/* Pack name + price */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '10px', gap: '12px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: '15px', fontWeight: '600',
                    color: 'var(--avq-fg, #111827)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {pack.name}
                  </div>
                  {pack.description && (
                    <p style={{ fontSize: '12px', color: 'var(--avq-muted-fg, #6b7280)', margin: '3px 0 0' }}>
                      {pack.description}
                    </p>
                  )}
                </div>
                <span style={{
                  fontSize: '17px', fontWeight: '700',
                  color: 'var(--avq-fg, #111827)',
                  whiteSpace: 'nowrap', flexShrink: 0,
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  ${Number(pack.price).toFixed(0)}
                  <span style={{
                    fontSize: '11px', color: 'var(--avq-muted-fg, #6b7280)',
                    fontWeight: '500', marginLeft: '4px',
                  }}>
                    {pack.currency}
                  </span>
                </span>
              </div>

              {/* Items as inline pill chips (no "Incluye:" prefix — chips speak for themselves) */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '14px' }}>
                {pack.items.map(item => (
                  <span key={item.id} style={{
                    display: 'inline-flex', alignItems: 'center', gap: '5px',
                    padding: '3px 9px', borderRadius: '999px',
                    background: 'var(--avq-muted, #f8f9fb)',
                    fontSize: '12px', color: 'var(--avq-fg, #111827)',
                  }}>
                    <strong style={{ fontWeight: '700', color: 'var(--avq-accent, #6366f1)' }}>
                      {item.quantity}×
                    </strong>
                    <span>{item.product.name}</span>
                  </span>
                ))}
              </div>

              {/* Validity + Buy */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '11px', color: 'var(--avq-muted-fg, #6b7280)' }}>
                  {pack.validityDays
                    ? t('creditPacks.validity', { days: pack.validityDays })
                    : t('creditPacks.noExpiry')}
                </span>
                <button
                  type="button"
                  onClick={() => onBuy(pack.id)}
                  disabled={isBuying}
                  style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    padding: '7px 18px', borderRadius: '999px',
                    fontSize: '13px', fontWeight: '600',
                    background: 'var(--avq-accent, #6366f1)', color: '#fff',
                    border: 'none',
                    cursor: isBuying ? 'not-allowed' : 'pointer',
                    opacity: isBuying ? 0.6 : 1,
                    transition: 'opacity 0.15s var(--avq-ease, cubic-bezier(0.25, 1, 0.5, 1))',
                  }}
                >
                  {isBuying ? <Spinner size={14} /> : t('creditPacks.buy')}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
