import { h } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import type { WidgetProps } from './types'
import { BookingFlow } from './components/BookingFlow'
import { Toast } from './components/ui/Toast'
import { VenueChatModal } from './components/VenueChatModal'
import { getVenueInfo } from './api/booking'

export default function App(props: WidgetProps) {
  // The default container max-width keeps the booking flow narrow + focused.
  // /classes widens to 1100px (calendar grid + sidebar). /appointments widens
  // to 1180px so the wizard step content + venue sidebar both have room on
  // desktop. Each width must match the host page's outer .shell for that flow
  // (book.avoqado.io sets body.flow-classes/.flow-appointments .shell to the
  // same px in public/index.html) — otherwise the narrower of the two clamps
  // the layout and the extra shell width does nothing.
  const widthClass =
    props.flowType === 'classes'
      ? 'avq-wide'
      : props.flowType === 'appointments'
        ? 'avq-mid'
        : 'max-w-lg'

  // Lightweight venue fetch just for the wa.me fallback. Doesn't block
  // BookingFlow — that component also fetches venue info on its own.
  const [venuePhone, setVenuePhone] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    getVenueInfo(props.venue)
      .then(v => { if (active) setVenuePhone(v?.phone ?? null) })
      .catch(() => {})
    return () => { active = false }
  }, [props.venue])

  // Map widget flowType → venue-chat flowOrigin. The widget exposes
  // 'classes' | 'appointments' | 'packs' (plus internal extras); we ignore
  // anything else and default to appointments.
  // The widget's FlowType doesn't include 'packs' (booking-only), so it
  // never reaches the venue-chat server's 'packs' branch from here. Hash
  // routes like /<slug>#packs are surfaced inside BookingFlow; if we ever
  // want packs to thread through, lift that signal up to App.
  const flowOrigin: 'appointments' | 'classes' | 'packs' = props.flowType === 'classes' ? 'classes' : 'appointments'

  return (
    <div
      data-avq-theme={props.theme}
      style={props.accentColor ? `--avq-accent:${props.accentColor}` : undefined}
      class="avq-root"
    >
      <div class={'mx-auto px-4 py-6 ' + widthClass}>
        <BookingFlow props={props} />
      </div>
      <Toast />
      <VenueChatModal
        venueSlug={props.venue}
        venuePhone={venuePhone}
        flowOrigin={flowOrigin}
        locale={props.locale}
        hideFab={props.hideChatFab}
      />
    </div>
  )
}
