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
  },
): string | null {
  if (!p) return null;
  if (!p.allowCustomerCancel) return t(`${K}.escribele`);

  const inicio = new Date(ctx.startsAt).getTime();
  const fecha = (horasAntes: number) =>
    cuando(t, inicio - horasAntes * HORA_MS, ctx.timeZone, ctx.locale);
  // El SERVIDOR deja cancelar mientras falten al menos `minHoursBeforeStart` horas; éste es el último momento.
  const horasDelUltimo = p.minHoursBeforeStart ?? 0;
  const hastaCancelar = fecha(horasDelUltimo);

  if (
    ctx.pagaCon === "tarjeta" ||
    ctx.pagaCon === "estudio" ||
    ctx.pagaCon === "gratis"
  )
    return t(`${K}.enLinea`, { fecha: hastaCancelar });

  const alUltimo = porcentajeDeDevolucion(
    p,
    inicio,
    inicio - horasDelUltimo * HORA_MS,
  );

  if (ctx.pagaCon === "ilimitado") {
    // Un Ilimitado regresa siempre; en la ventana tardía, la falta queda anotada.
    const base = t(`${K}.ilimitado`, { fecha: hastaCancelar });
    if (!alUltimo.tardia) return base;
    return `${base} ${t(`${K}.ilimitadoTarde`, { fecha: fecha(p.creditFreeRefundHoursBefore) })}`;
  }

  const varias = ctx.sesiones > 1;
  const regresan = (percent: number) =>
    Math.floor((ctx.sesiones * percent) / 100);
  // Con tiempo de sobra: NEVER no regresa nada; ALWAYS y TIME_BASED, todo.
  const temprano = porcentajeDeDevolucion(p, inicio, -Infinity);
  if (temprano.percent === 0)
    return t(varias ? `${K}.nuncaVarias` : `${K}.nunca`);

  const gratis = varias ? `${K}.gratisVarias` : `${K}.gratis`;
  const tarde = regresan(alUltimo.percent);
  if (tarde === regresan(temprano.percent))
    return t(gratis, { fecha: hastaCancelar });

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
  return `${t(gratis, { fecha: fecha(p.creditFreeRefundHoursBefore) })} ${segunda}`;
}
