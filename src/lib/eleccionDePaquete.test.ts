import { describe, expect, it } from "vitest";
import type { CustomerCreditBalance, Product } from "../types";
import { opcionesQueCubren, pagoDeLaClase } from "./eleccionDePaquete";

type Compra = CustomerCreditBalance["purchases"][number];
type Saldo = Compra["itemBalances"][number];

const saldo = (
  id: string,
  remainingQuantity: number,
  extra: Partial<Saldo> = {},
): Saldo => ({
  id,
  productId: "lagree",
  product: { id: "lagree", name: "Lagree", type: "CLASS" },
  originalQuantity: Math.max(remainingQuantity, 5),
  remainingQuantity,
  ...extra,
});
const compra = (
  id: string,
  name: string,
  itemBalances: Saldo[],
  extra: Partial<Compra> = {},
): Compra => ({
  id,
  creditPack: { name },
  status: "ACTIVE",
  itemBalances,
  ...extra,
});
const cuenta = (...purchases: Compra[]): CustomerCreditBalance => ({
  customer: { id: "ana" },
  purchases,
});

// Jueves 26 de noviembre de 2026, 18:15 en CDMX.
const CLASE = "2026-11-27T00:15:00.000Z";
const SIN_USO = { yaUsoIlimitadoEnLaSesion: false };
const ids = (c: CustomerCreditBalance, lugares = 1, ctx = SIN_USO) =>
  opcionesQueCubren(c, "lagree", lugares, CLASE, ctx).map((o) => o.balanceId);

describe("opcionesQueCubren", () => {
  it("dos paquetes que cubren: primero el que vence antes (11-dic antes que 20-dic)", () => {
    const c = cuenta(
      compra("c20", "8 Sesiones", [saldo("b20", 4)], {
        expiresAt: "2026-12-20T06:00:00.000Z",
      }),
      compra("c11", "5 Sesiones", [saldo("b11", 4)], {
        expiresAt: "2026-12-11T06:00:00.000Z",
      }),
    );
    const opciones = opcionesQueCubren(c, "lagree", 1, CLASE, SIN_USO);
    expect(opciones[0]).toEqual({
      balanceId: "b11",
      packName: "5 Sesiones",
      restante: 4,
      original: 5,
      ilimitado: false,
      vence: "2026-12-11T06:00:00.000Z",
      soloEstaClase: true,
    });
    expect(opciones.map((o) => o.balanceId)).toEqual(["b11", "b20"]);
  });

  it("sin vencimiento al final; empate de vencimiento: menos restantes y luego balanceId", () => {
    const c = cuenta(
      compra("sin", "Sin vencer", [saldo("b-sin", 1)]),
      compra("a", "A", [saldo("b-z", 3)], {
        expiresAt: "2026-12-11T06:00:00.000Z",
      }),
      compra("b", "B", [saldo("b-y", 2)], {
        expiresAt: "2026-12-11T06:00:00.000Z",
      }),
      compra("c", "C", [saldo("b-x", 3)], {
        expiresAt: "2026-12-11T06:00:00.000Z",
      }),
    );
    expect(ids(c)).toEqual(["b-y", "b-x", "b-z", "b-sin"]);
  });

  it("no ofrece compras que no estén ACTIVE ni saldos en 0, ni de otra clase", () => {
    const c = cuenta(
      compra("venc", "Vencido", [saldo("b-venc", 3)], { status: "EXPIRED" }),
      compra("cero", "Vacío", [saldo("b-cero", 0)]),
      compra("otra", "Barre", [
        saldo("b-otra", 3, {
          productId: "barre",
          product: { id: "barre", name: "Barre", type: "CLASS" },
        }),
      ]),
      compra("ok", "5 Sesiones", [saldo("b-ok", 3)]),
    );
    expect(ids(c)).toEqual(["b-ok"]);
  });

  it("un paquete que no alcanza para los lugares no aparece", () => {
    const c = cuenta(
      compra("uno", "1 Sesión", [saldo("b-uno", 1)]),
      compra("tres", "5 Sesiones", [saldo("b-tres", 3)]),
    );
    expect(ids(c, 2)).toEqual(["b-tres"]);
  });

  it("soloEstaClase es false si la compra tiene saldos de otra clase", () => {
    const c = cuenta(
      compra("mix", "Mixto", [
        saldo("b-lagree", 3),
        saldo("b-barre", 3, {
          productId: "barre",
          product: { id: "barre", name: "Barre", type: "CLASS" },
        }),
      ]),
    );
    const [opcion] = opcionesQueCubren(c, "lagree", 1, CLASE, SIN_USO);
    expect(opcion.balanceId).toBe("b-lagree");
    expect(opcion.soloEstaClase).toBe(false);
  });

  describe("Ilimitado (D679)", () => {
    const ilimitado = (extra: Partial<Compra> = {}) =>
      compra(
        "ili",
        "Ilimitado",
        [
          saldo("b-ili", 99_999, {
            originalQuantity: 99_999,
            unlimited: true,
          }),
        ],
        { expiresAt: "2026-12-20T06:00:00.000Z", ...extra },
      );
    const normal = compra("cinco", "5 Sesiones", [saldo("b-cinco", 4)], {
      expiresAt: "2026-12-11T06:00:00.000Z",
    });

    it("cubre un lugar: aparece marcado como Ilimitado", () => {
      const [opcion] = opcionesQueCubren(
        cuenta(ilimitado()),
        "lagree",
        1,
        CLASE,
        SIN_USO,
      );
      expect(opcion.balanceId).toBe("b-ili");
      expect(opcion.ilimitado).toBe(true);
      expect(opcion.vence).toBe("2026-12-20T06:00:00.000Z");
    });

    it("que vence antes del horario no aparece (la fecha es de la COMPRA, el saldo no la trae)", () => {
      const c = cuenta(
        ilimitado({ expiresAt: "2026-11-26T18:00:00.000Z" }),
        normal,
      );
      expect(ids(c)).toEqual(["b-cinco"]);
    });

    it("que vence justo a la hora de la clase tampoco aparece (el SERVIDOR: startsAt >= expiresAt)", () => {
      expect(ids(cuenta(ilimitado({ expiresAt: CLASE })))).toEqual([]);
    });

    it("con 2 lugares no aparece (es personal)", () => {
      expect(ids(cuenta(ilimitado(), normal), 2)).toEqual(["b-cinco"]);
    });

    it("si ya canjeó su Ilimitado en esta sesión, no aparece; un paquete normal sí", () => {
      const c = cuenta(ilimitado(), normal);
      expect(ids(c, 1, { yaUsoIlimitadoEnLaSesion: true })).toEqual([
        "b-cinco",
      ]);
    });

    it("si su reserva anterior en esa sesión fue con tarjeta (no usó el Ilimitado), sí aparece", () => {
      const c = cuenta(ilimitado(), normal);
      expect(ids(c, 1, { yaUsoIlimitadoEnLaSesion: false })).toEqual([
        "b-cinco",
        "b-ili",
      ]);
    });

    it("con el mismo vencimiento que un paquete normal, el normal va primero (su 99,999 no se enseña, sólo ordena)", () => {
      const c = cuenta(
        ilimitado({ expiresAt: "2026-12-11T06:00:00.000Z" }),
        normal,
      );
      expect(ids(c)).toEqual(["b-cinco", "b-ili"]);
    });
  });

  it("un paquete normal cuya compra vence antes del horario sigue apareciendo (el SERVIDOR sólo revisa que no haya vencido hoy)", () => {
    const c = cuenta(
      compra("cinco", "5 Sesiones", [saldo("b-cinco", 4)], {
        expiresAt: "2026-11-26T18:00:00.000Z",
      }),
    );
    expect(ids(c)).toEqual(["b-cinco"]);
  });
});

