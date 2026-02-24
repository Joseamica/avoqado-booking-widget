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
      <div class="flex items-center justify-center py-16">
        <Spinner size={32} />
      </div>
    )
  }

  if (error || !reservation) {
    return (
      <div class="space-y-4 py-8 text-center">
        <p class="text-[var(--avq-fg,#111827)] font-semibold">{t('errors.reservationNotFound')}</p>
        <p class="text-[var(--avq-muted-fg,#6b7280)]">{t('errors.reservationNotFoundDescription')}</p>
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

  const statusColors: Record<string, string> = {
    PENDING: 'bg-yellow-100 text-yellow-800',
    CONFIRMED: 'bg-green-100 text-green-800',
    CHECKED_IN: 'bg-blue-100 text-blue-800',
    COMPLETED: 'bg-gray-100 text-gray-800',
    CANCELLED: 'bg-red-100 text-red-800',
    NO_SHOW: 'bg-orange-100 text-orange-800',
  }

  return (
    <div class="space-y-5">
      <h2 class="text-lg font-semibold text-[var(--avq-fg,#111827)]">{t('manage.title')}</h2>

      {/* Status */}
      <div class="flex justify-center">
        <span class={`rounded-full px-3 py-1 text-sm font-medium ${statusColors[reservation.status] ?? 'bg-gray-100 text-gray-800'}`}>
          {t(`status.${reservation.status}`)}
        </span>
      </div>

      {/* Code */}
      <div class="rounded-xl bg-[var(--avq-muted,#f3f4f6)] p-4 text-center">
        <p class="text-sm text-[var(--avq-muted-fg,#6b7280)]">Código</p>
        <p class="mt-1 text-3xl font-bold tracking-wider text-[var(--avq-fg,#111827)]">{reservation.confirmationCode}</p>
      </div>

      {/* Details */}
      <div class="space-y-3 rounded-xl border border-[var(--avq-border,#e5e7eb)] p-4">
        <div class="flex items-start gap-3">
          <svg xmlns="http://www.w3.org/2000/svg" class="mt-0.5 h-5 w-5 text-[var(--avq-muted-fg,#6b7280)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          <div>
            <p class="font-medium text-[var(--avq-fg,#111827)]">{dateStr}</p>
            <p class="text-sm text-[var(--avq-muted-fg,#6b7280)]">{timeStr}</p>
          </div>
        </div>

        {reservation.product && (
          <div class="flex items-center gap-3">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-[var(--avq-muted-fg,#6b7280)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            <p class="text-[var(--avq-fg,#111827)]">{reservation.product.name}</p>
          </div>
        )}

        {reservation.specialRequests && (
          <div class="flex items-start gap-3">
            <svg xmlns="http://www.w3.org/2000/svg" class="mt-0.5 h-5 w-5 text-[var(--avq-muted-fg,#6b7280)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            <div>
              <p class="text-sm font-medium text-[var(--avq-fg,#111827)]">{t('manage.specialRequests')}</p>
              <p class="text-sm text-[var(--avq-muted-fg,#6b7280)]">{reservation.specialRequests}</p>
            </div>
          </div>
        )}
      </div>

      {/* Cancel dialog inline */}
      {showCancel && (
        <div class="rounded-xl border border-red-200 bg-red-50 p-4 space-y-3">
          <h3 class="font-semibold text-red-800">{t('manage.cancelTitle')}</h3>
          <p class="text-sm text-red-700">{t('manage.cancelDescription')}</p>
          <div class="space-y-1">
            <label class="block text-sm font-medium text-red-800">{t('manage.cancelReasonLabel')}</label>
            <Textarea
              value={cancelReason}
              onInput={(e) => setCancelReason((e.target as HTMLTextAreaElement).value)}
              placeholder={t('manage.cancelReasonPlaceholder')}
              rows={2}
            />
          </div>
          <div class="flex gap-2">
            <Button variant="outline" onClick={() => setShowCancel(false)} class="flex-1">{t('actions.goBack')}</Button>
            <button
              type="button"
              onClick={handleCancel}
              disabled={cancelling}
              class="flex-1 rounded-lg bg-red-600 text-white text-sm font-medium py-2.5 hover:bg-red-700 disabled:opacity-50 transition-colors"
            >
              {cancelling ? <Spinner size={16} /> : t('manage.cancelConfirm')}
            </button>
          </div>
        </div>
      )}

      {/* Actions */}
      <div class="space-y-3">
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
