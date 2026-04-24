import { h } from 'preact'
import { useEffect, useRef } from 'preact/hooks'
import type { TFunction } from '../i18n'
import { Spinner } from './ui/Spinner'

interface CheckoutModalProps {
  phone: string
  email: string
  onPhoneChange: (v: string) => void
  onEmailChange: (v: string) => void
  onClose: () => void
  onSubmit: () => void
  submitting: boolean
  t: TFunction
}

const TX = 'background 0.15s var(--avq-ease), border-color 0.15s var(--avq-ease), color 0.15s var(--avq-ease), opacity 0.15s var(--avq-ease)'

/**
 * Stripe-checkout pre-fill modal.
 *
 * Accessibility:
 * - role=dialog + aria-modal=true so screen readers know they're trapped in a modal
 * - aria-labelledby points at the title
 * - Autofocuses the phone input on open
 * - Escape closes
 * - Click on backdrop closes (but not click inside the panel)
 * - Focus trap: Tab cycles between modal interactive elements only
 */
export function CheckoutModal({ phone, email, onPhoneChange, onEmailChange, onClose, onSubmit, submitting, t }: CheckoutModalProps) {
  const phoneRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = 'avq-checkout-title'
  const canSubmit = phone.trim().length > 0 && !submitting

  useEffect(() => {
    // Autofocus phone on open
    phoneRef.current?.focus()

    // Escape closes; Tab traps inside panel
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !submitting) {
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel) return
      const focusables = panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, submitting])

  return (
    <div
      role="presentation"
      onClick={(e) => {
        // Close on backdrop click (not when clicking inside the panel)
        if (e.target === e.currentTarget && !submitting) onClose()
      }}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'color-mix(in srgb, #000 45%, transparent)',
        backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '16px',
        animation: 'avq-fadeIn 0.2s var(--avq-ease)',
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{
          background: 'var(--avq-bg, #ffffff)', borderRadius: '18px',
          padding: '24px', width: '100%', maxWidth: '380px',
          boxShadow: '0 20px 50px -12px color-mix(in srgb, #000 30%, transparent)',
          border: '1px solid var(--avq-border, #e8eaed)',
        }}
      >
        <h3 id={titleId} style={{ fontSize: '17px', fontWeight: '700', color: 'var(--avq-fg, #111827)', margin: '0 0 6px', letterSpacing: '-0.01em' }}>
          {t('creditPacks.checkoutTitle')}
        </h3>
        <p style={{ fontSize: '13px', color: 'var(--avq-muted-fg, #6b7280)', margin: '0 0 18px', lineHeight: '1.5' }}>
          {t('creditPacks.checkoutSubtitle')}
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div>
            <label htmlFor="avq-checkout-phone" style={{ display: 'block', fontSize: '12px', fontWeight: '500', color: 'var(--avq-muted-fg, #6b7280)', marginBottom: '6px' }}>
              {t('form.phone')} <span style={{ color: 'var(--avq-danger-accent)' }} aria-hidden="true">*</span>
            </label>
            <input
              id="avq-checkout-phone"
              ref={phoneRef}
              type="tel"
              autoComplete="tel"
              required
              placeholder={t('form.phonePlaceholder')}
              value={phone}
              onInput={(e) => onPhoneChange((e.target as HTMLInputElement).value)}
              style={{
                width: '100%', height: '44px', padding: '0 14px', borderRadius: '12px',
                border: '1.5px solid var(--avq-border, #e8eaed)', fontSize: '14px',
                background: 'var(--avq-bg, #ffffff)', color: 'var(--avq-fg, #111827)',
                outline: 'none', boxSizing: 'border-box',
                transition: TX,
              }}
            />
          </div>
          <div>
            <label htmlFor="avq-checkout-email" style={{ display: 'block', fontSize: '12px', fontWeight: '500', color: 'var(--avq-muted-fg, #6b7280)', marginBottom: '6px' }}>
              {t('form.email')}
            </label>
            <input
              id="avq-checkout-email"
              type="email"
              autoComplete="email"
              placeholder={t('form.emailPlaceholder')}
              value={email}
              onInput={(e) => onEmailChange((e.target as HTMLInputElement).value)}
              style={{
                width: '100%', height: '44px', padding: '0 14px', borderRadius: '12px',
                border: '1.5px solid var(--avq-border, #e8eaed)', fontSize: '14px',
                background: 'var(--avq-bg, #ffffff)', color: 'var(--avq-fg, #111827)',
                outline: 'none', boxSizing: 'border-box',
                transition: TX,
              }}
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            style={{
              flex: 1, height: '44px', borderRadius: '12px',
              border: '1.5px solid var(--avq-border, #e8eaed)',
              background: 'var(--avq-bg, #ffffff)',
              fontSize: '14px', fontWeight: '500', color: 'var(--avq-fg, #111827)',
              cursor: submitting ? 'not-allowed' : 'pointer',
              opacity: submitting ? 0.5 : 1,
              transition: TX,
            }}
          >
            {t('actions.goBack')}
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={!canSubmit}
            style={{
              flex: 1, height: '44px', borderRadius: '12px',
              border: 'none', background: 'var(--avq-accent, #6366f1)',
              fontSize: '14px', fontWeight: '600', color: '#ffffff',
              cursor: canSubmit ? 'pointer' : 'not-allowed',
              opacity: canSubmit ? 1 : 0.5,
              transition: TX,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
            }}
          >
            {submitting ? <Spinner size={16} /> : t('creditPacks.continueToPayment')}
          </button>
        </div>
      </div>
    </div>
  )
}
