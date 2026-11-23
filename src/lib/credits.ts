/**
 * D679 · paquete «Ilimitado». Por dentro es un saldo de 99,999 con la marca `unlimited`; aquí vive lo que el widget enseña y
 * decide con él: cubre 1 lugar (es personal) y nunca se enseña su número.
 */
import type { TFunction } from '../i18n'

type Saldo = { unlimited?: boolean; remainingQuantity: number; expiresAt?: string | null }

/** Un Ilimitado que vence antes de que empiece el horario elegido (el SERVIDOR lo rechaza: `startsAt >= expiresAt`). */
export function venceAntes(b: Saldo, startsAt?: string | null): boolean {
  return !!(b.unlimited && b.expiresAt && startsAt && new Date(startsAt) >= new Date(b.expiresAt))
}

/**
 * ¿Este saldo paga `seats` lugares del horario que empieza en `startsAt`? Un Ilimitado sólo 1, y sólo si el horario empieza
 * antes de que venza; uno normal, si le alcanzan `seats × porLugar` créditos. El mismo orden que el SERVIDOR.
 */
export function cubreLugares(b: Saldo, seats: number, porLugar = 1, startsAt?: string | null): boolean {
  return b.unlimited ? seats <= 1 && !venceAntes(b, startsAt) : b.remainingQuantity >= seats * porLugar
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

const fecha = (t: TFunction, iso: string, timeZone?: string) =>
  new Intl.DateTimeFormat(t('cuenta.intl'), { day: 'numeric', month: 'long', timeZone }).format(new Date(iso))

/** «Ilimitado · vence el 22 de diciembre» (fecha en la zona del negocio), o «Ilimitado» si no vence. */
export function venceEl(t: TFunction, expiresAt?: string | null, timeZone?: string): string {
  return expiresAt ? t('creditPacks.unlimitedUntil', { date: fecha(t, expiresAt, timeZone) }) : t('creditPacks.unlimited')
}

/** Por qué un Ilimitado no paga esta reserva: vence antes del horario, o es personal (1 lugar). */
export function avisoDelIlimitado(t: TFunction, b: Saldo, startsAt?: string | null, timeZone?: string): string {
  return venceAntes(b, startsAt)
    ? t('creditPacks.unlimitedExpiresBefore', { date: fecha(t, b.expiresAt!, timeZone) })
    : t('creditPacks.unlimitedOneSeat')
}
