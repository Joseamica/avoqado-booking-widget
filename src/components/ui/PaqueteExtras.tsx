import { h } from "preact";
import type { TFunction } from "../../i18n";
import type { CreditPackPublic } from "../../types";
import { ahorroFrenteAUnaSesion, precioPorSesion } from "../../lib/paquetes";
import { precio } from "../../lib/precio";
import { branding } from "../../state/booking";
import { Icono, iconoDeDestacado } from "./Icono";

/** Un paquete con etiqueta puesta por el estudio (un SERVIDOR viejo no la manda ⇒ nunca destacado). */
export const esDestacado = (pack: CreditPackPublic): boolean =>
  !!pack.badgeText?.trim();

/** Atributos de la tarjeta: de dónde la lee la prueba y cuándo se marca como destacada. */
export const atributosDePaquete = (pack: CreditPackPublic) => ({
  "data-paquete": pack.id,
  ...(esDestacado(pack) ? { "data-destacado": "true" } : {}),
});

/** Estilo de borde: el destacado lleva el acento; los demás, el borde normal. */
export const bordeDePaquete = (pack: CreditPackPublic): string =>
  esDestacado(pack)
    ? "2px solid var(--avq-accent, #6366f1)"
    : "1px solid var(--avq-border, #e8eaed)";

/** La etiqueta de arriba («Más popular» + ícono); un ícono desconocido deja sólo el texto. */
export function EtiquetaDestacada({ pack }: { pack: CreditPackPublic }) {
  if (!esDestacado(pack)) return null;
  const icono = iconoDeDestacado(pack.badgeIcon);
  return (
    <span
      data-destacado-etiqueta=""
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        alignSelf: "flex-start",
        padding: "4px 10px",
        borderRadius: "999px",
        background: "var(--avq-accent, #6366f1)",
        color: "#fff",
        fontSize: "13px",
        fontWeight: 700,
      }}
    >
      {icono && <Icono nombre={icono} size={14} />}
      {pack.badgeText}
    </span>
  );
}

/** «$200 por sesión» y, cuando aplica, «Ahorras $500». Un Ilimitado no enseña números. */
export function LineaDePrecio({
  pack,
  packs,
  t,
}: {
  pack: CreditPackPublic;
  packs: CreditPackPublic[];
  t: TFunction;
}) {
  const porSesion = precioPorSesion(pack);
  if (porSesion == null) return null;
  const ahorro = ahorroFrenteAUnaSesion(pack, packs, {
    precioClase: null,
    showPrices: branding.value.showPrices !== false,
  });
  const lang = t("cuenta.intl").startsWith("en") ? "en" : "es";
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "4px 10px",
        alignItems: "baseline",
        fontSize: "14px",
      }}
    >
      <span style={{ color: "var(--avq-muted-fg, #6b7280)" }}>
        {t("creditPacks.perSession", {
          precio: precio(porSesion, pack.currency, lang),
        })}
      </span>
      {ahorro != null && (
        <span style={{ color: "var(--avq-accent, #6366f1)", fontWeight: 700 }}>
          {t("creditPacks.saves", {
            monto: precio(ahorro, pack.currency, lang),
          })}
        </span>
      )}
    </div>
  );
}
