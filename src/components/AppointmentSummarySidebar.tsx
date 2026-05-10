import { h } from 'preact'
import { useState } from 'preact/hooks'
import type { Product, PublicSlot } from '../types'
import type { TFunction } from '../i18n'

/** Format MXN with thousand separators, no decimals. Mirrors ServiceSelector. */
function formatPriceMXN(amount: number): string {
  try {
    return new Intl.NumberFormat('es-MX', {
      style: 'currency', currency: 'MXN', maximumFractionDigits: 0,
    }).format(amount)
  } catch {
    return `$${Math.round(amount).toLocaleString('es-MX')}`
  }
}

/** Render minutes as "1 h", "45 min", "1 h 30 min". */
function formatDuration(min: number): string {
  if (min <= 0) return ''
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h === 0) return `${m} min`
  if (m === 0) return `${h} h`
  return `${h} h ${m} min`
}

interface AppointmentSummarySidebarProps {
  products: Product[]
  totalPrice: number | null
  totalDuration: number
  /** When provided, an extra "fecha + hora" row renders above the services list. */
  selectedDate?: string | null
  selectedSlot?: PublicSlot | null
  /** When set, the bottom CTA renders. Without this prop the sidebar is read-only
   *  (used on payment + confirmation, where the action lives elsewhere). */
  onNext?: () => void
  nextDisabled?: boolean
  /** Override the CTA label. Defaults to "Siguiente". */
  nextLabel?: string
  /** Pencil-icon click on a row — used by the service step to navigate to
   *  ServiceDetailView in edit mode. Omit to hide pencils. */
  onEditProduct?: (product: Product) => void
  /** Optional totals block (shown on the payment step). */
  showTotals?: boolean
  subtotal?: number
  taxes?: number
  dueToday?: number
  dueAtVenue?: number
  /** Note rendered under the totals (e.g. "Esta cita incluye un servicio con un
   *  precio variable. El precio se determinará en la cita y no se incluye en el
   *  total."). Optional — omit when no variable-priced product is selected. */
  totalsNote?: string
  t: TFunction
}

