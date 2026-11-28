import { describe, expect, it } from "vitest";
import paginaHospedada from "../../public/index.html?raw";
import { iconoDeDestacado } from "../components/ui/Icono";

const EMOJI =
  /[\u{1F300}-\u{1FAFF}\u{231A}-\u{23FF}\u{2600}-\u{27BF}\u{2B50}]/u;

// Lo que ve la clienta: los componentes (.tsx), los .ts que no son prueba y los textos de src/i18n. Los títulos de las pruebas
// (*.test.tsx, *.test.ts) no son interfaz: quedan fuera. Se leen con Vite (`?raw`), como las demás pruebas de la página.
const fuentes = import.meta.glob<string>(
  [
    "../**/*.tsx",
    "!../**/*.test.tsx",
    "../**/*.ts",
    "!../**/*.test.ts",
    "../i18n/*.json",
  ],
  { query: "?raw", import: "default", eager: true },
);

/** Las líneas con un emoji, como `archivo:línea`; los comentarios no cuentan. */
function lineasConEmoji(archivos: Record<string, string>): string[] {
  const encontrados: string[] = [];
  for (const [ruta, texto] of Object.entries(archivos)) {
    texto.split("\n").forEach((linea: string, i: number) => {
      const t = linea.trim();
      if (
        t.startsWith("//") ||
        t.startsWith("*") ||
        t.startsWith("/*") ||
        t.startsWith("{/*")
      )
        return;
      if (EMOJI.test(linea)) encontrados.push(`${ruta}:${i + 1}`);
    });
  }
  return encontrados;
}

describe("sin emojis en la interfaz", () => {
  it("lee los componentes, los .ts que no son prueba y los textos de i18n", () => {
    const rutas = Object.keys(fuentes);
    expect(rutas).toContain("../components/BookingFlow.tsx");
    expect(rutas).toContain("../i18n/es.json");
    expect(rutas).toContain("../i18n/en.json");
    expect(rutas).toContain("../lib/paquetes.ts");
    expect(rutas.some((r) => r.endsWith(".test.tsx") || r.endsWith(".test.ts"))).toBe(false);
  });

  it("ningún .tsx, .ts, texto de i18n ni public/index.html trae un emoji", () => {
    expect(
      lineasConEmoji({ ...fuentes, "public/index.html": paginaHospedada }),
    ).toEqual([]);
  });

  it("atrapa un emoji fuera de un comentario y deja pasar uno dentro", () => {
    expect(
      lineasConEmoji({
        "x.tsx": "const a = 1;\n// \u{1F389} comentario\n<p>Listo \u{1F389}</p>",
      }),
    ).toEqual(["x.tsx:3"]);
  });

  it("mapea los íconos de destacado del servidor", () => {
    expect(iconoDeDestacado("flame")).toBe("flama");
    expect(iconoDeDestacado("star")).toBe("estrella");
    expect(iconoDeDestacado("rocket")).toBeNull();
    expect(iconoDeDestacado(null)).toBeNull();
  });
});
