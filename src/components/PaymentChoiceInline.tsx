import { h } from 'preact'
import type { CustomerCreditBalance, Product, UpfrontPolicy } from '../types'
import type { TFunction } from '../i18n'

export type InlineChoice =
  | { kind: 'credits'; creditBalanceId: string; packName: string }
  | { kind: 'cash' }
  | null

interface PaymentChoiceInlineProps {
  product: Product
  seats: number
  credits: CustomerCreditBalance | null
  upfrontPolicy: UpfrontPolicy
  selected: InlineChoice
  onChange: (choice: InlineChoice) => void
  locale: 'en' | 'es'
  t: TFunction
}

function formatPriceMXN(amount: number): string {
  try {
    return new Intl.NumberFormat('es-MX', {
      style: 'currency', currency: 'MXN', maximumFractionDigits: 0,
    }).format(amount)
  } catch {
    return `$${Math.round(amount).toLocaleString('es-MX')}`
  }
}

/**
 * Square-style inline payment chooser. Only renders when the product accepts
 * BOTH credits and cash (the customer genuinely has a choice). Credit-only or
 * cash-only products fall through and use the existing post-submit flow.
 *
 * Stores choice in parent state via onChange; the parent's submit handler
 * (Reserva cita button) reads it and short-circuits the post-submit credit
 * check API round trip.
 */
export function PaymentChoiceInline({
  product,
  seats,
  credits,
  upfrontPolicy,
  selected,
  onChange,
  locale,
  t,
}: PaymentChoiceInlineProps) {
  const creditCost = product.creditCost == null ? 1 : product.creditCost
  const cashPrice = product.price ?? 0
  const totalNeeded = seats * creditCost

  const matchingBalance = credits?.purchases
    ?.filter(p => p.status === 'ACTIVE')
    ?.flatMap(p => p.itemBalances.map(b => ({ ...b, packName: p.creditPack.name })))
    ?.filter(b => b.productId === product.id && b.remainingQuantity >= totalNeeded)
    ?.sort((a, b) => b.remainingQuantity - a.remainingQuantity)[0] ?? null

  const acceptsCredits = !!matchingBalance
  const acceptsCash = cashPrice > 0 && product.requireCreditForBooking !== true

  // Don't render at all if the customer doesn't actually have a choice.
  if (!acceptsCredits || !acceptsCash) return null

  const tx = locale === 'en'
    ? { title: 'How do you want to pay?', credits: 'Pay with credits', cash: upfrontPolicy === 'required' ? 'Pay now' : 'Pay at the appointment', creditsHint: (n: number, p: string) => `Use ${n} credit${n === 1 ? '' : 's'} from "${p}"`, cashHint: (price: string) => upfrontPolicy === 'required' ? `Charge ${price} now to your card` : `Pay ${price} when you arrive` }
    : { title: '¿Cómo quieres pagar?', credits: 'Pagar con créditos', cash: upfrontPolicy === 'required' ? 'Pagar ahora' : 'Pagar al llegar', creditsHint: (n: number, p: string) => `Usa ${n} crédito${n === 1 ? '' : 's'} de "${p}"`, cashHint: (price: string) => upfrontPolicy === 'required' ? `Cobramos ${price} ahora a tu tarjeta` : `Pagas ${price} en la cita` }

  const cashAmount = formatPriceMXN(cashPrice * seats)
  const isCreditsSelected = selected?.kind === 'credits'
  const isCashSelected = selected?.kind === 'cash'

  return (
    <div style={{ marginBottom: '20px' }}>
      <h3 style={{
        margin: '0 0 12px',
        fontSize: '15px', fontWeight: '700',
        color: 'var(--avq-fg, #111827)',
      }}>
        {tx.title}
      </h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <Option
          selected={isCreditsSelected}
          onClick={() => onChange({ kind: 'credits', creditBalanceId: matchingBalance!.id, packName: matchingBalance!.packName })}
          icon="💳"
          title={tx.credits}
          hint={tx.creditsHint(totalNeeded, matchingBalance!.packName)}
        />
        <Option
          selected={isCashSelected}
          onClick={() => onChange({ kind: 'cash' })}
          icon="🏦"
          title={tx.cash}
          hint={tx.cashHint(cashAmount)}
        />
      </div>
    </div>
  )
}

function Option({
  selected,
  onClick,
  icon,
  title,
  hint,
}: {
  selected: boolean
  onClick: () => void
  icon: string
  title: string
  hint: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      style={{
        display: 'flex', alignItems: 'center', gap: '12px',
        width: '100%', padding: '14px 16px',
        borderRadius: '12px',
        border: selected
          ? '2px solid var(--avq-accent, #2563eb)'
          : '1.5px solid var(--avq-border, #e8eaed)',
        background: selected
          ? 'color-mix(in srgb, var(--avq-accent, #2563eb) 6%, var(--avq-bg, #fff))'
          : 'var(--avq-bg, #fff)',
        cursor: 'pointer',
        textAlign: 'left',
        fontFamily: 'inherit',
        transition: 'all 0.15s ease',
        boxShadow: selected
          ? '0 0 0 3px color-mix(in srgb, var(--avq-accent, #2563eb) 12%, transparent)'
          : 'none',
      }}
    >
      <span style={{
        width: '36px', height: '36px', borderRadius: '50%',
        background: selected
          ? 'var(--avq-accent, #2563eb)'
          : 'color-mix(in srgb, var(--avq-accent, #2563eb) 10%, var(--avq-bg, #fff))',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
        fontSize: '16px',
        filter: selected ? 'brightness(1.1)' : undefined,
      }}>
        {icon}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '14px', fontWeight: '600', color: 'var(--avq-fg, #111827)' }}>
          {title}
        </div>
        <div style={{ fontSize: '12px', color: 'var(--avq-muted-fg, #6b7280)', marginTop: '2px' }}>
          {hint}
        </div>
      </div>
      <span style={{
        width: '20px', height: '20px', borderRadius: '50%',
        border: selected ? 'none' : '2px solid var(--avq-border, #e8eaed)',
        background: selected ? 'var(--avq-accent, #2563eb)' : 'transparent',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        {selected && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        )}
      </span>
    </button>
  )
}
