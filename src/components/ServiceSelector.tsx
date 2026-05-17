import { h } from 'preact'
import { useEffect, useMemo, useState } from 'preact/hooks'
import type { Product } from '../types'
import type { TFunction } from '../i18n'

/** Format MXN with thousand separators ("$6,962" not "$6962"). Drops cents to
 *  keep service-list rows scannable. */
function formatPriceMXN(amount: number): string {
  try {
    return new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: 'MXN',
      maximumFractionDigits: 0,
    }).format(amount)
  } catch {
    return `$${Math.round(amount).toLocaleString('es-MX')}`
  }
}

/** Strip accents + lowercase for fuzzy match (so "polygel" finds "Polígel"
 *  and "frances" finds "Francés"). */
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
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

interface CategoryBucket {
  id: string
  name: string
  displayOrder: number
  products: Product[]
}

/**
 * Service list with hybrid discovery — Booksy/Fresha/Vagaro pattern.
 *
 * Top: search bar + horizontally-scrollable category chips (only categories
 * with at least one product render). Default = "Todas" chip selected → list
 * groups by category with H3 headers; specific chip = flat list scoped to
 * that category. Search composes with the chip filter (AND).
 *
 * Falls back to the legacy flat list when no product carries a category
 * (e.g., legacy venues whose backend pre-dates the category-aware endpoint).
 */
