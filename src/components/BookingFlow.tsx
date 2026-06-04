import { h } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import type { WidgetProps, PublicClassSessionSlot, OperatingHours } from '../types'
import type { PublicSlot } from '../types'
import { createT } from '../i18n'
import * as api from '../api/booking'
import {
  step, venueInfo, selectedProduct, selectedDate, selectedSlot,
  selectedSpotIds, bookingResult, isLoading, apiError, manageSecret,
  hasServiceStep, getStepConfig, resetBooking, showToast,
  creditPacks, customerCredits, selectedCreditBalance, creditPacksLoading, creditPacksLoaded,
  showPortal, portalData, customerToken, customerInfo, setCustomerSession, clearCustomerSession,
  flowType, visibleProducts,
  selectedProducts, totalDuration, totalPrice, selectedModifiers,
  addSelectedProduct, removeSelectedProduct,
  slotHoldToken, slotHoldExpiresAt,
  branding, DEFAULT_BRANDING,
} from '../state/booking'
import { StepIndicator } from './StepIndicator'
import { ServiceSelector } from './ServiceSelector'
import { ReservationHero } from './ReservationHero'
import { DatePicker } from './DatePicker'
import { TimeSlotPicker } from './TimeSlotPicker'
import { SeatPicker } from './SeatPicker'
import { GuestInfoForm } from './GuestInfoForm'
import { DepositStep } from './DepositStep'
import { Confirmation } from './Confirmation'
import { ManageBooking } from './ManageBooking'
import { Spinner } from './ui/Spinner'
import { CreditPackBanner } from './CreditPackBanner'
import { CreditSelector } from './CreditSelector'
import { CheckoutModal } from './CheckoutModal'
import { CustomerPortal } from './CustomerPortal'
import { ClassSessionList } from './ClassSessionList'
import { ClassDetailView } from './ClassDetailView'
import { UnifiedLanding } from './UnifiedLanding'
import { PaymentSelector } from './PaymentSelector'
import { TimezoneModal, getStoredTzPreference } from './TimezoneModal'
import { VenueSidebarCard } from './VenueSidebarCard'
import { AppointmentSummarySidebar } from './AppointmentSummarySidebar'
import { ServiceDetailView } from './ServiceDetailView'
import { DateTimePickerSquare } from './DateTimePickerSquare'
import { PaymentStepHeader } from './PaymentStepHeader'
import { PaymentChoiceInline, type InlineChoice } from './PaymentChoiceInline'
import { CreditPacksModal } from './CreditPacksModal'
import { AppointmentConfirmation } from './AppointmentConfirmation'
import type { GuestFormData } from './GuestInfoForm'
import type { Product } from '../types'

interface BookingFlowProps {
  props: WidgetProps
}

const MANAGE_STEP = 99

/** Avoqado avocado icon — inline SVG for Shadow DOM */
function AvoqadoLogo() {
  return (
    <svg viewBox="0 0 732.5 893.3" width="16" height="20" style={{ flexShrink: 0 }}>
      <path
        fill="#69E185"
        d="M712.7,486.2c-3.3-83.5-37.8-157.2-99.8-213.1c-27.9-28.7-63.2-57.2-104.9-84.8c16-81.7,12.9-116.7-31.4-155.5
        l-2.4-2.1l-3.1-0.9c-33-9.4-58.6-7.7-78.1,5.1c-29.8,19.5-39.9,60.9-45.2,117.3c-131.6,12.1-242.1,95.5-296.3,224.2
        c-56.5,134-37,280.8,49.8,374.1c3.4,3.5,10.3,10.6,157,98l1.1,0.7l1.2,0.5c36,13.2,72.6,19.8,108.8,19.8
        c39.2,0,78.1-7.7,115.4-23.2c63.9-26.5,121.9-75.8,163.3-138.7C692.8,639.9,715.7,561.3,712.7,486.2z M580.3,507.4
        c-0.3,58-40.2,116.3-118.7,173.3C374.3,744.2,279.3,710,228,651.3c-43.8-50-65.3-119.8-56.1-182c4.8-32.5,20.5-77.7,68-108.3
        c64.6-41.7,110-56.7,144.4-56.7c45.6,0,71.8,26.4,97.4,52.4c10.4,10.5,20.2,20.4,31.3,28.6C545.7,409.4,580.5,454.2,580.3,507.4z"
      />
      <path
        fill="#C9712F"
        d="M362.2,412c-26.8,0-53.6,17.9-75.5,50.5c-18.4,27.3-30.3,61.1-30.3,86c0,49.5,47.4,89.7,105.7,89.7
        S468,598,468,548.5c0-24.9-11.9-58.7-30.3-86C415.8,430,389,412,362.2,412z"
      />
    </svg>
  )
}

/** Build a Square-style "Abierto · Cierra a las 21:00" / "Cerrado · Abre el lunes a las 9:00"
 *  status string from the venue's weekly schedule. Returns null when no hours
 *  are configured so the host page can hide the row entirely. */
function formatHoursLabel(
  hours: OperatingHours | undefined,
  timezone: string,
  locale: string | undefined,
): string | null {
  if (!hours) return null
  const dayKeys: Array<keyof OperatingHours> = [
    'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
  ]
  const lang = locale === 'en' ? 'en' : 'es'
  const tx = lang === 'en'
    ? { open: 'Open', closed: 'Closed', closesAt: 'Closes at', opensAt: 'Opens at' }
    : { open: 'Abierto', closed: 'Cerrado', closesAt: 'Cierra a las', opensAt: 'Abre a las' }
  const dayNames: Record<keyof OperatingHours, string> = lang === 'en'
    ? { sunday: 'Sunday', monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday', thursday: 'Thursday', friday: 'Friday', saturday: 'Saturday' }
    : { sunday: 'domingo', monday: 'lunes', tuesday: 'martes', wednesday: 'miércoles', thursday: 'jueves', friday: 'viernes', saturday: 'sábado' }

  let nowMins = 0
  let todayIdx = 0
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone, hour12: false, weekday: 'short', hour: '2-digit', minute: '2-digit',
    })
    const parts = fmt.formatToParts(new Date())
    const weekdayShort = (parts.find(p => p.type === 'weekday')?.value || 'Sun').toLowerCase().slice(0, 3)
    const hh = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0', 10)
    const mm = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0', 10)
    nowMins = hh * 60 + mm
    const shortMap: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }
    todayIdx = shortMap[weekdayShort] ?? 0
  } catch { /* fall through with defaults */ }

  function rangeMinutes(r: { open: string; close: string }) {
    const [oh, om] = r.open.split(':').map(n => parseInt(n, 10))
    const [ch, cm] = r.close.split(':').map(n => parseInt(n, 10))
    return { openMins: oh * 60 + (om || 0), closeMins: ch * 60 + (cm || 0), open: r.open, close: r.close }
  }

  const todayKey = dayKeys[todayIdx]
  const today = hours[todayKey]
  if (today?.enabled && today.ranges?.length) {
    const ranges = today.ranges.map(rangeMinutes).sort((a, b) => a.openMins - b.openMins)
    const inRange = ranges.find(r => nowMins >= r.openMins && nowMins < r.closeMins)
    if (inRange) return `${tx.open} · ${tx.closesAt} ${inRange.close}`
    const nextToday = ranges.find(r => nowMins < r.openMins)
    if (nextToday) return `${tx.closed} · ${tx.opensAt} ${nextToday.open}`
  }

  for (let offset = 1; offset <= 7; offset++) {
    const nextKey = dayKeys[(todayIdx + offset) % 7]
    const next = hours[nextKey]
    if (next?.enabled && next.ranges?.length) {
      const firstOpen = next.ranges.map(rangeMinutes).sort((a, b) => a.openMins - b.openMins)[0]
      const dayLabel = dayNames[nextKey]
      return lang === 'en'
        ? `${tx.closed} · Opens ${dayLabel} at ${firstOpen.open}`
        : `${tx.closed} · Abre el ${dayLabel} a las ${firstOpen.open}`
    }
  }

  return tx.closed
}

