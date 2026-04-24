import { h } from 'preact'
import { useState, useEffect } from 'preact/hooks'
import type { PublicReservationDetail } from '../types'
import type { TFunction } from '../i18n'
import { Spinner } from './ui/Spinner'
import { Button } from './ui/Button'
import { Textarea } from './ui/Input'
import * as api from '../api/booking'

interface ManageBookingProps {
  venueSlug: string
  cancelSecret: string
  timezone: string
  t: TFunction
  onBack: () => void
}

const statusConfig: Record<string, { bg: string; text: string }> = {
  PENDING: { bg: '#fef9c3', text: '#854d0e' },
  CONFIRMED: { bg: '#dcfce7', text: '#166534' },
  CHECKED_IN: { bg: '#dbeafe', text: '#1e40af' },
  COMPLETED: { bg: '#f3f4f6', text: '#1f2937' },
  CANCELLED: { bg: '#fee2e2', text: '#991b1b' },
  NO_SHOW: { bg: '#ffedd5', text: '#9a3412' },
}

export function ManageBooking({ venueSlug, cancelSecret, timezone, t, onBack }: ManageBookingProps) {
  const [reservation, setReservation] = useState<PublicReservationDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCancel, setShowCancel] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelling, setCancelling] = useState(false)

  useEffect(() => {
    api.getReservation(venueSlug, cancelSecret)
      .then(setReservation)
      .catch(() => setError(t('errors.reservationNotFound')))
      .finally(() => setLoading(false))
  }, [venueSlug, cancelSecret])

  async function handleCancel() {
    setCancelling(true)
    try {
      await api.cancelReservation(venueSlug, cancelSecret, cancelReason || undefined)
      const updated = await api.getReservation(venueSlug, cancelSecret)
      setReservation(updated)
      setShowCancel(false)
    } catch {
      setError(t('errors.generic'))
    } finally {
      setCancelling(false)
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '64px 0' }}>
        <Spinner size={28} />
      </div>
    )
  }

  if (error || !reservation) {
    return (
      <div class="avq-animate-in" style={{ padding: '48px 0', textAlign: 'center' }}>
        <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'var(--avq-muted, #f8f9fb)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--avq-muted-fg, #9ca3af)" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        </div>
        <p style={{ fontWeight: '600', color: 'var(--avq-fg, #111827)', marginBottom: '4px' }}>{t('errors.reservationNotFound')}</p>
        <p style={{ fontSize: '14px', color: 'var(--avq-muted-fg, #6b7280)', marginBottom: '20px' }}>{t('errors.reservationNotFoundDescription')}</p>
        <Button variant="outline" onClick={onBack}>{t('actions.goBack')}</Button>
      </div>
    )
  }

  const isCancelled = reservation.status === 'CANCELLED'
  const startDate = new Date(reservation.startsAt)
  const endDate = new Date(reservation.endsAt)
  const dateStr = startDate.toLocaleDateString(undefined, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: timezone,
  })
  const timeStr = `${startDate.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', timeZone: timezone })} - ${endDate.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', timeZone: timezone })}`

  const sc = statusConfig[reservation.status] ?? statusConfig.COMPLETED

  return (
    <div class="avq-animate-in">
      <h2 style={{ fontSize: '18px', fontWeight: '700', color: 'var(--avq-fg, #111827)', marginBottom: '20px' }}>
        {t('manage.title')}
      </h2>

      {/* Status */}
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
        <span style={{
          borderRadius: '8px', padding: '4px 12px',
          fontSize: '12px', fontWeight: '600',
          background: sc.bg, color: sc.text,
          letterSpacing: '0.02em',
        }}>
          {t(`status.${reservation.status}`)}
        </span>
      </div>

      {/* Code */}
      <div style={{
        borderRadius: '14px', padding: '16px',
        background: 'var(--avq-muted, #f8f9fb)',
        border: '1px solid var(--avq-border, #e8eaed)',
        textAlign: 'center', marginBottom: '16px',
      }}>
        <p style={{ margin: '0 0 4px', fontSize: '12px', color: 'var(--avq-muted-fg, #6b7280)', fontWeight: '500', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
          {t('confirmation.code')}
        </p>
        <p style={{ margin: 0, fontSize: '26px', fontWeight: '700', letterSpacing: '0.06em', color: 'var(--avq-fg, #111827)' }}>
          {reservation.confirmationCode}
        </p>
      </div>

      {/* Refund result — visible after a CANCELLED transition that returned credits */}
      {isCancelled && reservation.cancellation && reservation.cancellation.creditsRefundable > 0 && (
        <div
          role="status"
          aria-live="polite"
          style={{
            marginBottom: '16px', padding: '12px 14px',
            borderRadius: '12px',
            background: 'var(--avq-success-bg)',
            border: '1px solid var(--avq-success-border)',
            color: 'var(--avq-success-fg)', fontSize: '13px', fontWeight: '500',
            display: 'flex', alignItems: 'center', gap: '10px',
          }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--avq-success-accent)" stroke-width="2" aria-hidden="true">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
          </svg>
          {t('manage.refundedSuccess', { count: reservation.cancellation.creditsRefundable })}
        </div>
      )}

      {/* Details */}
      <div style={{
        borderRadius: '14px', border: '1px solid var(--avq-border, #e8eaed)',
        padding: '16px', marginBottom: '20px',
        display: 'flex', flexDirection: 'column', gap: '14px',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
          <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: 'var(--avq-muted, #f8f9fb)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--avq-muted-fg, #6b7280)" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          </div>
          <div>
            <p style={{ margin: 0, fontSize: '14px', fontWeight: '500', color: 'var(--avq-fg, #111827)', textTransform: 'capitalize' }}>{dateStr}</p>
            <p style={{ margin: '2px 0 0', fontSize: '13px', color: 'var(--avq-muted-fg, #6b7280)' }}>{timeStr}</p>
          </div>
        </div>

        {reservation.product && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: 'var(--avq-muted, #f8f9fb)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--avq-muted-fg, #6b7280)" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            </div>
            <p style={{ margin: 0, fontSize: '14px', color: 'var(--avq-fg, #111827)' }}>{reservation.product.name}</p>
          </div>
        )}

        {reservation.specialRequests && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
            <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: 'var(--avq-muted, #f8f9fb)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--avq-muted-fg, #6b7280)" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            </div>
            <div>
              <p style={{ margin: '0 0 2px', fontSize: '13px', fontWeight: '500', color: 'var(--avq-fg, #111827)' }}>{t('manage.specialRequests')}</p>
              <p style={{ margin: 0, fontSize: '13px', color: 'var(--avq-muted-fg, #6b7280)' }}>{reservation.specialRequests}</p>
            </div>
          </div>
        )}
      </div>

      {/* Cancel dialog inline */}
      {showCancel && (
        <div style={{
          borderRadius: '14px', border: '1.5px solid var(--avq-danger-border)',
          background: 'var(--avq-danger-bg)', padding: '16px',
          marginBottom: '16px',
        }}>
          <h3 style={{ margin: '0 0 4px', fontSize: '15px', fontWeight: '600', color: 'var(--avq-danger-fg)' }}>{t('manage.cancelTitle')}</h3>
          <p style={{ margin: '0 0 14px', fontSize: '13px', color: 'var(--avq-danger-accent)', opacity: 0.9 }}>{t('manage.cancelDescription')}</p>

          {/* Refund policy preview — only when this booking actually used credits */}
          {reservation.cancellation && reservation.cancellation.creditsUsed > 0 && (
            <div style={{
              marginBottom: '14px', padding: '11px 13px',
              borderRadius: '10px',
              border: '1px solid var(--avq-warning-border)',
              background: 'var(--avq-warning-bg)',
              fontSize: '12px', color: 'var(--avq-warning-fg)',
              lineHeight: '1.5',
            }}>
              {reservation.cancellation.creditsRefundable > 0 ? (
                <span>{t('manage.refundPreview', {
                  refunded: reservation.cancellation.creditsRefundable,
                  total: reservation.cancellation.creditsUsed,
                })}</span>
              ) : (
                <span>{t('manage.noRefund', { count: reservation.cancellation.creditsUsed })}</span>
              )}
            </div>
          )}

          <div style={{ marginBottom: '14px' }}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', color: 'var(--avq-danger-fg)', marginBottom: '6px' }}>{t('manage.cancelReasonLabel')}</label>
            <Textarea
              value={cancelReason}
              onInput={(e) => setCancelReason((e.target as HTMLTextAreaElement).value)}
              placeholder={t('manage.cancelReasonPlaceholder')}
              rows={2}
            />
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button variant="outline" onClick={() => setShowCancel(false)} class="flex-1">{t('actions.goBack')}</Button>
            <Button variant="destructive" onClick={handleCancel} disabled={cancelling} class="flex-1">
              {cancelling ? <Spinner size={16} /> : t('manage.cancelConfirm')}
            </Button>
          </div>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {!isCancelled && reservation.status !== 'COMPLETED' && reservation.status !== 'NO_SHOW' && !showCancel && (
          <Button variant="destructive" fullWidth onClick={() => setShowCancel(true)}>
            {t('manage.cancelButton')}
          </Button>
        )}
        <Button variant="outline" fullWidth onClick={onBack}>
          {t('manage.backToBooking')}
        </Button>
      </div>
    </div>
  )
}
