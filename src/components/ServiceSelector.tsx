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
      <div style={{ padding: '48px 0', textAlign: 'center' }}>
        <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'var(--avq-muted, #f8f9fb)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
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
      <h2 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '16px', color: 'var(--avq-fg, #111827)' }}>
        {t('service.title')}
      </h2>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
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
                justifyContent: 'space-between', padding: '14px 16px',
                borderRadius: '14px', textAlign: 'left', cursor: 'pointer',
                border: isSelected
                  ? '2px solid var(--avq-accent, #6366f1)'
                  : '1.5px solid var(--avq-border, #e8eaed)',
                background: isSelected
                  ? 'color-mix(in srgb, var(--avq-accent, #6366f1) 4%, var(--avq-bg, #ffffff))'
                  : isHov ? 'var(--avq-muted, #f8f9fb)' : 'var(--avq-bg, #ffffff)',
                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                boxShadow: isSelected
                  ? '0 0 0 3px color-mix(in srgb, var(--avq-accent, #6366f1) 8%, transparent)'
                  : isHov ? 'var(--avq-card-shadow, 0 1px 3px rgba(0,0,0,0.04))' : 'none',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <p style={{ margin: 0, fontSize: '15px', fontWeight: '500', color: 'var(--avq-fg, #111827)' }}>
                    {product.name}
                  </p>
                  {product.type === 'CLASS' && (
                    <span style={{
                      fontSize: '10px', fontWeight: '600', padding: '2px 8px',
                      borderRadius: '6px',
                      background: 'color-mix(in srgb, var(--avq-accent, #6366f1) 10%, transparent)',
                      color: 'var(--avq-accent, #6366f1)',
                      lineHeight: '16px',
                      whiteSpace: 'nowrap',
                      letterSpacing: '0.02em',
                      textTransform: 'uppercase',
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

              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0, marginLeft: '12px' }}>
                {product.price != null && (
                  <span style={{ fontSize: '16px', fontWeight: '600', color: 'var(--avq-fg, #111827)' }}>
                    ${product.price.toFixed(0)}
                  </span>
                )}
                <div style={{
                  width: '20px', height: '20px', borderRadius: '50%',
                  border: isSelected ? 'none' : '2px solid var(--avq-border, #e8eaed)',
                  background: isSelected ? 'var(--avq-accent, #6366f1)' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'all 0.2s ease',
                  flexShrink: 0,
                }}>
                  {isSelected && (
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                  )}
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
