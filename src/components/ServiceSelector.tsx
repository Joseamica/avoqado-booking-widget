import { h } from 'preact'
import { useMemo, useState } from 'preact/hooks'
import type { Product } from '../types'
import type { TFunction } from '../i18n'

interface ServiceSelectorProps {
  products: Product[]
  selectedProductId: string | null
  onSelect: (product: Product) => void
  t: TFunction
}

/** Segmented control for switching between Services and Classes */
function TabBar({ activeTab, onTabChange, t }: {
  activeTab: 'services' | 'classes'
  onTabChange: (tab: 'services' | 'classes') => void
  t: TFunction
}) {
  return (
    <div style={{
      display: 'flex', gap: '4px', padding: '3px',
      background: 'var(--avq-muted, #f3f4f6)', borderRadius: '12px',
      marginBottom: '20px',
    }}>
      {(['services', 'classes'] as const).map(tab => {
        const isActive = activeTab === tab
        return (
          <button
            key={tab}
            type="button"
            onClick={() => onTabChange(tab)}
            style={{
              flex: 1, padding: '9px 16px',
              borderRadius: '9px', border: 'none',
              fontSize: '13px', fontWeight: isActive ? '600' : '500',
              color: isActive ? 'var(--avq-fg, #111827)' : 'var(--avq-muted-fg, #6b7280)',
              background: isActive ? 'var(--avq-bg, #ffffff)' : 'transparent',
              boxShadow: isActive ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              letterSpacing: '-0.01em',
            }}
          >
            {tab === 'services' ? t('service.tabServices') : t('service.tabClasses')}
          </button>
        )
      })}
    </div>
  )
}

/** Standard service card (appointments, events) */
function ServiceCard({ product, isSelected, onSelect, t }: {
  product: Product
  isSelected: boolean
  onSelect: () => void
  t: TFunction
}) {
  const [isHov, setIsHov] = useState(false)

  return (
    <button
      type="button"
      onClick={onSelect}
      onMouseEnter={() => setIsHov(true)}
      onMouseLeave={() => setIsHov(false)}
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
        <p style={{ margin: 0, fontSize: '15px', fontWeight: '500', color: 'var(--avq-fg, #111827)' }}>
          {product.name}
        </p>
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
            ${Number(product.price).toFixed(0)}
          </span>
        )}
        <RadioDot isSelected={isSelected} />
      </div>
    </button>
  )
}

/** Class card — richer layout with capacity indicator and group-class feel */
function ClassCard({ product, isSelected, onSelect, t }: {
  product: Product
  isSelected: boolean
  onSelect: () => void
  t: TFunction
}) {
  const [isHov, setIsHov] = useState(false)
  const capacity = product.maxParticipants ?? product.eventCapacity

  return (
    <button
      type="button"
      onClick={onSelect}
      onMouseEnter={() => setIsHov(true)}
      onMouseLeave={() => setIsHov(false)}
      style={{
        display: 'flex', width: '100%', alignItems: 'stretch',
        textAlign: 'left', cursor: 'pointer', overflow: 'hidden',
        borderRadius: '14px',
        border: isSelected
          ? '2px solid var(--avq-accent, #6366f1)'
          : '1.5px solid var(--avq-border, #e8eaed)',
        background: isSelected
          ? 'color-mix(in srgb, var(--avq-accent, #6366f1) 4%, var(--avq-bg, #ffffff))'
          : isHov ? 'var(--avq-muted, #f8f9fb)' : 'var(--avq-bg, #ffffff)',
        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
        boxShadow: isSelected
          ? '0 0 0 3px color-mix(in srgb, var(--avq-accent, #6366f1) 8%, transparent)'
          : isHov ? '0 2px 8px rgba(0,0,0,0.06)' : 'none',
      }}
    >
      {/* Accent left stripe */}
      <div style={{
        width: '4px', flexShrink: 0,
        background: isSelected
          ? 'var(--avq-accent, #6366f1)'
          : 'color-mix(in srgb, var(--avq-accent, #6366f1) 30%, transparent)',
        transition: 'background 0.2s ease',
      }} />

      <div style={{ flex: 1, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {/* Top row: name + badge */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
            {/* Group icon */}
            <div style={{
              width: '32px', height: '32px', borderRadius: '10px', flexShrink: 0,
              background: 'color-mix(in srgb, var(--avq-accent, #6366f1) 10%, transparent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--avq-accent, #6366f1)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </div>
            <div style={{ minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: '15px', fontWeight: '600', color: 'var(--avq-fg, #111827)', letterSpacing: '-0.01em' }}>
                {product.name}
              </p>
            </div>
          </div>
          <RadioDot isSelected={isSelected} />
        </div>

        {/* Bottom row: metadata chips */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          {product.duration && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: '4px',
              fontSize: '12px', fontWeight: '500', color: 'var(--avq-muted-fg, #6b7280)',
            }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              {t('service.duration', { min: product.duration })}
            </span>
          )}
          {capacity != null && capacity > 0 && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: '4px',
              fontSize: '12px', fontWeight: '500', color: 'var(--avq-muted-fg, #6b7280)',
            }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
              </svg>
              {t(capacity === 1 ? 'service.classCapacity_one' : 'service.classCapacity', { count: capacity })}
            </span>
          )}
          {product.price != null && (
            <span style={{
              fontSize: '14px', fontWeight: '700', color: 'var(--avq-fg, #111827)',
              marginLeft: 'auto',
            }}>
              ${Number(product.price).toFixed(0)}
            </span>
          )}
        </div>
      </div>
    </button>
  )
}

/** Shared radio-dot indicator */
function RadioDot({ isSelected }: { isSelected: boolean }) {
  return (
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
  )
}

export function ServiceSelector({ products, selectedProductId, onSelect, t }: ServiceSelectorProps) {
  const services = useMemo(() => products.filter(p => p.type !== 'CLASS'), [products])
  const classes = useMemo(() => products.filter(p => p.type === 'CLASS'), [products])
  const hasBoth = services.length > 0 && classes.length > 0
  const [activeTab, setActiveTab] = useState<'services' | 'classes'>(services.length > 0 ? 'services' : 'classes')

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

  const visibleProducts = hasBoth
    ? (activeTab === 'services' ? services : classes)
    : products

  const noProductsForTab = hasBoth && visibleProducts.length === 0

  return (
    <div>
      <h2 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '16px', color: 'var(--avq-fg, #111827)' }}>
        {t('service.title')}
      </h2>

      {hasBoth && (
        <TabBar activeTab={activeTab} onTabChange={setActiveTab} t={t} />
      )}

      {noProductsForTab ? (
        <div style={{ padding: '32px 0', textAlign: 'center' }}>
          <p style={{ fontSize: '14px', color: 'var(--avq-muted-fg, #6b7280)' }}>
            {activeTab === 'classes' ? t('service.noClasses') : t('service.noProducts')}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {visibleProducts.map(product => {
            const isSelected = product.id === selectedProductId
            if (product.type === 'CLASS') {
              return (
                <ClassCard
                  key={product.id}
                  product={product}
                  isSelected={isSelected}
                  onSelect={() => onSelect(product)}
                  t={t}
                />
              )
            }
            return (
              <ServiceCard
                key={product.id}
                product={product}
                isSelected={isSelected}
                onSelect={() => onSelect(product)}
                t={t}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
