# Diseño: Módulo de Identidad de Marca para Reservaciones

**Fecha:** 2026-05-26
**Estado:** Aprobado (pendiente de plan de implementación)
**Repos afectados:** `avoqado-server`, `avoqado-web-dashboard`, `avoqado-booking-widget`

## Objetivo

Dar a los venues un editor de identidad de marca para su página de
reservaciones (`book.avoqado.io/<slug>/appointments` y `/classes`), análogo
al que ya existe para links de pago (`paymentLinkBranding`). Hoy las
reservaciones solo consumen `venue.primaryColor`, `logo`, `logoFull` y
`heroImageUrl` de forma directa, sin control de presentación dedicado.

## Contexto previo

- Links de pago ya tienen `Venue.paymentLinkBranding` (JSON) + editor
  `PaymentLinkBranding.tsx` en el dashboard + lectura pública en
  `paymentLink.service.ts` (`mergeBranding`).
- Cambio reciente: `paymentLinkBranding.buttonColor` ahora hereda
  `venue.primaryColor` cuando no está seteado (resuelto en lectura, nunca
  persistido → herencia viva). Este spec replica ese patrón.
- El widget consume la info pública del venue vía
  `reservation.public.controller.ts` (`getVenueInfo`), que ya devuelve
  `logo/logoFull/heroImageUrl/primaryColor`.

## Decisiones tomadas (brainstorming)

1. **Arquitectura:** módulo `reservationBranding` **separado** (espejo del de
   pagos, JSON propio en `Venue`). No se unifica con pagos.
2. **Campos configurables:** 4 base (logo on/off, color de acento, forma de
   botón, tipografía) + 4 específicos de reservaciones (foto hero,
   descripciones, duración, precios). **Todos `true`/mostrar por default.**
3. **Color:** `accentColor` propio de reservaciones que **por default hereda
   `venue.primaryColor`** (resuelto en lectura, mismo patrón que pagos).
4. **Tipografía:** se incluye desde la fase 1 (inyección de `@font-face` en el
   Shadow DOM del widget).

## Modelo de datos (avoqado-server / Prisma)

Nuevo campo en el modelo `Venue` (junto a `paymentLinkBranding`):

```prisma
/// Per-venue branding overrides applied to the public reservation pages
/// (book.avoqado.io citas/clases). JSON shape mirrors reservationBranding
/// defaults in the service layer. NULL = sane defaults.
reservationBranding Json?
```

Defaults + tipo, definidos en el service (espejo de `DEFAULT_PAYMENT_LINK_BRANDING`):

```ts
export const DEFAULT_RESERVATION_BRANDING = {
  showLogo:         true,
  accentColor:      null as string | null, // null = hereda venue.primaryColor (resuelto en lectura)
  buttonShape:      'rounded' as 'rounded' | 'square' | 'pill',
  fontFamily:       'DM Sans',
  showHeroImage:    true,  // no-op si el venue no tiene heroImageUrl
  showDescriptions: true,
  showDuration:     true,
  showPrices:       true,
}
export type ReservationBranding = typeof DEFAULT_RESERVATION_BRANDING
```

### Semántica de herencia (igual que pagos)

- `mergeReservationBranding(raw, primaryColor)` resuelve `accentColor` en
  **lectura**: `stored.accentColor ?? primaryColor (si es color CSS válido) ?? '#006aff'`.
- El valor heredado **nunca se persiste** en el JSON → cambiar `primaryColor`
  sigue propagándose a reservaciones (herencia viva).
- La ruta de **escritura** (`updateReservationBranding`) NO pasa `primaryColor`
  al merge, para no congelar el heredado.
- Reusa la guardia de color CSS (`resolveBrandFallbackColor`) ya creada para
  pagos; extraerla a un helper compartido del módulo de branding.

## API (avoqado-server)

Espejo de las rutas/controladores/servicios de pagos:

- **Dashboard (autenticado):**
  - `GET  /api/v1/dashboard/venues/:venueId/reservation-branding/config`
    → `getReservationBranding(venueId)` (merge con defaults + herencia)
  - `PUT  /api/v1/dashboard/venues/:venueId/reservation-branding/config`
    → `updateReservationBranding(venueId, body, staffId)` (read-modify-write,
      `logAction` con `RESERVATION_BRANDING_UPDATED`)
  - Zod schema `updateReservationBrandingSchema` (mismo whitelist de fonts que
    pagos: `PAYMENT_LINK_FONT_IDS`/renombrar a `BRANDING_FONT_IDS`).
- **Público:** sin endpoint nuevo. El payload de
  `reservation.public.controller.ts` agrega un objeto:
  ```ts
  branding: mergeReservationBranding(venue.reservationBranding, venue.primaryColor)
  ```
  junto a los campos `logo/logoFull/heroImageUrl/primaryColor` actuales.

## Editor en el dashboard (avoqado-web-dashboard)

