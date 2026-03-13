import { h } from 'preact'
import { useState } from 'preact/hooks'
import type { CustomerCreditBalance } from '../types'
import type { TFunction } from '../i18n'

interface CreditSelectorProps {
  credits: CustomerCreditBalance
  productId: string
  onSelect: (balanceId: string, productId: string) => void
  onSkip: () => void
  required?: boolean
  t: TFunction
}

export function CreditSelector({ credits, productId, onSelect, onSkip, required, t }: CreditSelectorProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [skipHover, setSkipHover] = useState(false)

  // Find all balances that match the selected product and have remaining credits
  const matchingBalances = credits.purchases
    .filter(p => p.status === 'ACTIVE')
    .flatMap(p =>
      p.itemBalances
        .filter(b => b.productId === productId && b.remainingQuantity > 0)
        .map(b => ({ ...b, packName: p.creditPack.name, expiresAt: p.expiresAt }))
    )

  if (matchingBalances.length === 0) return null

  return (
    <div class="avq-animate-in" style={{ padding: '4px 0' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        padding: '12px 14px', borderRadius: '12px',
        background: 'color-mix(in srgb, #22c55e 8%, var(--avq-bg, #ffffff))',
        border: '1px solid color-mix(in srgb, #22c55e 20%, transparent)',
        marginBottom: '16px',
      }}>
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
          <polyline points="22 4 12 14.01 9 11.01"/>
        </svg>
        <span style={{ fontSize: '14px', fontWeight: '500', color: '#15803d' }}>
          {t('creditPacks.hasCredits')}
        </span>
      </div>

      {/* Balance options */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
        {matchingBalances.map(balance => {
          const isHov = hoveredId === balance.id
          return (
            <button
              key={balance.id}
              type="button"
              onClick={() => onSelect(balance.id, balance.productId)}
              onMouseEnter={() => setHoveredId(balance.id)}
              onMouseLeave={() => setHoveredId(null)}
              style={{
                display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between',
                padding: '14px 16px', borderRadius: '12px', textAlign: 'left',
                cursor: 'pointer', border: '1.5px solid var(--avq-border, #e8eaed)',
                background: isHov ? 'color-mix(in srgb, var(--avq-accent, #6366f1) 4%, var(--avq-bg, #ffffff))' : 'var(--avq-bg, #ffffff)',
                transition: 'all 0.2s ease',
                boxShadow: isHov ? '0 0 0 3px color-mix(in srgb, var(--avq-accent, #6366f1) 8%, transparent)' : 'none',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <span style={{ fontSize: '14px', fontWeight: '500', color: 'var(--avq-fg, #111827)' }}>
                  {t('creditPacks.useCredit')}
                </span>
                <span style={{ fontSize: '12px', color: 'var(--avq-muted-fg, #6b7280)' }}>
                  {balance.packName} — {t('creditPacks.remaining', {
                    remaining: balance.remainingQuantity,
                    total: balance.originalQuantity,
                  })}
                </span>
              </div>
              <div style={{
                padding: '4px 10px', borderRadius: '6px',
                background: 'color-mix(in srgb, #22c55e 10%, transparent)',
                fontSize: '12px', fontWeight: '600', color: '#16a34a',
              }}>
                {t('creditPacks.useCredit')}
              </div>
            </button>
          )
        })}
      </div>

      {/* Skip button — hidden when credit is required */}
      {!required && (
        <button
          type="button"
          onClick={onSkip}
          onMouseEnter={() => setSkipHover(true)}
          onMouseLeave={() => setSkipHover(false)}
          style={{
            width: '100%', padding: '12px',
            borderRadius: '12px', border: '1.5px solid var(--avq-border, #e8eaed)',
            background: skipHover ? 'var(--avq-muted, #f8f9fb)' : 'var(--avq-bg, #ffffff)',
            fontSize: '13px', fontWeight: '500', color: 'var(--avq-muted-fg, #6b7280)',
            cursor: 'pointer', transition: 'all 0.15s ease',
            textAlign: 'center',
          }}
        >
          {t('creditPacks.skipCredit')}
        </button>
      )}
    </div>
  )
}
