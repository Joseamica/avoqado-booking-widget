/** Reglas puras de los paquetes en venta: orden, precio por sesión, ahorro y etiqueta de precio. */
import type { TFunction } from "../i18n";
import type { CreditPackPublic } from "../types";
import { totalDeSesiones } from "./credits";
import { precio } from "./precio";

const sesiones = (p: CreditPackPublic): number | "ilimitado" =>
  totalDeSesiones(p.items);

/** Copia ordenada por sesiones (Ilimitado al final); empate por precio. `sort` es estable. */
export function ordenarPaquetes(packs: CreditPackPublic[]): CreditPackPublic[] {
  const clave = (p: CreditPackPublic) => {
    const s = sesiones(p);
    return s === "ilimitado" ? Infinity : s;
  };
  return [...packs].sort((a, b) => {
    const ka = clave(a);
    const kb = clave(b);
    return ka === kb ? a.price - b.price : ka < kb ? -1 : 1;
  });
}

/** Precio de cada sesión; `null` en un Ilimitado. */
export function precioPorSesion(pack: CreditPackPublic): number | null {
  const s = sesiones(pack);
  return s === "ilimitado" || s <= 0 ? null : pack.price / s;
}

/**
 * Cuánto se ahorra frente a pagar las sesiones sueltas. Referencia: el paquete de 1 sesión de esa misma clase; si no existe,
 * `precioClase` sólo cuando se enseñan precios. `null` si cubre varias clases, es Ilimitado o no ahorra nada.
 */
export function ahorroFrenteAUnaSesion(
  pack: CreditPackPublic,
  packs: CreditPackPublic[],
  ref: { precioClase: number | null; showPrices: boolean },
): number | null {
  const s = sesiones(pack);
  if (s === "ilimitado") return null;
  const productos = new Set(pack.items.map((i) => i.productId));
  if (productos.size !== 1) return null;
  const [productId] = [...productos];
  const suelto = packs.find((p) => {
    if (
      p.items.length !== 1 ||
      p.items[0].productId !== productId ||
      p.items[0].unlimited
    )
      return false;
    return sesiones(p) === 1;
  });
  const unitario = suelto
    ? suelto.price
    : ref.showPrices
      ? ref.precioClase
      : null;
  if (unitario == null) return null;
  const ahorro = Math.round((unitario * s - pack.price) * 100) / 100;
  return ahorro > 0 ? ahorro : null;
}

/** «Incluida en tu paquete», «$325 · clase suelta» o nada (sin precios o sin monto). */
export function etiquetaDePrecio(
  t: TFunction,
  a: { precio: number | null; showPrices: boolean; incluida: boolean },
): string | null {
  if (a.incluida) return t("reservaClases.incluida");
  if (!a.showPrices || a.precio == null) return null;
  return t("reservaClases.claseSuelta", {
    precio: precio(
      a.precio,
      "MXN",
      t("cuenta.intl").startsWith("en") ? "en" : "es",
    ),
  });
}
