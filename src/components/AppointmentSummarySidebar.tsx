import { h } from 'preact'
import { useState } from 'preact/hooks'
import type { Product, PublicSlot } from '../types'
import type { TFunction } from '../i18n'
import { selectedModifiers } from '../state/booking'

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
  /** Override the card title ("Resumen de la cita" by default). Used by
   *  /classes to say "Resumen de la clase" instead. */
  title?: string
  /** Override the "N servicios" count label. /classes passes "1 clase" /
   *  "N clases". When omitted, falls back to the i18n keys. */
  countLabel?: string
  /** Override "A pagar en la cita" → "A pagar en el estudio" for classes. */
  dueAtVenueLabel?: string
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
  selectedDate,
  selectedSlot,
  title,
  countLabel: countLabelOverride,
  dueAtVenueLabel,
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

  const countLabel = countLabelOverride
    ?? (products.length === 1
      ? t('summary.servicesCount_one', { count: 1 })
      : t('summary.servicesCount', { count: products.length }))

  // Compose a single "lunes 18 de mayo · 14:30" line when the customer has
  // already picked both date and slot. Date-only renders without a time.
  let scheduleLabel: string | null = null
  if (selectedSlot?.startsAt) {
    const d = new Date(selectedSlot.startsAt)
    if (!Number.isNaN(d.getTime())) {
      try {
        // Intl in es-MX returns "martes, 19 de mayo". Capitalize only the
        // first letter so it reads "Martes, 19 de mayo" — using
        // textTransform: capitalize on the render side would also uppercase
        // "De Mayo", which Spanish convention rejects.
        const datePart = new Intl.DateTimeFormat('es-MX', {
          weekday: 'long', day: 'numeric', month: 'long',
        }).format(d).replace(/^\w/, c => c.toUpperCase())
        const timePart = new Intl.DateTimeFormat('es-MX', {
          hour: '2-digit', minute: '2-digit', hour12: false,
        }).format(d)
        scheduleLabel = `${datePart} · ${timePart}`
      } catch {
        scheduleLabel = d.toLocaleString()
      }
    }
  } else if (selectedDate) {
    const d = new Date(`${selectedDate}T00:00:00`)
    if (!Number.isNaN(d.getTime())) {
      try {
        scheduleLabel = new Intl.DateTimeFormat('es-MX', {
          weekday: 'long', day: 'numeric', month: 'long',
        }).format(d).replace(/^\w/, c => c.toUpperCase())
      } catch {
        scheduleLabel = selectedDate
      }
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <h3 style={{
        margin: 0, fontSize: '17px', fontWeight: '700',
        color: 'var(--avq-fg, #111827)', letterSpacing: '-0.3px',
      }}>
        {title ?? t('summary.title')}
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
                {scheduleLabel && (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '8px',
                    padding: '10px 0 8px',
                    borderBottom: products.length > 0 ? '1px solid var(--avq-border, #f1f3f5)' : 'none',
                    marginBottom: products.length > 0 ? '4px' : 0,
                  }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--avq-muted-fg, #6b7280)', flexShrink: 0 }}>
                      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                      <line x1="16" y1="2" x2="16" y2="6" />
                      <line x1="8" y1="2" x2="8" y2="6" />
                      <line x1="3" y1="10" x2="21" y2="10" />
                    </svg>
                    <span style={{
                      fontSize: '13px', color: 'var(--avq-fg, #111827)',
                    }}>
                      {scheduleLabel}
                    </span>
                  </div>
                )}
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
            label={dueAtVenueLabel ?? t('summary.dueAtVenue')}
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
            background: nextDisabled ? '#d1d5db' : 'var(--avq-accent, #2563eb)',
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

  // Picked modifiers for this product — only render rows that we can resolve
  // against the product's modifierGroups (otherwise the price would be wrong).
  const groupsById = new Map<string, { id: string; name: string; price: number }>()
  for (const group of product.modifierGroups ?? []) {
    for (const m of group.modifiers) {
      groupsById.set(m.id, m)
    }
  }
  const pickedForProduct = selectedModifiers.value.filter(
    s => s.productId === product.id && groupsById.has(s.modifierId),
  )

  return (
    <div style={{
      paddingTop: '10px', paddingBottom: isLast ? '4px' : '10px',
      borderBottom: isLast ? 'none' : '1px solid transparent',
    }}>
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: '10px',
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

      {pickedForProduct.length > 0 && (
        <ul style={{
          listStyle: 'none', padding: 0,
          margin: '6px 0 0 18px',
          display: 'flex', flexDirection: 'column', gap: '4px',
        }}>
          {pickedForProduct.map(sel => {
            const mod = groupsById.get(sel.modifierId)!
            const lineTotal = mod.price * sel.quantity
            return (
              <li key={`${sel.productId}-${sel.modifierId}`} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: '10px', fontSize: '12.5px',
                color: 'var(--avq-muted-fg, #6b7280)',
              }}>
                <span>
                  {mod.name}{sel.quantity > 1 ? ` × ${sel.quantity}` : ''}
                </span>
                {lineTotal > 0 && (
                  <span style={{ whiteSpace: 'nowrap' }}>
                    +{formatPriceMXN(lineTotal)}
                  </span>
                )}
              </li>
            )
          })}
        </ul>
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
