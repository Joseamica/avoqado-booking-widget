import type { Weekday, WeeklyHours } from './types'

/** Día de la semana en la zona del negocio (no la del navegador del comensal). */
export function weekdayKey(now: Date, timeZone: string): Weekday {
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone }).format(now).toLowerCase() as Weekday
}

/** Franjas de HOY. `null` = sin restricción de horario; `[]` = hoy no abre. `overnight` = cierra después de la medianoche. */
export function todayRanges(
  hours: WeeklyHours | null,
  now: Date,
  timeZone: string,
): { open: string; close: string; overnight: boolean }[] | null {
  if (!hours) return null
  const day = hours[weekdayKey(now, timeZone)]
  if (!day?.enabled) return []
  return day.ranges.map(r => ({ open: r.open, close: r.close, overnight: r.close <= r.open }))
}

export function formatTime(iso: string, timeZone: string, locale: 'es' | 'en'): string {
  return new Intl.DateTimeFormat(locale === 'es' ? 'es-MX' : 'en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: locale !== 'es',
    timeZone,
  }).format(new Date(iso))
}
