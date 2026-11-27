/**
 * Qué paquetes de la clienta pagan una clase y cuál se usa por default. Puro: las reglas de dinero (canje y D679) son las de
 * `credits.ts`, no se reescriben aquí.
 */
import type { CustomerCreditBalance, Product } from "../types";
import { cubreLugares } from "./credits";

export type OpcionDePaquete = {
  /** El saldo que se manda al SERVIDOR: exactamente el de la opción enseñada. */
  balanceId: string;
  packName: string;
  /** En un Ilimitado es el número interno (≈99,999): nunca se enseña; mira `ilimitado`. */
  restante: number;
  /** En un Ilimitado es el número interno (≈99,999): nunca se enseña; mira `ilimitado`. */
  original: number;
  ilimitado: boolean;
  /** Vencimiento de la COMPRA (el saldo no trae el suyo). */
  vence: string | null;
  /** La compra sólo trae saldos de esta clase (palabras: «sesiones de …» en vez de «créditos»). */
  soloEstaClase: boolean;
};

const comparar = (a: number | string, b: number | string) =>
  a < b ? -1 : a > b ? 1 : 0;
/** Sin vencimiento va al final (Infinity: se compara, nunca se resta). */
const vencimiento = (o: OpcionDePaquete) =>
  o.vence ? new Date(o.vence).getTime() : Number.POSITIVE_INFINITY;

/**
 * Los saldos de compras `ACTIVE` que pagan `lugares` lugares de la clase `productId` que empieza en `startsAt`, ordenados para
 * que el primero sea el default: vence primero (sin vencimiento al final), luego menos restantes, luego `balanceId`.
 * Un Ilimitado no se ofrece si la clienta ya canjeó uno en esta sesión (el SERVIDOR rechaza el segundo).
 */
export function opcionesQueCubren(
  c: CustomerCreditBalance,
  productId: string,
  lugares: number,
  startsAt: string,
  ctx: { yaUsoIlimitadoEnLaSesion: boolean },
): OpcionDePaquete[] {
  const opciones: OpcionDePaquete[] = [];
  for (const compra of c.purchases) {
    if (compra.status !== "ACTIVE") continue;
    const vence = compra.expiresAt ?? null;
    const soloEstaClase = compra.itemBalances.every(
      (b) => b.productId === productId,
    );
    for (const b of compra.itemBalances) {
      if (b.productId !== productId || b.remainingQuantity <= 0) continue;
      const ilimitado = b.unlimited === true;
      if (ilimitado && ctx.yaUsoIlimitadoEnLaSesion) continue;
      // La fecha vive en la compra: sin copiarla, un Ilimitado que vence antes del horario se ofrecería y el SERVIDOR lo rechazaría.
      if (!cubreLugares({ ...b, expiresAt: vence }, lugares, 1, startsAt))
        continue;
      opciones.push({
        balanceId: b.id,
        packName: compra.creditPack.name,
        restante: b.remainingQuantity,
        original: b.originalQuantity,
        ilimitado,
        vence,
        soloEstaClase,
      });
    }
  }
  return opciones.sort(
    (a, b) =>
      comparar(vencimiento(a), vencimiento(b)) ||
      comparar(a.restante, b.restante) ||
      comparar(a.balanceId, b.balanceId),
  );
}

/**
 * Cómo se paga la clase sin paquete: gratis (precio 0), con tarjeta al reservar (`required` y el estudio puede cobrar en línea)
 * o en el estudio (cualquier otro caso: el SERVIDOR cae a pagar al llegar cuando no puede cobrar).
 */
export function pagoDeLaClase(
  product: Product,
  canCharge: boolean | undefined,
): "tarjeta" | "estudio" | "gratis" {
  if ((product.price ?? 0) <= 0) return "gratis";
  if (product.upfrontPolicy === "required" && canCharge !== false)
    return "tarjeta";
  return "estudio";
}
