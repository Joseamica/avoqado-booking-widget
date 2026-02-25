import { h } from 'preact'
import { useState } from 'preact/hooks'
import type { TFunction } from '../i18n'
import type { PublicBookingResult } from '../types'

interface DepositStepProps {
  booking: PublicBookingResult
  t: TFunction
  onContinue: () => void
}

export function DepositStep({ booking, t, onContinue }: DepositStepProps) {
  const [hov, setHov] = useState(false)

  return (
    <div class="avq-animate-scale" style={{ textAlign: 'center' }}>
      <div style={{
        width: '64px', height: '64px', borderRadius: '50%',
        background: 'linear-gradient(135deg, #fef9c3 0%, #fde68a 100%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        margin: '0 auto 20px',
        boxShadow: '0 4px 14px rgba(202, 138, 4, 0.15)',
      }}>
        <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#ca8a04" stroke-width="2">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
      </div>

      <h2 style={{ fontSize: '20px', fontWeight: '700', color: 'var(--avq-fg, #111827)', margin: '0 0 8px' }}>
        {t('deposit.title')}
      </h2>

      {booking.depositAmount && (
        <p style={{ margin: '0 0 16px', fontSize: '32px', fontWeight: '700', color: 'var(--avq-accent, #6366f1)' }}>
          ${booking.depositAmount}
        </p>
      )}

      <p style={{ fontSize: '14px', color: 'var(--avq-muted-fg, #6b7280)', margin: '0 0 28px' }}>
        {t('deposit.atVenueNote')}
      </p>

      <button
        type="button"
        onClick={onContinue}
        onMouseEnter={() => setHov(true)}
        onMouseLeave={() => setHov(false)}
        style={{
          width: '100%', height: '46px', borderRadius: '12px',
          background: 'var(--avq-accent, #6366f1)',
          color: '#ffffff', fontWeight: '600', fontSize: '14px',
          border: 'none', cursor: 'pointer',
          transition: 'all 0.2s ease',
          boxShadow: hov
            ? '0 4px 14px color-mix(in srgb, var(--avq-accent, #6366f1) 40%, transparent)'
            : '0 2px 8px color-mix(in srgb, var(--avq-accent, #6366f1) 25%, transparent)',
          transform: hov ? 'translateY(-1px)' : 'translateY(0)',
        }}
      >
        Entendido
      </button>
    </div>
  )
}