Nueva página `src/pages/Reservations/ReservationBranding.tsx` (o ubicación
equivalente a la sección de reservaciones), espejo de `PaymentLinkBranding.tsx`:

- Patrón **draft/dirty** con `useCurrentVenue`, `useQuery`/`useMutation`.
- Controles:
  - Toggle `showLogo`.
  - Color `accentColor` con presets (reusar `PRESET_COLORS`) + input hex. El
    placeholder/estado inicial muestra el `primaryColor` heredado.
  - `buttonShape` (rounded / square / pill).
  - `fontFamily` (reusar `SearchCombobox` + catálogo de fuentes de `PaymentLinks/`).
  - Toggles `showHeroImage`, `showDescriptions`, `showDuration`, `showPrices`.
- **Preview en vivo** de una tarjeta de servicio de ejemplo + CTA, aplicando
  color/forma/fuente/toggles.
- Nuevo `src/services/reservationBranding.service.ts` (`getBranding`,
  `updateBranding`) con `DEFAULT_RESERVATION_BRANDING` espejado (mantener en
  sync con el server, igual que hoy con pagos).
- Ruta + entrada de navegación en la sección de reservaciones. Llaves i18n
  (namespace nuevo o `reservations`).
- **Reuso de infra de fuentes:** importar el catálogo/`fonts-eager`/`font-loader`
  existentes de `PaymentLinks/`. Si el import cruzado es incómodo, mover esos
  módulos a una ubicación compartida (`src/components/branding/fonts/`) y
  reapuntar pagos — refactor acotado, sin cambiar comportamiento de pagos.

## Consumo en el widget (avoqado-booking-widget)

- `src/types.ts`: extender `VenueInfo` con `branding?: ReservationBranding`
  (campos opcionales con defaults, para tolerar bundles viejos / venues sin config).
- **Color:** `branding.accentColor` → `--avq-accent` (hoy se usa
  `info.primaryColor` directo en `App.tsx`/`BookingFlow.tsx`; pasa a usar el
  resuelto, con fallback a `primaryColor`).
- **Forma de botón:** `branding.buttonShape` → border-radius de los CTAs
  (`rounded` = actual, `square` = 0, `pill` = 9999px). Token CSS `--avq-btn-radius`.
- **Foto hero:** `branding.showHeroImage && info.heroImageUrl` → **componente
  nuevo** de portada arriba del flujo de reservaciones (hoy no se renderiza).
- **Toggles de lista:** `showDescriptions`/`showDuration`/`showPrices` → render
  condicional en `ServiceSelector.tsx` y en la lista de clases.
- **Tipografía (`fontFamily`):**
  - Las fuentes cargadas vía `@font-face` en `document.head` cascadean dentro
    del Shadow DOM (las fuentes no se scopean al shadow root).
  - Al recibir `branding.fontFamily` (≠ system/DM Sans default), inyectar el/los
    `@font-face` correspondientes en `document.head` (una sola vez, idempotente)
    cargando el `.woff2` del mismo catálogo que pagos, y setear
    `font-family` en el contenedor raíz del widget (`--avq-font`).
  - Reusar la lista blanca de fuentes del server para validar.

## Defaults e inheritance (resumen)

- `reservationBranding` NULL → todos los defaults: mostrar todo, `accentColor`
  hereda `primaryColor`, `rounded`, `DM Sans`.
- `accentColor` resuelto en lectura, nunca persistido (herencia viva).
- `showHeroImage` default `true` pero no-op si no hay `heroImageUrl`.

## Testing

- **Server:** test unitario de `mergeReservationBranding` — herencia de
  `accentColor`, guardia de color inválido, override explícito respetado,
  defaults cuando el JSON es NULL.
- **Dashboard:** smoke del editor (carga, edita, guarda, dirty/save).
- **Widget:** cada toggle oculta/muestra su elemento; forma/color/fuente se
  aplican; hero solo aparece con `heroImageUrl`.
- **Manual end-to-end:** editar en dashboard → verificar en
  `book.avoqado.io/<slug>/appointments` y `/classes`.

## Secuencia de despliegue (regla cross-repo: backend primero)

1. `avoqado-server`: migración Prisma (campo nuevo, aditivo) + service + rutas
   + payload público. Desplegar y estabilizar.
2. `avoqado-web-dashboard`: editor + servicio + ruta/nav.
3. `avoqado-booking-widget`: consumo + fuentes + hero + toggles → build + deploy CDN.

El campo es aditivo y opcional; ningún cliente viejo se rompe (regla: nunca
quitar/renombrar campos de respuestas; campos nuevos opcionales con default).

## Fuera de alcance (no-goals)

- Unificar marca de pagos y reservaciones en un solo módulo (se eligió separado).
- Secondary color, temas dark, o branding por-servicio/por-clase.
- Cambiar cómo pagos consume su branding (solo posible refactor acotado de la
  infra de fuentes compartida).
