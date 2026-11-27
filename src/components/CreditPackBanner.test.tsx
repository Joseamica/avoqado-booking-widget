import { h } from "preact";
import { cleanup, render } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createT } from "../i18n";
import type { CreditPackPublic } from "../types";
import { CreditPackBanner } from "./CreditPackBanner";
import { CreditPacksModal } from "./CreditPacksModal";
import { UnifiedLanding } from "./UnifiedLanding";

const t = createT("es");
const fn = vi.fn();
const clase = { id: "lagree", name: "Lagree", type: "CLASS", price: 300 };
const mk = (
  id: string,
  n: number,
  price: number,
  extra: Partial<CreditPackPublic> = {},
): CreditPackPublic => ({
  id,
  name: `Paquete ${n}`,
  price,
  currency: "MXN",
  validityDays: 30,
  items: [{ id: `i${id}`, productId: "lagree", product: clase, quantity: n }],
  ...extra,
});
// Desordenados a propósito. 5 sesiones por $1,000 contra 5 sueltas de $300 (1,500) ahorra $500.
const PACKS = [
  mk("p12", 12, 2400),
  mk("p1", 1, 300),
  mk("p25", 25, 4000),
  mk("p5", 5, 1000, { badgeText: "Más popular", badgeIcon: "star" }),
  mk("p8", 8, 1600),
];
const SIN_ETIQUETA = PACKS.map(
  ({ badgeText, badgeIcon, ...p }) => p as CreditPackPublic,
);

const pantallas: [string, (p: CreditPackPublic[]) => h.JSX.Element][] = [
  [
    "banner",
    (p) => <CreditPackBanner packs={p} onBuy={fn} buyingPackId={null} t={t} />,
  ],
  [
    "ventana",
    (p) => (
      <CreditPacksModal
        packs={p}
        buyingPackId={null}
        onBuy={fn}
        onClose={fn}
        locale="es"
        t={t}
      />
    ),
  ],
  [
    "pestaña",
    (p) => (
      <UnifiedLanding
        products={[]}
        creditPacks={p}
        onPickAppointments={fn}
        onPickClasses={fn}
        onBuyPack={fn}
        buyingPackId={null}
        initialTab="packs"
        t={t}
      />
    ),
  ],
];

afterEach(() => cleanup());

describe.each(pantallas)("paquetes en %s", (_n, ver) => {
  it("de menor a mayor: 1, 5, 8, 12, 25", () => {
    const { container } = render(ver(PACKS));
    const nombres = [...container.querySelectorAll("[data-paquete]")].map((e) =>
      e.getAttribute("data-paquete"),
    );
    expect(nombres).toEqual(["p1", "p5", "p8", "p12", "p25"]);
  });
  it("precio por sesión y «Ahorras $500» donde aplica", () => {
    const { container } = render(ver(PACKS));
    const c5 = container.querySelector('[data-paquete="p5"]')!;
    expect(c5.textContent).toContain("$200 por sesión");
    expect(c5.textContent).toContain("Ahorras $500");
    expect(
      container.querySelector('[data-paquete="p1"]')!.textContent,
    ).not.toContain("Ahorras");
  });
  it("el destacado enseña etiqueta con ícono y su tarjeta se marca", () => {
    const { container } = render(ver(PACKS));
    const c5 = container.querySelector('[data-paquete="p5"]')!;
    expect(c5.getAttribute("data-destacado")).toBe("true");
    expect(c5.textContent).toContain("Más popular");
    expect(c5.querySelector("[data-destacado-etiqueta] svg")).toBeTruthy();
    expect(
      container
        .querySelector('[data-paquete="p8"]')!
        .getAttribute("data-destacado"),
    ).toBeNull();
  });
  it("SERVIDOR viejo sin etiqueta: nada truena ni se marca", () => {
    const { container } = render(ver(SIN_ETIQUETA));
    expect(container.querySelector("[data-destacado]")).toBeNull();
    expect(container.textContent).not.toContain("Más popular");
  });
});
