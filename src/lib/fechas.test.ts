import { describe, expect, it } from "vitest";
import { createT } from "../i18n";
import { encabezadoDeDia } from "./fechas";

const TZ = "America/Mexico_City";
const AHORA = Date.UTC(2026, 10, 26, 18, 0, 0); // 26-nov-2026 12:00 CDMX
describe("encabezadoDeDia", () => {
  it("Hoy, Mañana y fecha larga", () => {
    const t = createT("es");
    expect(encabezadoDeDia("2026-11-26", AHORA, TZ, "es", t)).toBe("Hoy");
    expect(encabezadoDeDia("2026-11-27", AHORA, TZ, "es", t)).toBe("Mañana");
    const s = encabezadoDeDia("2026-11-28", AHORA, TZ, "es", t);
    expect(s).toBe("Sábado, 28 de noviembre");
    expect(s).not.toContain(" De ");
  });
  it("año sólo si no es el actual", () => {
    expect(encabezadoDeDia("2027-01-05", AHORA, TZ, "es", createT("es"))).toBe(
      "Martes, 5 de enero de 2027",
    );
  });
  it("hoy se mide en la zona del negocio", () => {
    const t = createT("es");
    const casiMedianoche = Date.UTC(2026, 10, 27, 3, 0, 0); // 26-nov 21:00 CDMX = 27 UTC
    expect(encabezadoDeDia("2026-11-26", casiMedianoche, TZ, "es", t)).toBe(
      "Hoy",
    );
  });
  it("en inglés", () => {
    expect(encabezadoDeDia("2026-11-28", AHORA, TZ, "en", createT("en"))).toBe(
      "Saturday, November 28",
    );
    expect(encabezadoDeDia("2026-11-27", AHORA, TZ, "en", createT("en"))).toBe(
      "Tomorrow",
    );
  });
});
