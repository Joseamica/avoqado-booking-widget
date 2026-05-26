# Reservation Branding Identity Module — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give venues a dashboard editor to brand their reservation pages (`book.avoqado.io/<slug>/appointments` and `/classes`), mirroring the existing payment-link branding module.

**Architecture:** A new `Venue.reservationBranding` JSON column (separate from `paymentLinkBranding`). The server merges it with defaults and resolves `accentColor` from `venue.primaryColor` at read time (live inheritance, never persisted). A new dashboard page edits it; the booking widget consumes a `branding` object on the public venue payload and applies accent color, button shape, font (injected into the Shadow DOM via `@font-face`), an optional hero image, and show/hide toggles for price/duration/description.

**Tech Stack:** Express + Prisma + Zod + Jest (avoqado-server) · React 18 + TanStack Query + react-i18next (avoqado-web-dashboard) · Preact Web Component (avoqado-booking-widget).

**Deploy order (cross-repo rule — backend first):** all SERVER tasks → deploy → DASHBOARD tasks → deploy → WIDGET tasks → build + CDN deploy. The column is additive/optional; no old client breaks.

**Dependency:** Reuses `resolveBrandFallbackColor` from the uncommitted payment-link color-inheritance change in `paymentLink.service.ts`. Task S2 extracts it to a shared helper; if that change is reverted, S2's helper still stands alone.

**Paths are absolute from each repo root:**
- Server: `/Users/amieva/Documents/Programming/Avoqado/avoqado-server`
- Dashboard: `/Users/amieva/Documents/Programming/Avoqado/avoqado-web-dashboard`
- Widget: `/Users/amieva/Documents/Programming/Avoqado/avoqado-booking-widget`

---

## File Structure

**avoqado-server**
- Modify: `prisma/schema.prisma` (add `reservationBranding Json?` to `Venue`)
- Create: `src/services/dashboard/branding.shared.ts` (shared `resolveBrandFallbackColor` + `BRANDING_FONT_IDS`)
- Create: `src/services/dashboard/reservationBranding.service.ts`
- Create: `src/services/dashboard/__tests__/reservationBranding.service.test.ts`
- Create: `src/schemas/dashboard/reservationBranding.schema.ts`
- Modify: `src/controllers/dashboard/reservation.dashboard.controller.ts` (add 2 handlers)
- Modify: `src/routes/dashboard/reservation.routes.ts` (add 2 routes)
- Modify: `src/controllers/public/reservation.public.controller.ts` (add field to select + `branding` to response, ~line 204 + ~line 301)

**avoqado-web-dashboard**
- Create: `src/services/reservationBranding.service.ts`
- Create: `src/pages/Reservations/ReservationBranding.tsx`
- Modify: `src/routes/lazyComponents.ts` (lazy import)
- Modify: `src/routes/venueRoutes.tsx` (route entry)
- Modify: nav/sidebar config (entry under Reservations) — exact file located in Task D3

**avoqado-booking-widget**
- Modify: `src/types.ts` (add `ReservationBranding` + `VenueInfo.branding`)
- Modify: `src/components/BookingFlow.tsx` (populate branding from venue payload; thread toggles)
- Modify: `src/App.tsx` (apply accent/shape/font tokens at root)
- Modify: `src/components/ServiceSelector.tsx` (conditional price/duration/description)
- Create: `src/components/ReservationHero.tsx` (hero image)
- Create: `src/lib/brandingFont.ts` (inject `@font-face` into document.head)
- Modify: `src/shared-styles.ts` (button-radius + font tokens)

---

# PART 1 — SERVER (avoqado-server)

### Task S1: Add `reservationBranding` column to Venue

**Files:**
- Modify: `prisma/schema.prisma` (Venue model, after `paymentLinkBranding` ~line 151)

- [ ] **Step 1: Add the field**

In `prisma/schema.prisma`, directly after the `paymentLinkBranding Json?` line in the `Venue` model, add:

```prisma
  /// Per-venue branding overrides for the public reservation pages
  /// (book.avoqado.io citas/clases). JSON shape mirrors
  /// DEFAULT_RESERVATION_BRANDING in reservationBranding.service.ts.
  /// `accentColor` is null = inherit Venue.primaryColor (resolved at read).
  /// NULL = sane defaults. Sibling of paymentLinkBranding.
  reservationBranding Json?
```

- [ ] **Step 2: Create the migration**

Run: `cd /Users/amieva/Documents/Programming/Avoqado/avoqado-server && npx prisma migrate dev --name add_reservation_branding`
Expected: a new migration under `prisma/migrations/*_add_reservation_branding/` with `ALTER TABLE "Venue" ADD COLUMN "reservationBranding" JSONB;`, and `prisma generate` runs automatically.

- [ ] **Step 3: Verify the client type**

Run: `npx tsc --noEmit 2>&1 | grep -i "reservationBranding" || echo "clean"`
Expected: `clean` (the field is now on the generated Prisma type).

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(reservations): add reservationBranding column to Venue"
```

---

### Task S2: Shared branding helper

**Files:**
- Create: `src/services/dashboard/branding.shared.ts`

This extracts the color-fallback + font whitelist so both payment-link and reservation branding share one source of truth.

- [ ] **Step 1: Create the shared helper**

Create `src/services/dashboard/branding.shared.ts`:

```ts
/**
 * Shared branding primitives for payment-link and reservation branding.
 * Single source of truth for the brand-accent fallback rule and the font
 * whitelist so both surfaces stay consistent.
 */

