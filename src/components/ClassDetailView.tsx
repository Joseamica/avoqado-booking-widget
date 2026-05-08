import { h } from 'preact'
import type { PublicClassSessionSlot, Product } from '../types'
import type { TFunction } from '../i18n'
import { InstructorAvatar } from './InstructorAvatar'

interface ClassDetailViewProps {
  /** The slot the customer tapped on the listing. */
  slot: PublicClassSessionSlot
  /** The matching product object (resolved by parent from venueInfo.products). */
  product: Product | null
  /** Venue timezone — controls date/time display. */
  timezone: string
  /** Forwarded to the parent. Customer hit "Reservar" — proceed to seat / form. */
  onBook: () => void
  /** Customer hit Atrás — go back to listing. */
  onBack: () => void
  t: TFunction
}

/**
 * Intermediate screen between tapping a class on the listing and entering
 * the booking form / seat picker. Shows the rich context the customer needs
 * to commit: hero image, capacity status, instructor, description, schedule.
 *
 * Mirrors the v2-class-detail design exploration with a 2-col desktop layout
 * (content + sticky booking card) collapsing to a single column with a sticky
 * bottom CTA on mobile.
 */
export function ClassDetailView({
  slot,
  product,
  timezone,
  onBook,
  onBack,
  t,
}: ClassDetailViewProps) {
  const locale: 'en' | 'es' = (t('classList.today') === 'Today' ? 'en' : 'es')
  const isFull = !slot.available || (slot.remaining ?? 0) === 0
  const remaining = slot.remaining ?? 0
  const localeStr = locale === 'es' ? 'es-MX' : 'en-US'

  const startDate = new Date(slot.startsAt)
  const endDate = new Date(slot.endsAt)
  const dateLabel = startDate.toLocaleDateString(localeStr, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: timezone,
  }).replace(/^\w/, c => c.toUpperCase())
  const startTime = startDate.toLocaleTimeString(localeStr, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: locale === 'en',
    timeZone: timezone,
  })
  const endTime = endDate.toLocaleTimeString(localeStr, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: locale === 'en',
    timeZone: timezone,
  })
  const tzShort = (() => {
    try {
      const parts = new Intl.DateTimeFormat(localeStr, { timeZone: timezone, timeZoneName: 'short' }).formatToParts(startDate)
      return parts.find(p => p.type === 'timeZoneName')?.value ?? ''
    } catch { return '' }
  })()

  const instructorName = slot.instructor
    ? `${slot.instructor.firstName} ${slot.instructor.lastName}`.trim()
    : null

  const heroSrc = slot.productImageUrl ?? product?.imageUrl ?? null

  const price = product?.price ?? 0
  const creditCost = product?.creditCost ?? 1
  const requiresCredit = product?.requireCreditForBooking === true
  const upfront = product?.upfrontPolicy

  return (
    <div class="avq-animate-in">
      {/* Back link */}
      <button
        type="button"
        onClick={onBack}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: '6px',
          padding: '4px 0', marginBottom: '14px',
          fontSize: '13px', fontWeight: '500',
          color: 'var(--avq-muted-fg, #6b7280)',
          background: 'none', border: 'none', cursor: 'pointer',
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
        {t('actions.goBack')}
      </button>

      <div class="avq-classdetail-layout">
        <div class="avq-classdetail-main">
          {/* Hero image */}
          {heroSrc ? (
            <div style={{
              width: '100%', aspectRatio: '16/9', maxHeight: '320px',
              borderRadius: '14px', overflow: 'hidden',
              backgroundImage: `url('${heroSrc}')`,
              backgroundSize: 'cover', backgroundPosition: 'center',
              marginBottom: '20px',
            }} />
          ) : null}

          {/* Status pill */}
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            padding: '4px 10px', borderRadius: '999px',
            background: isFull ? '#fee2e2' : '#dcfce7',
            color: isFull ? '#b91c1c' : '#166534',
            fontSize: '11px', fontWeight: '700', letterSpacing: '0.3px',
            marginBottom: '12px',
          }}>
            <span style={{
              width: '5px', height: '5px', borderRadius: '50%',
              background: isFull ? '#b91c1c' : '#166534',
            }} />
            {isFull ? t('classList.fullClass') : t('classList.spotsLeftBadge', { count: remaining })}
          </span>

          {/* Title */}
          <h1 style={{
            margin: '0 0 12px',
            fontSize: '28px', fontWeight: '700',
            letterSpacing: '-0.8px', lineHeight: 1.1,
            color: 'var(--avq-fg, #111827)',
          }}>
            {slot.productName}
          </h1>

          {/* Tags */}
          <div style={{ display: 'flex', gap: '6px', marginBottom: '24px', flexWrap: 'wrap' }}>
            {product?.type === 'CLASS' && <Tag>{t('service.groupClass')}</Tag>}
            {product?.duration ? <Tag>{product.duration} min</Tag> : null}
          </div>

          {/* Meta grid */}
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 22px',
            padding: '18px 20px', background: 'var(--avq-muted, #f8f9fb)',
            borderRadius: '14px', marginBottom: '24px',
          }} class="avq-meta-grid">
            <MetaItem icon={<CalendarIcon />} label={t('classDetail.fecha')} value={dateLabel} />
            <MetaItem
              icon={<ClockIcon />}
              label={t('classDetail.hora')}
              value={tzShort ? `${startTime} — ${endTime} ${tzShort}` : `${startTime} — ${endTime}`}
            />
            {slot.capacity != null && (
              <MetaItem
                icon={<UsersIcon />}
                label={t('classDetail.cupo')}
                value={`${slot.capacity} ${t('classDetail.peopleMax')} · ${(slot.enrolled ?? 0)} ${t('classDetail.enrolled')}`}
              />
            )}
          </div>

          {/* About */}
          {product?.description && (
            <div style={{ marginBottom: '24px' }}>
              <h2 style={{
                margin: '0 0 10px', fontSize: '16px', fontWeight: '700',
                color: 'var(--avq-fg, #111827)',
              }}>{t('classDetail.about')}</h2>
              <p style={{
                margin: 0, fontSize: '14px',
                color: 'var(--avq-muted-fg, #6b7280)', lineHeight: 1.6,
                whiteSpace: 'pre-wrap',
              }}>{product.description}</p>
            </div>
          )}

          {/* Instructor card */}
          {slot.instructor && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '12px',
              padding: '14px 16px',
              background: 'var(--avq-bg, #ffffff)',
              border: '1px solid var(--avq-border, #e8eaed)',
              borderRadius: '14px',
              marginBottom: '24px',
            }}>
              <InstructorAvatar instructor={slot.instructor} size={48} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: '14px', fontWeight: '700', color: 'var(--avq-fg, #111827)' }}>
                  {instructorName}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--avq-muted-fg, #6b7280)', marginTop: '2px' }}>
                  {t('classDetail.aboutInstructor')}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Booking card — desktop sticky right rail; mobile renders below */}
        <aside class="avq-classdetail-booking">
          <div style={{
            background: 'var(--avq-bg, #ffffff)',
            border: '1px solid var(--avq-border, #e8eaed)',
            borderRadius: '16px',
            padding: '22px',
            boxShadow: '0 12px 28px rgba(15,15,16,0.06)',
          }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '4px' }}>
              <span style={{ fontSize: '26px', fontWeight: '700', letterSpacing: '-0.6px', color: 'var(--avq-fg, #111827)' }}>
                {price > 0 ? formatPrice(price, locale) : t('payment.payOptionalHint').includes('libre') ? '—' : (t('classDetail.free'))}
              </span>
              {creditCost > 0 && (
                <span style={{ fontSize: '13px', color: 'var(--avq-muted-fg, #6b7280)' }}>
                  {creditCost === 1
                    ? t('classDetail.orOneCredit')
                    : t('classDetail.orNCredits', { count: creditCost })}
                </span>
              )}
            </div>
            <p style={{ margin: '0 0 16px', fontSize: '12px', color: 'var(--avq-muted-fg, #6b7280)' }}>
              {upfront === 'required'
                ? t('classDetail.payAtBooking')
                : upfront === 'at_venue'
                  ? t('classDetail.payAtVenue')
                  : t('classDetail.payOptional')}
            </p>

            <button
              type="button"
              onClick={onBook}
              disabled={isFull}
              style={{
                width: '100%',
                padding: '14px 16px',
                background: isFull ? 'var(--avq-muted-fg, #9ca3af)' : 'var(--avq-accent, #6366F1)',
                color: '#ffffff',
                fontSize: '14px',
                fontWeight: '700',
                border: 0,
                borderRadius: '12px',
                cursor: isFull ? 'not-allowed' : 'pointer',
              }}
            >
              {requiresCredit
                ? t('classDetail.bookWithCredit')
                : t('classDetail.bookCta')}
            </button>
          </div>
        </aside>
      </div>

      <style>{`
        .avq-classdetail-layout { display: grid; grid-template-columns: 1fr; gap: 0; }
        .avq-classdetail-booking { margin-top: 16px; }
        @media (min-width: 880px) {
          .avq-classdetail-layout {
            grid-template-columns: minmax(0, 1fr) 320px;
            gap: 28px;
            align-items: start;
          }
          .avq-classdetail-main { min-width: 0; }
          .avq-classdetail-main > * { min-width: 0; }
          .avq-classdetail-booking { margin-top: 0; position: sticky; top: 24px; }
        }
        @media (max-width: 480px) {
          .avq-meta-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  )
}

function Tag({ children }: { children: any }) {
  return (
    <span style={{
      padding: '4px 10px',
      background: 'color-mix(in srgb, var(--avq-accent, #6366f1) 12%, var(--avq-bg, #fff))',
      color: 'var(--avq-accent, #6366f1)',
      borderRadius: '6px',
      fontSize: '11px', fontWeight: '700', letterSpacing: '0.3px',
      textTransform: 'uppercase',
    }}>{children}</span>
  )
}

function MetaItem({
  icon,
  label,
  value,
}: {
  icon: any
  label: string
  value: string
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
      <span style={{ color: 'var(--avq-muted-fg, #6b7280)', flexShrink: 0, marginTop: '2px' }}>{icon}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: '10px', fontWeight: '700', letterSpacing: '0.5px', color: 'var(--avq-muted-fg, #6b7280)', textTransform: 'uppercase' }}>
          {label}
        </div>
        <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--avq-fg, #111827)', marginTop: '2px' }}>
          {value}
        </div>
      </div>
    </div>
  )
}

function formatPrice(amount: number, locale: 'en' | 'es'): string {
  try {
    return new Intl.NumberFormat(locale === 'es' ? 'es-MX' : 'en-US', {
      style: 'currency', currency: 'MXN', maximumFractionDigits: 0,
    }).format(amount)
  } catch {
    return `$${Math.round(amount)}`
  }
}

function CalendarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  )
}
function ClockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  )
}
function UsersIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  )
}
