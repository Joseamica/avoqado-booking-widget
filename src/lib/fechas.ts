/** Encabezado de día de la lista de clases. Puro: la hora de «ahora» y la zona entran como argumentos. */
import type { TFunction } from "../i18n";

const ymdEn = (ms: number, timeZone: string): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));

const mayuscula = (s: string) => s.charAt(0).toLocaleUpperCase() + s.slice(1);

/** «Hoy», «Mañana» o «Sábado, 28 de noviembre» (sólo la primera letra en mayúscula; año sólo si no es el actual). */
export function encabezadoDeDia(
  ymd: string,
  nowMs: number,
  timeZone: string,
  locale: "es" | "en",
  t: TFunction,
): string {
  const hoy = ymdEn(nowMs, timeZone);
  if (ymd === hoy) return t("reservaClases.hoy");
  const [y, m, d] = ymd.split("-").map(Number);
  // El día calendario es el mismo en cualquier zona: se formatea en UTC para no correrlo.
  const dia = new Date(Date.UTC(y, m - 1, d, 12));
  const [hy, hm, hd] = hoy.split("-").map(Number);
  const manana = new Date(Date.UTC(hy, hm - 1, hd + 1, 12));
  if (ymd === manana.toISOString().slice(0, 10))
    return t("reservaClases.manana");
  const conAnio = y !== Number(hoy.slice(0, 4));
  const fmt = new Intl.DateTimeFormat(locale === "en" ? "en-US" : "es-MX", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(conAnio ? { year: "numeric" as const } : {}),
  });
  return mayuscula(fmt.format(dia));
}