export function AppointmentSummarySidebar({
  products,
  totalPrice,
  totalDuration,
  onNext,
  nextDisabled = false,
  nextLabel,
  onEditProduct,
  showTotals = false,
  subtotal,
  taxes,
  dueToday,
  dueAtVenue,
  totalsNote,
  t,
}: AppointmentSummarySidebarProps) {
  const [expanded, setExpanded] = useState(true)
  const isEmpty = products.length === 0

  const hasVariable = products.some(p => p.price == null)
  const priceLabel = isEmpty
    ? null
    : totalPrice != null && totalPrice > 0
      ? `${hasVariable ? '+' : ''}${formatPriceMXN(totalPrice)}`
      : t('summary.variablePrice')

  const countLabel = products.length === 1
    ? t('summary.servicesCount_one', { count: 1 })
    : t('summary.servicesCount', { count: products.length })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <h3 style={{
        margin: 0, fontSize: '17px', fontWeight: '700',
        color: 'var(--avq-fg, #111827)', letterSpacing: '-0.3px',
      }}>
        {t('summary.title')}
      </h3>

      {/* Card */}
      <div style={{
        border: '1px solid var(--avq-border, #e8eaed)',
        borderRadius: '12px',
        background: 'var(--avq-bg, #ffffff)',
        overflow: 'hidden',
      }}>
        {isEmpty ? (
          <div style={{ padding: '20px 18px', fontSize: '14px', color: 'var(--avq-muted-fg, #6b7280)' }}>
            {t('summary.empty')}
          </div>
        ) : (
          <div>
            {/* Header (always visible). Click toggles the body when there are services. */}
            <button
              type="button"
              onClick={() => setExpanded(v => !v)}
              style={{
                width: '100%',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: '12px', padding: '16px 18px',
                background: 'transparent', border: 0,
                cursor: 'pointer', textAlign: 'left',
                fontFamily: 'inherit',
              }}
              aria-expanded={expanded}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
                <span style={{ fontSize: '15px', fontWeight: '600', color: 'var(--avq-fg, #111827)' }}>
                  {countLabel}
                </span>
                <span style={{ fontSize: '13px', color: 'var(--avq-muted-fg, #6b7280)' }}>
                  {priceLabel}
                  {totalDuration > 0 && (
                    <>
                      {priceLabel ? ' · ' : ''}
                      {formatDuration(totalDuration)}
                    </>
                  )}
                </span>
              </div>
              <ChevronIcon up={expanded} />
            </button>

            {expanded && (
              <div style={{
                borderTop: '1px solid var(--avq-border, #e8eaed)',
                padding: '6px 18px 14px',
              }}>
                {products.map((product, idx) => (
                  <SummaryRow
                    key={product.id}
                    product={product}
                    isLast={idx === products.length - 1}
                    onEdit={onEditProduct ? () => onEditProduct(product) : undefined}
                    t={t}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Totals block — only on the payment step */}
      {showTotals && (
        <div style={{
          border: '1px solid var(--avq-border, #e8eaed)',
          borderRadius: '12px',
          padding: '16px 18px',
          background: 'var(--avq-bg, #ffffff)',
          display: 'flex', flexDirection: 'column', gap: '10px',
        }}>
          <TotalRow label={t('summary.subtotal')} value={subtotal != null ? formatPriceMXN(subtotal) : '—'} />
          <TotalRow label={t('summary.taxes')} value={taxes != null ? formatPriceMXN(taxes) : formatPriceMXN(0)} />
          <TotalRow
            label={t('summary.total')}
            value={subtotal != null ? `${hasVariable ? '+' : ''}${formatPriceMXN(subtotal + (taxes ?? 0))}` : '—'}
            bold
          />
          <div style={{ height: '1px', background: 'var(--avq-border, #e8eaed)', margin: '4px 0' }} />
          <TotalRow
            label={t('summary.dueToday')}
            value={dueToday != null ? formatPriceMXN(dueToday) : formatPriceMXN(0)}
            bold
          />
          <TotalRow
            label={t('summary.dueAtVenue')}
            value={dueAtVenue != null ? `${hasVariable ? '+' : ''}${formatPriceMXN(dueAtVenue)}` : '—'}
            muted
          />
          {totalsNote && (
            <p style={{
              margin: '8px 0 0', fontSize: '12px', lineHeight: 1.5,
              color: 'var(--avq-muted-fg, #6b7280)',
            }}>
              {totalsNote}
            </p>
          )}
        </div>
      )}

      {/* Bottom CTA */}
      {onNext && (
        <button
          type="button"
          onClick={onNext}
          disabled={nextDisabled}
          style={{
            padding: '14px',
            background: nextDisabled ? '#d1d5db' : '#2563eb',
            color: nextDisabled ? '#6b7280' : '#ffffff',
            border: 0, borderRadius: '12px',
            fontSize: '15px', fontWeight: '600',
            cursor: nextDisabled ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit',
            transition: 'background 0.15s ease',
          }}
        >
          {nextLabel ?? t('summary.next')}
        </button>
      )}
    </div>
  )
}

function SummaryRow({
  product,
  isLast,
  onEdit,
  t,
}: {
  product: Product
  isLast: boolean
  onEdit?: () => void
  t: TFunction
}) {
  const priceLabel = product.price == null
    ? t('summary.variablePrice')
    : formatPriceMXN(Number(product.price))

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: '10px',
      paddingTop: '10px', paddingBottom: isLast ? '4px' : '10px',
      borderBottom: isLast ? 'none' : '1px solid transparent',
    }}>
      <span style={{
        width: '8px', height: '8px', borderRadius: '50%',
        background: 'var(--avq-muted-fg, #9ca3af)',
        flexShrink: 0, marginTop: '6px',
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: '14px', fontWeight: '600',
          color: 'var(--avq-fg, #111827)',
          lineHeight: 1.35,
        }}>
          {product.name}
        </div>
      </div>
      <span style={{
        fontSize: '13px',
        color: product.price == null ? 'var(--avq-muted-fg, #6b7280)' : 'var(--avq-fg, #111827)',
        whiteSpace: 'nowrap',
      }}>
        {priceLabel}
      </span>
      {onEdit && (
        <button
          type="button"
          onClick={onEdit}
          aria-label={t('summary.edit')}
          style={{
            background: 'transparent', border: 0,
            cursor: 'pointer', padding: '4px',
            color: 'var(--avq-muted-fg, #6b7280)',
            display: 'inline-flex', alignItems: 'center',
          }}
        >
          <PencilIcon />
        </button>
      )}
    </div>
  )
}

function TotalRow({
  label,
  value,
  bold = false,
  muted = false,
}: {
  label: string
  value: string
  bold?: boolean
  muted?: boolean
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: '12px',
      fontSize: '14px',
      fontWeight: bold ? '600' : '500',
      color: muted ? 'var(--avq-muted-fg, #6b7280)' : 'var(--avq-fg, #111827)',
    }}>
      <span>{label}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  )
}

function ChevronIcon({ up }: { up: boolean }) {
  return (
    <svg
      width="20" height="20" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2.2"
      strokeLinecap="round" strokeLinejoin="round"
      style={{
        flexShrink: 0,
        color: 'var(--avq-fg, #111827)',
        transform: up ? 'rotate(0deg)' : 'rotate(180deg)',
        transition: 'transform 0.2s ease',
      }}
    >
      <polyline points="18 15 12 9 6 15" />
    </svg>
  )
}

function PencilIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  )
}
