import { h } from 'preact'
import type { Product } from '../types'
import type { TFunction } from '../i18n'

function formatPriceMXN(amount: number): string {
  try {
    return new Intl.NumberFormat('es-MX', {
      style: 'currency', currency: 'MXN', maximumFractionDigits: 0,
    }).format(amount)
  } catch {
    return `$${Math.round(amount).toLocaleString('es-MX')}`
  }
}

interface ServiceDetailViewProps {
  product: Product
  mode: 'add' | 'edit'
  onAdd: () => void
  onUpdate: () => void
  onRemove: () => void
  onBack: () => void
  t: TFunction
}

/**
 * Square-style service detail screen — shown after the customer taps a service
 * row. Acts as a confirmation step + edit interface for the multi-service
 * /appointments wizard. The Add variant exposes a single big "Añadir" button;
 * the Edit variant exposes "Eliminar" + "Actualizar" side by side.
 */
export function ServiceDetailView({
  product,
  mode,
  onAdd,
  onUpdate,
  onRemove,
  onBack,
  t,
}: ServiceDetailViewProps) {
  const priceLabel = product.price == null
    ? t('summary.variablePrice')
    : formatPriceMXN(Number(product.price))
  const durationLabel = product.duration ? t('service.duration', { min: product.duration }) : null

  return (
    <div class="avq-animate-in" style={{ paddingTop: '4px' }}>
      {/* Breadcrumb */}
      <nav style={{
        display: 'flex', alignItems: 'center', gap: '6px',
        fontSize: '13px', marginBottom: '14px',
      }} aria-label="breadcrumb">
        <button
          type="button"
          onClick={onBack}
          style={{
            background: 'transparent', border: 0,
            color: 'var(--avq-muted-fg, #6b7280)',
            cursor: 'pointer', padding: 0, fontSize: 'inherit',
            fontFamily: 'inherit',
            textDecoration: 'underline', textUnderlineOffset: '2px',
          }}
        >
          {t('serviceDetail.breadcrumb')}
        </button>
        <span style={{ color: 'var(--avq-muted-fg, #9ca3af)' }}>/</span>
        <span style={{ color: 'var(--avq-fg, #111827)', fontWeight: '600' }}>
          {product.name}
        </span>
      </nav>

      {/* Title + meta */}
      <h1 style={{
        margin: '0 0 8px', fontSize: '28px', fontWeight: '700',
        letterSpacing: '-0.6px',
        color: 'var(--avq-fg, #111827)',
      }}>
        {product.name}
      </h1>
      <p style={{
        margin: '0 0 24px', fontSize: '14px',
        color: 'var(--avq-muted-fg, #6b7280)',
      }}>
        <span style={{ fontWeight: '600', color: 'var(--avq-fg, #111827)' }}>{priceLabel}</span>
        {durationLabel && (
          <>
            <span style={{ margin: '0 8px' }}>·</span>
            <span>{durationLabel}</span>
          </>
        )}
      </p>

      {/* Description (optional) — skipped when it duplicates the name, which
          some venue datasets do (the API returns name === description). */}
      {product.description &&
       product.description.trim().toLowerCase() !== product.name.trim().toLowerCase() && (
        <p style={{
          margin: '0 0 24px', fontSize: '14px',
          color: 'var(--avq-fg, #111827)', lineHeight: 1.55,
        }}>
          {product.description}
        </p>
      )}

      {/* Actions — full-width within the main column (the sidebar already
          carves out its own space; we don't need a second cap). */}
      {mode === 'add' ? (
        <button
          type="button"
          onClick={onAdd}
          style={{
            width: '100%',
            padding: '16px',
            background: '#2563eb', color: '#ffffff',
            border: 0, borderRadius: '12px',
            fontSize: '15px', fontWeight: '600',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {t('serviceDetail.add')}
        </button>
      ) : (
        <div style={{
          display: 'flex', gap: '10px', flexWrap: 'wrap',
        }}>
          <button
            type="button"
            onClick={onRemove}
            style={{
              flex: 1, minWidth: '140px',
              padding: '16px',
              background: '#f3f4f6', color: '#2563eb',
              border: 0, borderRadius: '12px',
              fontSize: '15px', fontWeight: '600',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {t('serviceDetail.remove')}
          </button>
          <button
            type="button"
            onClick={onUpdate}
            style={{
              flex: 1, minWidth: '140px',
              padding: '16px',
              background: '#2563eb', color: '#ffffff',
              border: 0, borderRadius: '12px',
              fontSize: '15px', fontWeight: '600',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {t('serviceDetail.update')}
          </button>
        </div>
      )}
    </div>
  )
}
