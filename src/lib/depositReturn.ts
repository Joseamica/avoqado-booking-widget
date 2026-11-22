import type { PublicBookingResult, PublicReservationDetail } from '../types'

const legacyKey = 'avq:pendingReservation'
const reservationKey = (venue: string) => `${legacyKey}:${venue}`
/** Cómo regresó de Stripe: por la liga de pago hecho (`success`) o por la de «atrás» (`cancelled`). */
type PaymentOutcome = 'success' | 'cancelled'
type SavedReservation = { venue: string; cancelSecret: string; confirmationCode: string; outcome?: PaymentOutcome }

function readSaved(key: string, venue: string): SavedReservation | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) ?? 'null')
    return saved?.venue === venue && typeof saved.cancelSecret === 'string' && saved.cancelSecret.length > 0
      && typeof saved.confirmationCode === 'string' ? saved : null
  } catch { return null }
}

export function savePendingReservation(
  venue: string,
  result: Pick<PublicBookingResult, 'cancelSecret' | 'confirmationCode'> & { outcome?: PaymentOutcome },
) {
  try {
    const outcome = result.outcome === 'success' || result.outcome === 'cancelled' ? { outcome: result.outcome } : {}
    sessionStorage.setItem(reservationKey(venue), JSON.stringify({ venue, cancelSecret: result.cancelSecret, confirmationCode: result.confirmationCode, ...outcome }))
    if (readSaved(legacyKey, venue)) sessionStorage.removeItem(legacyKey)
  } catch { /* blocked storage: the return screen explains it */ }
}

export function clearPendingReservation(venue: string) {
  try {
    sessionStorage.removeItem(reservationKey(venue))
    if (readSaved(legacyKey, venue)) sessionStorage.removeItem(legacyKey)
  } catch { /* blocked storage */ }
}

export function resolveDepositReturn(venue: string) {
  const url = new URL(window.location.href)
  const flag = url.searchParams.get('avq_payment')
  const returned = flag === 'success' || flag === 'cancelled'
  // Ownership is checked before either return flag can consume anything.
  const saved = readSaved(reservationKey(venue), venue) ?? readSaved(legacyKey, venue)
  if (saved) {
    // D683: se recuerda cómo regresó, para que recargar no cambie lo que se le dice.
    if (flag === 'success' || flag === 'cancelled') saved.outcome = flag
    savePendingReservation(venue, saved)
    if (returned) {
      url.searchParams.delete('avq_payment')
      window.history.replaceState(window.history.state, '', url.toString())
    }
  }
  // Sin la marca de pago hecho (volvió por «atrás» de Stripe o con el del navegador), el pago no se terminó.
  return { saved, returned, paymentUnfinished: Boolean(saved) && saved?.outcome !== 'success' }
}

export function depositCheckoutUrl(flag: 'success' | 'cancelled') {
  const url = new URL(window.location.href)
  url.searchParams.delete('manage')
  url.searchParams.delete('avq_payment')
  url.searchParams.delete('avq_credits')
  url.searchParams.set('avq_payment', flag)
  return url.toString()
}

export function depositNotice(status: PublicReservationDetail['depositStatus'], querying: boolean, returned: boolean) {
  if (status === 'PENDING') return querying ? 'deposit.confirming' : 'deposit.pending'
  const known: Record<string, string> = {
    PAID: 'deposit.paid', REFUNDED: 'deposit.refunded', CARD_HOLD: 'deposit.cardHold',
    FORFEITED: 'deposit.forfeited', EXPIRED: 'deposit.expired', DISPUTED: 'deposit.disputed',
  }
  return Object.prototype.hasOwnProperty.call(known, status ?? '')
    ? known[status!] : returned ? 'deposit.returnUnverified' : 'deposit.unknown'
}
