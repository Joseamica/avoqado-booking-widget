// Dinero de la tienda: los precios llegan en PESOS (con IVA incluido) y se suman en centavos enteros.

export const toCents = (pesos: number): number => Math.round(pesos * 100)

/** «$85» si es entero; si no, «$85.50». Prefijo `$` a mano: el símbolo de MXN no depende del idioma ni del navegador. */
export function formatMXN(pesos: number, locale: 'es' | 'en'): string {
  const cents = toCents(pesos)
  const digits = cents % 100 === 0 ? 0 : 2
  return (
    '$' +
    new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'es-MX', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(cents / 100)
  )
}

/** El `expectedTotal` del pedido: el `total` de la última cotización del servidor con dos decimales («206.00»). */
export const expectedTotalFromQuote = (total: number): string => (toCents(total) / 100).toFixed(2)
