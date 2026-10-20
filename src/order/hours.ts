import type { DayHours, Weekday, WeeklyHours } from './types'

/** Día de la semana en la zona del negocio (no la del navegador del comensal). */
export function weekdayKey(now: Date, timeZone: string): Weekday {
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone }).format(now).toLowerCase() as Weekday
}

type DayRange = { open: string; close: string; overnight: boolean }
/** Las franjas de un día; `overnight` = cierra después de la medianoche. Un día apagado no tiene ninguna. */
const rangesOf = (day: DayHours | undefined): DayRange[] =>
  day?.enabled ? day.ranges.map(r => ({ open: r.open, close: r.close, overnight: r.close <= r.open })) : []

/** Franjas de HOY. `null` = sin restricción de horario; `[]` = hoy no abre. `overnight` = cierra después de la medianoche. */
export function todayRanges(hours: WeeklyHours | null, now: Date, timeZone: string): DayRange[] | null {
  return hours ? rangesOf(hours[weekdayKey(now, timeZone)]) : null
}

const WEEK: Weekday[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))

/**
 * Hora de cierre («22:00») de la franja en que el negocio está abierto AHORA, en su zona (no la del navegador); la de una
 * franja nocturna es la del día siguiente («02:00»). `null` si no hay horario o ahora no cae en ninguna franja. Las fronteras
 * son las del servidor (`isWithinHours`): abre a la hora de apertura y cierra a la de cierre, y la madrugada de la franja
 * nocturna de AYER cuenta. Es un adorno (el chip «Abierto hasta las…»): una zona inválida da `null`, no tumba la tienda.
 * ponytail: con franjas traslapadas dice el cierre de la primera que contiene la hora; el servidor no las prohíbe, pero nadie las pone.
 */
export function closesAt(hours: WeeklyHours | null, now: Date, timeZone: string): string | null {
  if (!hours) return null
  try {
    const [h, m] = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).format(now).split(':').map(Number)
    const nowMin = h * 60 + m
    const today = weekdayKey(now, timeZone)
    for (const r of rangesOf(hours[today])) {
      const open = minutes(r.open), close = minutes(r.close)
      if (open < close ? nowMin >= open && nowMin < close : open > close && nowMin >= open) return r.close
    }
    for (const r of rangesOf(hours[WEEK[(WEEK.indexOf(today) + 6) % 7]]))
      if (minutes(r.open) > minutes(r.close) && nowMin < minutes(r.close)) return r.close
  } catch (_e) {
    // zona inválida: abajo, null
  }
  return null
}

export function formatTime(iso: string, timeZone: string, locale: 'es' | 'en'): string {
  return new Intl.DateTimeFormat(locale === 'es' ? 'es-MX' : 'en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: locale !== 'es',
    timeZone,
  }).format(new Date(iso))
}
