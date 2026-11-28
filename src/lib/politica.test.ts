import { describe, expect, it } from "vitest";
import { createT } from "../i18n";
import type { PublicCancellationPolicy } from "../types";
import { lineaDePolitica } from "./politica";

const t = createT("es");
// Jueves 26 de noviembre de 2026, 18:15 en CDMX.
const CLASE = "2026-11-27T00:15:00.000Z";
const CDMX = "America/Mexico_City";
// Una semana antes de la clase: antes de todos los plazos.
const ANTES = Date.parse("2026-11-19T18:00:00.000Z");
const HORA = 3_600_000;
const inicio = Date.parse(CLASE);
// Con la política de default: devolución gratis hasta 24 h antes (mié 25 18:15) y en línea hasta 2 h antes (jue 26 16:15).
const GRATIS = inicio - 24 * HORA;
const EN_LINEA = inicio - 2 * HORA;
const YA_NO =
  "Esta clase ya no se puede cancelar en línea. Si necesitas cancelar, escríbele al estudio.";

const politica = (
  extra: Partial<PublicCancellationPolicy> = {},
): PublicCancellationPolicy => ({
  allowCustomerCancel: true,
  minHoursBeforeStart: 2,
  creditRefundMode: "TIME_BASED",
  creditFreeRefundHoursBefore: 24,
  creditLateRefundPercent: 0,
  ...extra,
});
type PagaCon = "paquete" | "ilimitado" | "tarjeta" | "estudio" | "gratis";
const linea = (
  p: PublicCancellationPolicy | null | undefined,
  pagaCon: PagaCon,
  extra: {
    sesiones?: number;
    startsAt?: string;
    timeZone?: string;
    ahora?: number;
  } = {},
) =>
  lineaDePolitica(t, p, {
    startsAt: extra.startsAt ?? CLASE,
    timeZone: extra.timeZone ?? CDMX,
    pagaCon,
    sesiones: extra.sesiones ?? 1,
    locale: "es",
    ahora: extra.ahora ?? ANTES,
  });

