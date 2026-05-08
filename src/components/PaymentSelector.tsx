import { h } from 'preact'
import { useMemo } from 'preact/hooks'
import type { CustomerCreditBalance, Product, UpfrontPolicy } from '../types'
import type { TFunction } from '../i18n'

interface PaymentSelectorProps {
  product: Product
  /** Number of credits this booking consumes (typically party size or # of seats). */
  seats: number
  /** Customer credit balance for this venue (only matching pack purchases). */
  credits: CustomerCreditBalance | null
  /** Resolved policy for this product — already merged with venue defaults. */
  upfrontPolicy: UpfrontPolicy
  /** User picked "use credits" — pass the credit-pack item-balance ID to consume. */
  onSelectCredits: (creditItemBalanceId: string) => void
  /** User picked "pay cash now" or "pay at venue" — proceeds with reservation, no credit. */
  onSelectCash: () => void
  /** No matching credits found and user wants to buy a pack first. */
  onBuyPack: () => void
  t: TFunction
}

/**
 * Phase 3: payment-method selector shown before reservation submit when a
 * product offers both cash and credit-redeem paths.
 *
 * UX rules (Square + Avoqado hybrid):
 * - upfrontPolicy='required' + cashPrice>0 + creditCost>0 → cash + credits side-by-side
 * - upfrontPolicy='at_venue' + creditCost>0 → "use credits" + "pay at venue" side-by-side
 * - creditCost==0 OR no matching credits → just the cash path with policy hint
 * - matching credits but insufficient → show "buy more" CTA
 */
