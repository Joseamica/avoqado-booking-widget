import { h } from 'preact'
import { useMemo, useState } from 'preact/hooks'
import type { CustomerCreditBalance } from '../types'
import type { TFunction } from '../i18n'

interface CreditSelectorProps {
  credits: CustomerCreditBalance
  productId: string
  /** Number of credits this booking will consume (one per seat). */
  seats: number
  onSelect: (balanceId: string, productId: string) => void
  onSkip: () => void
  onBuyMore?: () => void
  required?: boolean
  t: TFunction
}

const TX = 'background 0.15s var(--avq-ease), border-color 0.15s var(--avq-ease), box-shadow 0.15s var(--avq-ease), color 0.15s var(--avq-ease)'

export function CreditSelector({ credits, productId, seats, onSelect, onSkip, onBuyMore, required, t }: CreditSelectorProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [skipHover, setSkipHover] = useState(false)

  const { sufficient, insufficient, allInsufficient, ordered } = useMemo(() => {
    const matching = credits.purchases
      .filter(p => p.status === 'ACTIVE')
      .flatMap(p =>
        p.itemBalances
          .filter(b => b.productId === productId && b.remainingQuantity > 0)
          .map(b => ({ ...b, packName: p.creditPack.name, expiresAt: p.expiresAt }))
      )
    const suff = matching.filter(b => b.remainingQuantity >= seats)
    const insuff = matching.filter(b => b.remainingQuantity < seats)
    return {
      sufficient: suff,
      insufficient: insuff,
      allInsufficient: suff.length === 0 && matching.length > 0,
      ordered: [...suff, ...insuff],
    }
  }, [credits, productId, seats])

  if (ordered.length === 0) return null

  return (
    <div class="avq-animate-in" style={{ padding: '4px 0' }}>
      {/* Header — green when sufficient, amber when not */}
      <div
        role="status"
        aria-live="polite"
        style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          padding: '12px 14px', borderRadius: '12px',
          background: allInsufficient ? 'var(--avq-warning-bg)' : 'var(--avq-success-bg)',
          border: `1px solid ${allInsufficient ? 'var(--avq-warning-border)' : 'var(--avq-success-border)'}`,
          marginBottom: '20px',
        }}
      >
        {allInsufficient ? (
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--avq-warning-accent)" stroke-width="2" aria-hidden="true">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--avq-success-accent)" stroke-width="2" aria-hidden="true">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
            <polyline points="22 4 12 14.01 9 11.01"/>
          </svg>
        )}
        <span style={{
          fontSize: '14px', fontWeight: '500',
          color: allInsufficient ? 'var(--avq-warning-fg)' : 'var(--avq-success-fg)',
        }}>
          {allInsufficient
            ? t('creditPacks.insufficient', { needed: seats, available: ordered[0].remainingQuantity })
            : seats > 1
              ? t('creditPacks.willUseN', { count: seats })
              : t('creditPacks.hasCredits')}
        </span>
      </div>

      {/* Balance options */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px' }}>
        {ordered.map(balance => {
          const canUse = balance.remainingQuantity >= seats
          const isHov = canUse && hoveredId === balance.id
          const remainingAfter = balance.remainingQuantity - seats

          return (
            <button
              key={balance.id}
              type="button"
              onClick={() => canUse && onSelect(balance.id, balance.productId)}
              disabled={!canUse}
              onMouseEnter={() => canUse && setHoveredId(balance.id)}
              onMouseLeave={() => canUse && setHoveredId(null)}
              aria-label={canUse
                ? t('creditPacks.useN', { count: seats }) + ' — ' + balance.packName
                : t('creditPacks.notEnough') + ' — ' + balance.packName}
              style={{
                display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between',
                padding: '14px 16px', borderRadius: '14px', textAlign: 'left',
                cursor: canUse ? 'pointer' : 'not-allowed',
                border: `1.5px solid ${isHov ? 'var(--avq-accent, #6366f1)' : 'var(--avq-border, #e8eaed)'}`,
                background: !canUse
                  ? 'var(--avq-muted, #f8f9fb)'
                  : isHov
                    ? 'color-mix(in srgb, var(--avq-accent, #6366f1) 5%, var(--avq-bg, #ffffff))'
                    : 'var(--avq-bg, #ffffff)',
                opacity: canUse ? 1 : 0.6,
                transition: TX,
                boxShadow: isHov ? '0 0 0 4px color-mix(in srgb, var(--avq-accent, #6366f1) 10%, transparent)' : 'none',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0, flex: 1 }}>
                <span style={{
                  fontSize: '14px', fontWeight: '600',
                  color: canUse ? 'var(--avq-fg, #111827)' : 'var(--avq-muted-fg, #9ca3af)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {balance.packName}
                </span>
                <span style={{ fontSize: '12px', color: 'var(--avq-muted-fg, #6b7280)' }}>
                  {t('creditPacks.remaining', {
                    remaining: balance.remainingQuantity,
                    total: balance.originalQuantity,
                  })}
                  {canUse && seats > 0 && (
                    <> · {t('creditPacks.afterUse', { remaining: remainingAfter })}</>
                  )}
                </span>
              </div>
              <div style={{
                marginLeft: '12px', flexShrink: 0,
                padding: '5px 11px', borderRadius: '999px',
                background: canUse ? 'var(--avq-success-bg)' : 'var(--avq-warning-bg)',
                color: canUse ? 'var(--avq-success-fg)' : 'var(--avq-warning-fg)',
                fontSize: '12px', fontWeight: '600',
                whiteSpace: 'nowrap',
              }}>
                {canUse
                  ? (seats > 1 ? t('creditPacks.useN', { count: seats }) : t('creditPacks.useCredit'))
                  : t('creditPacks.notEnough')}
              </div>
            </button>
          )
        })}
      </div>

      {/* Buy more button — shown when insufficient */}
      {allInsufficient && onBuyMore && (
        <button
          type="button"
          onClick={onBuyMore}
          style={{
            width: '100%', padding: '13px',
            borderRadius: '12px', border: 'none',
            background: 'var(--avq-accent, #6366f1)',
            fontSize: '14px', fontWeight: '600', color: '#ffffff',
            cursor: 'pointer', transition: TX, marginBottom: '8px',
            textAlign: 'center',
            letterSpacing: '0.01em',
          }}
        >
          {t('creditPacks.buyMore')}
        </button>
      )}

      {/* Skip — hidden when credit is required or all insufficient */}
      {!required && !allInsufficient && (
        <button
          type="button"
          onClick={onSkip}
          onMouseEnter={() => setSkipHover(true)}
          onMouseLeave={() => setSkipHover(false)}
          style={{
            width: '100%', padding: '11px',
            borderRadius: '12px', border: '1px solid transparent',
            background: skipHover ? 'var(--avq-muted, #f8f9fb)' : 'transparent',
            fontSize: '13px', fontWeight: '500', color: 'var(--avq-muted-fg, #6b7280)',
            cursor: 'pointer', transition: TX,
            textAlign: 'center',
          }}
        >
          {t('creditPacks.skipCredit')}
        </button>
      )}
    </div>
  )
}
