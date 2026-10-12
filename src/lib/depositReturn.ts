import type { PublicBookingResult, PublicReservationDetail } from '../types'

const legacyKey = 'avq:pendingReservation'
const reservationKey = (venue: string) => `${legacyKey}:${venue}`
type SavedReservation = { venue: string; cancelSecret: string; confirmationCode: string }

function readSaved(key: string, venue: string): SavedReservation | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) ?? 'null')
    return saved?.venue === venue && typeof saved.cancelSecret === 'string' && saved.cancelSecret.length > 0
      && typeof saved.confirmationCode === 'string' ? saved : null
  } catch { return null }
}

export function savePendingReservation(venue: string, result: Pick<PublicBookingResult, 'cancelSecret' | 'confirmationCode'>) {
  try {
    sessionStorage.setItem(reservationKey(venue), JSON.stringify({ venue, cancelSecret: result.cancelSecret, confirmationCode: result.confirmationCode }))
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
    savePendingReservation(venue, saved)
    if (returned) {
      url.searchParams.delete('avq_payment')
      window.history.replaceState(window.history.state, '', url.toString())
    }
  }
  return { saved, returned }
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
