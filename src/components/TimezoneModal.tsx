import { h } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import type { TFunction } from '../i18n'

interface TimezoneModalProps {
  /** Venue timezone (IANA, e.g. 'America/Mexico_City'). */
  venueTz: string
  /** Friendly venue name shown in the modal copy. */
  venueName: string
  /** Called when the customer picks a TZ — parent persists + uses for date math. */
  onChoose: (choice: 'browser' | 'venue') => void
  t: TFunction
}

const STORAGE_KEY = 'avq_tz_preference'

/**
 * Detects whether the customer's browser timezone differs from the venue's
 * timezone and (when it does + no prior choice was saved) renders a Square-style
 * modal asking which one to display times in.
 *
 * Returns null when:
 * - customer's browser is in the same TZ as the venue
 * - customer already picked a preference (persisted in localStorage)
 *
 * The persisted choice is read by the parent via `getStoredTzPreference()` so
 * downstream date formatting uses it consistently.
 */
export function TimezoneModal({ venueTz, venueName, onChoose, t }: TimezoneModalProps) {
  const [open, setOpen] = useState(false)
  const [browserTz, setBrowserTz] = useState<string>('')

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const browser = Intl.DateTimeFormat().resolvedOptions().timeZone
      setBrowserTz(browser)
      // Same TZ → no decision needed.
      if (!browser || browser === venueTz) return
      // Already chose previously → respect it silently.
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored === 'browser' || stored === 'venue') return
      setOpen(true)
    } catch {
      /* If Intl is unavailable, default to venue tz quietly. */
    }
  }, [venueTz])

  function pick(choice: 'browser' | 'venue') {
    try { localStorage.setItem(STORAGE_KEY, choice) } catch { /* */ }
    setOpen(false)
    onChoose(choice)
  }

  if (!open) return null

  const offsetLabel = (tz: string) => {
    try {
      const now = new Date()
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(now)
      const tzPart = parts.find(p => p.type === 'timeZoneName')
      return tzPart?.value ?? tz
    } catch { return tz }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="avq-tz-title"
      onClick={e => { if (e.target === e.currentTarget) pick('venue') }}
      style={{
        position: 'fixed', inset: 0, zIndex: 999,
        background: 'rgba(15, 23, 42, 0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '16px',
      }}
    >
      <div
        style={{
          background: 'var(--avq-bg, #ffffff)',
          borderRadius: '16px',
          maxWidth: '420px', width: '100%',
          padding: '24px',
          boxShadow: '0 20px 50px rgba(0,0,0,0.18)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
          <div
            style={{
              width: '36px', height: '36px', borderRadius: '10px',
              background: 'color-mix(in srgb, var(--avq-accent, #6366f1) 12%, var(--avq-bg, #fff))',
              color: 'var(--avq-accent, #6366f1)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <ClockIcon />
          </div>
          <h3 id="avq-tz-title" style={{ margin: 0, fontSize: '17px', fontWeight: '600', color: 'var(--avq-fg, #111827)' }}>
            {t('timezone.title')}
          </h3>
        </div>

        <p style={{ margin: '0 0 18px', fontSize: '14px', color: 'var(--avq-muted-fg, #6b7280)', lineHeight: '1.5' }}>
          {t('timezone.description', { venue: venueName, browserTz, venueTz })}
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <button type="button" onClick={() => pick('browser')} style={choiceButtonStyle(true)}>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: '14px', fontWeight: '600' }}>{t('timezone.useBrowser')}</div>
              <div style={{ fontSize: '12px', color: 'var(--avq-muted-fg, #6b7280)', marginTop: '2px' }}>
                {browserTz} ({offsetLabel(browserTz)})
              </div>
            </div>
          </button>
          <button type="button" onClick={() => pick('venue')} style={choiceButtonStyle(false)}>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: '14px', fontWeight: '600' }}>{t('timezone.useVenue')}</div>
              <div style={{ fontSize: '12px', color: 'var(--avq-muted-fg, #6b7280)', marginTop: '2px' }}>
                {venueTz} ({offsetLabel(venueTz)})
              </div>
            </div>
          </button>
        </div>
      </div>
    </div>
  )
}

/** Read the persisted preference. Returns 'venue' as default when nothing stored. */
export function getStoredTzPreference(): 'browser' | 'venue' {
  if (typeof window === 'undefined') return 'venue'
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v === 'browser' ? 'browser' : 'venue'
  } catch { return 'venue' }
}

function choiceButtonStyle(primary: boolean): h.JSX.CSSProperties {
  return {
    width: '100%',
    padding: '14px 16px',
    borderRadius: '12px',
    border: primary ? '1.5px solid var(--avq-accent, #6366f1)' : '1px solid var(--avq-border, #e8eaed)',
    background: primary
      ? 'color-mix(in srgb, var(--avq-accent, #6366f1) 5%, var(--avq-bg, #fff))'
      : 'var(--avq-bg, #ffffff)',
    color: 'var(--avq-fg, #111827)',
    cursor: 'pointer',
    transition: 'background 0.15s ease',
  }
}

function ClockIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  )
}
