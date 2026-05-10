import { h } from 'preact'
import { useState } from 'preact/hooks'
import type { Product } from '../types'
import type { TFunction } from '../i18n'

/** Format MXN with thousand separators ("$6,962" not "$6962"). Drops cents to
 *  keep service-list rows scannable. */
function formatPriceMXN(amount: number): string {
  try {
    return new Intl.NumberFormat('es-MX', {
      style: 'currency', currency: 'MXN', maximumFractionDigits: 0,
    }).format(amount)
  } catch {
    return `$${Math.round(amount).toLocaleString('es-MX')}`
  }
}

interface ServiceSelectorProps {
  products: Product[]
  /** IDs of products already added to the appointment. Selected rows render
   *  with a soft highlight + "Añadido" pill. */
  selectedProductIds: string[]
  /** Tap handler — opens the ServiceDetailView (Square-pattern intermediate
   *  page) where the customer confirms via "Añadir" or, for already-added
   *  services, edits via "Eliminar"/"Actualizar". */
  onOpenDetail: (product: Product) => void
  t: TFunction
}

/**
 * Square-style service list. Each row is a borderless tap target with the
 * service name on top, optional description (clamped to 2 lines), and
 * "price · duration" metadata below. Clicking a row hands off to the parent's
 * ServiceDetailView; this component is purely a list renderer.
 */
export function ServiceSelector({
  products,
  selectedProductIds,
  onOpenDetail,
  t,
}: ServiceSelectorProps) {
  if (products.length === 0) {
    return (
      <div style={{ padding: '48px 0', textAlign: 'center' }}>
        <div style={{
          width: '48px', height: '48px', borderRadius: '50%',
          background: 'var(--avq-muted, #f8f9fb)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 12px',
        }}>
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--avq-muted-fg, #9ca3af)" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>
        </div>
        <p style={{ fontSize: '14px', color: 'var(--avq-muted-fg, #6b7280)' }}>
          {t('service.noProducts')}
        </p>
      </div>
    )
  }

  return (
    <div>
      <h2 style={{
        fontSize: '18px', fontWeight: '700',
        margin: '0 0 4px',
        color: 'var(--avq-fg, #111827)',
        letterSpacing: '-0.3px',
      }}>
        {t('service.title')}
      </h2>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {products.map((product, idx) => (
          <ServiceRow
            key={product.id}
            product={product}
            isAdded={selectedProductIds.includes(product.id)}
            isFirst={idx === 0}
            onOpen={() => onOpenDetail(product)}
            t={t}
          />
        ))}
      </div>
    </div>
  )
}

function ServiceRow({
  product,
  isAdded,
  isFirst,
  onOpen,
  t,
}: {
  product: Product
  isAdded: boolean
  isFirst: boolean
  onOpen: () => void
  t: TFunction
}) {
  const [isHov, setIsHov] = useState(false)

  const priceLabel = product.price == null
    ? t('summary.variablePrice')
    : formatPriceMXN(Number(product.price))
  const durationLabel = product.duration ? t('service.duration', { min: product.duration }) : null

  return (
    <button
      type="button"
      onClick={onOpen}
      onMouseEnter={() => setIsHov(true)}
      onMouseLeave={() => setIsHov(false)}
      style={{
        display: 'flex', flexDirection: 'column',
        alignItems: 'flex-start', gap: '6px',
        width: '100%', textAlign: 'left',
        padding: '20px 4px',
        borderTop: isFirst ? 'none' : '1px solid var(--avq-border, #e8eaed)',
        borderLeft: 0, borderRight: 0, borderBottom: 0,
        background: isHov ? 'var(--avq-muted, #f8f9fb)' : 'transparent',
        cursor: 'pointer',
        transition: 'background 0.15s ease',
        fontFamily: 'inherit',
      }}
    >
      <div style={{
        display: 'flex', alignItems: 'center',
        gap: '10px', width: '100%',
      }}>
        <span style={{
          fontSize: '15px', fontWeight: '600',
          color: 'var(--avq-fg, #111827)',
          letterSpacing: '-0.01em',
        }}>
          {product.name}
        </span>
        {isAdded && (
          <span style={{
            fontSize: '11px', fontWeight: '600',
            padding: '3px 8px',
            borderRadius: '999px',
            background: 'color-mix(in srgb, var(--avq-accent, #2563eb) 14%, var(--avq-bg, #ffffff))',
            color: 'var(--avq-accent, #2563eb)',
            letterSpacing: '0.2px',
          }}>
            Añadido
          </span>
        )}
      </div>

      {product.description && (
        <p style={{
          margin: 0, fontSize: '13px', lineHeight: 1.5,
          color: 'var(--avq-muted-fg, #6b7280)',
          display: '-webkit-box',
          WebkitLineClamp: 2 as any,
          WebkitBoxOrient: 'vertical' as any,
          overflow: 'hidden',
          maxWidth: '720px',
        }}>
          {product.description}
        </p>
      )}

      <div style={{
        display: 'flex', alignItems: 'center',
        gap: '10px', fontSize: '13px',
        color: 'var(--avq-muted-fg, #6b7280)',
        marginTop: '2px',
      }}>
        <span style={{
          fontWeight: '500',
          color: product.price == null ? 'var(--avq-muted-fg, #6b7280)' : 'var(--avq-fg, #111827)',
        }}>
          {priceLabel}
        </span>
        {durationLabel && (
          <>
            <span aria-hidden="true">·</span>
            <span>{durationLabel}</span>
          </>
        )}
      </div>
    </button>
  )
}
