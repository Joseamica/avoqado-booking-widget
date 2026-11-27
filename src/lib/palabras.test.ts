import { describe, expect, it } from "vitest";
import { createT } from "../i18n";
import { unidad } from "./palabras";

const t = createT("es");
describe("unidad", () => {
  it("sesión(es) de la clase, o créditos", () => {
    expect(
      unidad(t, { cantidad: 1, nombreClase: "Lagree", soloEstaClase: true }),
    ).toBe("sesión de Lagree");
    expect(
      unidad(t, { cantidad: 5, nombreClase: "Lagree", soloEstaClase: true }),
    ).toBe("sesiones de Lagree");
    expect(
      unidad(t, { cantidad: 5, nombreClase: "Lagree", soloEstaClase: false }),
    ).toBe("créditos");
    expect(
      unidad(t, { cantidad: 1, nombreClase: "Lagree", soloEstaClase: false }),
    ).toBe("crédito");
  });
});