const clase = (extra: Partial<Product>): Product => ({
  id: "lagree",
  name: "Lagree",
  price: 325,
  duration: 50,
  eventCapacity: null,
  type: "CLASS",
  ...extra,
});

describe("pagoDeLaClase", () => {
  it("precio 0 o sin precio ⇒ gratis", () => {
    expect(
      pagoDeLaClase(clase({ price: 0, upfrontPolicy: "required" }), true),
    ).toBe("gratis");
    expect(pagoDeLaClase(clase({ price: null }), true)).toBe("gratis");
  });

  it("por adelantado y el estudio puede cobrar ⇒ tarjeta (también si un SERVIDOR viejo no dice canCharge)", () => {
    expect(pagoDeLaClase(clase({ upfrontPolicy: "required" }), true)).toBe(
      "tarjeta",
    );
    expect(pagoDeLaClase(clase({ upfrontPolicy: "required" }), undefined)).toBe(
      "tarjeta",
    );
  });

  it("por adelantado pero el estudio no puede cobrar ⇒ estudio (el SERVIDOR cae a pagar al llegar)", () => {
    expect(pagoDeLaClase(clase({ upfrontPolicy: "required" }), false)).toBe(
      "estudio",
    );
  });

  it("al llegar, opcional o sin política ⇒ estudio", () => {
    expect(pagoDeLaClase(clase({ upfrontPolicy: "at_venue" }), true)).toBe(
      "estudio",
    );
    expect(pagoDeLaClase(clase({ upfrontPolicy: "optional" }), true)).toBe(
      "estudio",
    );
    expect(pagoDeLaClase(clase({}), true)).toBe("estudio");
  });
});