export function ServiceSelector({
  products,
  selectedProductIds,
  onOpenDetail,
  t,
}: ServiceSelectorProps) {
  const [queryRaw, setQueryRaw] = useState('')
  const [query, setQuery] = useState('')
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null)

  // Debounce search input so massive catalogs (200+ products) don't re-filter
  // on every keystroke. 150ms feels instant but cuts filter work ~10x.
  useEffect(() => {
    const id = setTimeout(() => setQuery(queryRaw), 150)
    return () => clearTimeout(id)
  }, [queryRaw])

  // Build category buckets in displayOrder. We only surface categories whose
  // products survive the active filters, so empty chips never render.
  const { categories, filtered, isGrouped, hasCategoryData } = useMemo(() => {
    const trimmed = norm(query.trim())
    const matchesSearch = (p: Product) => {
      if (!trimmed) return true
      return norm(p.name).includes(trimmed) || (p.description ? norm(p.description).includes(trimmed) : false)
    }

    const hasCategoryData = products.some(p => !!p.category)
    if (!hasCategoryData) {
      // Legacy fallback: flat list, search-only filter.
      return {
        categories: [] as CategoryBucket[],
        filtered: products.filter(matchesSearch),
        isGrouped: false,
        hasCategoryData,
      }
    }

    // Group products by category (skip products without category — should be
    // rare but treat them as "Otros" so they don't vanish silently).
    const byId = new Map<string, CategoryBucket>()
    const OTHERS_KEY = '__others__'
    for (const p of products) {
      const cat = p.category
      const key = cat?.id ?? OTHERS_KEY
      if (!byId.has(key)) {
        byId.set(key, {
          id: key,
          name: cat?.name ?? 'Otros',
          displayOrder: cat?.displayOrder ?? 9999,
          products: [],
        })
      }
      byId.get(key)!.products.push(p)
    }

    const allBuckets = [...byId.values()].sort((a, b) => a.displayOrder - b.displayOrder)

    // Apply category filter THEN search filter
    const visibleBuckets = allBuckets
      .filter(b => (activeCategoryId ? b.id === activeCategoryId : true))
      .map(b => ({ ...b, products: b.products.filter(matchesSearch) }))
      .filter(b => b.products.length > 0)

    return {
      categories: allBuckets, // chips list — full set so the user sees all options
      filtered: visibleBuckets.flatMap(b => b.products),
      isGrouped: activeCategoryId == null,
      hasCategoryData,
      visibleBuckets,
    }
  }, [products, query, activeCategoryId])

  // Re-derive visibleBuckets for rendering (memo above returns it indirectly)
  const visibleBuckets = useMemo<CategoryBucket[]>(() => {
    const trimmed = norm(query.trim())
    const matchesSearch = (p: Product) => {
      if (!trimmed) return true
      return norm(p.name).includes(trimmed) || (p.description ? norm(p.description).includes(trimmed) : false)
    }
    if (!hasCategoryData) {
      return [{ id: '__all__', name: '', displayOrder: 0, products: filtered }]
    }
    return categories
      .filter(b => (activeCategoryId ? b.id === activeCategoryId : true))
      .map(b => ({ ...b, products: b.products.filter(matchesSearch) }))
      .filter(b => b.products.length > 0)
  }, [categories, query, activeCategoryId, hasCategoryData, filtered])

  if (products.length === 0) {
    return (
      <div style={{ padding: '48px 0', textAlign: 'center' }}>
        <div
          style={{
            width: '48px',
            height: '48px',
            borderRadius: '50%',
            background: 'var(--avq-muted, #f8f9fb)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 12px',
          }}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--avq-muted-fg, #9ca3af)"
            stroke-width="2"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="9" y1="3" x2="9" y2="21" />
          </svg>
        </div>
        <p style={{ fontSize: '14px', color: 'var(--avq-muted-fg, #6b7280)' }}>{t('service.noProducts')}</p>
      </div>
    )
  }

  return (
    <div>
      <h2
        style={{
          fontSize: '18px',
          fontWeight: '700',
          margin: '0 0 16px',
          color: 'var(--avq-fg, #111827)',
          letterSpacing: '-0.3px',
        }}
      >
        {t('service.title')}
      </h2>

      {/* Search bar */}
      <div style={{ position: 'relative', marginBottom: '12px' }}>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--avq-muted-fg, #9ca3af)"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          style={{
            position: 'absolute',
            left: '12px',
            top: '50%',
            transform: 'translateY(-50%)',
            pointerEvents: 'none',
          }}
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="search"
          role="searchbox"
          aria-label={t('serviceSearch.placeholder')}
          value={queryRaw}
          onInput={(e: any) => setQueryRaw(e.currentTarget.value)}
          placeholder={t('serviceSearch.placeholder')}
          style={{
            width: '100%',
            padding: '10px 36px 10px 36px',
            fontSize: '14px',
            border: '1px solid var(--avq-border, #e8eaed)',
            borderRadius: '10px',
            background: 'var(--avq-bg, #ffffff)',
            color: 'var(--avq-fg, #111827)',
            fontFamily: 'inherit',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
        {queryRaw && (
          <button
            type="button"
            onClick={() => {
              setQueryRaw('')
              setQuery('')
            }}
            aria-label="Limpiar búsqueda"
            style={{
              position: 'absolute',
              right: '8px',
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'transparent',
              border: 0,
              cursor: 'pointer',
              padding: '6px',
              color: 'var(--avq-muted-fg, #6b7280)',
              fontFamily: 'inherit',
            }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>

      {/* Category chips */}
      {hasCategoryData && categories.length > 0 && (
        <div
          role="tablist"
          aria-label="Categorías de servicio"
          style={{
            display: 'flex',
            gap: '8px',
            overflowX: 'auto',
            marginBottom: '8px',
            paddingBottom: '4px',
            scrollbarWidth: 'thin',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          <CategoryChip
            label={t('serviceSearch.categoryAll')}
            active={activeCategoryId == null}
            onClick={() => setActiveCategoryId(null)}
          />
          {categories.map(c => (
            <CategoryChip
              key={c.id}
              label={c.name}
              active={activeCategoryId === c.id}
              onClick={() => setActiveCategoryId(c.id)}
            />
          ))}
        </div>
      )}

      {/* List — grouped by category when no chip filter active, flat when filtered */}
      {visibleBuckets.length === 0 ? (
        <div style={{ padding: '40px 0', textAlign: 'center' }}>
          <p style={{ fontSize: '14px', color: 'var(--avq-muted-fg, #6b7280)' }}>{t('serviceSearch.noResults')}</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {visibleBuckets.map(bucket => (
            <div key={bucket.id} style={{ marginTop: '8px' }}>
              {isGrouped && bucket.name && (
                <h3
                  style={{
                    fontSize: '12px',
                    fontWeight: '700',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    margin: '12px 0 4px',
                    color: 'var(--avq-muted-fg, #6b7280)',
                  }}
                >
                  {bucket.name}
                </h3>
              )}
              {bucket.products.map((product, idx) => (
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
          ))}
        </div>
      )}
    </div>
  )
}

function CategoryChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        flexShrink: 0,
        padding: '6px 14px',
        fontSize: '13px',
        fontWeight: '600',
        borderRadius: '999px',
        background: active ? 'var(--avq-accent, #2563eb)' : 'var(--avq-muted, #f8f9fb)',
        color: active ? '#ffffff' : 'var(--avq-fg, #111827)',
        border: active ? '1px solid var(--avq-accent, #2563eb)' : '1px solid var(--avq-border, #e8eaed)',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        fontFamily: 'inherit',
        transition: 'background 0.15s ease, color 0.15s ease',
      }}
    >
      {label}
    </button>
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

  const priceLabel = product.price == null ? t('summary.variablePrice') : formatPriceMXN(Number(product.price))
  const durationLabel = product.duration ? t('service.duration', { min: product.duration }) : null

  return (
    <button
      type="button"
      onClick={onOpen}
      onMouseEnter={() => setIsHov(true)}
      onMouseLeave={() => setIsHov(false)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: '6px',
        width: '100%',
        textAlign: 'left',
        padding: '20px 4px',
        borderTop: isFirst ? 'none' : '1px solid var(--avq-border, #e8eaed)',
        borderLeft: 0,
        borderRight: 0,
        borderBottom: 0,
        background: isHov ? 'var(--avq-muted, #f8f9fb)' : 'transparent',
        cursor: 'pointer',
        transition: 'background 0.15s ease',
        fontFamily: 'inherit',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          width: '100%',
        }}
      >
        <span
          style={{
            fontSize: '15px',
            fontWeight: '600',
            color: 'var(--avq-fg, #111827)',
            letterSpacing: '-0.01em',
          }}
        >
          {product.name}
        </span>
        {isAdded && (
          <span
            style={{
              fontSize: '11px',
              fontWeight: '600',
              padding: '3px 8px',
              borderRadius: '999px',
              background: 'color-mix(in srgb, var(--avq-accent, #2563eb) 14%, var(--avq-bg, #ffffff))',
              color: 'var(--avq-accent, #2563eb)',
              letterSpacing: '0.2px',
            }}
          >
            Añadido
          </span>
        )}
      </div>

      {product.description && (
        <p
          style={{
            margin: 0,
            fontSize: '13px',
            lineHeight: 1.5,
            color: 'var(--avq-muted-fg, #6b7280)',
            display: '-webkit-box',
            WebkitLineClamp: 2 as any,
            WebkitBoxOrient: 'vertical' as any,
            overflow: 'hidden',
            maxWidth: '720px',
          }}
        >
          {product.description}
        </p>
      )}

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          fontSize: '13px',
          color: 'var(--avq-muted-fg, #6b7280)',
          marginTop: '2px',
        }}
      >
        <span
          style={{
            fontWeight: '500',
            color: product.price == null ? 'var(--avq-muted-fg, #6b7280)' : 'var(--avq-fg, #111827)',
          }}
        >
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
