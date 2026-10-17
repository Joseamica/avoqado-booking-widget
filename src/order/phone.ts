// Copia de `phoneE164` de la rama de sellos (avoqado-booking-widget d03dbad, src/data/countries.ts).
// TODO: unificar con src/data/countries.ts cuando la rama de sellos llegue a main.
import { COUNTRIES, DEFAULT_DIAL } from '../data/countries'

const KNOWN_DIALS = new Set(COUNTRIES.map(c => c.dial))

/**
 * El teléfono que viaja al servidor, SIEMPRE con lada (14-oct-2026: el alta de la tarjeta llegaba como '+' + 10
 * dígitos y el cliente quedaba sin el 52). Una lada vacía o que no está en la lista se vuelve la de México. Con +52 se
 * quita el 52 o el 521 que la persona repitió al escribir (52 + 10 ⇒ 10; 521 + 10 ⇒ 10), igual que
 * `normalizarTelefonoMx` del servidor; sin esto salía '+52525544422262', que el servidor ya no corrige.
 */
export function phoneE164(dial: string, national: string): string {
  const safeDial = KNOWN_DIALS.has(dial) ? dial : DEFAULT_DIAL
  let digits = national.replace(/\D/g, '')
  if (safeDial === '52') {
    if (digits.length === 12 && digits.startsWith('52')) digits = digits.slice(2)
    else if (digits.length === 13 && digits.startsWith('521')) digits = digits.slice(3)
  }
  return `+${safeDial}${digits}`
}
