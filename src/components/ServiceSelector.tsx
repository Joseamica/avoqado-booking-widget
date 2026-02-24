import { h } from 'preact'
import { useState } from 'preact/hooks'
import type { Product } from '../types'
import type { TFunction } from '../i18n'

interface ServiceSelectorProps {
  products: Product[]
  selectedProductId: string | null
  onSelect: (product: Product) => void
  t: TFunction
}

export function ServiceSelector({ products, selectedProductId, onSelect, t }: ServiceSelectorProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  if (products.length === 0) {
    return (
      <p style={{ padding: '48px 0', textAlign: 'center', fontSize: '14px', color: 'var(--avq-muted-fg, #6b7280)' }}>
        {t('service.noProducts')}
      </p>
    )
  }

  return (
    <div>
      <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '20px', color: 'var(--avq-fg, #111827)' }}>
        {t('service.title')}
      </h2>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {products.map(product => {
          const isSelected = product.id === selectedProductId
          const isHov = hoveredId === product.id

          return (
            <button
              key={product.id}
              type="button"
              onClick={() => onSelect(product)}
              onMouseEnter={() => setHoveredId(product.id)}
              onMouseLeave={() => setHoveredId(null)}
              style={{
                display: 'flex', width: '100%', alignItems: 'center',
                justifyContent: 'space-between', padding: '16px 20px',
                borderRadius: '12px', textAlign: 'left', cursor: 'pointer',
                border: isSelected
                  ? '2px solid var(--avq-accent, #6366f1)'
                  : '1.5px solid var(--avq-border, #e5e7eb)',
                background: isHov && !isSelected ? 'var(--avq-muted, #f3f4f6)' : 'transparent',
                transition: 'all 150ms ease',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <p style={{ margin: 0, fontSize: '15px', fontWeight: '500', color: 'var(--avq-fg, #111827)' }}>
                    {product.name}
                  </p>
                  {product.type === 'CLASS' && (
                    <span style={{
                      fontSize: '11px', fontWeight: '600', padding: '2px 8px',
                      borderRadius: '9999px',
                      background: 'var(--avq-accent, #6366f1)',
                      color: '#ffffff',
                      lineHeight: '16px',
                      whiteSpace: 'nowrap',
                    }}>
                      {t('service.groupClass')}
                    </span>
                  )}
                </div>
                {product.duration && (
                  <p style={{ margin: 0, fontSize: '13px', color: 'var(--avq-muted-fg, #6b7280)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                    {t('service.duration', { min: product.duration })}
                  </p>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
                {product.price != null && (
                  <span style={{ fontSize: '16px', fontWeight: '600', color: 'var(--avq-fg, #111827)' }}>
                    ${product.price.toFixed(0)}
                  </span>
                )}
                {isSelected && (
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style={{ color: 'var(--avq-accent, #6366f1)', flexShrink: 0 }}>
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
