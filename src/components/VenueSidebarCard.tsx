import { h } from 'preact'
import type { PublicVenueInfo, CreditPackPublic } from '../types'
import type { CustomerInfo } from '../state/booking'
import type { TFunction } from '../i18n'

interface VenueSidebarCardProps {
  info: PublicVenueInfo
  creditPacks: CreditPackPublic[]
  onBuyPack: (packId: string) => void
  customerInfo: CustomerInfo | null
  t: TFunction
}

/**
 * Sticky sidebar shown on the /classes page (desktop only). Mirrors the
 * v2-classes-list mockup: small venue card with name, meta rows (address,
 * phone, timezone) and a "Comprar paquete" CTA when packs exist.
 *
 * Mobile already shows the same affordances via the mini-chip + sticky-bottom
 * pack CTA inside ClassSessionList — the parent layout simply hides this
 * aside under 880px to avoid duplication.
 */
export function VenueSidebarCard({
  info,
  creditPacks,
  onBuyPack,
  customerInfo,
  t,
}: VenueSidebarCardProps) {
  const cheapestPack = creditPacks.length
    ? creditPacks.reduce((min, p) => (p.price < min.price ? p : min), creditPacks[0])
    : null
  const totalSessions = cheapestPack
    ? cheapestPack.items.reduce((sum, i) => sum + i.quantity, 0)
    : 0

  return (
    <div
      style={{
        background: 'var(--avq-bg, #ffffff)',
        border: '1px solid var(--avq-border, #e8eaed)',
        borderRadius: '16px',
        padding: '20px',
        boxShadow: '0 1px 2px rgba(15,15,16,0.04)',
      }}
    >
      <div style={{
        fontSize: '10px', fontWeight: '700', letterSpacing: '1.5px',
        color: 'var(--avq-muted-fg, #6b7280)', textTransform: 'uppercase',
        marginBottom: '8px',
      }}>
        {info.type ?? 'Venue'}
      </div>

      <h3 style={{
        margin: '0 0 4px',
        fontSize: '16px', fontWeight: '700', letterSpacing: '-0.3px',
        color: 'var(--avq-fg, #111827)',
      }}>
        {info.name}
      </h3>

      {info.address && (
        <p style={{
          margin: '0 0 14px', fontSize: '12px',
          color: 'var(--avq-muted-fg, #6b7280)', lineHeight: 1.5,
        }}>
          {info.address}
        </p>
      )}

      {/* Logged-in customer chip */}
      {customerInfo && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '10px',
          padding: '10px 12px', background: 'var(--avq-muted, #f8f9fb)',
          borderRadius: '10px', marginBottom: '14px',
        }}>
          <div style={{
            width: '32px', height: '32px', borderRadius: '50%',
            background: 'var(--avq-accent, #6366F1)', color: 'white',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '12px', fontWeight: '700',
          }}>
            {(customerInfo.firstName ?? customerInfo.email ?? '?').charAt(0).toUpperCase()}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--avq-fg, #111827)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {customerInfo.firstName ?? customerInfo.email ?? ''}
            </div>
            <div style={{ fontSize: '10px', color: 'var(--avq-muted-fg, #6b7280)' }}>
              {t('form.bookingAs', { name: customerInfo.firstName ?? '' }).replace(/\(\)\s*/, '')}
            </div>
          </div>
        </div>
      )}

      <MetaRow
        icon={<MapPinIcon />}
        label="Ubicación"
        value={info.address ? info.address.split(',')[0] : '—'}
      />
      {info.phone && (
        <MetaRow icon={<PhoneIcon />} label="Teléfono" value={info.phone} />
      )}
      <MetaRow
        icon={<ClockIcon />}
        label="Zona horaria"
        value={info.timezone.split('/').pop()?.replace(/_/g, ' ') ?? info.timezone}
      />

      {cheapestPack && (
        <button
          type="button"
          onClick={() => onBuyPack(cheapestPack.id)}
          style={{
            width: '100%',
            marginTop: '16px',
            padding: '14px 16px',
            background: 'var(--avq-muted, #f8f9fb)',
            border: '1px solid var(--avq-border, #e8eaed)',
            borderRadius: '12px',
            cursor: 'pointer',
            textAlign: 'left',
            transition: 'border-color .15s ease',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--avq-accent, #6366F1)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--avq-border, #e8eaed)' }}
        >
          <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--avq-fg, #111827)', marginBottom: '2px' }}>
            {cheapestPack.name} →
          </div>
          <div style={{ fontSize: '11px', color: 'var(--avq-muted-fg, #6b7280)' }}>
            {totalSessions > 0 ? `${totalSessions} ${t('landing.packSummary', { count: totalSessions }).split(' ').slice(1).join(' ')}` : ''}
            {totalSessions > 0 && cheapestPack.price ? ' · ' : ''}
            {cheapestPack.price ? formatPrice(cheapestPack.price, cheapestPack.currency) : ''}
          </div>
        </button>
      )}
    </div>
  )
}

function MetaRow({
  icon,
  label,
  value,
}: {
  icon: any
  label: string
  value: string
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '8px',
      padding: '10px 0',
      borderTop: '1px solid var(--avq-border, #e8eaed)',
      fontSize: '13px', color: 'var(--avq-fg, #111827)',
    }}>
      <span style={{ color: 'var(--avq-muted-fg, #6b7280)', display: 'inline-flex' }}>{icon}</span>
      <span style={{ color: 'var(--avq-muted-fg, #6b7280)', marginRight: 'auto' }}>{label}</span>
      <span style={{ fontWeight: '600', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  )
}

function formatPrice(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('es-MX', { style: 'currency', currency: currency || 'MXN', maximumFractionDigits: 0 }).format(amount)
  } catch {
    return `$${Math.round(amount)}`
  }
}

function MapPinIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  )
}
function PhoneIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  )
}
function ClockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  )
}