export function PaymentSelector({
  product,
  seats,
  credits,
  upfrontPolicy,
  onSelectCredits,
  onSelectCash,
  onBuyPack,
  t,
}: PaymentSelectorProps) {
  const creditCost = product.creditCost == null ? 1 : product.creditCost
  const cashPrice = product.price ?? 0
  const creditOnly = product.requireCreditForBooking === true
  const acceptsCash = cashPrice > 0 && !creditOnly
  const acceptsCredits = creditCost > 0

  // Find matching credit balances for this product, sorted descending by remaining
  // so the most generous balance shows first.
  const creditBalances = useMemo(() => {
    if (!credits) return []
    const totalNeeded = seats * creditCost
    return credits.purchases
      .filter(p => p.status === 'ACTIVE')
      .flatMap(p =>
        p.itemBalances.map(b => ({
          ...b,
          packName: p.creditPack.name,
          sufficient: b.remainingQuantity >= totalNeeded,
          totalNeeded,
        })),
      )
      .filter(b => b.productId === product.id && b.remainingQuantity > 0)
      .sort((a, b) => b.remainingQuantity - a.remainingQuantity)
  }, [credits, product.id, seats, creditCost])

  const sufficientBalance = creditBalances.find(b => b.sufficient) ?? null
  const insufficientBalance = !sufficientBalance && creditBalances.length > 0 ? creditBalances[0] : null

  const cashLabel =
    upfrontPolicy === 'required'
      ? t('payment.payNow', { amount: formatPrice(cashPrice * seats) })
      : t('payment.payAtVenue', { amount: formatPrice(cashPrice * seats) })

  const cashHint =
    upfrontPolicy === 'required'
      ? t('payment.payNowHint')
      : upfrontPolicy === 'at_venue'
        ? t('payment.payAtVenueHint')
        : t('payment.payOptionalHint')

  return (
    <div class="avq-animate-in" style={{ padding: '4px 0' }}>
      <h3 style={{ fontSize: '15px', fontWeight: '600', color: 'var(--avq-fg, #111827)', margin: '0 0 16px' }}>
        {t('payment.title')}
      </h3>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {/* Credits option (when applicable + customer has matching balance) */}
        {acceptsCredits && sufficientBalance && (
          <button
            type="button"
            onClick={() => onSelectCredits(sufficientBalance.id)}
            style={paymentOptionStyle(true)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={iconBadgeStyle('success')}>💳</span>
              <div style={{ textAlign: 'left', flex: 1 }}>
                <div style={{ fontSize: '14px', fontWeight: '600', color: 'var(--avq-fg, #111827)' }}>
                  {seats * creditCost === 1
                    ? t('payment.useOneCredit', { pack: sufficientBalance.packName })
                    : t('payment.useNCredits', { count: seats * creditCost, pack: sufficientBalance.packName })}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--avq-muted-fg, #6b7280)', marginTop: '2px' }}>
                  {t('payment.creditsRemaining', {
                    remaining: sufficientBalance.remainingQuantity - seats * creditCost,
                    total: sufficientBalance.originalQuantity,
                  })}
                </div>
              </div>
            </div>
          </button>
        )}

        {/* Insufficient credits — show "buy more" CTA */}
        {acceptsCredits && !sufficientBalance && insufficientBalance && (
          <button
            type="button"
            onClick={onBuyPack}
            style={paymentOptionStyle(false, true)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={iconBadgeStyle('warning')}>⚠️</span>
              <div style={{ textAlign: 'left', flex: 1 }}>
                <div style={{ fontSize: '14px', fontWeight: '600', color: 'var(--avq-fg, #111827)' }}>
                  {t('payment.creditsInsufficient')}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--avq-muted-fg, #6b7280)', marginTop: '2px' }}>
                  {t('payment.creditsInsufficientHint', {
                    needed: seats * creditCost,
                    available: insufficientBalance.remainingQuantity,
                  })}
                </div>
              </div>
            </div>
          </button>
        )}

        {/* No matching credit balance at all — buy pack option */}
        {acceptsCredits && creditBalances.length === 0 && (
          <button
            type="button"
            onClick={onBuyPack}
            style={paymentOptionStyle(false, true)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={iconBadgeStyle('accent')}>📦</span>
              <div style={{ textAlign: 'left', flex: 1 }}>
                <div style={{ fontSize: '14px', fontWeight: '600', color: 'var(--avq-fg, #111827)' }}>
                  {t('payment.buyPack')}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--avq-muted-fg, #6b7280)', marginTop: '2px' }}>
                  {t('payment.buyPackHint')}
                </div>
              </div>
            </div>
          </button>
        )}

        {/* Cash option (shown when cashPrice>0 and credit isn't strictly required) */}
        {acceptsCash && (
          <button
            type="button"
            onClick={onSelectCash}
            style={paymentOptionStyle(true)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={iconBadgeStyle(upfrontPolicy === 'required' ? 'accent' : 'neutral')}>
                {upfrontPolicy === 'required' ? '💳' : '🏪'}
              </span>
              <div style={{ textAlign: 'left', flex: 1 }}>
                <div style={{ fontSize: '14px', fontWeight: '600', color: 'var(--avq-fg, #111827)' }}>
                  {cashLabel}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--avq-muted-fg, #6b7280)', marginTop: '2px' }}>
                  {cashHint}
                </div>
              </div>
            </div>
          </button>
        )}
      </div>
    </div>
  )
}

function formatPrice(amount: number): string {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(amount)
}

function paymentOptionStyle(enabled: boolean, dashed: boolean = false): h.JSX.CSSProperties {
  return {
    width: '100%',
    padding: '14px',
    borderRadius: '12px',
    border: dashed
      ? '1.5px dashed var(--avq-border, #e8eaed)'
      : '1px solid var(--avq-border, #e8eaed)',
    background: 'var(--avq-bg, #ffffff)',
    cursor: enabled ? 'pointer' : 'not-allowed',
    opacity: enabled ? 1 : 0.5,
    transition: 'border-color 0.15s ease, background 0.15s ease',
  }
}

function iconBadgeStyle(variant: 'success' | 'warning' | 'accent' | 'neutral'): h.JSX.CSSProperties {
  const colors: Record<string, string> = {
    success: 'var(--avq-success-bg)',
    warning: 'var(--avq-warning-bg)',
    accent: 'color-mix(in srgb, var(--avq-accent, #6366f1) 12%, var(--avq-bg))',
    neutral: 'var(--avq-muted, #f8f9fb)',
  }
  return {
    width: '40px',
    height: '40px',
    borderRadius: '10px',
    background: colors[variant],
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '18px',
    flexShrink: 0,
  }
}
