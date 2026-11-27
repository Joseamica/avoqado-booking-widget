import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { iconoDeDestacado } from "../components/ui/Icono";

const EMOJI =
  /[\u{1F300}-\u{1FAFF}\u{231A}-\u{23FF}\u{2600}-\u{27BF}\u{2B50}]/u;

function archivos(dir: string, salida: string[] = []): string[] {
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) archivos(ruta, salida);
    else if (ruta.endsWith(".tsx") && !ruta.endsWith(".test.tsx"))
      salida.push(ruta);
  }
  return salida;
}

// Los títulos de las pruebas (*.test.tsx) no son interfaz: quedan fuera.
describe("sin emojis en la interfaz", () => {
  it("ningún .tsx ni public/index.html trae un emoji", () => {
    const encontrados: string[] = [];
    for (const ruta of [...archivos("src"), "public/index.html"]) {
      readFileSync(ruta, "utf8")
        .split("\n")
        .forEach((linea, i) => {
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
    expect(encontrados).toEqual([]);
  });

  it("mapea los íconos de destacado del servidor", () => {
    expect(iconoDeDestacado("flame")).toBe("flama");
    expect(iconoDeDestacado("star")).toBe("estrella");
    expect(iconoDeDestacado("rocket")).toBeNull();
    expect(iconoDeDestacado(null)).toBeNull();
  });
});
