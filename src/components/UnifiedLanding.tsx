import { h } from 'preact'
import { useState } from 'preact/hooks'
import type { Product, CreditPackPublic } from '../types'
import type { TFunction } from '../i18n'
import { Spinner } from './ui/Spinner'

interface UnifiedLandingProps {
  /** Product list from venueInfo — used to decide which CTAs to surface. */
  products: Product[]
  /** Credit packs the venue offers (loaded async — empty array = none configured). */
  creditPacks: CreditPackPublic[]
  /** Customer picked the appointments path. Switches flowType + URL. */
  onPickAppointments: () => void
  /** Customer picked the classes path. Switches flowType + URL. */
  onPickClasses: () => void
  /** Customer wants to buy a specific credit pack — opens checkout flow. */
  onBuyPack: (packId: string) => void
  /** Pack ID currently being processed (after checkout submit). */
  buyingPackId: string | null
  /** Tab to start on. Defaults to 'book'; switches to 'packs' when the customer
   *  just returned from a successful Stripe checkout so they immediately see
   *  the credits they just bought. */
  initialTab?: Tab
  t: TFunction
}

export type Tab = 'book' | 'packs'

/**
 * Square-style picker shown when the customer lands on /<slug> with no flow
 * segment. Two big CTAs (appointments / classes) plus a tab to browse + buy
 * credit packs via Stripe checkout (Phase 4).
 *
 * If the venue only has one type of product (e.g. only classes), the parent
 * skips this landing and routes directly to the matching flow — so the picker
 * never shows when it's pointless.
 */
export function UnifiedLanding({
  products,
  creditPacks,
  onPickAppointments,
  onPickClasses,
  onBuyPack,
  buyingPackId,
  initialTab,
  t,
}: UnifiedLandingProps) {
  const [tab, setTab] = useState<Tab>(initialTab ?? 'book')
  const hasClasses = products.some(p => p.type === 'CLASS')
  const hasAppointments = products.some(p => p.type !== 'CLASS')
  const hasPacks = creditPacks.length > 0

  return (
    <div class="avq-animate-in" style={{ padding: '4px 0 16px' }}>
      {/* Tab switcher — only shown when packs exist; otherwise the CTAs alone are clearer */}
      {hasPacks && (
        <div
          role="tablist"
          style={{
            display: 'flex',
            gap: '6px',
            padding: '4px',
            background: 'var(--avq-muted, #f3f4f6)',
            borderRadius: '12px',
            marginBottom: '20px',
          }}
        >
          <TabButton active={tab === 'book'} onClick={() => setTab('book')}>
            {t('landing.tabBook')}
          </TabButton>
          <TabButton active={tab === 'packs'} onClick={() => setTab('packs')}>
            {t('landing.tabPacks')}
          </TabButton>
        </div>
      )}

      {tab === 'book' ? (
        <BookTab
          hasAppointments={hasAppointments}
          hasClasses={hasClasses}
          onPickAppointments={onPickAppointments}
          onPickClasses={onPickClasses}
          t={t}
        />
      ) : (
        <PacksTab
          packs={creditPacks}
          onBuyPack={onBuyPack}
          buyingPackId={buyingPackId}
          t={t}
        />
      )}
    </div>
  )
}

// ─── Tab: Book (two CTAs) ─────────────────────────────────────────────

function BookTab({
  hasAppointments,
  hasClasses,
  onPickAppointments,
  onPickClasses,
  t,
}: {
  hasAppointments: boolean
  hasClasses: boolean
  onPickAppointments: () => void
  onPickClasses: () => void
  t: TFunction
}) {
  return (
    <div>
      <h2 style={titleStyle()}>{t('landing.title')}</h2>
      <p style={subtitleStyle()}>{t('landing.subtitle')}</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {hasAppointments && (
          <button type="button" onClick={onPickAppointments} style={ctaCardStyle()}>
            <div style={ctaIconStyle('accent')}>
              <CalendarIcon />
            </div>
            <div style={{ textAlign: 'left', flex: 1 }}>
              <div style={ctaTitleStyle()}>{t('landing.appointmentsTitle')}</div>
              <div style={ctaSubtitleStyle()}>{t('landing.appointmentsSubtitle')}</div>
            </div>
            <ChevronIcon />
          </button>
        )}

        {hasClasses && (
          <button type="button" onClick={onPickClasses} style={ctaCardStyle()}>
            <div style={ctaIconStyle('success')}>
              <YogaIcon />
            </div>
            <div style={{ textAlign: 'left', flex: 1 }}>
              <div style={ctaTitleStyle()}>{t('landing.classesTitle')}</div>
              <div style={ctaSubtitleStyle()}>{t('landing.classesSubtitle')}</div>
            </div>
            <ChevronIcon />
          </button>
        )}

        {!hasAppointments && !hasClasses && (
          <div style={emptyStateStyle()}>{t('service.noProducts')}</div>
        )}
      </div>
    </div>
  )
}

// ─── Tab: Packs (Stripe checkout) ─────────────────────────────────────

function PacksTab({
  packs,
  onBuyPack,
  buyingPackId,
  t,
}: {
  packs: CreditPackPublic[]
  onBuyPack: (packId: string) => void
  buyingPackId: string | null
  t: TFunction
}) {
  return (
    <div>
      <h2 style={titleStyle()}>{t('landing.packsTitle')}</h2>
      <p style={subtitleStyle()}>{t('landing.packsSubtitle')}</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {packs.map(pack => (
          <PackCard key={pack.id} pack={pack} onBuy={onBuyPack} loading={buyingPackId === pack.id} t={t} />
        ))}
      </div>
    </div>
  )
}

