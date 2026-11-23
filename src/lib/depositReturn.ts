import type { PublicBookingResult, PublicReservationDetail } from '../types'

const legacyKey = 'avq:pendingReservation'
const reservationKey = (venue: string) => `${legacyKey}:${venue}`
/** Cómo regresó de Stripe: por la liga de pago hecho (`success`) o por la de «atrás» (`cancelled`). */
type PaymentOutcome = 'success' | 'cancelled'
/** `ref`: la marca que viaja en las ligas de regreso de ESA reserva (D681). Si regresa con otra, la vuelta es de otra reserva. */
type SavedReservation = { venue: string; cancelSecret: string; confirmationCode: string; outcome?: PaymentOutcome; ref?: string }

function readSaved(key: string, venue: string): SavedReservation | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) ?? 'null')
    return saved?.venue === venue && typeof saved.cancelSecret === 'string' && saved.cancelSecret.length > 0
      && typeof saved.confirmationCode === 'string' ? saved : null
  } catch { return null }
}

export function savePendingReservation(
  venue: string,
  result: Pick<PublicBookingResult, 'cancelSecret' | 'confirmationCode'> & { outcome?: PaymentOutcome; ref?: string },
) {
  try {
    const outcome = result.outcome === 'success' || result.outcome === 'cancelled' ? { outcome: result.outcome } : {}
    const ref = typeof result.ref === 'string' && result.ref.length > 0 ? { ref: result.ref } : {}
    sessionStorage.setItem(reservationKey(venue), JSON.stringify({ venue, cancelSecret: result.cancelSecret, confirmationCode: result.confirmationCode, ...outcome, ...ref }))
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
  let saved = readSaved(reservationKey(venue), venue) ?? readSaved(legacyKey, venue)
  // D681: el navegador guarda UNA reserva por negocio. Si regresa de Stripe con la marca de otra (abrió un segundo pago en la misma
  // pestaña y volvió del primero), no se le habla de la guardada: es la vuelta de una reserva que este navegador ya no tiene.
  if (returned && saved?.ref && url.searchParams.get('avq_ref') !== saved.ref) saved = null
  if (saved) {
    // D683: se recuerda cómo regresó, para que recargar no cambie lo que se le dice.
    if (flag === 'success' || flag === 'cancelled') saved.outcome = flag
    savePendingReservation(venue, saved)
    if (returned) {
      url.searchParams.delete('avq_payment')
      url.searchParams.delete('avq_ref')
      window.history.replaceState(window.history.state, '', url.toString())
    }
  }
  // Sin la marca de pago hecho (volvió por «atrás» de Stripe o con el del navegador), el pago no se terminó.
  return { saved, returned, paymentUnfinished: Boolean(saved) && saved?.outcome !== 'success' }
}

export function depositCheckoutUrl(flag: 'success' | 'cancelled', ref?: string) {
  const url = new URL(window.location.href)
  url.searchParams.delete('manage')
  url.searchParams.delete('avq_payment')
  url.searchParams.delete('avq_credits')
  url.searchParams.delete('avq_ref')
  url.searchParams.set('avq_payment', flag)
  if (ref) url.searchParams.set('avq_ref', ref)
  return url.toString()
}

/** D681: marca de una sola reserva para sus ligas de regreso de Stripe. No es secreta: sólo distingue una vuelta de otra. */
export function newReturnRef() {
  return Math.random().toString(36).slice(2, 12)
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
