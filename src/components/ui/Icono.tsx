import { h } from "preact";

export type NombreIcono =
  | "check"
  | "reloj"
  | "lugar"
  | "chat"
  | "paquete"
  | "tarjeta"
  | "banco"
  | "tienda"
  | "persona"
  | "grupo"
  | "calendario"
  | "pin"
  | "lapiz"
  | "alerta"
  | "estrella"
  | "etiqueta"
  | "flama"
  | "corazon"
  | "destellos"
  | "trofeo"
  | "atras"
  | "correo"
  | "globo"
  | "frente"
  | "asiento"
  | "anterior"
  | "siguiente"
  | "cerrar";

/** Trazos de 24×24, a mano, en la misma familia (Lucide-like). Cada uno es un conjunto de `d` de path. */
const TRAZOS: Record<NombreIcono, string[]> = {
  check: ["M20 6 9 17l-5-5"],
  reloj: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z", "M12 7v5l3 2"],
  lugar: [
    "M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z",
    "M12 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z",
  ],
  chat: ["M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"],
  paquete: ["M21 8 12 3 3 8v8l9 5 9-5V8Z", "M3 8l9 5 9-5", "M12 13v8"],
  tarjeta: [
    "M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z",
    "M3 10h18",
    "M7 15h3",
  ],
  banco: [
    "M3 10 12 4l9 6H3Z",
    "M5 10v8M9.5 10v8M14.5 10v8M19 10v8",
    "M3 21h18",
  ],
  tienda: [
    "M4 9l1.5-5h13L20 9",
    "M4 9a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0A2.7 2.7 0 0 0 20 9",
    "M5 12v8h14v-8",
    "M10 20v-5h4v5",
  ],
  persona: ["M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z", "M4 21a8 8 0 0 1 16 0"],
  grupo: [
    "M9 5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z",
    "M2.5 20a6.5 6.5 0 0 1 13 0",
    "M16 5.3a3.5 3.5 0 0 1 0 6.4",
    "M18 14a6.5 6.5 0 0 1 3.5 6",
  ],
  calendario: [
    "M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z",
    "M16 3v4M8 3v4M3 10h18",
  ],
  pin: ["M12 17v5", "M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6Z"],
  lapiz: ["M4 20l1-4L16.5 4.5a2 2 0 0 1 3 3L8 19l-4 1Z", "M14.5 6.5l3 3"],
  alerta: [
    "M10.3 4 2.7 17.5A2 2 0 0 0 4.4 20.5h15.2a2 2 0 0 0 1.7-3L13.7 4a2 2 0 0 0-3.4 0Z",
    "M12 9.5v4",
    "M12 17h.01",
  ],
  estrella: [
    "M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3Z",
  ],
  etiqueta: ["M3 12V4h8l10 10-8 8L3 12Z", "M7.5 8.5h.01"],
  flama: [
    "M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3.2 2-4 .3 1.5 1 2.2 2 2.5-.5-3 .2-6 1-8.5Z",
  ],
  corazon: [
    "M12 20s-8-4.8-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 9c0 6.2-8 11-8 11Z",
  ],
  destellos: [
    "M10 4l1.6 4.4L16 10l-4.4 1.6L10 16l-1.6-4.4L4 10l4.4-1.6L10 4Z",
    "M18 14l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8L18 14Z",
  ],
  trofeo: [
    "M8 4h8v6a4 4 0 0 1-8 0V4Z",
    "M8 6H4v1a4 4 0 0 0 4 4",
    "M16 6h4v1a4 4 0 0 1-4 4",
    "M12 14v4",
    "M8 21h8",
  ],
  atras: ["M19 12H5", "M11 18l-6-6 6-6"],
  correo: [
    "M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z",
    "M3 8l9 6 9-6",
  ],
  globo: [
    "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z",
    "M3 12h18",
    "M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z",
  ],
  frente: [
    "M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z",
    "M5 21a7 7 0 0 1 14 0",
    "M9 12.5 12 15l3-2.5",
  ],
  asiento: [
    "M5 9h14a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 1 2-2Z",
    "M6 15v3M18 15v3",
  ],
  anterior: ["M15 18l-6-6 6-6"],
  siguiente: ["M9 18l6-6-6-6"],
  cerrar: ["M18 6 6 18", "M6 6l12 12"],
};

/** Un ícono de trazo (1.75, puntas redondas, `currentColor`); decorativo: el texto lo dice quien lo usa. */
export function Icono({
  nombre,
  size = 20,
}: {
  nombre: NombreIcono;
  size?: number;
}) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      style={{ flexShrink: 0 }}
    >
      {TRAZOS[nombre].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

const DESTACADOS: Record<string, NombreIcono> = {
  star: "estrella",
  tag: "etiqueta",
  flame: "flama",
  heart: "corazon",
  sparkles: "destellos",
  trophy: "trofeo",
};

/** El ícono de un destacado del SERVIDOR (`star`, `tag`…); un nombre que no conocemos no dibuja nada. */
export function iconoDeDestacado(
  icon: string | null | undefined,
): NombreIcono | null {
  if (!icon) return null;
  return Object.prototype.hasOwnProperty.call(DESTACADOS, icon)
    ? DESTACADOS[icon]
    : null;
}