function PackCard({
  pack,
  onBuy,
  loading,
  t,
}: {
  pack: CreditPackPublic
  onBuy: (id: string) => void
  loading: boolean
  t: TFunction
}) {
  const totalSessions = pack.items.reduce((sum, i) => sum + i.quantity, 0)
  const productNames = Array.from(new Set(pack.items.map(i => i.product.name)))
  const summary =
    productNames.length === 1
      ? `${totalSessions} × ${productNames[0]}`
      : t('landing.packSummary', { count: totalSessions })

  return (
    <div
      style={{
        padding: '16px',
        borderRadius: '14px',
        border: '1px solid var(--avq-border, #e8eaed)',
        background: 'var(--avq-bg, #ffffff)',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '15px', fontWeight: '600', color: 'var(--avq-fg, #111827)' }}>{pack.name}</div>
          {pack.description && (
            <div style={{ fontSize: '13px', color: 'var(--avq-muted-fg, #6b7280)', marginTop: '2px', lineHeight: '1.4' }}>
              {pack.description}
            </div>
          )}
          <div style={{ fontSize: '12px', color: 'var(--avq-muted-fg, #6b7280)', marginTop: '6px' }}>{summary}</div>
          {pack.validityDays != null && pack.validityDays > 0 && (
            <div style={{ fontSize: '12px', color: 'var(--avq-muted-fg, #9ca3af)', marginTop: '2px' }}>
              {t('landing.validity', { days: pack.validityDays })}
            </div>
          )}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '17px', fontWeight: '700', color: 'var(--avq-fg, #111827)', whiteSpace: 'nowrap' }}>
            {formatPrice(pack.price, pack.currency)}
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={() => onBuy(pack.id)}
        disabled={loading}
        style={{
          width: '100%',
          padding: '11px 16px',
          borderRadius: '10px',
          border: 'none',
          background: loading ? 'var(--avq-muted-fg, #9ca3af)' : 'var(--avq-accent, #6366f1)',
          color: '#ffffff',
          fontSize: '14px',
          fontWeight: '600',
          cursor: loading ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
        }}
      >
        {loading ? <Spinner size={14} /> : null}
        {loading ? t('landing.processing') : t('landing.buyButton')}
      </button>
    </div>
  )
}

// ─── shared bits ──────────────────────────────────────────────────────

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: any }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        flex: 1,
        padding: '8px 12px',
        borderRadius: '8px',
        border: 'none',
        background: active ? 'var(--avq-bg, #ffffff)' : 'transparent',
        color: active ? 'var(--avq-fg, #111827)' : 'var(--avq-muted-fg, #6b7280)',
        fontSize: '13px',
        fontWeight: '600',
        cursor: 'pointer',
        boxShadow: active ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
        transition: 'background 0.15s ease, color 0.15s ease',
      }}
    >
      {children}
    </button>
  )
}

function formatPrice(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('es-MX', { style: 'currency', currency: currency || 'MXN' }).format(amount)
  } catch {
    return `$${amount.toFixed(2)}`
  }
}

function titleStyle(): h.JSX.CSSProperties {
  return { fontSize: '20px', fontWeight: '600', color: 'var(--avq-fg, #111827)', margin: '0 0 6px', textAlign: 'center' }
}
function subtitleStyle(): h.JSX.CSSProperties {
  return { fontSize: '14px', color: 'var(--avq-muted-fg, #6b7280)', margin: '0 0 24px', textAlign: 'center' }
}
function ctaCardStyle(): h.JSX.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: '14px',
    width: '100%',
    padding: '18px 16px',
    borderRadius: '14px',
    border: '1px solid var(--avq-border, #e8eaed)',
    background: 'var(--avq-bg, #ffffff)',
    cursor: 'pointer',
    transition: 'border-color 0.15s ease, transform 0.05s ease',
  }
}
function ctaIconStyle(variant: 'accent' | 'success'): h.JSX.CSSProperties {
  const bg =
    variant === 'accent'
      ? 'color-mix(in srgb, var(--avq-accent, #6366f1) 12%, var(--avq-bg))'
      : 'var(--avq-success-bg, #ecfdf5)'
  const fg =
    variant === 'accent' ? 'var(--avq-accent, #6366f1)' : 'var(--avq-success-fg, #047857)'
  return {
    width: '48px',
    height: '48px',
    borderRadius: '12px',
    background: bg,
    color: fg,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  }
}
function ctaTitleStyle(): h.JSX.CSSProperties {
  return { fontSize: '15px', fontWeight: '600', color: 'var(--avq-fg, #111827)', marginBottom: '2px' }
}
function ctaSubtitleStyle(): h.JSX.CSSProperties {
  return { fontSize: '13px', color: 'var(--avq-muted-fg, #6b7280)', lineHeight: '1.35' }
}
function emptyStateStyle(): h.JSX.CSSProperties {
  return { padding: '32px 16px', textAlign: 'center', color: 'var(--avq-muted-fg, #6b7280)', fontSize: '14px' }
}

// ─── inline icons ─────────────────────────────────────────────────────

function CalendarIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  )
}

function YogaIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="5" r="2" />
      <path d="M12 7v4l-3 4 1 6m2-10 3 4-1 6" />
      <path d="M5 11h14" />
    </svg>
  )
}

function ChevronIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--avq-muted-fg, #9ca3af)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style={{ flexShrink: 0 }}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}