export function BookingFlow({ props }: BookingFlowProps) {
  const t = createT(props.locale)
  const [slots, setSlots] = useState<PublicSlot[]>([])
  const [slotsLoading, setSlotsLoading] = useState(false)
  const [seatPickerActive, setSeatPickerActive] = useState(false)
  // Phase 10: intermediate "class detail" step in the /classes flow.
  // When true, ClassDetailView is rendered above the seat/form step. Going
  // back from detail returns to the listing; "Reservar" continues to seat
  // picker (if layoutConfig) or the form step.
  const [classDetailActive, setClassDetailActive] = useState(false)
  const [buyingPackId, setBuyingPackId] = useState<string | null>(null)
  const [checkoutPackId, setCheckoutPackId] = useState<string | null>(null)
  const [checkoutPhone, setCheckoutPhone] = useState('')
  const [checkoutEmail, setCheckoutEmail] = useState('')
  const [pendingFormData, setPendingFormData] = useState<GuestFormData | null>(null)
  const [showCreditSelector, setShowCreditSelector] = useState(false)
  const [showNoCreditsBuyPrompt, setShowNoCreditsBuyPrompt] = useState(false)
  const [showPaymentSelector, setShowPaymentSelector] = useState(false)
  // Square-style /appointments wizard: ServiceDetailView intermediate page.
  // When non-null, the service-step main column renders the detail view instead
  // of the list. mode='add' for products not yet picked, 'edit' for ones already
  // in selectedProducts (sidebar pencil click).
  const [detailViewProduct, setDetailViewProduct] = useState<{ product: Product; mode: 'add' | 'edit' } | null>(null)
  // Form-submit fn lifted out of GuestInfoForm so the sidebar's "Reserva cita"
  // button can drive submission on the Square /appointments payment step.
  // Null when no form is currently mounted; set when GuestInfoForm registers
  // itself; cleared again on unmount.
  const [formSubmitFn, setFormSubmitFn] = useState<(() => void) | null>(null)
  // Inline payment choice for /appointments (PaymentChoiceInline). When set,
  // handleFormSubmit short-circuits its own credit-check API call and submits
  // straight to /reservations with the chosen balance (or no balance for cash).
  const [inlinePayment, setInlinePayment] = useState<InlineChoice>(null)
  // Visibility of the top-nav-triggered "Comprar créditos" modal. The host
  // page calls widget.showCreditPacks() → the widget dispatches
  // _avq_show_credit_packs on its host element → this flag flips on. Picking
  // a pack in the modal hands off to the existing CheckoutModal flow.
  const [showCreditPacksModal, setShowCreditPacksModal] = useState(false)

  // Step config — hoisted ABOVE every useEffect so closures that reference
  // it never hit TDZ when an early-return guard (isLoading / portal / manage
  // state) returns before the function body completes. Effect callbacks fire
  // after the function returns, so they need the binding initialized by then.
  const config = getStepConfig(hasServiceStep.value)

  // The unified landing (Square-style two-CTA picker) shows whenever the
  // customer enters via /<slug> with no flow segment. Picking a CTA flips
  // flowType in-memory + rewrites the URL so a refresh keeps the choice.
  const [showLanding, setShowLanding] = useState(props.flowType === undefined || props.flowType === 'unified')

  // When the customer returns from a successful Stripe checkout we open the
  // landing on the 'Comprar paquetes' tab so they immediately see the credits
  // they just bought (and can use them on the next booking).
  const [landingInitialTab, setLandingInitialTab] = useState<'book' | 'packs'>(() => {
    if (typeof window === 'undefined') return 'book'
    const url = new URL(window.location.href)
    // 'packs' surfaces when the customer just bought (avq_credits=success) OR when
    // the hosted-page top-nav "Comprar paquetes" link points to /<slug>#packs.
    if (url.searchParams.get('avq_credits') === 'success') return 'packs'
    if (window.location.hash === '#packs') return 'packs'
    return 'book'
  })

  // Listen for the custom `_avq_show_account` event the host page top-nav fires
  // when the customer clicks "Mi Cuenta". The host calls widgetEl.showAccount()
  // → the widget element fires this event → we open the portal. Decoupled from
  // window.location so embedded widgets aren't affected.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const host = props.hostElement
    if (!host) return
    const onShowAccount = () => { showPortal.value = true }
    const onShowCreditPacks = () => { setShowCreditPacksModal(true) }
    // Deep-link from email "Ver mi reservación" CTA: host extracts the
    // cancelSecret from ?manage=<secret> and calls widget.showManageBooking().
    // We open ManageBooking with that secret so the customer lands on their
    // booking detail without having to look it up.
    const onShowManage = (e: Event) => {
      const detail = (e as CustomEvent<{ cancelSecret?: string }>).detail
      if (detail?.cancelSecret) {
        manageSecret.value = detail.cancelSecret
        // BUGFIX: must also switch the step, otherwise the render gate
        // (step.value === MANAGE_STEP) stays false and the customer lands on
        // the booking catalog instead of their reservation. This was the Amaena
        // reminder-link bug — the email CTA opened the service menu, not the
        // cancel screen, so the customer could never self-cancel.
        step.value = MANAGE_STEP
      }
    }
    host.addEventListener('_avq_show_account', onShowAccount)
    host.addEventListener('_avq_show_credit_packs', onShowCreditPacks)
    host.addEventListener('_avq_show_manage', onShowManage as EventListener)
    return () => {
      host.removeEventListener('_avq_show_account', onShowAccount)
      host.removeEventListener('_avq_show_credit_packs', onShowCreditPacks)
      host.removeEventListener('_avq_show_manage', onShowManage as EventListener)
    }
  }, [props.hostElement])

  // Hosted-page deep link, read directly from the URL on mount. The host page
  // (book.avoqado.io) also fires showManageBooking() via the event above, but
  // that dispatch can race this component's effect attachment. Reading
  // ?manage=<cancelSecret> here makes the deep-link reliable regardless of host
  // timing — belt-and-suspenders with the event handler.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (manageSecret.value) return // already opened (event, or after a booking)
    try {
      const secret = new URLSearchParams(window.location.search).get('manage')
      if (secret) {
        manageSecret.value = secret
        step.value = MANAGE_STEP
      }
    } catch {
      /* malformed URL — ignore, fall through to normal catalog */
    }
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Customer-facing TZ — initialized from the stored preference. The TimezoneModal
  // (rendered below) updates this signal when the customer picks one. Used by
  // ClassSessionList and the date pickers to compute today/tomorrow/HH:MM in the
  // expected zone. Defaults to 'venue' when the customer hasn't picked yet.
  const [tzPreference, setTzPreference] = useState<'browser' | 'venue'>(getStoredTzPreference)

  function resolveDisplayTz(venueTz: string): string {
    if (tzPreference !== 'browser' || typeof window === 'undefined') return venueTz
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || venueTz } catch { return venueTz }
  }

  // Sync flowType signal with prop. Must run BEFORE the venue load effect so
  // resetBooking() picks up the right product filter.
  useEffect(() => {
    flowType.value = props.flowType ?? 'unified'
    setShowLanding(props.flowType === undefined || props.flowType === 'unified')
  }, [props.flowType])

  // Auto-skip the picker when the venue only sells appointments — no point
  // asking "¿Citas o clases?" when there are no classes and no packs. Fires
  // once both venueInfo + the credit-packs fetch have settled so we don't
  // race the API. URL is replaced (not pushed) so the back button doesn't
  // land the customer on a landing that's just going to redirect again.
  useEffect(() => {
    if (!showLanding) return
    const info = venueInfo.value
    if (!info) return
    if (!creditPacksLoaded.value) return
    const hasClasses = info.products.some(p => p.type === 'CLASS')
    const hasAppointments = info.products.some(p => p.type !== 'CLASS')
    const hasPacks = creditPacks.value.length > 0
    if (hasAppointments && !hasClasses && !hasPacks) {
      flowType.value = 'appointments'
      setShowLanding(false)
      if (typeof window !== 'undefined' && window.history?.replaceState) {
        const base = window.location.pathname.replace(/\/+$/, '').replace(/\/appointments$|\/classes$/, '')
        window.history.replaceState({}, '', `${base}/appointments${window.location.search}`)
      }
      resetBooking(info)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showLanding, venueInfo.value, creditPacksLoaded.value])

  // Load venue info on mount
  useEffect(() => {
    if (!props.venue) return
    isLoading.value = true
    apiError.value = null
    api.getVenueInfo(props.venue)
      .then(info => {
        venueInfo.value = info
        branding.value = info.branding ?? DEFAULT_BRANDING
        resetBooking(info)
        // Notify the hosted page (book.avoqado.io) so it can populate the
        // appointments drawer with venue contact info. Plain hosts that don't
        // listen ignore it harmlessly.
        const hasClasses = (info.products ?? []).some(p => p.type === 'CLASS')
        props.hostElement.dispatchEvent(new CustomEvent('avoqado:venue-loaded', {
          bubbles: true, composed: true,
          detail: {
            venue: {
              name: info.name,
              address: info.address ?? null,
              phone: info.phone ?? null,
              timezone: info.timezone,
              hoursLabel: formatHoursLabel(info.operatingHours, info.timezone, props.locale),
              // Brand fields — bridged out so the hosted page shell
              // (book.avoqado.io/<slug>) can paint its own topnav (Mi Cuenta
              // CTA, active tab underline) in the venue's brand color and
              // surface the wide/small logos. Internal widget chrome already
              // reads these off venueInfo via the accentOverride below.
              primaryColor: info.primaryColor ?? null,
              logo: info.logo ?? null,
              logoFull: info.logoFull ?? null,
              heroImageUrl: info.heroImageUrl ?? null,
              // Capability flags so the hosted page can hide nav links the
              // venue doesn't use (e.g. "Clases" when only appointments are
              // offered). Keeps the chrome from showing dead-end CTAs.
              hasClasses,
            },
          },
        }))
        // Load credit packs in background. Once they land, notify the host
        // page so the top-nav "Comprar créditos" CTA can unhide itself when
        // the venue actually has packs on offer.
        api.getCreditPacks(props.venue).then(packs => {
          creditPacks.value = packs
          creditPacksLoaded.value = true
          props.hostElement.dispatchEvent(new CustomEvent('avoqado:credit-packs-loaded', {
            bubbles: true, composed: true,
            detail: { count: packs.length },
          }))
        }).catch(() => {
          // Treat fetch errors as "no packs" so the auto-skip below can still
          // proceed instead of getting stuck waiting on a flag that never flips.
          creditPacksLoaded.value = true
        })
      })
      .catch((err) => {
        apiError.value = err.status === 404 ? t('errors.venueNotFound') : t('errors.generic')
      })
      .finally(() => { isLoading.value = false })
  }, [props.venue])

  // Notify the hosted page (book.avoqado.io) whenever auth state changes so it
  // can swap the drawer "Iniciar sesión" CTA for a logged-in profile label.
  // Fires on mount with the hydrated session (or null), and again on login/logout.
  useEffect(() => {
    const c = customerInfo.value
    props.hostElement.dispatchEvent(new CustomEvent('avoqado:auth-changed', {
      bubbles: true, composed: true,
      detail: {
        customer: c ? {
          id: c.id, firstName: c.firstName, lastName: c.lastName, email: c.email, phone: c.phone,
        } : null,
      },
    }))
  }, [customerInfo.value?.id ?? null])

  // Load full portal data in background if customer is logged in
  useEffect(() => {
    if (customerToken.value && !portalData.value) {
      api.getCustomerPortal(props.venue, customerToken.value).then(data => {
        portalData.value = data
        // Backfill customerInfo if not yet stored (e.g. login from older version)
        if (!customerInfo.value && data.customer) {
          const { id, firstName, lastName, email, phone } = data.customer
          setCustomerSession(customerToken.value!, { id, firstName, lastName, email, phone })
        }
      }).catch(() => {
        clearCustomerSession()
      })
    }
  }, [props.venue])

  // Detect return from Stripe checkout via the avq_credits URL param. The webhook may
  // race with the redirect, so poll a few times before giving up.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    const flag = url.searchParams.get('avq_credits')
    if (!flag) return

    // Strip the param from the URL so the effect doesn't re-fire on hot reloads / nav.
    url.searchParams.delete('avq_credits')
    const cleanUrl = url.toString()
    window.history.replaceState({}, '', cleanUrl)

    if (flag === 'cancel') {
      showToast(t('creditPacks.checkoutCancelled'), 'error')
      try { sessionStorage.removeItem('avq:pendingCheckout') } catch { /* */ }
      return
    }

    if (flag !== 'success') return

    let stash: { phone?: string; email?: string; venue?: string } = {}
    try {
      const raw = sessionStorage.getItem('avq:pendingCheckout')
      if (raw) stash = JSON.parse(raw)
      sessionStorage.removeItem('avq:pendingCheckout')
    } catch { /* */ }

    if (!stash.phone && !stash.email) {
      showToast(t('creditPacks.purchaseSuccess'), 'success')
      return
    }

    // Poll the balance endpoint up to 5 times (every 1.5s) waiting for the webhook to fulfill.
    let attempts = 0
    const maxAttempts = 5
    const baselineCount = (customerCredits.value?.purchases?.length ?? 0)
    const tick = async () => {
      attempts++
      try {
        const fresh = await api.getCustomerCredits(props.venue, {
          email: stash.email,
          phone: stash.phone,
        })
        const newCount = fresh.purchases.length
        if (newCount > baselineCount || attempts >= maxAttempts) {
          customerCredits.value = fresh
          if (newCount > baselineCount) {
            showToast(t('creditPacks.purchaseSuccess'), 'success')
          }
          return
        }
      } catch { /* keep polling */ }
      setTimeout(tick, 1500)
    }
    tick()
    // Intentional: only run on mount with the URL flag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ----- Service-detail URL routing (Square-style deep link) ----------------
  // Hosted page can deep-link directly to a service's detail screen via
  //   /<slug>/appointments/services/<productId>
  // Two effects keep state and the address bar in sync:
  //   1) URL → state: on venueInfo load + on browser back/forward (popstate),
  //      parse the path; if it points at a real product, open the detail view.
  //   2) State → URL: when the customer enters/exits the detail view through
  //      the in-app UI, push a new history entry so the back button works.
  // We only manage the URL when the host's path actually starts with
  //   /<slug>/appointments  — third-party embeds keep their host's URL intact.
  function appointmentsBasePath(): string | null {
    if (typeof window === 'undefined') return null
    const path = window.location.pathname.replace(/\/+$/, '')
    const match = path.match(/^(\/[^/]+\/appointments)(?:\/.*)?$/)
    return match ? match[1] : null
  }

  useEffect(() => {
    if (props.flowType !== 'appointments') return
    if (typeof window === 'undefined') return

    function reconcileFromUrl() {
      const info = venueInfo.value
      if (!info) return
      const base = appointmentsBasePath()
      if (!base) return
      const trail = window.location.pathname.slice(base.length).replace(/\/+$/, '')
      const detailMatch = trail.match(/^\/services\/(.+)$/)

      if (!detailMatch) {
        setDetailViewProduct(null)
        return
      }

      const productId = decodeURIComponent(detailMatch[1])
      const product = info.products.find(p => p.id === productId && p.type !== 'CLASS')
      if (!product) {
        // Stale or invalid product id — drop the deep link and show the list.
        window.history.replaceState({}, '', base + window.location.search + window.location.hash)
        setDetailViewProduct(null)
        return
      }
      const isAdded = selectedProducts.value.some(p => p.id === productId)
      setDetailViewProduct({ product, mode: isAdded ? 'edit' : 'add' })
    }

    reconcileFromUrl()
    window.addEventListener('popstate', reconcileFromUrl)
    return () => window.removeEventListener('popstate', reconcileFromUrl)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueInfo.value, props.flowType])

  // Skip the FIRST run of the state→URL effect: on mount detailViewProduct
  // is null, but the URL may already point at a detail (deep link or refresh).
  // If we push on mount we wipe the deep link before the reconcile effect can
  // hydrate state from venueInfo. After mount we trust state to drive URL.
  const didSyncUrl = useRef(false)
  useEffect(() => {
    if (props.flowType !== 'appointments') return
    if (typeof window === 'undefined') return
    if (!didSyncUrl.current) {
      didSyncUrl.current = true
      return
    }
    const base = appointmentsBasePath()
    if (!base) return

    const target = detailViewProduct
      ? `${base}/services/${encodeURIComponent(detailViewProduct.product.id)}`
      : base

    if (window.location.pathname.replace(/\/+$/, '') !== target) {
      window.history.pushState({}, '', target + window.location.search + window.location.hash)
    }
  }, [detailViewProduct, props.flowType])

  // Eager-load customer credits when the Square /appointments wizard reaches
  // the payment step with a logged-in customer. Surfaces the credit balance
  // to the customer BEFORE they submit so the "donde está para pagar con
  // créditos" question doesn't have to be answered post-submit. The existing
  // handleFormSubmit flow still consumes customerCredits.value to drive the
  // credit/payment selectors after the customer clicks Reserva cita.
  useEffect(() => {
    if (props.flowType !== 'appointments') return
    if (step.value !== config.formStep) return
    const customer = customerInfo.value
    const product = selectedProduct.value
    if (!customer || !product) return
    const phone = customer.phone ?? undefined
    const email = customer.email ?? undefined
    if (!phone && !email) return
    const seats = Math.max(selectedSpotIds.value.length, 1)
    // Multi-service: pass every selected productId so the server returns
    // balances for any of them. PaymentChoiceInline then verifies coverage
    // for ALL services before enabling "Pay with credits".
    const productIds = selectedProducts.value.length > 0
      ? selectedProducts.value.map(p => p.id)
      : [product.id]
    api.getCustomerCredits(props.venue, { phone, email, seats, productIds })
      .then(credits => { customerCredits.value = credits })
      .catch(() => { /* silent — picker just won't render */ })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.value, customerInfo.value?.id, selectedProduct.value?.id, selectedProducts.value.length, props.flowType, props.venue])

  // Slot hold: when the Square /appointments wizard reaches the payment step
  // with a slot picked, ask the server to hold that window for 10 min and
  // hydrate slotHoldExpiresAt + slotHoldToken so the PaymentStepHeader
  // countdown reflects the real backend TTL. If the endpoint isn't deployed
  // yet (404) the existing visual-only fallback inside the header keeps the
  // UX intact — backend optionality on purpose.
  useEffect(() => {
    if (props.flowType !== 'appointments') return
    if (step.value !== config.formStep) return
    const slot = selectedSlot.value
    if (!slot) return
    // Only create one hold per slot — react re-renders shouldn't fire dupes.
    if (slotHoldToken.value) return
    const products = selectedProducts.value.length > 0
      ? selectedProducts.value
      : (selectedProduct.value ? [selectedProduct.value] : [])
    // Race protection: capture the step we were on at request time. If the
    // user clicks back BEFORE the createHold response arrives, the cancelHold
    // effect (below) sees `slotHoldToken.value === null` and no-ops — and the
    // late response would set the token AFTER step changed, leaving an
    // orphan hold on the server. We check step.value when the response
    // resolves and cancel inline if we've already moved on.
    const requestedAtStep = step.value
    api.createHold(props.venue, {
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
      productIds: products.map(p => p.id),
      classSessionId: slot.classSessionId ?? undefined,
      partySize: Math.max(selectedSpotIds.value.length, 1),
    })
      .then(res => {
        if (step.value !== requestedAtStep) {
          // User navigated back during the in-flight request. Don't store the
          // token in widget state — just release it on the server.
          api.cancelHold(props.venue, res.holdId).catch(() => { /* silent */ })
          return
        }
        slotHoldToken.value = res.holdId
        slotHoldExpiresAt.value = new Date(res.expiresAt).getTime()
      })
      .catch(() => {
        // Backend not deployed yet, or the slot was already taken. Either way
        // PaymentStepHeader will fall back to a visual-only 10-min counter.
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.value, selectedSlot.value?.startsAt, props.flowType, props.venue])

  // Release the hold when the customer navigates away from the form step
  // (back button to time picker, full reset, etc). The cancel endpoint is
  // idempotent — failures are silent.
  useEffect(() => {
    if (props.flowType !== 'appointments') return
    if (step.value === config.formStep) return
    const token = slotHoldToken.value
    if (!token) return
    api.cancelHold(props.venue, token).catch(() => { /* silent */ })
    slotHoldToken.value = null
    slotHoldExpiresAt.value = null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.value, props.flowType, props.venue])

  // Release the slot hold when the page unloads (tab close, browser back,
  // navigation away from book.avoqado.io). The React/Preact effect cleanup
  // doesn't reliably fire on hard unload, so we use navigator.sendBeacon
  // which fires a fire-and-forget HTTP request that the browser GUARANTEES
  // to deliver even after the document has been torn down. Without this,
  // an abandoned hold sits for the full 10-min TTL.
  useEffect(() => {
    if (props.flowType !== 'appointments') return
    const handler = () => {
      const token = slotHoldToken.value
      if (!token) return
      const url = `/api/v1/public/venues/${encodeURIComponent(props.venue)}/reservations/hold/${encodeURIComponent(token)}`
      // sendBeacon doesn't natively support DELETE — but our server's route
      // file accepts the cancel via DELETE only. Fall back to fetch with
      // keepalive:true which has the same fire-and-forget semantics during
      // unload across all evergreen browsers.
      try {
        fetch(url, { method: 'DELETE', keepalive: true }).catch(() => {})
      } catch {
        /* unload-time errors are silenced */
      }
    }
    window.addEventListener('pagehide', handler)
    window.addEventListener('beforeunload', handler)
    return () => {
      window.removeEventListener('pagehide', handler)
      window.removeEventListener('beforeunload', handler)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.flowType, props.venue])

  // Visibility-based freshness refresh. Square's pattern: when the customer
  // returns to a tab that has been hidden long enough that the catalog could
  // plausibly have shifted under them (price change, product deleted, hours
  // updated, credits redeemed elsewhere), re-fetch venueInfo + customerCredits
  // and warn the customer if anything material changed. Threshold = 5 min,
  // same as Square's stale-tab heuristic.
  const lastHiddenAtRef = useRef<number | null>(null)
  useEffect(() => {
    if (typeof document === 'undefined') return

    async function refreshStaleVenue() {
      try {
        const fresh = await api.getVenueInfo(props.venue)
        const prev = venueInfo.value
        if (!prev) return
        // Compare only the fields that matter for the customer's in-flight
        // booking — id, name, price, duration. Image / description churn is
        // fine to swallow silently.
        const sig = (p: typeof prev.products[number]) => `${p.id}|${p.name}|${p.price}|${p.duration}`
        const prevSig = prev.products.map(sig).join('\n')
        const freshSig = fresh.products.map(sig).join('\n')
        const productsChanged = prevSig !== freshSig
        const hoursChanged = JSON.stringify(prev.operatingHours) !== JSON.stringify(fresh.operatingHours)
        if (!productsChanged && !hoursChanged) return

        venueInfo.value = fresh
        branding.value = fresh.branding ?? DEFAULT_BRANDING

        // Drop any selected services that are no longer in the catalog. If
        // EVERY selected service vanished, route the customer back to the
        // service step so they can rebuild their cart from scratch.
        const freshIds = new Set(fresh.products.map(p => p.id))
        const stillValid = selectedProducts.value.filter(p => freshIds.has(p.id))
        if (stillValid.length !== selectedProducts.value.length) {
          selectedProducts.value = stillValid
          selectedProduct.value = stillValid[0] ?? null
          if (stillValid.length === 0 && step.value > config.serviceStep) {
            step.value = config.serviceStep
          }
          showToast(
            props.locale === 'en'
              ? 'Some services were updated. Please review your appointment.'
              : 'Algunos servicios cambiaron. Revisa tu cita.',
            'error',
          )
        } else if (productsChanged || hoursChanged) {
          showToast(
            props.locale === 'en' ? 'The catalog was updated.' : 'El catálogo se actualizó.',
            'success',
          )
        }

        // Refresh the customer's credit balance too — they may have redeemed
        // credits in another tab while this one was hidden.
        const customer = customerInfo.value
        const product = selectedProduct.value
        if (customer && (customer.phone || customer.email) && product) {
          const seats = Math.max(selectedSpotIds.value.length, 1)
          const productIds = selectedProducts.value.length > 0
            ? selectedProducts.value.map(p => p.id)
            : [product.id]
          api.getCustomerCredits(props.venue, {
            email: customer.email ?? undefined,
            phone: customer.phone ?? undefined,
            seats,
            productIds,
          })
            .then(c => { customerCredits.value = c })
            .catch(() => { /* silent — picker just won't update */ })
        }
      } catch {
        /* network blip — leave the customer with what they had */
      }
    }

    function onVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        lastHiddenAtRef.current = Date.now()
        return
      }
      if (document.visibilityState !== 'visible') return
      const hiddenAt = lastHiddenAtRef.current
      lastHiddenAtRef.current = null
      if (!hiddenAt) return
      const hiddenFor = Date.now() - hiddenAt
      if (hiddenFor < 5 * 60 * 1000) return // <5 min — don't bother
      refreshStaleVenue()
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.venue, props.locale])

  // Fetch available slots for a date
  function fetchSlots() {
    const date = selectedDate.value
    const info = venueInfo.value
    if (!date || !info) return
    setSlotsLoading(true)
    // Map UI flow type → server type filter. 'unified' sends no filter, so
    // server returns the full result as before. The mapping is intentionally
    // explicit so future flow types (e.g. 'eventos') can extend it cleanly.
    const flow = flowType.value
    const typeFilter: 'class' | 'appointment' | undefined =
      flow === 'classes' ? 'class' : flow === 'appointments' ? 'appointment' : undefined
    // Multi-service: ask the backend for slots wide enough to fit EVERY
    // selected service back-to-back. Without this, a 45 + 30 min booking
    // shows 45-min slots and the customer hits a 409 at submit when their
    // 75-min appointment collides with an existing reservation.
    const combinedDuration = totalDuration.value > 0
      ? totalDuration.value
      : (selectedProduct.value?.duration ?? undefined)
    api.getAvailability(props.venue, {
      date,
      productId: selectedProduct.value?.id,
      duration: combinedDuration,
      type: typeFilter,
    })
      .then(res => setSlots(res.slots))
      .catch(() => setSlots([]))
      .finally(() => setSlotsLoading(false))
  }

  // Load availability when date changes
  useEffect(() => {
    fetchSlots()
  }, [selectedDate.value, selectedProduct.value?.id])

  // Dispatch custom events on host element
  function dispatchEvent(name: string, detail: Record<string, unknown>) {
    props.hostElement.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true, detail }))
  }

  if (isLoading.value) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '64px 0', gap: '12px' }}>
        <Spinner size={28} />
        <p style={{ fontSize: '13px', color: 'var(--avq-muted-fg, #9ca3af)' }}>{t('time.loading')}</p>
      </div>
    )
  }

  if (apiError.value) {
    return (
      <div class="avq-animate-in" style={{ padding: '48px 0', textAlign: 'center' }}>
        <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'var(--avq-muted, #f8f9fb)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
          <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--avq-muted-fg, #6b7280)" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        </div>
        <p style={{ fontWeight: '600', color: 'var(--avq-fg, #111827)', marginBottom: '8px' }}>{apiError.value}</p>
        <button
          type="button"
          onClick={() => { apiError.value = null; isLoading.value = false }}
          style={{ fontSize: '14px', color: 'var(--avq-accent, #6366f1)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: '2px' }}
        >
          {t('actions.retry')}
        </button>
      </div>
    )
  }

  const info = venueInfo.value
  if (!info) return null

  if (!info.publicBooking.enabled) {
    return (
      <div class="avq-animate-in" style={{ padding: '48px 0', textAlign: 'center' }}>
        <div style={{ width: '56px', height: '56px', borderRadius: '50%', background: 'var(--avq-muted, #f8f9fb)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--avq-muted-fg, #6b7280)" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        </div>
        <h2 style={{ fontSize: '18px', fontWeight: '600', color: 'var(--avq-fg, #111827)', marginBottom: '6px' }}>{t('errors.bookingDisabled')}</h2>
        <p style={{ fontSize: '14px', color: 'var(--avq-muted-fg, #6b7280)', marginBottom: '20px' }}>{t('errors.bookingDisabledDescription')}</p>
        {info.phone && (
          <a
            href={`tel:${info.phone}`}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '8px',
              padding: '10px 20px', borderRadius: '10px',
              border: '1px solid var(--avq-border, #e8eaed)',
              fontSize: '14px', color: 'var(--avq-fg, #111827)',
              textDecoration: 'none', transition: 'border-color 0.2s ease',
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
            {t('errors.bookingDisabledContact', { phone: info.phone })}
          </a>
        )}
      </div>
    )
  }

  // Customer portal screen
  if (showPortal.value) {
    return (
      <div>
        {/* Venue header */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', marginBottom: '28px', paddingTop: '4px' }}>
          {info.logo ? (
            <img src={info.logo} alt={info.name} style={{ width: '56px', height: '56px', borderRadius: '14px', objectFit: 'cover', boxShadow: 'var(--avq-card-shadow, 0 1px 3px rgba(0,0,0,0.04))', border: '1px solid var(--avq-border, #e8eaed)' }} />
          ) : (
            <div style={{ width: '56px', height: '56px', borderRadius: '14px', background: 'var(--avq-accent, #6366f1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px', fontWeight: '700', color: '#ffffff', boxShadow: '0 2px 8px rgba(99,102,241,0.25)' }}>
              {info.name.charAt(0).toUpperCase()}
            </div>
          )}
          <h1 style={{ fontSize: '18px', fontWeight: '700', color: 'var(--avq-fg, #111827)', margin: 0, letterSpacing: '-0.01em' }}>{info.name}</h1>
        </div>

        <CustomerPortal
          venueSlug={props.venue}
          timezone={info.timezone}
          venuePhone={info.phone}
          t={t}
          onBack={() => {
            showPortal.value = false
            portalData.value = null
          }}
          onManageBooking={(cancelSecret) => {
            showPortal.value = false
            manageSecret.value = cancelSecret
            step.value = MANAGE_STEP
          }}
        />
        {/* Avoqado footer — suppressed when the host page renders its own
            (book.avoqado.io sets hide-venue-header=true and owns the chrome). */}
        {!props.hideVenueHeader && (
          <div style={{ marginTop: '32px', textAlign: 'center', paddingBottom: '4px' }}>
            <a href="https://avoqado.io" target="_blank" rel="noopener noreferrer" class="avq-footer-link" style={{ fontSize: '12px', justifyContent: 'center' }}>
              <AvoqadoLogo />
              <span>{t('poweredBy')}</span>
            </a>
          </div>
        )}
      </div>
    )
  }

  // Manage booking screen
  if (step.value === MANAGE_STEP) {
    return (
      <div>
        <ManageBooking
          venueSlug={props.venue}
          cancelSecret={manageSecret.value!}
          timezone={info.timezone}
          venueInfo={info}
          t={t}
          onBack={() => resetBooking(info)}
        />
        {!props.hideVenueHeader && (
          <div style={{ marginTop: '32px', textAlign: 'center', paddingBottom: '4px' }}>
            <a href="https://avoqado.io" target="_blank" rel="noopener noreferrer" class="avq-footer-link" style={{ fontSize: '12px', justifyContent: 'center' }}>
              <AvoqadoLogo />
              <span>{t('poweredBy')}</span>
            </a>
          </div>
        )}
      </div>
    )
  }

  const stepLabels = hasServiceStep.value
    ? [t('steps.service'), t('steps.date'), t('steps.time'), t('steps.info'), t('steps.confirmation')]
    : [t('steps.date'), t('steps.time'), t('steps.info'), t('steps.confirmation')]

  // Auto-skip the GuestInfoForm when the logged-in customer already has every
  // field the venue needs. We submit on their behalf with the saved data, so
  // the experience matches "Reservar" buttons on signed-in dashboards (Square,
  // Mindbody) where the form never re-appears once the account is known.
  // EXCEPT on the Square /appointments wizard — there the customer expects
  // a review screen with "Reserva cita" before the booking actually creates.
  useEffect(() => {
    if (step.value !== config.formStep) return
    if (flowType.value === 'appointments') return
    if (showCreditSelector || showNoCreditsBuyPrompt || showPaymentSelector) return
    const c = customerInfo.value
    if (!c) return
    const hasName = Boolean(c.firstName)
    const hasPhone = Boolean(c.phone)
    const hasEmail = Boolean(c.email)
    const venueRequiresEmail = info.publicBooking.requireEmail
    const venueRequiresPhone = info.publicBooking.requirePhone !== false
    const allRequiredCovered =
      hasName && (!venueRequiresPhone || hasPhone) && (!venueRequiresEmail || hasEmail)
    if (!allRequiredCovered) return
    // Auto-submit using the saved customer data; downstream logic (PaymentSelector,
    // credit redemption, deposit) still gets a chance to interrupt before the
    // reservation actually creates.
    const fullName = [c.firstName, c.lastName].filter(Boolean).join(' ') || c.firstName || ''
    handleFormSubmit({
      guestName: fullName,
      guestPhone: c.phone ?? '',
      guestEmail: c.email ?? undefined,
      partySize: Math.max(selectedSpotIds.value.length, 1),
      specialRequests: undefined,
    } as GuestFormData)
    // Eslint exhaustive-deps would want handleFormSubmit + info, but those
    // are stable for the lifetime of a non-changing booking session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.value, customerInfo.value?.id, showCreditSelector, showNoCreditsBuyPrompt, showPaymentSelector])

  // The global back button is suppressed inside the ClassDetailView (which has
  // its own Atrás link) and on the listing itself. It still fires for the
  // appointments wizard's middle steps and the class flow's seat picker / form.
  const showBack = !showLanding && !classDetailActive && (
    (step.value > (hasServiceStep.value ? config.serviceStep : config.dateStep) && step.value < config.confirmStep)
    || (step.value === config.timeStep && seatPickerActive)
  ) && !(flowType.value === 'classes' && step.value === config.dateStep)

  function handleBack() {
    // If showing no-credits buy prompt, go back to form
    if (showNoCreditsBuyPrompt) {
      setShowNoCreditsBuyPrompt(false)
      setPendingFormData(null)
      return
    }
    // If showing credit selector, go back to form
    if (showCreditSelector) {
      setShowCreditSelector(false)
      setPendingFormData(null)
      return
    }
    // If showing payment selector (Phase 3 hybrid path), go back to form
    if (showPaymentSelector) {
      setShowPaymentSelector(false)
      setPendingFormData(null)
      return
    }
    // Class flow has a flat listing — back from form goes back to the list,
    // not to the date picker (which doesn't exist in this flow).
    if (flowType.value === 'classes') {
      if (step.value === config.formStep) {
        selectedSlot.value = null
        selectedSpotIds.value = []
        selectedProduct.value = null
        step.value = config.dateStep // re-renders ClassSessionList
        return
      }
      if (step.value === config.timeStep && seatPickerActive) {
        setSeatPickerActive(false)
        selectedSlot.value = null
        selectedSpotIds.value = []
        selectedProduct.value = null
        step.value = config.dateStep
        return
      }
    }
    if (step.value === config.formStep) {
      // If product has layout, go back to seat picker
      if (selectedProduct.value?.layoutConfig && selectedSlot.value?.classSessionId) {
        setSeatPickerActive(true)
        step.value = config.timeStep
      } else {
        fetchSlots() // Refresh capacity data when going back to time picker
        step.value = config.timeStep
      }
    } else if (step.value === config.timeStep) {
      if (seatPickerActive) {
        // Going back from seat picker to time slot selection
        setSeatPickerActive(false)
        selectedSlot.value = null
        selectedSpotIds.value = []
      } else {
        step.value = config.dateStep
      }
    } else if (step.value === config.dateStep && hasServiceStep.value) step.value = config.serviceStep
  }

  // Handle buying a credit pack — show checkout form first
  function handleBuyPack(packId: string) {
    setCheckoutPackId(packId)
    setCheckoutPhone('')
    setCheckoutEmail('')
  }

  async function handleCheckoutSubmit() {
    if (!checkoutPackId || !checkoutPhone.trim()) return
    setBuyingPackId(checkoutPackId)
    try {
      const phone = checkoutPhone.trim()
      const email = checkoutEmail.trim() || undefined

      // Stash the contact info so we can re-fetch the balance when Stripe redirects back.
      try {
        sessionStorage.setItem('avq:pendingCheckout', JSON.stringify({ phone, email, venue: props.venue }))
      } catch { /* sessionStorage may be blocked in 3rd-party iframes — non-fatal */ }

      // Build success URL with a flag so we know we came back from a successful checkout.
      const url = new URL(window.location.href)
      url.searchParams.set('avq_credits', 'success')
      const successUrl = url.toString()
      url.searchParams.set('avq_credits', 'cancel')
      const cancelUrl = url.toString()

      const result = await api.createPackCheckout(props.venue, checkoutPackId, {
        phone,
        email,
        successUrl,
        cancelUrl,
      })
      if (result.checkoutUrl) {
        window.location.href = result.checkoutUrl
      }
    } catch (err: any) {
      showToast(err.data?.message ?? t('errors.generic'), 'error')
    } finally {
      setBuyingPackId(null)
    }
  }

  // Submit reservation. `creditPayload` accepts either a single balance ID
  // (legacy single-service path) or a list (Square multi-service redemption,
  // where each selected service consumes its own balance).
  async function submitReservation(
    data: GuestFormData,
    creditPayload?: string | string[],
  ) {
    const slot = selectedSlot.value
    if (!slot) return
    isLoading.value = true
    try {
      const spots = selectedSpotIds.value
      const creditBalanceId = typeof creditPayload === 'string' ? creditPayload : undefined
      const creditBalanceIds = Array.isArray(creditPayload) && creditPayload.length > 0 ? creditPayload : undefined
      // If the venue requires upfront payment, the server will return checkoutUrl
      // and we'll redirect to Stripe. Tell Stripe where to send the customer back.
      const successUrl = (() => {
        const u = new URL(window.location.href)
        u.searchParams.set('avq_payment', 'success')
        return u.toString()
      })()
      const cancelUrl = (() => {
        const u = new URL(window.location.href)
        u.searchParams.set('avq_payment', 'cancelled')
        return u.toString()
      })()
      // Multi-service appointments: send the full ordered productIds[] when
      // the customer picked more than one service. The server sums durations
      // and uses productIds[0] as the lead product for legacy joins.
      const multiProductIds = selectedProducts.value.length > 1
        ? selectedProducts.value.map(p => p.id)
        : undefined
      // Authoritative fallback: the slot window the customer picked. Used when
      // any selected product is missing duration (legacy data — admin created
      // an APPOINTMENTS_SERVICE before the dashboard form required it). The
      // slot window already came from /availability which used the venue's
      // defaultDurationMin, so this is the same number the server already
      // committed to when it offered the slot.
      const slotWindowMinutes = Math.round(
        (new Date(slot.endsAt).getTime() - new Date(slot.startsAt).getTime()) / 60000,
      )
      // Match the duration the /availability call used to size this slot.
      // totalDuration includes modifier durationMin deltas (e.g. Rubber Base
      // 20min + Gel modifier 20min = 40min). If we send the bare product
      // duration here while slot.endsAt - slot.startsAt reflects the extended
      // window, the server's Zod refine rejects with "duration no coincide
      // con el rango de fechas".
      const combinedDuration = totalDuration.value > 0 ? totalDuration.value : slotWindowMinutes
      const result = await api.createReservation(props.venue, {
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        duration: combinedDuration,
        guestName: data.guestName,
        guestPhone: data.guestPhone,
        guestEmail: data.guestEmail || undefined,
        partySize: spots.length > 0 ? spots.length : (data.partySize || undefined),
        productId: selectedProduct.value?.id,
        productIds: multiProductIds,
        classSessionId: slot.classSessionId || undefined,
        spotIds: spots.length > 0 ? spots : undefined,
        specialRequests: data.specialRequests || undefined,
        creditItemBalanceId: creditBalanceId || undefined,
        creditItemBalanceIds: creditBalanceIds,
        modifierSelections: selectedModifiers.value.length > 0 ? selectedModifiers.value : undefined,
        holdId: slotHoldToken.value ?? undefined,
        successUrl,
        cancelUrl,
      }, customerToken.value ?? undefined /* Bearer token stamps customerId server-side */)
      // Upfront-payment-required path: server pre-created the reservation in PENDING
      // and minted a Stripe Checkout session. Hand off to Stripe; the webhook will
      // flip the reservation to CONFIRMED on payment success.
      if (result.checkoutUrl) {
        try {
          sessionStorage.setItem('avq:pendingReservation', JSON.stringify({
            venue: props.venue,
            cancelSecret: result.cancelSecret,
            confirmationCode: result.confirmationCode,
          }))
        } catch { /* sessionStorage may be blocked in 3rd-party iframes — non-fatal */ }
        window.location.href = result.checkoutUrl
        return
      }
      bookingResult.value = result
      step.value = config.confirmStep
      setShowCreditSelector(false)
      setPendingFormData(null)
      dispatchEvent('avoqado:confirmed', {
        confirmationCode: result.confirmationCode,
        startsAt: result.startsAt,
        endsAt: result.endsAt,
        productName: selectedProduct.value?.name,
      })
    } catch (err: any) {
      if (err.status === 409) {
        showToast(t('errors.slotTaken'), 'error')
        selectedSlot.value = null
        fetchSlots()
        step.value = config.timeStep
        setShowCreditSelector(false)
        setPendingFormData(null)
      } else {
        showToast(err.data?.message ?? t('errors.generic'), 'error')
      }
    } finally {
      isLoading.value = false
    }
  }

  /** Number of credits this booking will consume (1 per seat, fallback partySize, default 1). */
  function bookingSeatCount(data: GuestFormData): number {
    const spots = selectedSpotIds.value
    if (spots.length > 0) return spots.length
    if (data.partySize && data.partySize > 0) return data.partySize
    return 1
  }

  async function handleFormSubmit(data: GuestFormData) {
    // Square /appointments inline picker short-circuit: if the customer
    // already chose how they want to pay on the form screen, skip the
    // credit-check round trip and submit directly. Cash for "Pagar al
    // llegar" → no balance ID; credits → pass the chosen balance through.
    if (inlinePayment) {
      if (inlinePayment.kind === 'credits') {
        // Multi-service: send all per-product balance IDs so the server can
        // redeem from each in one transaction. Single-service keeps the
        // legacy single-balance shape for back-compat with class redemption.
        const balanceIds = Object.values(inlinePayment.balanceIdsByProduct)
        if (balanceIds.length > 1) {
          await submitReservation(data, balanceIds)
        } else {
          await submitReservation(data, inlinePayment.creditBalanceId)
        }
      } else {
        await submitReservation(data)
      }
      return
    }

    // Check if customer has credits for the selected product
    const productId = selectedProduct.value?.id
    const requiresCredit = selectedProduct.value?.requireCreditForBooking === true
    const cashPrice = selectedProduct.value?.price ?? 0
    const upfrontPolicy = selectedProduct.value?.upfrontPolicy
    const seats = bookingSeatCount(data)

    if (productId && (data.guestEmail || data.guestPhone)) {
      try {
        const credits = await api.getCustomerCredits(props.venue, {
          email: data.guestEmail || undefined,
          phone: data.guestPhone,
          seats,
          productId,
        })
        customerCredits.value = credits

        // Any matching balance with the right product?
        const matching = credits.purchases
          .filter(p => p.status === 'ACTIVE')
          .flatMap(p => p.itemBalances)
          .filter(b => b.productId === productId && b.remainingQuantity > 0)

        const hasAnyCredits = matching.length > 0

        if (hasAnyCredits) {
          // Phase 3 hybrid path: when product accepts BOTH cash and credits AND
          // customer has matching credits, show the policy-aware PaymentSelector
          // so they can choose explicitly. Otherwise fall back to the legacy
          // CreditSelector (which is purpose-built for credit-required products).
          const isHybrid = !requiresCredit && cashPrice > 0 && !!upfrontPolicy
          setPendingFormData(data)
          if (isHybrid) {
            setShowPaymentSelector(true)
          } else {
            setShowCreditSelector(true)
          }
          return
        }

        // No matching credits at all — block if required, show buy prompt
        if (requiresCredit) {
          setPendingFormData(data)
          setShowNoCreditsBuyPrompt(true)
          return
        }
      } catch {
        // No credits found or error
        if (requiresCredit) {
          setPendingFormData(data)
          setShowNoCreditsBuyPrompt(true)
          return
        }
      }
    } else if (requiresCredit) {
      // Can't check credits without contact info
      showToast(t('creditPacks.requiredNoCredits'), 'error')
      return
    }

    // No credits available — submit directly
    await submitReservation(data)
  }

  // Apply the venue's resolved brand accent as --avq-accent unless the host
  // element supplied an explicit `accent-color` attribute (which already set it
  // on .avq-root). Prefer the resolved reservation branding accent (which the
  // server already resolves as accentColor ?? primaryColor) so this inner
  // override stays consistent with the .avq-root token set in App.tsx — using
  // raw primaryColor here would shadow a venue's custom branding.accentColor
  // for the whole booking subtree. Loses to an explicit embedder override.
  const venueAccent = branding.value.accentColor ?? info.primaryColor
  const accentOverride = !props.accentColor && venueAccent
    ? { ['--avq-accent' as any]: venueAccent }
    : undefined

  return (
    <div style={accentOverride}>
      {/* Venue header — suppressed when the host page already shows the brand
          (e.g. book.avoqado.io's topnav). External embeds keep it. */}
      {!props.hideVenueHeader && (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px',
        marginBottom: '28px', paddingTop: '4px',
      }}>
        {info.logo ? (
          <img
            src={info.logo}
            alt={info.name}
            style={{
              width: '56px', height: '56px', borderRadius: '14px', objectFit: 'cover',
              boxShadow: 'var(--avq-card-shadow, 0 1px 3px rgba(0,0,0,0.04))',
              border: '1px solid var(--avq-border, #e8eaed)',
            }}
          />
        ) : (
          <div style={{
            width: '56px', height: '56px', borderRadius: '14px',
            background: 'var(--avq-accent, #6366f1)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '22px', fontWeight: '700', color: '#ffffff',
            boxShadow: '0 2px 8px rgba(99,102,241,0.25)',
          }}>
            {info.name.charAt(0).toUpperCase()}
          </div>
        )}
        <h1 style={{ fontSize: '18px', fontWeight: '700', color: 'var(--avq-fg, #111827)', margin: 0, letterSpacing: '-0.01em' }}>
          {info.name}
        </h1>
        {/* My Account link */}
        <button
          type="button"
          onClick={() => { showPortal.value = true }}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: '4px',
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: '13px', fontWeight: '500',
            color: 'var(--avq-accent, #6366f1)',
            padding: 0,
          }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
          {t('portal.myAccount')}
        </button>
      </div>
      )}

      {/* Timezone modal — shown only when browser TZ differs from venue TZ and
          the customer hasn't picked a preference yet. Persists choice in localStorage. */}
      <TimezoneModal
        venueTz={info.timezone}
        venueName={info.name}
        onChoose={setTzPreference}
        t={t}
      />

      {/* Step indicator — hidden for:
          - the class flow (the list IS the selector)
          - the unified landing (no concept of "steps" yet)
          - the Square-style /appointments wizard (sidebar Resumen handles wayfinding) */}
      {step.value < config.confirmStep && flowType.value !== 'classes' && flowType.value !== 'appointments' && !showLanding && (
        <StepIndicator
          currentStep={step.value}
          totalSteps={config.totalSteps}
          labels={stepLabels}
        />
      )}

      {/* Back button */}
      {showBack && (
        <button
          type="button"
          onClick={handleBack}
          style={{
            display: 'flex', alignItems: 'center', gap: '4px',
            marginBottom: '16px', padding: '4px 0',
            fontSize: '13px', fontWeight: '500',
            color: 'var(--avq-muted-fg, #6b7280)',
            background: 'none', border: 'none', cursor: 'pointer',
            transition: 'color 0.2s ease',
          }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
          {t('actions.goBack')}
        </button>
      )}

      {/* Steps */}
      <div class="avq-animate-in" key={`${step.value}-${showLanding}`}>
        {/* Reservation hero — wide cover photo above the appointments service
            step, gated by branding.showHeroImage + a configured heroImageUrl. */}
        {!showLanding && flowType.value === 'appointments' && step.value === config.serviceStep &&
          branding.value.showHeroImage && info.heroImageUrl && (
          <ReservationHero imageUrl={info.heroImageUrl} alt={info.name} />
        )}
        {/* Unified landing: two-CTA picker shown only when entering via /<slug>. */}
        {showLanding && flowType.value === 'unified' && (
          <UnifiedLanding
            products={info.products}
            creditPacks={creditPacks.value}
            buyingPackId={buyingPackId}
            initialTab={landingInitialTab}
            heroImageUrl={info.heroImageUrl ?? null}
            venueName={info.name}
            onBuyPack={handleBuyPack}
            onPickAppointments={() => {
              flowType.value = 'appointments'
              setShowLanding(false)
              if (typeof window !== 'undefined' && window.history?.pushState) {
                const base = window.location.pathname.replace(/\/+$/, '')
                window.history.pushState({}, '', `${base}/appointments${window.location.search}`)
              }
              resetBooking(info)
            }}
            onPickClasses={() => {
              flowType.value = 'classes'
              setShowLanding(false)
              if (typeof window !== 'undefined' && window.history?.pushState) {
                const base = window.location.pathname.replace(/\/+$/, '')
                window.history.pushState({}, '', `${base}/classes${window.location.search}`)
              }
              resetBooking(info)
            }}
            t={t}
          />
        )}

        {/* Class flow: date-first listing replaces service/date/time steps.
            On desktop (>=880px) we render a 2-col layout with the venue summary
            + pack CTA on the right; mobile collapses to single column. */}
        {/* Class detail intermediate screen — shown after a slot is picked
            from the listing, before the seat picker / form. Lets the customer
            see capacity, instructor, description, and confirm with a clear
            Reservar CTA. */}
        {!showLanding && flowType.value === 'classes' && step.value < config.formStep && !seatPickerActive && classDetailActive && selectedSlot.value && (
          <ClassDetailView
            slot={selectedSlot.value as PublicClassSessionSlot}
            product={selectedProduct.value}
            timezone={resolveDisplayTz(info.timezone)}
            onBook={() => {
              setClassDetailActive(false)
              if (selectedProduct.value?.layoutConfig) {
                setSeatPickerActive(true)
                step.value = config.timeStep
              } else {
                step.value = config.formStep
              }
            }}
            onBack={() => {
              setClassDetailActive(false)
              selectedSlot.value = null
              selectedProduct.value = null
            }}
            t={t}
          />
        )}

        {!showLanding && flowType.value === 'classes' && step.value < config.formStep && !seatPickerActive && !classDetailActive && (
          <div class="avq-classes-layout">
            <div class="avq-classes-main">
              <ClassSessionList
                venueSlug={props.venue}
                timezone={resolveDisplayTz(info.timezone)}
                venuePhone={info.phone ?? null}
                products={info.products}
                onBuyPack={creditPacks.value.length > 0 ? () => {
                  // No classes scheduled, but customer can pre-buy a pack so
                  // they're ready when sessions appear. Routes to the unified
                  // landing's packs tab.
                  flowType.value = 'unified'
                  setLandingInitialTab('packs')
                  setShowLanding(true)
                  if (typeof window !== 'undefined' && window.history?.replaceState) {
                    const path = window.location.pathname.replace(/\/classes\/?$/, '/')
                    window.history.replaceState({}, '', path + window.location.search)
                  }
                } : undefined}
                onSelect={(slot: PublicClassSessionSlot) => {
                  // Phase 10: route the tap into the intermediate detail view
                  // instead of jumping straight to seat/form. Detail's "Reservar"
                  // button picks up from here.
                  const product = info.products.find(p => p.id === slot.productId) ?? null
                  selectedProduct.value = product
                  selectedSlot.value = slot
                  selectedSpotIds.value = []
                  setClassDetailActive(true)
                }}
                onExit={() => {
                  flowType.value = 'unified'
                  if (typeof window !== 'undefined' && window.history?.replaceState) {
                    const path = window.location.pathname.replace(/\/classes\/?$/, '/')
                    window.history.replaceState({}, '', path + window.location.search)
                  }
                  resetBooking(info)
                }}
                t={t}
              />
            </div>
            <aside class="avq-classes-sidebar">
              <VenueSidebarCard
                info={info}
                creditPacks={creditPacks.value}
                onBuyPack={handleBuyPack}
                customerInfo={customerInfo.value}
                t={t}
              />
            </aside>
            <style>{`
              .avq-classes-layout { display: grid; grid-template-columns: 1fr; gap: 0; }
              .avq-classes-main { min-width: 0; }
              .avq-classes-main > * { min-width: 0; }
              .avq-classes-sidebar { display: none; }
              @media (min-width: 960px) {
                .avq-classes-layout {
                  grid-template-columns: minmax(0, 1fr) 260px;
                  gap: 24px;
                  align-items: start;
                }
                .avq-classes-sidebar { display: block; position: sticky; top: 24px; }
              }
            `}</style>
          </div>
        )}

        {/* /appointments service step — detail view branch.
            When a service is being added/edited, the screen goes full-width
            centered (Square pattern). The sidebar Resumen does NOT render
            here; it returns once the customer confirms via Añadir/Actualizar
            and falls back to the list. */}
        {!showLanding && flowType.value === 'appointments' && step.value === config.serviceStep && hasServiceStep.value && detailViewProduct && (
          <div style={{ maxWidth: '720px', margin: '0 auto', padding: '0 4px' }}>
            <ServiceDetailView
              product={detailViewProduct.product}
              mode={detailViewProduct.mode}
              onAdd={() => {
                addSelectedProduct(detailViewProduct.product)
                setDetailViewProduct(null)
              }}
              onUpdate={() => setDetailViewProduct(null)}
              onRemove={() => {
                removeSelectedProduct(detailViewProduct.product.id)
                setDetailViewProduct(null)
              }}
              onBack={() => setDetailViewProduct(null)}
              t={t}
            />
          </div>
        )}

        {/* /appointments service step — list branch (2-col with sidebar). */}
        {!showLanding && flowType.value === 'appointments' && step.value === config.serviceStep && hasServiceStep.value && !detailViewProduct && (
          <div class="avq-appts-layout">
            <div class="avq-appts-main">
              <ServiceSelector
                products={visibleProducts.value}
                selectedProductIds={selectedProducts.value.map(p => p.id)}
                onOpenDetail={(product) => {
                  const isAdded = selectedProducts.value.some(p => p.id === product.id)
                  setDetailViewProduct({ product, mode: isAdded ? 'edit' : 'add' })
                }}
                t={t}
              />
              {/* CreditPackBanner removed from /appointments here — the top-nav
                  "Comprar créditos" button now owns the buy-a-pack entry point.
                  The banner survives in the no-credits-buy-prompt sub-state
                  (further down) where context demands it inline. */}
            </div>
            <aside class="avq-appts-sidebar">
              <AppointmentSummarySidebar
                products={selectedProducts.value}
                totalPrice={totalPrice.value}
                totalDuration={totalDuration.value}
                onEditProduct={(product) => setDetailViewProduct({ product, mode: 'edit' })}
                onNext={() => {
                  // Keep the legacy single-product signal in sync so downstream
                  // (date/time/form steps still on Phase-pre-multi code) reads
                  // the lead service. Phase 4+ migrate them to selectedProducts.
                  selectedProduct.value = selectedProducts.value[0] ?? null
                  setDetailViewProduct(null)
                  step.value = config.dateStep
                }}
                nextDisabled={selectedProducts.value.length === 0}
                t={t}
              />
            </aside>
            <style>{`
              .avq-appts-layout { display: grid; grid-template-columns: 1fr; gap: 24px; }
              .avq-appts-main { min-width: 0; }
              /* Mobile: sidebar stacks below the main column so the customer
                 always sees Resumen + Siguiente. Desktop pins it to the right. */
              .avq-appts-sidebar { display: block; }
              @media (min-width: 880px) {
                .avq-appts-layout {
                  grid-template-columns: minmax(0, 1fr) 320px;
                  gap: 32px;
                  align-items: start;
                }
                .avq-appts-sidebar { position: sticky; top: 24px; }
              }
            `}</style>
          </div>
        )}

        {/* /appointments — Square-style merged date+time picker with sidebar */}
        {!showLanding && flowType.value === 'appointments' && (step.value === config.dateStep || step.value === config.timeStep) && !seatPickerActive && (
          <div class="avq-appts-layout">
            <div class="avq-appts-main">
              <DateTimePickerSquare
                selectedDate={selectedDate.value}
                onSelectDate={(date) => {
                  selectedDate.value = date
                  selectedSlot.value = null
                  step.value = config.timeStep
                }}
                selectedSlot={selectedSlot.value}
                onSelectSlot={(slot) => {
                  selectedSlot.value = slot
                  selectedSpotIds.value = []
                  if (selectedProduct.value?.layoutConfig && slot.classSessionId) {
                    setSeatPickerActive(true)
                  } else {
                    step.value = config.formStep
                  }
                }}
                slots={slots}
                slotsLoading={slotsLoading}
                timezone={info.timezone}
                operatingHours={info.operatingHours}
                maxAdvanceDays={info.scheduling?.maxAdvanceDays ?? 30}
                // Waitlist intentionally NOT wired: there is no public waitlist
                // endpoint yet, and the old placeholder just showed a success
                // toast without joining anything — misleading the customer.
                // Omitting onJoinWaitlist hides the CTA (DateTimePickerSquare
                // only renders it when the handler is provided). Re-add once a
                // real public join-waitlist API exists.
                locale={props.locale}
                t={t}
              />
            </div>
            <aside class="avq-appts-sidebar">
              <AppointmentSummarySidebar
                products={selectedProducts.value}
                totalPrice={totalPrice.value}
                totalDuration={totalDuration.value}
                selectedDate={selectedDate.value}
                selectedSlot={selectedSlot.value}
                onEditProduct={(product) => {
                  setDetailViewProduct({ product, mode: 'edit' })
                  step.value = config.serviceStep
                }}
                t={t}
              />
            </aside>
            <style>{`
              .avq-appts-layout { display: grid; grid-template-columns: 1fr; gap: 24px; }
              .avq-appts-main { min-width: 0; }
              /* Mobile: sidebar stacks below the main column so the customer
                 always sees Resumen + Siguiente. Desktop pins it to the right. */
              .avq-appts-sidebar { display: block; }
              @media (min-width: 880px) {
                .avq-appts-layout {
                  grid-template-columns: minmax(0, 1fr) 320px;
                  gap: 32px;
                  align-items: start;
                }
                .avq-appts-sidebar { position: sticky; top: 24px; }
              }
            `}</style>
          </div>
        )}

        {/* Legacy date/time blocks — preserved for any flow that isn't
            /appointments and isn't /classes (effectively unused since the
            unified flow lands on UnifiedLanding). Kept as a safety net. */}
        {!showLanding && flowType.value !== 'classes' && flowType.value !== 'appointments' && step.value === config.dateStep && (
          <div>
            <DatePicker
              selectedDate={selectedDate.value}
              onSelect={(date) => {
                selectedDate.value = date
                selectedSlot.value = null
                step.value = config.timeStep
              }}
              maxAdvanceDays={info.scheduling?.maxAdvanceDays ?? 30}
              timezone={info.timezone}
              operatingHours={info.operatingHours}
              t={t}
            />
            {!hasServiceStep.value && creditPacks.value.length > 0 && (
              <CreditPackBanner
                packs={creditPacks.value}
                onBuy={handleBuyPack}
                buyingPackId={buyingPackId}
                t={t}
              />
            )}
          </div>
        )}

        {!showLanding && flowType.value !== 'classes' && flowType.value !== 'appointments' && step.value === config.timeStep && !seatPickerActive && (
          <TimeSlotPicker
            slots={slots}
            selectedSlot={selectedSlot.value}
            onSelect={(slot) => {
              selectedSlot.value = slot
              selectedSpotIds.value = []
              if (selectedProduct.value?.layoutConfig && slot.classSessionId) {
                setSeatPickerActive(true)
              } else {
                step.value = config.formStep
              }
            }}
            timezone={info.timezone}
            isLoading={slotsLoading}
            t={t}
          />
        )}

        {step.value === config.timeStep && seatPickerActive && selectedProduct.value?.layoutConfig && selectedSlot.value && (
          <SeatPicker
            layout={selectedProduct.value.layoutConfig}
            takenSpotIds={selectedSlot.value.takenSpotIds ?? []}
            selectedSpotIds={selectedSpotIds.value}
            onToggleSpot={(spotId) => {
              const current = selectedSpotIds.value
              if (current.includes(spotId)) {
                selectedSpotIds.value = current.filter(id => id !== spotId)
              } else {
                selectedSpotIds.value = [...current, spotId]
              }
            }}
            onConfirm={() => {
              setSeatPickerActive(false)
              step.value = config.formStep
            }}
            t={t}
          />
        )}

        {step.value === config.formStep && (() => {
          /* Render the four mutually-exclusive form sub-states once, then wrap
             them in the Square 2-col layout when /appointments. Non-appointments
             paths inline the same body without the chrome. The sub-state
             branching matches the legacy semantics exactly. */
          const formStepBody = (
            <>
              {!showCreditSelector && !showNoCreditsBuyPrompt && !showPaymentSelector && (
                info.publicBooking.requireAccount && !customerInfo.value ? (
                  <div class="avq-animate-in" style={{ padding: '32px 16px', textAlign: 'center' }}>
                    <div style={{
                      width: '56px', height: '56px', borderRadius: '50%',
                      background: 'color-mix(in srgb, var(--avq-accent, #6366f1) 12%, var(--avq-bg, #fff))',
                      color: 'var(--avq-accent, #6366f1)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      margin: '0 auto 16px',
                    }}>
                      <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                        <circle cx="9" cy="7" r="4" />
                        <line x1="19" y1="8" x2="19" y2="14" />
                        <line x1="22" y1="11" x2="16" y2="11" />
                      </svg>
                    </div>
                    <h3 style={{ fontSize: '16px', fontWeight: '600', color: 'var(--avq-fg, #111827)', margin: '0 0 6px' }}>
                      {t('account.requireTitle')}
                    </h3>
                    <p style={{ fontSize: '14px', color: 'var(--avq-muted-fg, #6b7280)', margin: '0 0 18px', lineHeight: '1.5' }}>
                      {t('account.requireDescription', { venue: info.name })}
                    </p>
                    <button
                      type="button"
                      onClick={() => { showPortal.value = true }}
                      style={{
                        padding: '11px 22px', borderRadius: '10px', border: 'none',
                        background: 'var(--avq-accent, #6366f1)', color: '#ffffff',
                        fontSize: '14px', fontWeight: '600', cursor: 'pointer',
                      }}
                    >
                      {t('account.signInButton')}
                    </button>
                  </div>
                ) : (
                  <>
                    {flowType.value === 'appointments' && selectedProduct.value && (
                      <PaymentChoiceInline
                        products={selectedProducts.value.length > 0 ? selectedProducts.value : [selectedProduct.value]}
                        seats={Math.max(selectedSpotIds.value.length, 1)}
                        credits={customerCredits.value}
                        upfrontPolicy={selectedProduct.value.upfrontPolicy ?? 'at_venue'}
                        selected={inlinePayment}
                        onChange={setInlinePayment}
                        locale={props.locale}
                        t={t}
                      />
                    )}

                    <GuestInfoForm
                      venueInfo={info}
                      selectedSlot={selectedSlot.value}
                      selectedSpotCount={selectedSpotIds.value.length}
                      onSubmit={handleFormSubmit}
                      isSubmitting={isLoading.value}
                      t={t}
                      loggedInCustomer={customerInfo.value}
                      /* On the Square /appointments wizard the submit lives in
                       * the sticky sidebar as "Reserva cita" — hide the inline
                       * one and expose the form's submit fn to the parent.
                       *
                       * useState's setter interprets a bare-function arg as an
                       * UPDATER (calls it with prevState and stores the
                       * return). To store a function AS state we wrap one
                       * layer deeper so the setter sees a value-producing
                       * updater that returns the fn we actually want kept.
                       * Without this wrap, formSubmitFn ends up `undefined`
                       * and the sidebar's "Reserva cita" never enables. */
                      hideSubmitButton={flowType.value === 'appointments' || flowType.value === 'classes'}
                      registerSubmit={flowType.value === 'appointments' || flowType.value === 'classes'
                        ? (fn) => setFormSubmitFn(() => fn)
                        : undefined}
                      hidePartySize={flowType.value === 'classes'}
                    />
                  </>
                )
              )}

              {showPaymentSelector && pendingFormData && selectedProduct.value && (
                <PaymentSelector
                  product={selectedProduct.value}
                  seats={bookingSeatCount(pendingFormData)}
                  credits={customerCredits.value}
                  upfrontPolicy={selectedProduct.value.upfrontPolicy ?? 'at_venue'}
                  onSelectCredits={(balanceId) => {
                    selectedCreditBalance.value = { balanceId, productId: selectedProduct.value?.id || '' }
                    setShowPaymentSelector(false)
                    submitReservation(pendingFormData!, balanceId)
                  }}
                  onSelectCash={() => {
                    setShowPaymentSelector(false)
                    submitReservation(pendingFormData!)
                  }}
                  onBuyPack={() => {
                    setShowPaymentSelector(false)
                    setShowNoCreditsBuyPrompt(true)
                  }}
                  t={t}
                />
              )}

              {showCreditSelector && customerCredits.value && pendingFormData && (
                <CreditSelector
                  credits={customerCredits.value}
                  productId={selectedProduct.value?.id || ''}
                  seats={bookingSeatCount(pendingFormData)}
                  required={selectedProduct.value?.requireCreditForBooking === true}
                  onSelect={(balanceId) => {
                    selectedCreditBalance.value = { balanceId, productId: selectedProduct.value?.id || '' }
                    submitReservation(pendingFormData!, balanceId)
                  }}
                  onSkip={() => {
                    setShowCreditSelector(false)
                    submitReservation(pendingFormData!)
                  }}
                  onBuyMore={() => {
                    setShowCreditSelector(false)
                    setShowNoCreditsBuyPrompt(true)
                  }}
                  t={t}
                />
              )}

              {showNoCreditsBuyPrompt && (
                <div class="avq-animate-in" style={{ padding: '4px 0' }}>
                  <div
                    role="status"
                    aria-live="polite"
                    style={{
                      display: 'flex', alignItems: 'center', gap: '10px',
                      padding: '12px 14px', borderRadius: '12px',
                      background: 'var(--avq-warning-bg)',
                      border: '1px solid var(--avq-warning-border)',
                      marginBottom: '20px',
                    }}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--avq-warning-accent)" stroke-width="2" aria-hidden="true" style={{ flexShrink: 0 }}>
                      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                      <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                    </svg>
                    <span style={{ fontSize: '14px', fontWeight: '500', color: 'var(--avq-warning-fg)' }}>
                      {t('creditPacks.requiredNoCredits')}
                    </span>
                  </div>

                  {creditPacks.value.length > 0 && (
                    <CreditPackBanner
                      packs={creditPacks.value}
                      onBuy={handleBuyPack}
                      buyingPackId={buyingPackId}
                      t={t}
                    />
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setShowNoCreditsBuyPrompt(false)
                      setPendingFormData(null)
                    }}
                    style={{
                      width: '100%', padding: '11px', marginTop: '14px',
                      borderRadius: '12px', border: '1px solid transparent',
                      background: 'transparent',
                      fontSize: '13px', fontWeight: '500', color: 'var(--avq-muted-fg, #6b7280)',
                      cursor: 'pointer',
                      transition: 'background 0.15s var(--avq-ease), color 0.15s var(--avq-ease)',
                      textAlign: 'center',
                    }}
                  >
                    {t('actions.goBack')}
                  </button>
                </div>
              )}
            </>
          )

          if (flowType.value !== 'appointments' && flowType.value !== 'classes') {
            return formStepBody
          }

          // Square /appointments + /classes: header + 2-col layout with
          // Resumen sidebar. The slot-hold countdown is visual-only for now —
          // wire to the real backend hold endpoint (POST /reservations/hold)
          // once it ships and hydrate slotHoldExpiresAt in state.
          //
          // For /classes the customer picked a single class via the detail
          // view (sets selectedProduct, not selectedProducts), so derive the
          // sidebar products array from either source.
          const sidebarProducts = selectedProducts.value.length > 0
            ? selectedProducts.value
            : (selectedProduct.value ? [selectedProduct.value] : [])
          const subtotal = totalPrice.value
          const hasVariable = sidebarProducts.some(p => p.price == null)
          const variableNote = hasVariable
            ? (props.locale === 'en'
                ? 'This appointment includes a service with variable pricing. The amount will be set at the venue and is not included in the total.'
                : 'Esta cita incluye un servicio con un precio variable. El precio se determinará en la cita y no se incluye en el total.')
            : undefined

          // Whether PaymentChoiceInline will render: matches the component's
          // internal multi-product viability check exactly so the sidebar can
          // gate Reserva cita until the customer commits a choice.
          const paymentPickerVisible = (() => {
            const products = selectedProducts.value.length > 0
              ? selectedProducts.value
              : (selectedProduct.value ? [selectedProduct.value] : [])
            if (products.length === 0) return false
            // Cash viable: every product accepts cash (no credit-only).
            const acceptsCash = products.every(p => (p.price ?? 0) > 0 && p.requireCreditForBooking !== true)
            if (!acceptsCash) return false
            // Credits viable: every product has a covering balance.
            const credits = customerCredits.value
            if (!credits) return false
            const seats = Math.max(selectedSpotIds.value.length, 1)
            const allBalances = credits.purchases
              .filter(p => p.status === 'ACTIVE')
              .flatMap(p => p.itemBalances)
            return products.every(p => {
              const required = seats * (p.creditCost ?? 1)
              return allBalances.some(b => b.productId === p.id && b.remainingQuantity >= required)
            })
          })()

          return (
            <div class="avq-appts-layout">
              <div class="avq-appts-main">
                <PaymentStepHeader
                  locale={props.locale}
                  kind={flowType.value === 'classes' ? 'class' : 'appointment'}
                  onExpired={() => {
                    // Hold TTL hit zero. The slot is no longer guaranteed —
                    // someone else could grab it. Send the customer back to
                    // the time picker, clear the stale slot + hold state,
                    // refresh availability so they see the current truth, and
                    // surface a toast explaining why we moved them.
                    const token = slotHoldToken.value
                    if (token) {
                      api.cancelHold(props.venue, token).catch(() => {
                        /* silent — hold may already be GC'd server-side */
                      })
                    }
                    slotHoldToken.value = null
                    slotHoldExpiresAt.value = null
                    selectedSlot.value = null
                    step.value = config.timeStep
                    fetchSlots()
                    showToast(t('errors.slotExpired'), 'error')
                  }}
                />
                {formStepBody}
              </div>
              <aside class="avq-appts-sidebar">
                <AppointmentSummarySidebar
                  products={sidebarProducts}
                  totalPrice={totalPrice.value}
                  totalDuration={totalDuration.value}
                  selectedDate={selectedDate.value}
                  selectedSlot={selectedSlot.value}
                  showTotals
                  subtotal={subtotal ?? 0}
                  taxes={0}
                  /* Split the total into "due today" vs "due at venue" based
                   * on the lead product's upfrontPolicy + the inline payment
                   * choice. Credits cover everything → both rows zero. Cash
                   * with policy=required → charge now. Cash with policy=at_venue
                   * (the Mindform default) → pay on arrival. */
                  dueToday={(() => {
                    if (inlinePayment?.kind === 'credits') return 0
                    if (selectedProduct.value?.upfrontPolicy === 'required') return subtotal ?? 0
                    return 0
                  })()}
                  dueAtVenue={(() => {
                    if (inlinePayment?.kind === 'credits') return 0
                    if (selectedProduct.value?.upfrontPolicy === 'required') return 0
                    return subtotal ?? 0
                  })()}
                  totalsNote={variableNote}
                  /* "Reserva cita" lives in the sidebar — the form's inline
                   * submit is hidden via hideSubmitButton and exposes itself
                   * via registerSubmit so the sidebar can drive submission.
                   * If the inline payment picker is visible, the customer
                   * must commit a choice before the button enables. */
                  onNext={formSubmitFn ?? undefined}
                  nextLabel={flowType.value === 'classes'
                    ? (props.locale === 'en' ? 'Book class' : 'Reservar clase')
                    : t('summary.reserveAppointment')}
                  nextDisabled={isLoading.value || !formSubmitFn || (paymentPickerVisible && !inlinePayment)}
                  title={flowType.value === 'classes'
                    ? (props.locale === 'en' ? 'Class summary' : 'Resumen de la clase')
                    : undefined}
                  countLabel={flowType.value === 'classes' && sidebarProducts.length === 1
                    ? (props.locale === 'en' ? '1 class' : '1 clase')
                    : undefined}
                  dueAtVenueLabel={flowType.value === 'classes'
                    ? (props.locale === 'en' ? 'Pay at venue' : 'A pagar en el estudio')
                    : undefined}
                  t={t}
                />
              </aside>
              <style>{`
                .avq-appts-layout { display: grid; grid-template-columns: 1fr; gap: 24px; }
                .avq-appts-main { min-width: 0; }
                /* Mobile: sidebar stacks below the form so the customer
                   always sees Resumen + totals + Reserva cita. Desktop
                   pins it to the right. */
                .avq-appts-sidebar { display: block; }
                @media (min-width: 880px) {
                  .avq-appts-layout {
                    grid-template-columns: minmax(0, 1fr) 340px;
                    gap: 32px;
                    align-items: start;
                  }
                  .avq-appts-sidebar { position: sticky; top: 24px; }
                }
              `}</style>
            </div>
          )
        })()}

        {step.value === config.confirmStep && bookingResult.value && !bookingResult.value.depositRequired && flowType.value === 'appointments' && (
          <AppointmentConfirmation
            booking={bookingResult.value}
            venueInfo={info}
            selectedProducts={selectedProducts.value.length > 0 ? selectedProducts.value : (selectedProduct.value ? [selectedProduct.value] : [])}
            onReschedule={() => {
              manageSecret.value = bookingResult.value!.cancelSecret
              step.value = MANAGE_STEP
            }}
            onCancel={() => {
              manageSecret.value = bookingResult.value!.cancelSecret
              step.value = MANAGE_STEP
            }}
            onBookAgain={() => resetBooking(info)}
            locale={props.locale}
            t={t}
          />
        )}

        {step.value === config.confirmStep && bookingResult.value && !bookingResult.value.depositRequired && flowType.value !== 'appointments' && (
          <Confirmation
            booking={bookingResult.value}
            venueInfo={info}
            onManageBooking={() => {
              manageSecret.value = bookingResult.value!.cancelSecret
              step.value = MANAGE_STEP
            }}
            onNewBooking={() => resetBooking(info)}
            t={t}
          />
        )}

        {step.value === config.confirmStep && bookingResult.value?.depositRequired && (
          <DepositStep
            booking={bookingResult.value}
            t={t}
            onContinue={() => {
              // After acknowledging deposit, show confirmation
              const result = bookingResult.value!
              bookingResult.value = { ...result, depositRequired: false }
            }}
          />
        )}
      </div>

      {/* Checkout form overlay — accessible modal */}
      {checkoutPackId && (
        <CheckoutModal
          phone={checkoutPhone}
          email={checkoutEmail}
          onPhoneChange={setCheckoutPhone}
          onEmailChange={setCheckoutEmail}
          onClose={() => setCheckoutPackId(null)}
          onSubmit={handleCheckoutSubmit}
          submitting={!!buyingPackId}
          t={t}
        />
      )}

      {/* Credit-packs picker modal — triggered by the top-nav "Comprar
          créditos" button. Picking a pack hands off to the CheckoutModal
          above through handleBuyPack. */}
      {showCreditPacksModal && (
        <CreditPacksModal
          packs={creditPacks.value}
          buyingPackId={buyingPackId}
          onBuy={(packId) => {
            setShowCreditPacksModal(false)
            handleBuyPack(packId)
          }}
          onClose={() => setShowCreditPacksModal(false)}
          locale={props.locale}
          t={t}
        />
      )}

      {/* Avoqado footer — suppressed when the host page owns the chrome. */}
      {!props.hideVenueHeader && (
        <div style={{ marginTop: '32px', textAlign: 'center', paddingBottom: '4px' }}>
          <a href="https://avoqado.io" target="_blank" rel="noopener noreferrer" class="avq-footer-link" style={{ fontSize: '12px', justifyContent: 'center' }}>
            <AvoqadoLogo />
            <span>{t('poweredBy')}</span>
          </a>
        </div>
      )}
    </div>
  )
}
