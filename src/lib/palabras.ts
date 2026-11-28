/** Palabras que dependen de la cantidad y de si el paquete es de una sola clase. Puro: sin señales ni efectos. */
import type { TFunction } from "../i18n";

/** «sesión de Lagree» / «sesiones de Lagree» si el paquete es de esta clase; si cubre varias, «crédito(s)». */
export function unidad(
  t: TFunction,
  a: { cantidad: number; nombreClase: string; soloEstaClase: boolean },
): string {
  const uno = a.cantidad === 1;
  if (!a.soloEstaClase)
    return t(uno ? "reservaClases.credito" : "reservaClases.creditos");
  return t(uno ? "reservaClases.sesionDe" : "reservaClases.sesionesDe", {
    clase: a.nombreClase,
  });
}
