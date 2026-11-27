/**
 * La línea de política de cancelación que ve la clienta al reservar. Puro: describe la regla del SERVIDOR tal como está al
 * reservar (lo que de verdad regresa al cancelar lo dice la pantalla de cancelar). Sin política del SERVIDOR no hay línea.
 */
import type { TFunction } from "../i18n";
import type { PublicCancellationPolicy } from "../types";

type PagaCon = "paquete" | "ilimitado" | "tarjeta" | "estudio" | "gratis";

const HORA_MS = 3_600_000;
const K = "reservaClases.politica";

/**
 * Copia exacta de `porcentajeDeDevolucion` del SERVIDOR (`creditPack.public.service.ts`): cuánto regresa si se cancela en
 * `ahoraMs`. `tardia` = `TIME_BASED` y dentro de la ventana tardía (a un Ilimitado no le quita nada, sólo anota la falta).
 */
function porcentajeDeDevolucion(
  p: PublicCancellationPolicy,
  inicioMs: number,
  ahoraMs: number,
): { percent: number; tardia: boolean } {
  if (p.creditRefundMode === "NEVER") return { percent: 0, tardia: false };
  if (p.creditRefundMode === "ALWAYS") return { percent: 100, tardia: false };
  const horasParaEmpezar = (inicioMs - ahoraMs) / HORA_MS;
  if (horasParaEmpezar >= p.creditFreeRefundHoursBefore)
    return { percent: 100, tardia: false };
  return {
    percent: Math.max(0, Math.min(100, p.creditLateRefundPercent)),
    tardia: true,
  };
}

/** «el miércoles 25 a las 18:15» (o «a la 1:15») / «Wednesday, Nov 25 at 6:15 PM», en la zona del negocio. */
function cuando(
  t: TFunction,
  ms: number,
  timeZone: string,
  locale: "es" | "en",
): string {
  const en = locale === "en";
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat(en ? "en-US" : "es-MX", {
      timeZone,
      weekday: "long",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hourCycle: en ? "h12" : "h23",
    })
      .formatToParts(new Date(ms))
      .map((x) => [x.type, x.value]),
  );
  const dia = Number(partes.day);
  const hora = en ? Number(partes.hour) : Number(partes.hour) % 24;
  if (en)
    return t(`${K}.fecha`, {
      dia: `${partes.weekday}, ${partes.month} ${dia}`,
      hora: `${hora}:${partes.minute} ${partes.dayPeriod}`,
    });
  return t(hora === 1 ? `${K}.fechaALa` : `${K}.fecha`, {
    dia: `${partes.weekday} ${dia}`,
    hora: `${hora}:${partes.minute}`,
  });
}

/**
 * La regla de cancelación en una línea, con la misma cuenta que el SERVIDOR (`porcentajeDeDevolucion` y lo que regresa:
 * `Math.floor(sesiones × % / 100)`). Dos plazos cuando difieren: hasta cuándo regresa todo y hasta cuándo se puede cancelar en
 * línea (`minHoursBeforeStart`; sin plazo, hasta la hora de la clase). Con tarjeta, en el estudio o gratis no promete
 * devolución: sólo dice hasta cuándo se puede cancelar.
 *
 * `ahora` (epoch ms) decide qué plazos ya pasaron: llegado el plazo en línea, ya no se puede cancelar en línea; llegado el de
 * la devolución gratis, la línea dice lo que pasa si cancela ahora. Los dos se cuentan como pasados desde el milisegundo exacto
 * (el SERVIDOR todavía acepta en ese milisegundo, pero para cuando la clienta toca ya pasó: nunca se promete de más).
 */
export function lineaDePolitica(
  t: TFunction,
  p: PublicCancellationPolicy | null | undefined,
  ctx: {
    startsAt: string;
    timeZone: string;
    pagaCon: PagaCon;
    sesiones: number;
    locale: "es" | "en";
    ahora: number;
  },
): string | null {
  if (!p) return null;
  if (!p.allowCustomerCancel) return t(`${K}.escribele`);

  const inicio = new Date(ctx.startsAt).getTime();
  const fecha = (ms: number) => cuando(t, ms, ctx.timeZone, ctx.locale);
  // El SERVIDOR deja cancelar mientras falten al menos `minHoursBeforeStart` horas; éste es el último momento.
  const limiteEnLinea = inicio - (p.minHoursBeforeStart ?? 0) * HORA_MS;
  if (ctx.ahora >= limiteEnLinea) return t(`${K}.yaNoEnLinea`);
  const hastaCancelar = fecha(limiteEnLinea);
  const enLinea = t(`${K}.enLinea`, { fecha: hastaCancelar });

  if (
    ctx.pagaCon === "tarjeta" ||
    ctx.pagaCon === "estudio" ||
    ctx.pagaCon === "gratis"
  )
    return enLinea;

  const alUltimo = porcentajeDeDevolucion(p, inicio, limiteEnLinea);
  // Sólo existe un tramo tardío (TIME_BASED) si se puede cancelar en línea después de este momento.
  const limiteGratis = inicio - p.creditFreeRefundHoursBefore * HORA_MS;
  const yaEsTarde = ctx.ahora >= limiteGratis;

  if (ctx.pagaCon === "ilimitado") {
    // Un Ilimitado regresa siempre; en la ventana tardía, la falta queda anotada.
    if (!alUltimo.tardia) return t(`${K}.ilimitado`, { fecha: hastaCancelar });
    if (yaEsTarde) return t(`${K}.ilimitadoYaTarde`, { fecha: hastaCancelar });
    return `${t(`${K}.ilimitado`, { fecha: hastaCancelar })} ${t(`${K}.ilimitadoTarde`, { fecha: fecha(limiteGratis) })}`;
  }

  const varias = ctx.sesiones > 1;
  const regresan = (percent: number) =>
    Math.floor((ctx.sesiones * percent) / 100);
  // Con tiempo de sobra: NEVER no regresa nada; ALWAYS y TIME_BASED, todo.
  const temprano = porcentajeDeDevolucion(p, inicio, -Infinity);
  if (temprano.percent === 0)
    return t(varias ? `${K}.nuncaVarias` : `${K}.nunca`);

  const gratis = varias ? `${K}.gratisVarias` : `${K}.gratis`;
  // Si hasta el último momento regresa todo (ALWAYS, o un % tardío que alcanza para todas), no hay dos tramos.
  const tarde = regresan(alUltimo.percent);
  if (tarde === regresan(temprano.percent))
    return t(gratis, { fecha: hastaCancelar });

  if (yaEsTarde) {
    const siCancela =
      tarde === 0
        ? t(varias ? `${K}.ahoraNoRegresan` : `${K}.ahoraNoRegresa`)
        : t(tarde === 1 ? `${K}.ahoraRegresa` : `${K}.ahoraRegresan`, {
            n: tarde,
            total: ctx.sesiones,
          });
    return `${siCancela} ${enLinea}`;
  }

  const segunda =
    tarde === 0
      ? t(varias ? `${K}.tardeNoRegresan` : `${K}.tardeNoRegresa`, {
          fecha: hastaCancelar,
        })
      : t(tarde === 1 ? `${K}.tardeRegresa` : `${K}.tardeRegresan`, {
          fecha: hastaCancelar,
          n: tarde,
          total: ctx.sesiones,
        });
  return `${t(gratis, { fecha: fecha(limiteGratis) })} ${segunda}`;
}
