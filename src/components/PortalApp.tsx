import { h } from 'preact'
import { useEffect } from 'preact/hooks'
import { createT } from '../i18n'
import * as api from '../api/booking'
import { venueInfo, isLoading, showPortal } from '../state/booking'
import { CustomerPortal } from './CustomerPortal'
import { Spinner } from './ui/Spinner'
import { Toast } from './ui/Toast'

interface PortalAppProps {
  venue: string
  locale: 'en' | 'es'
  theme: 'light' | 'dark' | 'auto'
  accentColor?: string
}

/**
 * Standalone portal component — renders login/register or account dashboard.
 * Used as <avoqado-portal venue="slug"> on any page.
 */
export function PortalApp({ venue, locale, theme, accentColor }: PortalAppProps) {
  const t = createT(locale)

  useEffect(() => {
    if (!venue) return
    // Only load venue info if not already loaded (shared signal with booking)
    if (venueInfo.value?.slug === venue) return
    isLoading.value = true
    api.getVenueInfo(venue)
      .then(info => { venueInfo.value = info })
      .catch(() => {})
      .finally(() => { isLoading.value = false })
  }, [venue])

  const info = venueInfo.value

  if (isLoading.value || !info) {
    return (
      <div data-avq-theme={theme} style={accentColor ? `--avq-accent:${accentColor}` : undefined} class="avq-root">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px 0' }}>
          <Spinner size={24} />
        </div>
      </div>
    )
  }

  return (
    <div data-avq-theme={theme} style={accentColor ? `--avq-accent:${accentColor}` : undefined} class="avq-root">
      <div class="mx-auto max-w-lg px-4 py-6">
        <CustomerPortal
          venueSlug={venue}
          timezone={info.timezone}
          t={t}
          onBack={() => {
            // If there's a booking widget on the same page, navigate to it
            const bookingEl = document.querySelector('avoqado-booking')
            if (bookingEl) {
              bookingEl.scrollIntoView({ behavior: 'smooth' })
              showPortal.value = false
            }
          }}
          onManageBooking={(cancelSecret) => {
            // Try to navigate to booking widget on same page
            const bookingEl = document.querySelector('avoqado-booking') as any
            if (bookingEl) {
              bookingEl.scrollIntoView({ behavior: 'smooth' })
              // Dispatch event so the booking widget can handle it
              bookingEl.dispatchEvent(new CustomEvent('avoqado:manage', { detail: { cancelSecret } }))
            }
          }}
        />
      </div>
      <Toast />
    </div>
  )
}