/** Whitelisted fonts offered by every branding editor. Keep in sync with the
 *  dashboard catalog (payment-link-fonts.ts). */
export const BRANDING_FONT_IDS = [
  'DM Sans', 'Inter', 'Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Poppins',
  'Nunito', 'Work Sans', 'Raleway', 'Playfair Display', 'Merriweather',
  'Lora', 'PT Serif', 'Bebas Neue', 'Oswald', 'Anton', 'Archivo Black',
  'Alfa Slab One', 'Fjalla One', 'Russo One', 'Caveat', 'Pacifico',
  'Dancing Script', 'Sacramento', 'Fira Code', 'JetBrains Mono', 'Roboto Mono',
] as const

/**
 * Resolve the brand accent fallback. When a surface has no explicit color set,
 * inherit the venue's `primaryColor` (the same field the booking widget uses as
 * `--avq-accent`); fall back to the legacy blue only when primaryColor is unset
 * or not a CSS color. Resolved at READ time and never persisted — so changing
 * primaryColor keeps propagating (live inheritance).
 */
export function resolveBrandFallbackColor(primaryColor?: string | null, legacyDefault = '#006aff'): string {
  const trimmed = typeof primaryColor === 'string' ? primaryColor.trim() : ''
  return /^(#[0-9a-fA-F]{3,8}|rgb|hsl|oklch|color\()/.test(trimmed) ? trimmed : legacyDefault
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -i "branding.shared" || echo "clean"`
Expected: `clean`

- [ ] **Step 3: Commit**

```bash
git add src/services/dashboard/branding.shared.ts
git commit -m "feat(branding): shared brand-color fallback + font whitelist helper"
```

---

### Task S3: Reservation branding service (TDD)

**Files:**
- Create: `src/services/dashboard/reservationBranding.service.ts`
- Create: `src/services/dashboard/__tests__/reservationBranding.service.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/services/dashboard/__tests__/reservationBranding.service.test.ts`:

```ts
import { mergeReservationBranding, DEFAULT_RESERVATION_BRANDING } from '../reservationBranding.service'

describe('mergeReservationBranding', () => {
  it('returns defaults with inherited accent when raw is null', () => {
    const r = mergeReservationBranding(null, '#ff0000')
    expect(r).toEqual({ ...DEFAULT_RESERVATION_BRANDING, accentColor: '#ff0000' })
  })

  it('falls back to legacy blue when primaryColor is not a valid color', () => {
    const r = mergeReservationBranding(null, 'not-a-color')
    expect(r.accentColor).toBe('#006aff')
  })

  it('respects an explicitly stored accentColor over primaryColor', () => {
    const r = mergeReservationBranding({ accentColor: '#00ff00' }, '#ff0000')
    expect(r.accentColor).toBe('#00ff00')
  })

  it('inherits primaryColor when stored accentColor is null', () => {
    const r = mergeReservationBranding({ accentColor: null, showPrices: false }, '#123456')
    expect(r.accentColor).toBe('#123456')
    expect(r.showPrices).toBe(false)
  })

  it('fills missing toggles from defaults (all true)', () => {
    const r = mergeReservationBranding({}, null)
    expect(r.showLogo).toBe(true)
    expect(r.showHeroImage).toBe(true)
    expect(r.showDescriptions).toBe(true)
    expect(r.showDuration).toBe(true)
    expect(r.showPrices).toBe(true)
    expect(r.buttonShape).toBe('rounded')
    expect(r.fontFamily).toBe('DM Sans')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/services/dashboard/__tests__/reservationBranding.service.test.ts`
Expected: FAIL — `Cannot find module '../reservationBranding.service'`.

- [ ] **Step 3: Implement the service**

Create `src/services/dashboard/reservationBranding.service.ts`:

```ts
import { Prisma } from '@prisma/client'
import prisma from '@/config/prisma'
import { NotFoundError } from '@/errors/AppError'
import { logAction } from '@/services/dashboard/auditLog.service'
import { resolveBrandFallbackColor } from './branding.shared'

/**
 * Default reservation branding. All toggles default to "show". `accentColor`
 * null = inherit Venue.primaryColor (resolved in mergeReservationBranding).
 * Mirrored in avoqado-web-dashboard reservationBranding.service.ts.
 */
export const DEFAULT_RESERVATION_BRANDING = {
  showLogo: true,
  accentColor: null as string | null,
  buttonShape: 'rounded' as 'rounded' | 'square' | 'pill',
  fontFamily: 'DM Sans',
  showHeroImage: true,
  showDescriptions: true,
  showDuration: true,
  showPrices: true,
}

export type ReservationBranding = typeof DEFAULT_RESERVATION_BRANDING

/**
 * Merge stored branding with defaults. `accentColor` resolves to a concrete
 * color: explicit stored value → venue primaryColor → legacy blue. Read-time
 * only; the resolved value is NEVER written back (see updateReservationBranding).
 */
export function mergeReservationBranding(raw: unknown, primaryColor?: string | null): ReservationBranding {
  const accentFallback = resolveBrandFallbackColor(primaryColor)
  const stored = (raw && typeof raw === 'object' ? raw : {}) as Partial<ReservationBranding>
  return {
    showLogo: stored.showLogo ?? DEFAULT_RESERVATION_BRANDING.showLogo,
    accentColor: stored.accentColor ?? accentFallback,
    buttonShape: stored.buttonShape ?? DEFAULT_RESERVATION_BRANDING.buttonShape,
    fontFamily: stored.fontFamily ?? DEFAULT_RESERVATION_BRANDING.fontFamily,
    showHeroImage: stored.showHeroImage ?? DEFAULT_RESERVATION_BRANDING.showHeroImage,
    showDescriptions: stored.showDescriptions ?? DEFAULT_RESERVATION_BRANDING.showDescriptions,
    showDuration: stored.showDuration ?? DEFAULT_RESERVATION_BRANDING.showDuration,
    showPrices: stored.showPrices ?? DEFAULT_RESERVATION_BRANDING.showPrices,
  }
}

export async function getReservationBranding(venueId: string): Promise<ReservationBranding> {
  const venue = await prisma.venue.findUnique({
    where: { id: venueId },
    select: { reservationBranding: true, primaryColor: true },
  })
  if (!venue) throw new NotFoundError('Venue no encontrado')
  return mergeReservationBranding(venue.reservationBranding, venue.primaryColor)
}

export async function updateReservationBranding(
  venueId: string,
  data: Partial<ReservationBranding>,
  staffId: string,
): Promise<ReservationBranding> {
  const venue = await prisma.venue.findUnique({
    where: { id: venueId },
    select: { reservationBranding: true, primaryColor: true },
  })
  if (!venue) throw new NotFoundError('Venue no encontrado')

  // Merge WITHOUT primaryColor so the inherited accent is never frozen into
  // storage (keeps live inheritance). Persist accentColor as-is (may be null).
  const stored = (venue.reservationBranding && typeof venue.reservationBranding === 'object'
    ? venue.reservationBranding
    : {}) as Partial<ReservationBranding>
  const next = {
    showLogo: data.showLogo ?? stored.showLogo ?? DEFAULT_RESERVATION_BRANDING.showLogo,
    accentColor: data.accentColor !== undefined ? data.accentColor : (stored.accentColor ?? null),
    buttonShape: data.buttonShape ?? stored.buttonShape ?? DEFAULT_RESERVATION_BRANDING.buttonShape,
    fontFamily: data.fontFamily ?? stored.fontFamily ?? DEFAULT_RESERVATION_BRANDING.fontFamily,
    showHeroImage: data.showHeroImage ?? stored.showHeroImage ?? DEFAULT_RESERVATION_BRANDING.showHeroImage,
    showDescriptions: data.showDescriptions ?? stored.showDescriptions ?? DEFAULT_RESERVATION_BRANDING.showDescriptions,
    showDuration: data.showDuration ?? stored.showDuration ?? DEFAULT_RESERVATION_BRANDING.showDuration,
    showPrices: data.showPrices ?? stored.showPrices ?? DEFAULT_RESERVATION_BRANDING.showPrices,
  }

  await prisma.venue.update({
    where: { id: venueId },
    data: { reservationBranding: next as unknown as Prisma.InputJsonValue },
  })

  logAction({
    venueId,
    staffId,
    action: 'RESERVATION_BRANDING_UPDATED',
    entity: 'Venue',
    entityId: venueId,
    data: { to: next },
  })

  // Return resolved (with inheritance) so the editor shows the effective color.
  return mergeReservationBranding(next, venue.primaryColor)
}
```

NOTE: confirm the import paths match the siblings in `paymentLink.service.ts` (`prisma` default import, `NotFoundError` location, `logAction`). If `paymentLink.service.ts` imports them differently, copy its exact import lines.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/services/dashboard/__tests__/reservationBranding.service.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/dashboard/reservationBranding.service.ts src/services/dashboard/__tests__/reservationBranding.service.test.ts
git commit -m "feat(reservations): reservationBranding service with primaryColor inheritance"
```

---

### Task S4: Zod schema

**Files:**
- Create: `src/schemas/dashboard/reservationBranding.schema.ts`

- [ ] **Step 1: Create the schema**

Create `src/schemas/dashboard/reservationBranding.schema.ts`:

```ts
import { z } from 'zod'
import { BRANDING_FONT_IDS } from '@/services/dashboard/branding.shared'

export const reservationBrandingBodySchema = z.object({
  showLogo: z.boolean().optional(),
  accentColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'El color debe ser un código HEX de 6 dígitos (ej. #006aff)')
    .nullable()
    .optional(),
  buttonShape: z.enum(['rounded', 'square', 'pill']).optional(),
  fontFamily: z.enum(BRANDING_FONT_IDS as unknown as [string, ...string[]]).optional(),
  showHeroImage: z.boolean().optional(),
  showDescriptions: z.boolean().optional(),
  showDuration: z.boolean().optional(),
  showPrices: z.boolean().optional(),
})

export const updateReservationBrandingSchema = z.object({
  params: z.object({ venueId: z.string().min(1, 'Venue ID es requerido') }),
  body: reservationBrandingBodySchema,
})
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -i "reservationBranding.schema" || echo "clean"`
Expected: `clean`

- [ ] **Step 3: Commit**

```bash
git add src/schemas/dashboard/reservationBranding.schema.ts
git commit -m "feat(reservations): zod schema for reservation branding update"
```

---

### Task S5: Controller handlers

**Files:**
- Modify: `src/controllers/dashboard/reservation.dashboard.controller.ts`

- [ ] **Step 1: Add imports + handlers**

At the top of `src/controllers/dashboard/reservation.dashboard.controller.ts`, add (next to existing imports):

```ts
import * as reservationBrandingService from '@/services/dashboard/reservationBranding.service'
```

At the end of the file, append:

```ts
/**
 * GET /api/v1/dashboard/venues/:venueId/reservations/branding/config
 */
export async function getReservationBranding(req: Request, res: Response) {
  try {
    const { venueId } = req.params
    const branding = await reservationBrandingService.getReservationBranding(venueId)
    res.json({ success: true, data: branding })
  } catch (error: any) {
    logger.error('Error fetching reservation branding:', error)
    res.status(error.statusCode || 500).json({ success: false, error: error.message || 'Error al obtener branding' })
  }
}

/**
 * PUT /api/v1/dashboard/venues/:venueId/reservations/branding/config
 */
export async function updateReservationBranding(req: Request, res: Response) {
  try {
    const { venueId } = req.params
    const staffId = req.authContext?.userId
    if (!staffId) {
      res.status(401).json({ success: false, error: 'Autenticación requerida' })
      return
    }
    const branding = await reservationBrandingService.updateReservationBranding(venueId, req.body, staffId)
    res.json({ success: true, data: branding })
  } catch (error: any) {
    logger.error('Error updating reservation branding:', error)
    res.status(error.statusCode || 500).json({ success: false, error: error.message || 'Error al actualizar branding' })
  }
}
```

NOTE: confirm `logger` and `req.authContext?.userId` are already used in this controller (they are in `paymentLink.dashboard.controller.ts`). If `logger` isn't imported here, add `import logger from '@/config/logger'`.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -i "reservation.dashboard.controller" || echo "clean"`
Expected: `clean`

- [ ] **Step 3: Commit**

```bash
git add src/controllers/dashboard/reservation.dashboard.controller.ts
git commit -m "feat(reservations): branding GET/PUT controller handlers"
```

---

### Task S6: Routes

**Files:**
- Modify: `src/routes/dashboard/reservation.routes.ts`

The router is mounted at `/venues/:venueId/reservations` (dashboard.routes.ts:3528) with `authenticateTokenMiddleware`. Add static branding routes BEFORE any `/:reservationId` param route (Express matches in order).

- [ ] **Step 1: Add imports**

In `src/routes/dashboard/reservation.routes.ts`, add to the existing imports:

```ts
import { updateReservationBrandingSchema } from '../../schemas/dashboard/reservationBranding.schema'
```

(`controller` is already imported as `* as controller`.)

- [ ] **Step 2: Register the routes**

Immediately after `const router = Router({ mergeParams: true })`, add:

```ts
// ---- Branding (static prefix — declare before any /:reservationId route) ----
// GET  /api/v1/dashboard/venues/:venueId/reservations/branding/config
// PUT  /api/v1/dashboard/venues/:venueId/reservations/branding/config
router.get('/branding/config', checkPermission('reservations:read'), controller.getReservationBranding)
router.put(
  '/branding/config',
  checkPermission('reservations:update'),
  validateRequest(updateReservationBrandingSchema),
  controller.updateReservationBranding,
)
```

NOTE: Verify `reservations:update` exists. Run `grep -rn "reservations:update\|reservations:read" src/lib/permissions.ts`. If `reservations:update` is absent, use the same permission string the reservation-settings PUT route uses (grep `updateReservationSettings` in this routes file).

- [ ] **Step 3: Manual smoke (server running)**

Run the server (`npm run dev`), then:
```bash
curl -s -H "Authorization: Bearer <token>" http://localhost:3000/api/v1/dashboard/venues/<venueId>/reservations/branding/config
```
Expected: `{"success":true,"data":{"showLogo":true,"accentColor":"<primaryColor or #006aff>","buttonShape":"rounded","fontFamily":"DM Sans","showHeroImage":true,"showDescriptions":true,"showDuration":true,"showPrices":true}}`

- [ ] **Step 4: Commit**

```bash
git add src/routes/dashboard/reservation.routes.ts
git commit -m "feat(reservations): mount branding GET/PUT routes"
```

---

### Task S7: Expose `branding` on the public venue payload

**Files:**
- Modify: `src/controllers/public/reservation.public.controller.ts` (select ~line 204; response ~line 301)

- [ ] **Step 1: Add the field to the select + import**

Add near the top imports:
```ts
import { mergeReservationBranding } from '@/services/dashboard/reservationBranding.service'
```

In the `prisma.venue.findUnique` select block (currently lines ~204-211), add `reservationBranding: true` right after `primaryColor: true,`:

```ts
        primaryColor: true, // Phase 7: brand accent the widget consumes as --avq-accent
        reservationBranding: true, // Reservation branding overrides (merged + resolved below)
```

- [ ] **Step 2: Add `branding` to the response**

Replace the response block (currently lines ~301-308):

```ts
    res.json({
      ...venueInfo,
      products,
      timezone: venue.timezone || 'America/Mexico_City',
      publicBooking: settings.publicBooking,
      operatingHours: settings.operatingHours,
      payments: settings.payments,
    })
```

with (strip the raw `reservationBranding` out of the spread; expose the merged `branding`):

```ts
    const { reservationBranding, ...venueInfoRest } = venueInfo ?? ({} as typeof venueInfo & { reservationBranding?: unknown })
    res.json({
      ...venueInfoRest,
      branding: mergeReservationBranding(reservationBranding, venueInfoRest.primaryColor),
      products,
      timezone: venue.timezone || 'America/Mexico_City',
      publicBooking: settings.publicBooking,
      operatingHours: settings.operatingHours,
      payments: settings.payments,
    })
```

- [ ] **Step 3: Typecheck + smoke**

Run: `npx tsc --noEmit 2>&1 | grep -i "reservation.public" || echo "clean"`
Expected: `clean`
Then (server running): `curl -s "http://localhost:3000/api/v1/public/venues/<slug>" | npx json branding` (or pipe to `python3 -m json.tool`)
Expected: a `branding` object with the 8 keys; `accentColor` equals the venue's primaryColor (or `#006aff`).

- [ ] **Step 4: Commit**

```bash
git add src/controllers/public/reservation.public.controller.ts
git commit -m "feat(reservations): expose merged branding on public venue payload"
```

- [ ] **Step 5: Deploy server** (per cross-repo rule, before dashboard/widget). Confirm production `/api/v1/public/venues/<slug>` returns `branding`.

---

# PART 2 — DASHBOARD (avoqado-web-dashboard)

### Task D1: Reservation branding service

**Files:**
- Create: `src/services/reservationBranding.service.ts`

- [ ] **Step 1: Create the service**

Create `src/services/reservationBranding.service.ts`:

```ts
import api from '@/api' // confirm: paymentLink.service.ts imports the axios instance — copy its exact import

export interface ReservationBranding {
  showLogo: boolean
  accentColor: string | null
  buttonShape: 'rounded' | 'square' | 'pill'
  fontFamily: string
  showHeroImage: boolean
  showDescriptions: boolean
  showDuration: boolean
  showPrices: boolean
}

/** Mirrors DEFAULT_RESERVATION_BRANDING in avoqado-server. accentColor null =
 *  inherit venue primaryColor (server resolves to a concrete color on read). */
export const DEFAULT_RESERVATION_BRANDING: ReservationBranding = {
  showLogo: true,
  accentColor: null,
  buttonShape: 'rounded',
  fontFamily: 'DM Sans',
  showHeroImage: true,
  showDescriptions: true,
  showDuration: true,
  showPrices: true,
}

const reservationBrandingService = {
  async getBranding(venueId: string): Promise<ReservationBranding> {
    const response = await api.get(`/api/v1/dashboard/venues/${venueId}/reservations/branding/config`)
    return response.data.data
  },
  async updateBranding(venueId: string, branding: Partial<ReservationBranding>): Promise<ReservationBranding> {
    const response = await api.put(`/api/v1/dashboard/venues/${venueId}/reservations/branding/config`, branding)
    return response.data.data
  },
}

export default reservationBrandingService
```

NOTE: open `src/services/paymentLink.service.ts` and copy its exact `api` import line + response unwrapping (`response.data` vs `response.data.data`) so this matches.

- [ ] **Step 2: Typecheck**

Run: `cd /Users/amieva/Documents/Programming/Avoqado/avoqado-web-dashboard && npx tsc --noEmit 2>&1 | grep -i "reservationBranding.service" || echo "clean"`
Expected: `clean`

- [ ] **Step 3: Commit**

```bash
git add src/services/reservationBranding.service.ts
git commit -m "feat(reservations): dashboard reservation branding service"
```

---

### Task D2: ReservationBranding editor page

**Files:**
- Create: `src/pages/Reservations/ReservationBranding.tsx`

Mirror `src/pages/PaymentLinks/PaymentLinkBranding.tsx` (draft/dirty + TanStack Query + presets + font picker + live preview). Reuse the font infra from `PaymentLinks/` by importing it.

- [ ] **Step 1: Create the page**

Create `src/pages/Reservations/ReservationBranding.tsx`. Start by copying `PaymentLinks/PaymentLinkBranding.tsx` verbatim, then apply these exact changes:

1. Swap the service + types:
```ts
import reservationBrandingService, { DEFAULT_RESERVATION_BRANDING, type ReservationBranding } from '@/services/reservationBranding.service'
```
2. Reuse font infra from PaymentLinks (do not duplicate):
```ts
import { fontFamilyValue } from '../PaymentLinks/font-loader'
import '../PaymentLinks/fonts-eager'
import { FONT_CATEGORY_LABELS, PAYMENT_LINK_FONTS } from '../PaymentLinks/payment-link-fonts'
```
3. Query key + calls:
```ts
const { data: branding } = useQuery({
  queryKey: ['reservation-branding', venueId],
  queryFn: () => reservationBrandingService.getBranding(venueId),
  enabled: !!venueId,
  staleTime: 60_000,
})
const mutation = useMutation({
  mutationFn: (next: Partial<ReservationBranding>) => reservationBrandingService.updateBranding(venueId, next),
  onSuccess: (saved) => {
    queryClient.setQueryData(['reservation-branding', venueId], saved)
    setDirty(false)
    toast({ title: t('branding.saved', 'Marca actualizada') })
  },
})
const [draft, setDraft] = useState<ReservationBranding>(DEFAULT_RESERVATION_BRANDING)
```
4. Rename the field controls:
   - `buttonColor` → `accentColor` everywhere (the color picker writes `accentColor`). When `draft.accentColor == null`, show the value as a placeholder/empty state meaning "hereda color de marca".
   - Remove the `showImage` / `showTitle` / `showPrice` switches.
   - Add four switches bound to `showHeroImage`, `showDescriptions`, `showDuration`, `showPrices` (copy the existing Switch+Label block pattern, all default on).
5. Update the **live preview**: render a sample service card (name "Manicura express", description "Quitarle pellejitos…", `$250 · 15 min`) and a CTA button. Apply:
   - CTA `backgroundColor: draft.accentColor ?? '#006aff'`, radius from `draft.buttonShape` (reuse `SHAPE_CLASSES`).
   - Hide the description line when `!draft.showDescriptions`, the `· 15 min` when `!draft.showDuration`, the `$250` when `!draft.showPrices`.
   - Container `fontFamily: fontFamilyValue(draft.fontFamily)`.
6. i18n namespace: use `useTranslation('reservations')` (or a new `reservationBranding` namespace). Add the keys you reference to that namespace's `es`/`en` files (mirror the payment-link branding keys).

- [ ] **Step 2: Build the dashboard**

Run: `npm run build 2>&1 | tail -15`
Expected: build succeeds, no type errors referencing `ReservationBranding`.

- [ ] **Step 3: Commit**

```bash
git add src/pages/Reservations/ReservationBranding.tsx src/locales 2>/dev/null
git commit -m "feat(reservations): reservation branding editor page"
```

---

### Task D3: Route + lazy import + nav entry

**Files:**
- Modify: `src/routes/lazyComponents.ts` (after line 186)
- Modify: `src/routes/venueRoutes.tsx` (mirror line 73 import + line 380 route)
- Modify: nav/sidebar config (located in this task)

- [ ] **Step 1: Lazy import**

In `src/routes/lazyComponents.ts`, after the `PaymentLinkBranding` export (line 186), add:

```ts
export const ReservationBranding = lazyWithRetry(() => import('@/pages/Reservations/ReservationBranding'))
```

- [ ] **Step 2: Route entry**

In `src/routes/venueRoutes.tsx`: add `ReservationBranding,` to the lazy-component import group (near line 73). Then locate the reservations route group (search `reservations` in the file) and add a child route mirroring line 380:

```tsx
{ path: 'reservations/branding', element: <ReservationBranding /> },
```

If reservations routes are nested under a parent `path: 'reservations'`, add `{ path: 'branding', element: <ReservationBranding /> }` as its child instead.

- [ ] **Step 3: Nav entry**

Run: `grep -rn "payment-links/branding\|PaymentLinkBranding\|Marca\|branding" src/components/**/*sidebar* src/components/**/*nav* src/config 2>/dev/null` to find how the payment-link branding nav item is declared. Add a sibling entry pointing to the reservations branding route, label `t('nav.reservationBranding', 'Identidad de marca')`, gated by the same permission used for the reservations section.

- [ ] **Step 4: Build + manual verify**

Run: `npm run build 2>&1 | tail -5` (expect success).
Manual: `npm run dev`, log in, open the reservations branding page, change accent color + toggle "mostrar precios" off, Save. Reload — change persists.

- [ ] **Step 5: Commit**

```bash
git add src/routes/lazyComponents.ts src/routes/venueRoutes.tsx
git add -A  # nav config file located in step 3
git commit -m "feat(reservations): route + nav entry for reservation branding editor"
```

- [ ] **Step 6: Deploy dashboard.**

---

# PART 3 — WIDGET (avoqado-booking-widget)

### Task W1: Types

**Files:**
- Modify: `src/types.ts` (VenueInfo, ~line 85-95)

- [ ] **Step 1: Add the branding type + field**

In `src/types.ts`, add the interface near `VenueInfo`:

```ts
export interface ReservationBranding {
  showLogo: boolean
  accentColor: string | null
  buttonShape: 'rounded' | 'square' | 'pill'
  fontFamily: string
  showHeroImage: boolean
  showDescriptions: boolean
  showDuration: boolean
  showPrices: boolean
}
```

Add to the `VenueInfo` interface (optional — old payloads won't have it):

```ts
  /** Reservation branding (server-merged + accentColor resolved). Optional so
   *  older server payloads / cached responses still type-check. */
  branding?: ReservationBranding
```

- [ ] **Step 2: Typecheck**

Run: `cd /Users/amieva/Documents/Programming/Avoqado/avoqado-booking-widget && npx tsc --noEmit 2>&1 | grep -i "types.ts" || echo "clean"`
Expected: `clean`

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat(widget): ReservationBranding type on VenueInfo"
```

---

### Task W2: Branding defaults helper + signal

**Files:**
- Modify: `src/state/booking.ts` (add a `branding` signal + default)

- [ ] **Step 1: Add a defaulted branding signal**

In `src/state/booking.ts`, add:

```ts
import type { ReservationBranding } from '../types'

export const DEFAULT_BRANDING: ReservationBranding = {
  showLogo: true,
  accentColor: null,
  buttonShape: 'rounded',
  fontFamily: 'DM Sans',
  showHeroImage: true,
  showDescriptions: true,
  showDuration: true,
  showPrices: true,
}

export const branding = signal<ReservationBranding>(DEFAULT_BRANDING)
```

(Use the same `signal` import the file already uses from `@preact/signals`.)

- [ ] **Step 2: Populate it on venue load**

In `src/components/BookingFlow.tsx`, in the venue-load effect where `venueInfo.value` is set (search `venueInfo.value =`), add right after:

```ts
branding.value = info.branding ?? DEFAULT_BRANDING
```

(import `branding, DEFAULT_BRANDING` from `../state/booking`; `info` is the fetched venue payload.)

- [ ] **Step 3: Typecheck + commit**

Run: `npx tsc --noEmit 2>&1 | grep -iE "booking.ts|BookingFlow" || echo "clean"` → `clean`
```bash
git add src/state/booking.ts src/components/BookingFlow.tsx
git commit -m "feat(widget): branding signal populated from venue payload"
```

---

### Task W3: Apply accent + button-shape + font tokens at root

**Files:**
- Modify: `src/App.tsx` (root style, line 47)
- Modify: `src/shared-styles.ts` (button radius token)

- [ ] **Step 1: Compute the root style from branding**

In `src/App.tsx`, import the signal and compute a style object. Replace the root `<div>` style (line 47) so it sets `--avq-accent`, `--avq-btn-radius`, and `--avq-font`:

```tsx
import { branding } from './state/booking'

const b = branding.value
const shapeRadius = b.buttonShape === 'square' ? '0px' : b.buttonShape === 'pill' ? '9999px' : '0.5rem'
const rootStyle: Record<string, string> = {
  '--avq-btn-radius': shapeRadius,
}
// accentColor wins over the legacy accent-color attribute when present.
const accent = b.accentColor ?? props.accentColor
if (accent) rootStyle['--avq-accent'] = accent
if (b.fontFamily) rootStyle['--avq-font'] = `"${b.fontFamily}", system-ui, sans-serif`
```

Apply `style={rootStyle}` to the `.avq-root` div (replacing the current conditional `--avq-accent` style).

- [ ] **Step 2: Wire the tokens into CSS**

In `src/shared-styles.ts`, ensure the root applies the font and buttons use the radius token. Add to the `.avq-root` rule:
```css
.avq-root { font-family: var(--avq-font, inherit); }
```
And make CTA buttons use `border-radius: var(--avq-btn-radius, 0.5rem);` (update the primary button class — search the Button component's class in shared-styles for its current `border-radius`).

- [ ] **Step 3: Build + commit**

Run: `npm run build 2>&1 | tail -5` (expect success).
```bash
git add src/App.tsx src/shared-styles.ts
git commit -m "feat(widget): apply accent, button-shape and font tokens from branding"
```

---

### Task W4: Conditional price / duration / description in ServiceSelector

**Files:**
- Modify: `src/components/ServiceSelector.tsx` (price ~389, duration ~390, description ~451-465, price render ~482)

- [ ] **Step 1: Read branding in the row**

In `src/components/ServiceSelector.tsx`, import the signal at top: `import { branding } from '../state/booking'`. In the row component (where `priceLabel`/`durationLabel` are computed ~389), read flags:

```ts
const { showPrices, showDuration, showDescriptions } = branding.value
```

- [ ] **Step 2: Gate each element**

- Description block (~451-465): wrap the existing `{product.description && ( … )}` so it becomes `{showDescriptions && product.description && ( … )}`.
- Duration: change `const durationLabel = product.duration ? … : null` to `const durationLabel = showDuration && product.duration ? … : null` (existing `{durationLabel && …}` render then hides it).
- Price (~482): wrap the price `<span>` in `{showPrices && ( … )}`. If hiding the price leaves a dangling `·` separator, render the separator only when both price and duration are shown.

- [ ] **Step 3: Mirror in the class list**

Search the classes list renderer (`BookingFlow.tsx` `avq-classes-*` or a `ClassList` component) for the same price/duration display and gate it with the same `branding.value` flags.

- [ ] **Step 4: Build + commit**

Run: `npm run build 2>&1 | tail -5` (expect success).
```bash
git add src/components/ServiceSelector.tsx src/components/BookingFlow.tsx
git commit -m "feat(widget): honor show price/duration/description branding toggles"
```

---

### Task W5: Hero image component

**Files:**
- Create: `src/components/ReservationHero.tsx`
- Modify: `src/components/BookingFlow.tsx` (render hero above the flow)

- [ ] **Step 1: Create the component**

Create `src/components/ReservationHero.tsx`:

```tsx
import { h } from 'preact'

interface ReservationHeroProps {
  imageUrl: string
  alt?: string
}

/** Wide cover photo shown above the reservation flow when the venue has a
 *  heroImageUrl AND branding.showHeroImage is true. */
export function ReservationHero({ imageUrl, alt }: ReservationHeroProps) {
  return (
    <div
      class="avq-hero"
      style={{
        width: '100%',
        aspectRatio: '16 / 5',
        borderRadius: '14px',
        overflow: 'hidden',
        marginBottom: '20px',
      }}
    >
      <img src={imageUrl} alt={alt ?? ''} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
    </div>
  )
}
```

- [ ] **Step 2: Render it**

In `src/components/BookingFlow.tsx`, import `ReservationHero` and `branding`. At the top of the appointments/classes flow render (where the service step renders, e.g. just inside the wrapper before `avq-appts-layout`), add:

```tsx
{branding.value.showHeroImage && info.heroImageUrl && step.value === config.serviceStep && (
  <ReservationHero imageUrl={info.heroImageUrl} alt={info.name} />
)}
```

(`info` = venue info; confirm `heroImageUrl` is on the widget's `VenueInfo` type — add `heroImageUrl?: string | null` to `src/types.ts` if missing.)

- [ ] **Step 3: Build + commit**

Run: `npm run build 2>&1 | tail -5` (expect success).
```bash
git add src/components/ReservationHero.tsx src/components/BookingFlow.tsx src/types.ts
git commit -m "feat(widget): reservation hero image gated by branding + heroImageUrl"
```

---

### Task W6: Font injection into the Shadow DOM

**Files:**
- Create: `src/lib/brandingFont.ts`
- Modify: `src/App.tsx` (call the loader when fontFamily changes)

Fonts loaded via `@font-face` / Google Fonts `<link>` in `document.head` cascade into the Shadow DOM (fonts are not scoped). System default `DM Sans` already ships, so we only fetch non-default whitelisted fonts.

- [ ] **Step 1: Create the loader**

Create `src/lib/brandingFont.ts`:

```ts
/** Fonts that don't need fetching (already available / system default). */
const SKIP = new Set(['DM Sans'])
const loaded = new Set<string>()

/**
 * Inject a Google Fonts stylesheet for `family` into document.head once.
 * Idempotent. `@font-face` in the document cascades into the widget's Shadow
 * DOM, so setting `font-family` on the widget root is enough to apply it.
 */
export function loadBrandingFont(family: string | null | undefined): void {
  if (!family || SKIP.has(family) || loaded.has(family)) return
  if (typeof document === 'undefined') return
  loaded.add(family)
  const href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@400;500;600;700&display=swap`
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = href
  link.dataset.avqFont = family
  document.head.appendChild(link)
}
```

- [ ] **Step 2: Call it from App**

In `src/App.tsx`, after reading `b = branding.value`, trigger the load:

```tsx
import { useEffect } from 'preact/hooks'
import { loadBrandingFont } from './lib/brandingFont'

useEffect(() => {
  loadBrandingFont(branding.value.fontFamily)
}, [branding.value.fontFamily])
```

(The `--avq-font` token set in Task W3 then applies it via CSS.)

- [ ] **Step 3: Build + manual verify**

Run: `npm run build 2>&1 | tail -5` (expect success).
Manual: serve `test.html` (`npm run dev`, open `http://localhost:5174/test.html`), point a local venue's `reservationBranding.fontFamily` to e.g. `"Poppins"`, reload — confirm a `<link data-avq-font="Poppins">` appears in `document.head` and the widget text renders in Poppins.

- [ ] **Step 4: Commit**

```bash
git add src/lib/brandingFont.ts src/App.tsx
git commit -m "feat(widget): inject branding font into Shadow DOM via document.head"
```

---

### Task W7: End-to-end verification + deploy

- [ ] **Step 1: Full build**

Run: `npm run build 2>&1 | tail -5`
Expected: `dist/widget.js` built, no errors.

- [ ] **Step 2: Manual end-to-end (against deployed server + dashboard)**

In the dashboard, set for a test venue: accent color (different from primaryColor), buttonShape `pill`, font `Poppins`, toggle off `mostrar precios`, ensure a `heroImageUrl` is set. Save. Then load `http://localhost:5174/test.html` pointed at that venue (or production after deploy) and confirm: accent applied to CTAs, buttons pill-shaped, Poppins font, prices hidden, hero image shown above the flow.

- [ ] **Step 3: Deploy widget to CDN**

Run: `git push` (auto-deploy via `.github/workflows`), or `npx wrangler pages deploy dist --project-name avoqado-booking-widget`.
Verify: `curl -fsSL "https://book.avoqado.io/widget.js?cb=$(date +%s)" | grep -o "avq-btn-radius" | head -1` returns a match.

- [ ] **Step 4: Confirm live on book.avoqado.io**

Open `https://book.avoqado.io/<test-slug>/appointments` and confirm the branding renders as configured.

---

## Notes / Out of Scope

- No unification of payment-link and reservation branding (separate by design).
- No secondary color, dark theme, or per-product branding.
- Font catalog uses Google Fonts CSS API (covers the whitelisted families). If a whitelisted font isn't on Google Fonts, add an explicit `@font-face` entry to `brandingFont.ts`.
- The dashboard editor persists `accentColor` as-is (may be null = inherit). A future "Heredar del color de marca" reset affordance can set it back to null; not required for v1 since a fresh venue already inherits.
