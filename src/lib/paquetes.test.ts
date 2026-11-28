import { describe, expect, it } from "vitest";
import { createT } from "../i18n";
import type { CreditPackPublic } from "../types";
import {
  ahorroFrenteAUnaSesion,
  etiquetaDePrecio,
  ordenarPaquetes,
  precioPorSesion,
} from "./paquetes";

const t = createT("es");
const pack = (
  name: string,
  price: number,
  quantity: number,
  unlimited = false,
  productId = "p1",
): CreditPackPublic => ({
  id: name,
  name,
  price,
  currency: "MXN",
  items: [
    {
      id: `i-${name}`,
      productId,
      product: {
        id: productId,
        name: "Lagree",
        type: "APPOINTMENTS_CLASS",
        price: 325,
      },
      quantity,
      unlimited,
    },
  ],
});
const P5 = pack("5", 1450, 5);
const P1 = pack("1", 325, 1);
const P8 = pack("8", 2100, 8);
const P12 = pack("12", 2750, 12);
const P25 = pack("25", 4600, 25);
const ILI = pack("Ilimitado", 3900, 99999, true);
const TODOS = [P5, P1, P8, P12, P25, ILI];

describe("ordenarPaquetes", () => {
  it("por sesiones, Ilimitado al final, sin mutar", () => {
    const copia = [...TODOS];
    expect(ordenarPaquetes(TODOS).map((p) => p.name)).toEqual([
      "1",
      "5",
      "8",
      "12",
      "25",
      "Ilimitado",
    ]);
    expect(TODOS).toEqual(copia);
  });
  it("empate de sesiones: por precio; luego estable", () => {
    const a = pack("a", 500, 5);
    const b = pack("b", 400, 5);
    const c = pack("c", 400, 5);
    expect(ordenarPaquetes([a, b, c]).map((p) => p.name)).toEqual([
      "b",
      "c",
      "a",
    ]);
  });
});

describe("precioPorSesion", () => {
  it("precio entre sesiones; Ilimitado null", () => {
    expect(precioPorSesion(P8)).toBe(262.5);
    expect(precioPorSesion(ILI)).toBeNull();
  });
});

describe("ahorroFrenteAUnaSesion", () => {
  const ref = { precioClase: null, showPrices: false };
  it("contra el paquete de 1 sesión", () => {
    expect(ahorroFrenteAUnaSesion(P5, TODOS, ref)).toBe(175);
    expect(ahorroFrenteAUnaSesion(P8, TODOS, ref)).toBe(500);
    expect(ahorroFrenteAUnaSesion(P12, TODOS, ref)).toBe(1150);
    expect(ahorroFrenteAUnaSesion(P25, TODOS, ref)).toBe(3525);
  });
  it("sin el de 1 sesión: sólo con showPrices usa precioClase", () => {
    const sin = [P5, P8];
    expect(ahorroFrenteAUnaSesion(P5, sin, ref)).toBeNull();
    expect(
      ahorroFrenteAUnaSesion(P5, sin, { precioClase: 325, showPrices: false }),
    ).toBeNull();
    expect(
      ahorroFrenteAUnaSesion(P5, sin, { precioClase: 325, showPrices: true }),
    ).toBe(175);
  });
  it("null en Ilimitado, de varias clases o sin ahorro", () => {
    expect(ahorroFrenteAUnaSesion(ILI, TODOS, ref)).toBeNull();
    const dos: CreditPackPublic = {
      ...P5,
      items: [P5.items[0], { ...P5.items[0], id: "x", productId: "p2" }],
    };
    expect(ahorroFrenteAUnaSesion(dos, TODOS, ref)).toBeNull();
    expect(
      ahorroFrenteAUnaSesion(pack("caro", 2000, 5), TODOS, ref),
    ).toBeNull();
  });
  it("el paquete de 1 sesión de OTRA clase no es referencia", () => {
    const otra = pack("1b", 100, 1, false, "p2");
    expect(ahorroFrenteAUnaSesion(P5, [P5, otra], ref)).toBeNull();
  });
});

describe("etiquetaDePrecio", () => {
  it("incluida gana; sin precios null; con precio «clase suelta»", () => {
    expect(
      etiquetaDePrecio(t, { precio: 325, showPrices: true, incluida: true }),
    ).toBe("Incluida en tu paquete");
    expect(
      etiquetaDePrecio(t, { precio: 325, showPrices: false, incluida: false }),
    ).toBeNull();
    expect(
      etiquetaDePrecio(t, { precio: null, showPrices: true, incluida: false }),
    ).toBeNull();
    expect(
      etiquetaDePrecio(t, { precio: 325, showPrices: true, incluida: false }),
    ).toBe("$325 · clase suelta");
  });
  it("en inglés", () => {
    expect(
      etiquetaDePrecio(createT("en"), {
        precio: 325,
        showPrices: true,
        incluida: false,
      }),
    ).toBe("MX$325 · drop-in class");
  });
});