describe("lineaDePolitica", () => {
  it("sin política del SERVIDOR (viejo) no hay línea: nunca se inventa", () => {
    expect(linea(undefined, "paquete")).toBeNull();
    expect(linea(null, "tarjeta")).toBeNull();
  });

  it("si el estudio no deja cancelar en línea", () => {
    for (const pagaCon of [
      "paquete",
      "ilimitado",
      "tarjeta",
      "estudio",
      "gratis",
    ] as const) {
      expect(linea(politica({ allowCustomerCancel: false }), pagaCon)).toBe(
        "Para cancelar, escríbele al estudio.",
      );
    }
  });

  describe("con paquete", () => {
    it("TIME_BASED 24 h, 2 h para cancelar en línea, 0 % tarde: dos plazos", () => {
      expect(linea(politica(), "paquete")).toBe(
        "Cancela gratis hasta el miércoles 25 a las 18:15 y la sesión regresa a tu paquete. Hasta el jueves 26 a las 16:15 puedes cancelar, pero ya no regresa.",
      );
    });

    it("50 % tarde con 1 sesión: la cuenta del SERVIDOR redondea hacia abajo y no regresa", () => {
      expect(
        linea(politica({ creditLateRefundPercent: 50 }), "paquete", {
          sesiones: 1,
        }),
      ).toBe(
        "Cancela gratis hasta el miércoles 25 a las 18:15 y la sesión regresa a tu paquete. Hasta el jueves 26 a las 16:15 puedes cancelar, pero ya no regresa.",
      );
    });

    it("50 % tarde con 2 sesiones: regresa 1 de tus 2", () => {
      expect(
        linea(politica({ creditLateRefundPercent: 50 }), "paquete", {
          sesiones: 2,
        }),
      ).toBe(
        "Cancela gratis hasta el miércoles 25 a las 18:15 y las sesiones regresan a tu paquete. Hasta el jueves 26 a las 16:15 puedes cancelar y regresa 1 de tus 2 sesiones.",
      );
    });

    it("50 % tarde con 5 sesiones: regresan 2 de tus 5 (2.5 hacia abajo)", () => {
      expect(
        linea(politica({ creditLateRefundPercent: 50 }), "paquete", {
          sesiones: 5,
        }),
      ).toBe(
        "Cancela gratis hasta el miércoles 25 a las 18:15 y las sesiones regresan a tu paquete. Hasta el jueves 26 a las 16:15 puedes cancelar y regresan 2 de tus 5 sesiones.",
      );
    });

    it("0 % tarde con 2 sesiones: ya no regresan", () => {
      expect(linea(politica(), "paquete", { sesiones: 2 })).toBe(
        "Cancela gratis hasta el miércoles 25 a las 18:15 y las sesiones regresan a tu paquete. Hasta el jueves 26 a las 16:15 puedes cancelar, pero ya no regresan.",
      );
    });

    it("100 % tarde (o más, que el SERVIDOR recorta a 100): siempre regresa, una sola frase", () => {
      const esperado =
        "Cancela gratis hasta el jueves 26 a las 16:15 y la sesión regresa a tu paquete.";
      expect(linea(politica({ creditLateRefundPercent: 100 }), "paquete")).toBe(
        esperado,
      );
      expect(linea(politica({ creditLateRefundPercent: 150 }), "paquete")).toBe(
        esperado,
      );
    });

    it("cancelar en línea cierra antes que la devolución gratis (48 h): una sola frase con el martes 24", () => {
      expect(linea(politica({ minHoursBeforeStart: 48 }), "paquete")).toBe(
        "Cancela gratis hasta el martes 24 a las 18:15 y la sesión regresa a tu paquete.",
      );
    });

    it("los dos plazos iguales: una sola frase", () => {
      expect(linea(politica({ minHoursBeforeStart: 24 }), "paquete")).toBe(
        "Cancela gratis hasta el miércoles 25 a las 18:15 y la sesión regresa a tu paquete.",
      );
    });

    it("sin plazo para cancelar en línea: se puede hasta la hora de la clase", () => {
      expect(linea(politica({ minHoursBeforeStart: null }), "paquete")).toBe(
        "Cancela gratis hasta el miércoles 25 a las 18:15 y la sesión regresa a tu paquete. Hasta el jueves 26 a las 18:15 puedes cancelar, pero ya no regresa.",
      );
    });

    it("ALWAYS: regresa siempre, hasta el plazo de cancelar en línea", () => {
      expect(linea(politica({ creditRefundMode: "ALWAYS" }), "paquete")).toBe(
        "Cancela gratis hasta el jueves 26 a las 16:15 y la sesión regresa a tu paquete.",
      );
    });

    it("NEVER: la sesión no regresa", () => {
      expect(linea(politica({ creditRefundMode: "NEVER" }), "paquete")).toBe(
        "Si cancelas, la sesión no regresa a tu paquete.",
      );
      expect(
        linea(politica({ creditRefundMode: "NEVER" }), "paquete", {
          sesiones: 2,
        }),
      ).toBe("Si cancelas, las sesiones no regresan a tu paquete.");
    });
  });

  describe("con Ilimitado (el SERVIDOR siempre le regresa su uso)", () => {
    it("NEVER: tu Ilimitado sigue igual", () => {
      expect(linea(politica({ creditRefundMode: "NEVER" }), "ilimitado")).toBe(
        "Puedes cancelar hasta el jueves 26 a las 16:15; tu Ilimitado sigue igual.",
      );
    });

    it("ALWAYS: igual", () => {
      expect(linea(politica({ creditRefundMode: "ALWAYS" }), "ilimitado")).toBe(
        "Puedes cancelar hasta el jueves 26 a las 16:15; tu Ilimitado sigue igual.",
      );
    });

    it("TIME_BASED con ventana tardía: después cuenta como cancelación tardía", () => {
      expect(linea(politica(), "ilimitado")).toBe(
        "Puedes cancelar hasta el jueves 26 a las 16:15; tu Ilimitado sigue igual. Hasta el miércoles 25 a las 18:15 es a tiempo; después cuenta como cancelación tardía.",
      );
    });

    it("TIME_BASED con 100 % tarde: la falta se anota igual (el SERVIDOR la marca por la hora, no por el %)", () => {
      expect(
        linea(politica({ creditLateRefundPercent: 100 }), "ilimitado"),
      ).toBe(
        "Puedes cancelar hasta el jueves 26 a las 16:15; tu Ilimitado sigue igual. Hasta el miércoles 25 a las 18:15 es a tiempo; después cuenta como cancelación tardía.",
      );
    });

    it("TIME_BASED sin ventana tardía alcanzable (48 h para cancelar en línea): sin aviso de cancelación tardía", () => {
      expect(linea(politica({ minHoursBeforeStart: 48 }), "ilimitado")).toBe(
        "Puedes cancelar hasta el martes 24 a las 18:15; tu Ilimitado sigue igual.",
      );
    });
  });

  describe("con tarjeta, en el estudio o gratis: no promete devolución, sólo hasta cuándo", () => {
    it("12 h antes", () => {
      for (const pagaCon of ["tarjeta", "estudio", "gratis"] as const) {
        expect(linea(politica({ minHoursBeforeStart: 12 }), pagaCon)).toBe(
          "Puedes cancelar en línea hasta el jueves 26 a las 6:15.",
        );
      }
    });

    it("la regla de devolución del paquete no cambia la frase", () => {
      expect(linea(politica({ creditRefundMode: "NEVER" }), "tarjeta")).toBe(
        "Puedes cancelar en línea hasta el jueves 26 a las 16:15.",
      );
    });

    it("a la 1:15 (no «a las 1:15»)", () => {
      expect(
        linea(politica({ minHoursBeforeStart: 12 }), "tarjeta", {
          startsAt: "2026-11-26T19:15:00.000Z",
        }),
      ).toBe("Puedes cancelar en línea hasta el jueves 26 a la 1:15.");
    });
  });

  it("las horas son las de la zona del negocio, no las del navegador", () => {
    expect(
      linea(politica({ minHoursBeforeStart: 12 }), "tarjeta", {
        timeZone: "America/Cancun",
      }),
    ).toBe("Puedes cancelar en línea hasta el jueves 26 a las 7:15.");
    // En Madrid la clase es el viernes 27 a la 1:15: los plazos caen el jueves.
    expect(linea(politica(), "paquete", { timeZone: "Europe/Madrid" })).toBe(
      "Cancela gratis hasta el jueves 26 a la 1:15 y la sesión regresa a tu paquete. Hasta el jueves 26 a las 23:15 puedes cancelar, pero ya no regresa.",
    );
  });

  it("nunca dice «12h» (ni ninguna hora pegada a «h»)", () => {
    const modos = ["NEVER", "ALWAYS", "TIME_BASED"] as const;
    const pagos = [
      "paquete",
      "ilimitado",
      "tarjeta",
      "estudio",
      "gratis",
    ] as const;
    for (const creditRefundMode of modos)
      for (const minHoursBeforeStart of [null, 0, 2, 12, 24, 48])
        for (const pagaCon of pagos)
          for (const ahora of [ANTES, GRATIS, EN_LINEA - 1, EN_LINEA])
            for (const creditLateRefundPercent of [0, 50]) {
              const texto = linea(
                politica({
                  creditRefundMode,
                  minHoursBeforeStart,
                  creditLateRefundPercent,
                }),
                pagaCon,
                { sesiones: 2, ahora },
              );
              expect(texto).not.toBeNull();
              expect(texto).not.toMatch(/\d\s*h\b/);
              expect(texto).not.toContain("12h");
            }
  });

  describe("ya pasó un plazo (la línea habla de lo que pasa si cancela AHORA)", () => {
    const DOS_FRASES =
      "Cancela gratis hasta el miércoles 25 a las 18:15 y la sesión regresa a tu paquete. Hasta el jueves 26 a las 16:15 puedes cancelar, pero ya no regresa.";
    const TARDE_PAQUETE =
      "Si cancelas, la sesión ya no regresa a tu paquete. Puedes cancelar en línea hasta el jueves 26 a las 16:15.";

    describe("paquete", () => {
      it("1 ms antes de que acabe la devolución gratis: los dos plazos de siempre", () => {
        expect(linea(politica(), "paquete", { ahora: GRATIS - 1 })).toBe(
          DOS_FRASES,
        );
      });

      it("justo al acabar la devolución gratis: ya no promete el «gratis»", () => {
        expect(linea(politica(), "paquete", { ahora: GRATIS })).toBe(
          TARDE_PAQUETE,
        );
      });

      it("1 ms antes del plazo en línea: lo mismo", () => {
        expect(linea(politica(), "paquete", { ahora: EN_LINEA - 1 })).toBe(
          TARDE_PAQUETE,
        );
      });

      it("justo en el plazo en línea: ya no se puede cancelar en línea", () => {
        expect(linea(politica(), "paquete", { ahora: EN_LINEA })).toBe(YA_NO);
        expect(linea(politica(), "paquete", { ahora: EN_LINEA + HORA })).toBe(
          YA_NO,
        );
      });

      it("0 % tarde con 2 sesiones: ya no regresan", () => {
        expect(
          linea(politica(), "paquete", { sesiones: 2, ahora: GRATIS }),
        ).toBe(
          "Si cancelas, las sesiones ya no regresan a tu paquete. Puedes cancelar en línea hasta el jueves 26 a las 16:15.",
        );
      });

      it("50 % tarde: la misma cuenta hacia abajo que el SERVIDOR", () => {
        const p = politica({ creditLateRefundPercent: 50 });
        expect(linea(p, "paquete", { sesiones: 1, ahora: GRATIS })).toBe(
          TARDE_PAQUETE,
        );
        expect(linea(p, "paquete", { sesiones: 2, ahora: GRATIS })).toBe(
          "Si cancelas, regresa 1 de tus 2 sesiones. Puedes cancelar en línea hasta el jueves 26 a las 16:15.",
        );
        expect(linea(p, "paquete", { sesiones: 5, ahora: GRATIS })).toBe(
          "Si cancelas, regresan 2 de tus 5 sesiones. Puedes cancelar en línea hasta el jueves 26 a las 16:15.",
        );
      });

      it("100 % tarde: todo regresa hasta el plazo en línea, así que la frase de siempre sigue siendo cierta", () => {
        expect(
          linea(politica({ creditLateRefundPercent: 100 }), "paquete", {
            ahora: GRATIS,
          }),
        ).toBe(
          "Cancela gratis hasta el jueves 26 a las 16:15 y la sesión regresa a tu paquete.",
        );
      });

      it("NEVER y ALWAYS no tienen plazo gratis: sólo cambia al pasar el plazo en línea", () => {
        expect(
          linea(politica({ creditRefundMode: "NEVER" }), "paquete", {
            ahora: EN_LINEA - 1,
          }),
        ).toBe("Si cancelas, la sesión no regresa a tu paquete.");
        expect(
          linea(politica({ creditRefundMode: "ALWAYS" }), "paquete", {
            ahora: EN_LINEA - 1,
          }),
        ).toBe(
          "Cancela gratis hasta el jueves 26 a las 16:15 y la sesión regresa a tu paquete.",
        );
        expect(
          linea(politica({ creditRefundMode: "NEVER" }), "paquete", {
            ahora: EN_LINEA,
          }),
        ).toBe(YA_NO);
        expect(
          linea(politica({ creditRefundMode: "ALWAYS" }), "paquete", {
            ahora: EN_LINEA,
          }),
        ).toBe(YA_NO);
      });

      it("sin plazo en línea: se puede hasta la hora de la clase", () => {
        const p = politica({ minHoursBeforeStart: null });
        expect(linea(p, "paquete", { ahora: inicio - 1 })).toBe(
          "Si cancelas, la sesión ya no regresa a tu paquete. Puedes cancelar en línea hasta el jueves 26 a las 18:15.",
        );
        expect(linea(p, "paquete", { ahora: inicio })).toBe(YA_NO);
      });
    });

    describe("Ilimitado", () => {
      const TARDE =
        "Puedes cancelar hasta el jueves 26 a las 16:15; tu Ilimitado sigue igual, pero cuenta como cancelación tardía.";

      it("1 ms antes de que acabe el tiempo a tiempo: los dos plazos de siempre", () => {
        expect(linea(politica(), "ilimitado", { ahora: GRATIS - 1 })).toBe(
          "Puedes cancelar hasta el jueves 26 a las 16:15; tu Ilimitado sigue igual. Hasta el miércoles 25 a las 18:15 es a tiempo; después cuenta como cancelación tardía.",
        );
      });

      it("justo al acabar y 1 ms antes del plazo en línea: cuenta como cancelación tardía", () => {
        expect(linea(politica(), "ilimitado", { ahora: GRATIS })).toBe(TARDE);
        expect(linea(politica(), "ilimitado", { ahora: EN_LINEA - 1 })).toBe(
          TARDE,
        );
      });

      it("justo en el plazo en línea: ya no se puede cancelar en línea", () => {
        expect(linea(politica(), "ilimitado", { ahora: EN_LINEA })).toBe(YA_NO);
      });

      it("sin ventana tardía (48 h para cancelar en línea): sólo cambia al pasar el plazo en línea", () => {
        const p = politica({ minHoursBeforeStart: 48 });
        const limite = inicio - 48 * HORA;
        expect(linea(p, "ilimitado", { ahora: limite - 1 })).toBe(
          "Puedes cancelar hasta el martes 24 a las 18:15; tu Ilimitado sigue igual.",
        );
        expect(linea(p, "ilimitado", { ahora: limite })).toBe(YA_NO);
      });

      it("NEVER: no hay falta que anotar, sólo el plazo en línea", () => {
        const p = politica({ creditRefundMode: "NEVER" });
        expect(linea(p, "ilimitado", { ahora: EN_LINEA - 1 })).toBe(
          "Puedes cancelar hasta el jueves 26 a las 16:15; tu Ilimitado sigue igual.",
        );
        expect(linea(p, "ilimitado", { ahora: EN_LINEA })).toBe(YA_NO);
      });
    });

    describe("tarjeta, estudio y gratis: sólo el plazo en línea", () => {
      const p = politica({ minHoursBeforeStart: 12 });
      const limite = inicio - 12 * HORA;

      it("1 ms antes del plazo (aunque ya pasó la devolución gratis de los paquetes): la frase de siempre", () => {
        for (const pagaCon of ["tarjeta", "estudio", "gratis"] as const) {
          expect(linea(p, pagaCon, { ahora: limite - 1 })).toBe(
            "Puedes cancelar en línea hasta el jueves 26 a las 6:15.",
          );
          expect(linea(politica(), pagaCon, { ahora: GRATIS })).toBe(
            "Puedes cancelar en línea hasta el jueves 26 a las 16:15.",
          );
        }
      });

      it("justo en el plazo: ya no se puede cancelar en línea", () => {
        for (const pagaCon of ["tarjeta", "estudio", "gratis"] as const)
          expect(linea(p, pagaCon, { ahora: limite })).toBe(YA_NO);
      });
    });

    it("si el estudio no deja cancelar en línea, la frase de siempre aunque ya pasó el plazo", () => {
      expect(
        linea(politica({ allowCustomerCancel: false }), "paquete", {
          ahora: EN_LINEA,
        }),
      ).toBe("Para cancelar, escríbele al estudio.");
    });

    it("en inglés", () => {
      const en = createT("en");
      const ctx = {
        startsAt: CLASE,
        timeZone: CDMX,
        sesiones: 2,
        locale: "en" as const,
      };
      expect(
        lineaDePolitica(en, politica(), {
          ...ctx,
          pagaCon: "paquete",
          ahora: EN_LINEA,
        }),
      ).toBe(
        "This class can no longer be cancelled online. If you need to cancel, message the studio.",
      );
      expect(
        lineaDePolitica(en, politica(), {
          ...ctx,
          pagaCon: "paquete",
          ahora: GRATIS,
        }),
      ).toBe(
        "If you cancel, the sessions no longer go back to your pack. You can cancel online until Thursday, Nov 26 at 4:15 PM.",
      );
      expect(
        lineaDePolitica(en, politica({ creditLateRefundPercent: 50 }), {
          ...ctx,
          pagaCon: "paquete",
          ahora: GRATIS,
        }),
      ).toBe(
        "If you cancel, 1 of your 2 sessions goes back. You can cancel online until Thursday, Nov 26 at 4:15 PM.",
      );
      expect(
        lineaDePolitica(en, politica(), {
          ...ctx,
          sesiones: 1,
          pagaCon: "ilimitado",
          ahora: GRATIS,
        }),
      ).toBe(
        "You can cancel until Thursday, Nov 26 at 4:15 PM; your unlimited pass stays the same, but it counts as a late cancellation.",
      );
    });
  });

  it("en inglés", () => {
    const en = createT("en");
    expect(
      lineaDePolitica(en, politica(), {
        startsAt: CLASE,
        timeZone: CDMX,
        pagaCon: "paquete",
        sesiones: 1,
        locale: "en",
        ahora: ANTES,
      }),
    ).toBe(
      "Cancel for free until Wednesday, Nov 25 at 6:15 PM and the session goes back to your pack. Until Thursday, Nov 26 at 4:15 PM you can still cancel, but it no longer goes back.",
    );
    expect(
      lineaDePolitica(en, politica({ minHoursBeforeStart: 12 }), {
        startsAt: CLASE,
        timeZone: CDMX,
        pagaCon: "tarjeta",
        sesiones: 1,
        locale: "en",
        ahora: ANTES,
      }),
    ).toBe("You can cancel online until Thursday, Nov 26 at 6:15 AM.");
  });
});
