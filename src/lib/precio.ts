/**
 * Diseño 18-nov: UN solo formato de precio en las reservas. «$3,500» si es entero y «$99.50» si trae centavos: nunca se
 * redondean los centavos (antes había 15 formateadores; unos ponían «.00» y otros redondeaban $99.50 a $100). Es la regla que ya
 * usaban los extras (`ModifierPicker`). Los saldos de «Mi cuenta» siguen con centavos siempre, a propósito (como la caja).
 */
export function precio(monto: number, moneda = 'MXN', locale: 'es' | 'en' = 'es'): string {
  const n = Number(monto)
  const decimales = Math.round(n * 100) % 100 === 0 ? 0 : 2
  try {
    return new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'es-MX', {
      style: 'currency', currency: moneda || 'MXN', minimumFractionDigits: decimales, maximumFractionDigits: decimales,
    }).format(n)
  } catch {
    return `$${n.toFixed(decimales)}`
  }
}
