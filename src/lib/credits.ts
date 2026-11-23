/**
 * D679 · paquete «Ilimitado». Por dentro es un saldo de 99,999 con la marca `unlimited`; aquí vive lo que el widget enseña y
 * decide con él: cubre 1 lugar (es personal) y nunca se enseña su número.
 */
import type { TFunction } from '../i18n'

type Saldo = { unlimited?: boolean; remainingQuantity: number }

/** ¿Este saldo paga `seats` lugares? Un Ilimitado sólo 1; uno normal, si le alcanzan `seats × porLugar` créditos. */
export function cubreLugares(b: Saldo, seats: number, porLugar = 1): boolean {
  return b.unlimited ? seats <= 1 : b.remainingQuantity >= seats * porLugar
}

/** Sesiones que trae un paquete en venta; con un renglón Ilimitado, `'ilimitado'` (nunca 99,999). */
export function totalDeSesiones(items: { quantity: number; unlimited?: boolean }[]): number | 'ilimitado' {
  return items.some(i => i.unlimited) ? 'ilimitado' : items.reduce((sum, i) => sum + i.quantity, 0)
}

/** Créditos que le quedan, sólo de los saldos normales. */
export function saldoRestante(balances: Saldo[]): number {
  return balances.reduce((sum, b) => sum + (b.unlimited ? 0 : b.remainingQuantity), 0)
}

export function hayIlimitado(purchases: { itemBalances: { unlimited?: boolean }[] }[]): boolean {
  return purchases.some(p => p.itemBalances.some(b => b.unlimited))
}

/** «Ilimitado · vence el 22 de diciembre» (fecha en la zona del negocio), o «Ilimitado» si no vence. */
export function venceEl(t: TFunction, expiresAt?: string | null, timeZone?: string): string {
  if (!expiresAt) return t('creditPacks.unlimited')
  const date = new Intl.DateTimeFormat(t('cuenta.intl'), { day: 'numeric', month: 'long', timeZone }).format(new Date(expiresAt))
  return t('creditPacks.unlimitedUntil', { date })
}
