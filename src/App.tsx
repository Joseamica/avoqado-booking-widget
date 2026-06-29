import { h } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import type { WidgetProps } from './types'
import { BookingFlow } from './components/BookingFlow'
import { Toast } from './components/ui/Toast'
import { VenueChatModal } from './components/VenueChatModal'
import { getVenueInfo } from './api/booking'
import { branding, flowType } from './state/booking'
import { loadBrandingFont } from './lib/brandingFont'

export default function App(props: WidgetProps) {
  // The default container max-width keeps the booking flow narrow + focused.
  // /classes widens to 1100px (calendar grid + sidebar). /appointments widens
  // to 1180px so the wizard step content + venue sidebar both have room on
  // desktop. Each width must match the host page's outer .shell for that flow
  // (book.avoqado.io sets body.flow-classes/.flow-appointments .shell to the
  // same px in public/index.html) — otherwise the narrower of the two clamps
  // the layout and the extra shell width does nothing.
  //
  // Bind to the LIVE flowType signal, not props.flowType. props.flowType is
  // frozen at mount from the `flow-type` HTML attribute, but when a customer
  // enters appointments/classes from the unified landing the widget only flips
  // the signal (no attribute change), so a prop-driven width stayed at the
  // narrow `max-w-lg` while the host shell widened — the "cramped until reload"
  // bug. We still fall back to the prop while the signal is at its initial
  // 'unified' default so a direct /appointments load paints wide on first frame
  // (no flash) before BookingFlow's mount effect seeds the signal.
  const activeFlow = flowType.value !== 'unified' ? flowType.value : (props.flowType ?? 'unified')
  const widthClass =
    activeFlow === 'classes'
      ? 'avq-wide'
      : activeFlow === 'appointments'
        ? 'avq-mid'
        : 'max-w-lg'

  // Lightweight venue fetch for the wa.me fallback + chat availability. Doesn't
  // block BookingFlow — that component also fetches venue info on its own.
  const [venuePhone, setVenuePhone] = useState<string | null>(null)
  // Whether a "message us" affordance can actually reach the venue (server-
  // resolved: RELAY, or WA_ME_FALLBACK with a phone). Defaults to true so we
  // fail-open when the fetch errors or an older server omits `chat` — the FAB
  // only hides when the server explicitly says the channel would dead-end.
  const [chatCanMessage, setChatCanMessage] = useState(true)
  useEffect(() => {
    let active = true
    getVenueInfo(props.venue)
      .then(v => {
        if (!active) return
        setVenuePhone(v?.phone ?? null)
        const canMessage = v?.chat?.canMessage ?? true
        setChatCanMessage(canMessage)
        // Mirror the verdict to the host page: book.avoqado.io renders its own
        // "message us" pill in the light DOM and suppresses our shadow-DOM FAB
        // (hide-chat-fab), so it can't read `chat.canMessage` itself. It listens
        // for this on window and hides its pill + drawer row when canMessage is
        // false. Absent listener (third-party embeds) → harmless no-op.
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('avoqado:chat-availability', { detail: { canMessage } }))
        }
      })
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

  // Reservation branding tokens. accentColor (server-resolved from primaryColor)
  // wins over the `accent-color` attribute; buttonShape → CTA radius; fontFamily
  // → --avq-font. The font is loaded into document.head (see effect below) so it
  // cascades into this Shadow DOM.
  const b = branding.value
  const accent = b.accentColor ?? props.accentColor
  const shapeRadius = b.buttonShape === 'square' ? '0px' : b.buttonShape === 'pill' ? '9999px' : '0.5rem'
  const rootStyle: Record<string, string> = { '--avq-btn-radius': shapeRadius }
  if (accent) rootStyle['--avq-accent'] = accent
  if (b.fontFamily) rootStyle['--avq-font'] = `"${b.fontFamily}", system-ui, sans-serif`

  useEffect(() => {
    loadBrandingFont(b.fontFamily)
  }, [b.fontFamily])

  return (
    <div
      data-avq-theme={props.theme}
      style={rootStyle}
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
        hideFab={props.hideChatFab || !chatCanMessage}
      />
    </div>
  )
}
