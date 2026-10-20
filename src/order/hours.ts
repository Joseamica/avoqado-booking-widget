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

type Span = { start: number; end: number; close: string }

/** Minutos desde la medianoche, en la zona del negocio (puede lanzar si la zona es inválida: quien llama lo atrapa). */
function minutesNow(now: Date, timeZone: string): number {
  const [h, m] = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).format(now).split(':').map(Number)
  return h * 60 + m
}

/**
 * Hora de cierre («22:00») del tramo de servicio en que está el negocio AHORA, en su zona (no la del navegador). Una franja
 * nocturna cierra al día siguiente («02:00»); y si otra franja abre a más tardar a esa hora de cierre (franjas seguidas o
 * traslapadas, o la del día siguiente que abre justo cuando la nocturna cierra), el servicio es de corrido: se sigue la cadena y
 * la respuesta es el cierre de la última. `null` si no hay horario o ahora no cae en ninguna franja. Las fronteras son las del
 * servidor (`isWithinHours`): abre a la hora de apertura y cierra a la de cierre, y la madrugada de la franja nocturna de AYER
 * cuenta. Es un adorno (el chip «Abierto hasta las…»): una zona inválida da `null`, no tumba la tienda.
 */
export function closesAt(hours: WeeklyHours | null, now: Date, timeZone: string): string | null {
  if (!hours) return null
  try {
    const nowMin = minutesNow(now, timeZone)
    const today = WEEK.indexOf(weekdayKey(now, timeZone))
    // Las franjas de ayer, hoy y mañana en minutos desde la medianoche de HOY; una nocturna termina al día siguiente.
    const spans: Span[] = []
    for (const day of [-1, 0, 1])
      for (const r of rangesOf(hours[WEEK[(today + day + 7) % 7]])) {
        const open = minutes(r.open), close = minutes(r.close)
        if (open !== close) spans.push({ start: day * 1440 + open, end: day * 1440 + (open < close ? close : close + 1440), close: r.close })
      }
    let cur = spans.find(s => s.start <= nowMin && nowMin < s.end)
    while (cur) {
      const end = cur.end
      const next = spans.find(s => s.start <= end && s.end > end)
      if (!next) return cur.close
      cur = next
    }
  } catch (_e) {
    // zona inválida: abajo, null
  }
  return null
}

/**
 * Hora («13:00») a la que abre HOY el negocio si todavía no ha abierto: la primera franja de hoy que empieza después de ahora, en
 * su zona. `null` si no hay horario, si hoy no abre o si ya pasaron todas las aperturas de hoy: mañana no se promete (la frase
 * diría «desde las 09:00» sin decir «mañana»). Es un adorno (la barra del carrito): una zona inválida da `null`, no tumba la tienda.
 */
export function opensAt(hours: WeeklyHours | null, now: Date, timeZone: string): string | null {
  try {
    const ranges = todayRanges(hours, now, timeZone)
    if (!ranges) return null
    const nowMin = minutesNow(now, timeZone)
    const next = ranges.filter(r => r.open !== r.close && minutes(r.open) > nowMin).map(r => r.open).sort()
    return next[0] ?? null
  } catch (_e) {
    return null // zona inválida
  }
}

export function formatTime(iso: string, timeZone: string, locale: 'es' | 'en'): string {
  return new Intl.DateTimeFormat(locale === 'es' ? 'es-MX' : 'en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: locale !== 'es',
    timeZone,
  }).format(new Date(iso))
}

/**
 * Una hora del horario («09:05», que ya es la del negocio: la de `opensAt`) con el mismo formato que `formatTime`, el de una pausa:
 * «Puedes pedir desde las…» se lee igual cerrada que en pausa («9:05 AM» en inglés). Algo que no es una hora sale tal cual (pinta la
 * barra del carrito: nunca lanza).
 */
export function formatClock(hhmm: string, locale: 'es' | 'en'): string {
  const m = minutes(hhmm)
  return Number.isFinite(m) ? formatTime(new Date(m * 60_000).toISOString(), 'UTC', locale) : hhmm
}
