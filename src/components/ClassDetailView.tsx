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
    year: 'numeric',
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
      <div class="avq-classdetail-layout">
        <div class="avq-classdetail-main">
          {/* Breadcrumb — Square: "Todas las clases / nombre". The leftmost
           * segment is a real button (returns to the listing), the rightmost
           * is the current class name in black bold. */}
          <nav aria-label="breadcrumb" style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            marginBottom: '14px',
            fontSize: '13px',
          }}>
            <button
              type="button"
              onClick={onBack}
              style={{
                background: 'none', border: 'none', padding: 0,
                color: 'var(--avq-muted-fg, #6b7280)',
                fontSize: '13px', fontWeight: '500',
                cursor: 'pointer',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--avq-fg, #111827)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--avq-muted-fg, #6b7280)' }}
            >
              {t('classDetail.breadcrumbAll')}
            </button>
            <span style={{ color: 'var(--avq-muted-fg, #cbd1d8)' }}>/</span>
            <span style={{
              color: 'var(--avq-fg, #111827)', fontWeight: '600',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {slot.productName}
            </span>
          </nav>

          {/* Status pill — kept as-is, Square also uses a green/red pill */}
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            padding: '4px 10px', borderRadius: '999px',
            background: isFull ? '#fee2e2' : '#dcfce7',
            color: isFull ? '#b91c1c' : '#166534',
            fontSize: '12px', fontWeight: '600',
            marginBottom: '14px',
          }}>
            <span style={{
              width: '5px', height: '5px', borderRadius: '50%',
              background: isFull ? '#b91c1c' : '#166534',
            }} />
            {isFull ? t('classList.fullClass') : t('classList.spotsLeftBadge', { count: remaining })}
          </span>

          {/* Title — Square uses a big serif-y black. 32px feels right for the
           * widget's container width. */}
          <h1 style={{
            margin: '0 0 18px',
            fontSize: '32px', fontWeight: '700',
            letterSpacing: '-0.9px', lineHeight: 1.1,
            color: 'var(--avq-fg, #111827)',
          }}>
            {slot.productName}
          </h1>

          {/* Inline meta — Square pattern: price on its own line, date next,
           * "time — time" next. No card, no icons, no grid. Plain lines. */}
          <div style={{
            display: 'flex', flexDirection: 'column', gap: '4px',
            marginBottom: '24px',
            fontSize: '15px', color: 'var(--avq-fg, #111827)',
          }}>
            <div style={{ fontWeight: '600' }}>
              {price > 0 ? formatPrice(price, locale) : t('classDetail.free')}
            </div>
            <div>{dateLabel}</div>
            <div>{tzShort ? `${startTime} – ${endTime} ${tzShort}` : `${startTime} – ${endTime}`}</div>
          </div>

          {/* Optional hero image — kept but smaller (Square doesn't show one,
           * but if the venue uploaded one it's still useful context). Drops
           * from before-title to after-meta so the hierarchy reads cleanly. */}
          {heroSrc ? (
            <div style={{
              width: '100%', aspectRatio: '16/9', maxHeight: '220px',
              borderRadius: '10px', overflow: 'hidden',
              backgroundImage: `url('${heroSrc}')`,
              backgroundSize: 'cover', backgroundPosition: 'center',
              marginBottom: '20px',
            }} />
          ) : null}

          {/* Description — short paragraph, gray, no heading (Square also
           * skips the "About" heading when the description is one-liner). */}
          {product?.description && (
            <p style={{
              margin: '0 0 24px', fontSize: '14px',
              color: 'var(--avq-muted-fg, #6b7280)', lineHeight: 1.6,
              whiteSpace: 'pre-wrap',
            }}>
              {product.description}
            </p>
          )}

          {/* Divider — separates Class block from Staff block (Square pattern) */}
          <div style={{
            height: '1px', background: 'var(--avq-border, #e8eaed)',
            margin: '0 0 22px',
          }} />

          {/* Staff section — Square: bold heading + avatar circle + name row,
           * no card / no border. Renders only when an instructor is assigned. */}
          {slot.instructor && (
            <div style={{ marginBottom: '24px' }}>
              <h2 style={{
                margin: '0 0 12px', fontSize: '17px', fontWeight: '700',
                color: 'var(--avq-fg, #111827)', letterSpacing: '-0.01em',
              }}>
                {t('classDetail.staff')}
              </h2>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <InstructorAvatar instructor={slot.instructor} size={40} />
                <div style={{
                  fontSize: '15px', fontWeight: '500',
                  color: 'var(--avq-fg, #111827)',
                }}>
                  {instructorName}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Booking sidebar — sticky right rail with the CTA + credits/upsell.
         * Square doesn't have a sidebar here, but we keep one to surface the
         * pack upsell + credits status (Avoqado pattern, consistent with the
         * rest of the widget). Price is already shown in the main column so
         * the sidebar only repeats it as a small caption. */}
        <aside class="avq-classdetail-booking">
          <div style={{
            background: 'var(--avq-bg, #ffffff)',
            border: '1px solid var(--avq-border, #e8eaed)',
            borderRadius: '14px',
            padding: '18px',
          }}>
            {/* Caption: "$25 · pago al reservar" — small, gray, single line.
             * Avoids duplicating the main column's prominent price. */}
            <div style={{
              display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: '6px',
              marginBottom: '6px',
              fontSize: '13px', color: 'var(--avq-muted-fg, #6b7280)',
            }}>
              <span style={{ fontWeight: '600', color: 'var(--avq-fg, #111827)' }}>
                {price > 0 ? formatPrice(price, locale) : t('classDetail.free')}
              </span>
              {creditCost > 0 && (
                <span>
                  · {creditCost === 1
                    ? t('classDetail.orOneCredit')
                    : t('classDetail.orNCredits', { count: creditCost })}
                </span>
              )}
            </div>
            <p style={{ margin: '0 0 14px', fontSize: '12px', color: 'var(--avq-muted-fg, #6b7280)', lineHeight: 1.5 }}>
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
                background: isFull ? 'var(--avq-muted-fg, #9ca3af)' : 'var(--avq-accent, #2563eb)',
                color: '#ffffff',
                fontSize: '15px',
                fontWeight: '600',
                border: 0,
                borderRadius: '12px',
                cursor: isFull ? 'not-allowed' : 'pointer',
                transition: 'background 0.15s ease',
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
      `}</style>
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

