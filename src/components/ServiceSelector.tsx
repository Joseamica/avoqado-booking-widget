import { h } from 'preact'
import type { Product } from '../types'
import type { TFunction } from '../i18n'

interface ServiceSelectorProps {
  products: Product[]
  selectedProductId: string | null
  onSelect: (product: Product) => void
  t: TFunction
}

export function ServiceSelector({ products, selectedProductId, onSelect, t }: ServiceSelectorProps) {
  if (products.length === 0) {
    return <p class="py-8 text-center text-[var(--avq-muted-fg,#6b7280)]">{t('service.noProducts')}</p>
  }

  return (
    <div class="space-y-4">
      <h2 class="text-lg font-semibold text-[var(--avq-fg,#111827)]">{t('service.title')}</h2>
      <div class="space-y-3">
        {products.map(product => {
          const isSelected = product.id === selectedProductId
          return (
            <button
              key={product.id}
              type="button"
              onClick={() => onSelect(product)}
              class={`flex w-full items-center justify-between rounded-xl border-2 p-4 text-left transition-all ${isSelected ? 'border-[var(--avq-accent,#6366f1)] bg-[color-mix(in_srgb,var(--avq-accent,#6366f1)_8%,transparent)]' : 'border-[var(--avq-border,#e5e7eb)] hover:border-[color-mix(in_srgb,var(--avq-accent,#6366f1)_50%,transparent)]'}`}
            >
              <div class="space-y-1">
                <p class="font-medium text-[var(--avq-fg,#111827)]">{product.name}</p>
                {product.duration && (
                  <p class="flex items-center gap-1 text-sm text-[var(--avq-muted-fg,#6b7280)]">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                    {t('service.duration', { min: product.duration })}
                  </p>
                )}
              </div>
              {product.price != null && (
                <span class="text-lg font-semibold text-[var(--avq-fg,#111827)]">
                  ${product.price.toFixed(0)}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
