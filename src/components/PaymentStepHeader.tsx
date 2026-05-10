import { h } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { slotHoldExpiresAt } from '../state/booking'

interface PaymentStepHeaderProps {
  locale: 'en' | 'es'
  /** Called when the countdown reaches zero. The parent typically routes the
   *  customer back to the time-slot picker with a "slot expired" toast. */
  onExpired?: () => void
}

/**
 * Square-style "Proceso de pago / Cita reservada durante 9:56" header.
 *
 * The countdown reads `slotHoldExpiresAt` from state. If the backend hold
 * endpoint hasn't been deployed yet, the form-step entry effect in BookingFlow
 * sets a visual-only expiry of now+10min so the UI doesn't look broken — the
 * timer ticks but the slot isn't actually held server-side.
 *
 * TODO(jose): when POST /reservations/hold ships, hydrate slotHoldExpiresAt
 * from the server response and remove the visual-only fallback below.
 */
export function PaymentStepHeader({ locale, onExpired }: PaymentStepHeaderProps) {
  const [secondsLeft, setSecondsLeft] = useState<number>(0)

  useEffect(() => {
    let expiresAt = slotHoldExpiresAt.value
    // Visual-only fallback: 10-minute countdown from form-step entry. Real hold
    // tokens come from the (future) backend endpoint.
    if (!expiresAt) {
      expiresAt = Date.now() + 10 * 60 * 1000
      slotHoldExpiresAt.value = expiresAt
    }

    function tick() {
      const left = Math.max(0, Math.floor(((slotHoldExpiresAt.value ?? expiresAt!) - Date.now()) / 1000))
      setSecondsLeft(left)
      if (left <= 0) {
        clearInterval(interval)
        if (onExpired) onExpired()
      }
    }
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const mm = String(Math.floor(secondsLeft / 60)).padStart(1, '0')
  const ss = String(secondsLeft % 60).padStart(2, '0')

  const titleText = locale === 'en' ? 'Checkout' : 'Proceso de pago'
  const holdText = locale === 'en'
    ? `Appointment held for ${mm}:${ss}`
    : `Cita reservada durante ${mm}:${ss}`

  return (
    <div style={{ textAlign: 'center', marginBottom: '24px' }}>
      <h1 style={{
        margin: 0, fontSize: '20px', fontWeight: '700',
        color: 'var(--avq-fg, #111827)',
        letterSpacing: '-0.3px',
      }}>
        {titleText}
      </h1>
      <p style={{
        margin: '4px 0 0', fontSize: '13px',
        color: secondsLeft < 60 ? '#dc2626' : 'var(--avq-muted-fg, #6b7280)',
        fontVariantNumeric: 'tabular-nums',
      }}>
        {holdText}
      </p>
    </div>
  )
}
