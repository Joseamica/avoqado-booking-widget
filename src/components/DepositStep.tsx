import { h } from 'preact'
import type { TFunction } from '../i18n'
import type { PublicBookingResult } from '../types'

interface DepositStepProps {
  booking: PublicBookingResult
  t: TFunction
  onContinue: () => void
}

export function DepositStep({ booking, t, onContinue }: DepositStepProps) {
  return (
    <div class="space-y-6 text-center">
      <div class="flex justify-center">
        <div class="flex h-16 w-16 items-center justify-center rounded-full bg-yellow-100">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 text-yellow-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      </div>
      </div>
      <div>
        <h2 class="text-xl font-semibold text-[var(--avq-fg,#111827)]">{t('deposit.title')}</h2>
        {booking.depositAmount && (
          <p class="mt-2 text-3xl font-bold text-[var(--avq-accent,#6366f1)]">
            ${booking.depositAmount}
          </p>
        )}
      </div>
      <p class="text-[var(--avq-muted-fg,#6b7280)]">{t('deposit.atVenueNote')}</p>
      <button
        type="button"
        onClick={onContinue}
        class="h-12 w-full rounded-lg bg-[var(--avq-accent,#6366f1)] text-white font-medium hover:opacity-90 transition-opacity"
      >
        Entendido
      </button>
    </div>
  )
}
