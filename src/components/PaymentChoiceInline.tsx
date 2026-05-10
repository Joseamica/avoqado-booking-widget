import { h } from 'preact'
import type { CustomerCreditBalance, Product, UpfrontPolicy } from '../types'
import type { TFunction } from '../i18n'

/** What the customer picked. The widget reads this on submit:
 *  - 'credits' + balanceIds[]: every service maps to a balance, redeem from each
 *  - 'cash': skip credit-check API + submit normally
 *  - null: customer hasn't picked yet (Reserva cita stays disabled) */
export type InlineChoice =
  | { kind: 'credits'; creditBalanceId: string; packName: string; balanceIdsByProduct: Record<string, string> }
  | { kind: 'cash' }
  | null

interface PaymentChoiceInlineProps {
  /** Every service the customer added. PaymentChoiceInline ONLY enables the
   *  credits option when EVERY product in this list has a covering balance. */
  products: Product[]
  /** Number of seats / credits per service. partySize rolled up. */
  seats: number
  /** Customer credit balances, fetched eagerly with productIds=all-products. */
  credits: CustomerCreditBalance | null
  /** Lead product's policy — drives the cash label (now / at venue). */
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

interface MatchingBalance {
  id: string
  packName: string
  remainingQuantity: number
  productId: string
  required: number
}

/**
 * For each product in `products`, find the BEST matching balance (most credits
 * remaining, sufficient quantity). Returns null when ANY product lacks coverage
 * — the credits option is only viable when every service is covered.
 */
function pickBalancesForAllProducts(
  products: Product[],
  credits: CustomerCreditBalance | null,
  seats: number,
): { balances: MatchingBalance[]; totalCreditsRequired: number } | null {
  if (!credits || products.length === 0) return null

  const allBalances = credits.purchases
    .filter(p => p.status === 'ACTIVE')
    .flatMap(p =>
      p.itemBalances.map(b => ({
        id: b.id,
        productId: b.productId,
        remainingQuantity: b.remainingQuantity,
        packName: p.creditPack.name,
      })),
    )

  const picked: MatchingBalance[] = []
  let totalRequired = 0

  for (const product of products) {
    const required = seats * (product.creditCost ?? 1)
    totalRequired += required

    // Best matching balance for this product = highest remaining that covers
    // the requirement. Picking the most-stocked balance leaves smaller
    // balances available for other bookings.
    const candidate = allBalances
      .filter(b => b.productId === product.id && b.remainingQuantity >= required)
      .sort((a, b) => b.remainingQuantity - a.remainingQuantity)[0]

    if (!candidate) return null

    picked.push({
      id: candidate.id,
      packName: candidate.packName,
      remainingQuantity: candidate.remainingQuantity,
      productId: candidate.productId,
      required,
    })
  }

  return { balances: picked, totalCreditsRequired: totalRequired }
}

export function PaymentChoiceInline({
  products,
  seats,
  credits,
  upfrontPolicy,
  selected,
  onChange,
  locale,
  t,
}: PaymentChoiceInlineProps) {
  // Cash viability — every selected product must accept cash. A single
  // credit-only product disables the cash option.
  const acceptsCash = products.length > 0 && products.every(p => (p.price ?? 0) > 0 && p.requireCreditForBooking !== true)

  // Credits viability — pickBalancesForAllProducts returns null unless every
  // product has a covering balance.
  const coverage = pickBalancesForAllProducts(products, credits, seats)
  const acceptsCredits = coverage !== null

  // Don't render unless there's a real choice. Single-only fall-throughs
  // (cash-only or credit-only) keep going through the post-submit selectors.
  if (!acceptsCredits || !acceptsCash) return null

  const cashTotal = products.reduce((acc, p) => acc + (p.price ?? 0), 0) * seats

  // The picker stores the LEAD balance id in creditBalanceId for back-compat
  // with the legacy single-balance redemption path; the full per-product map
  // lives in balanceIdsByProduct so the widget can send creditItemBalanceIds[]
  // when multiple products redeem.
  const leadBalance = coverage!.balances[0]
  const balanceIdsByProduct: Record<string, string> = {}
  const uniquePackNames = new Set<string>()
  for (const b of coverage!.balances) {
    balanceIdsByProduct[b.productId] = b.id
    uniquePackNames.add(b.packName)
  }

  const tx = locale === 'en'
    ? {
      title: 'How do you want to pay?',
      credits: 'Pay with credits',
      cash: upfrontPolicy === 'required' ? 'Pay now' : 'Pay at the appointment',
      creditsHintSingle: (n: number, p: string) => `Use ${n} credit${n === 1 ? '' : 's'} from "${p}"`,
      creditsHintMulti: (n: number, p: string) => `Use ${n} credits across ${products.length} services from "${p}"`,
      creditsHintMixed: (n: number, services: number) => `Use ${n} credits across ${services} services`,
      cashHint: (price: string) => upfrontPolicy === 'required' ? `Charge ${price} now to your card` : `Pay ${price} when you arrive`,
    }
    : {
      title: '¿Cómo quieres pagar?',
      credits: 'Pagar con créditos',
      cash: upfrontPolicy === 'required' ? 'Pagar ahora' : 'Pagar al llegar',
      creditsHintSingle: (n: number, p: string) => `Usa ${n} crédito${n === 1 ? '' : 's'} de "${p}"`,
      creditsHintMulti: (n: number, p: string) => `Usa ${n} créditos en ${products.length} servicios de "${p}"`,
      creditsHintMixed: (n: number, services: number) => `Usa ${n} créditos en ${services} servicios`,
      cashHint: (price: string) => upfrontPolicy === 'required' ? `Cobramos ${price} ahora a tu tarjeta` : `Pagas ${price} en la cita`,
    }

  const isCreditsSelected = selected?.kind === 'credits'
  const isCashSelected = selected?.kind === 'cash'

  // Render the right credit hint:
  //  - 1 service          → "Use N credits from X"
  //  - N services, 1 pack → "Use N credits across X services from Y"
  //  - N services, N packs → "Use N credits across X services"
  const creditsHint = products.length === 1
    ? tx.creditsHintSingle(coverage!.totalCreditsRequired, leadBalance.packName)
    : uniquePackNames.size === 1
      ? tx.creditsHintMulti(coverage!.totalCreditsRequired, leadBalance.packName)
      : tx.creditsHintMixed(coverage!.totalCreditsRequired, products.length)

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
          onClick={() => onChange({
            kind: 'credits',
            creditBalanceId: leadBalance.id,
            packName: leadBalance.packName,
            balanceIdsByProduct,
          })}
          icon="💳"
          title={tx.credits}
          hint={creditsHint}
        />
        <Option
          selected={isCashSelected}
          onClick={() => onChange({ kind: 'cash' })}
          icon="🏦"
          title={tx.cash}
          hint={tx.cashHint(formatPriceMXN(cashTotal))}
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
