# Second-opinion review: appointment collision + Bearer auth fixes

**Audience:** an LLM reviewer (or human) with no prior context on this session.
**Status:** changes are uncommitted in two repos. Local QA passed. Asking for a fresh pair of eyes before push.
**Deadline pressure:** real customer (Mindform, a Pilates studio) goes live in 2 days. Bias toward correctness; flag any risk you see.

> **v2 (revision after first-pass review):** the original draft only fixed the
> `/reservations` controller. Reviewer correctly flagged that `/hold` had no
> collision guard, so two tabs could both create holds for the same slot and
> deadlock the slot for the 10-min TTL. Reviewer also flagged Bug 3 was
> half-fixed (widget-only). This v2 adds: advisory-lock-backed `createHold`
> guard, unconditional Bearer→`customerId` binding, defensive `Math.max(1, ...)`
> clamp, `classSessionId: null` filter on hold queries, and an extracted shared
> helper (`countAppointmentOccupancy`, `effectiveAppointmentPacing`) so the same
> rule doesn't drift across three call sites.

---

## 1. Product context (the why)

Avoqado has a multi-tenant booking system that historically only served **restaurants** (table-based, multiple resources per slot). It now also serves **tableless service venues** — Pilates studios, salons, spas — that book by *time only* (no table model, often 1:1 with a staff member).

Two product types coexist in the same DB / API:

- `APPOINTMENTS_SERVICE` — 1:1 service with a duration. Customer picks `[product, date, time]`. No `ClassSession` row; reservation is anchored only to `[startsAt, endsAt, productId]`.
- `CLASS` — group session with a fixed `ClassSession.capacity`. Customer picks `[classSessionId]`. Server enforces capacity via the existing class branch.

The customer-facing widget at `book.avoqado.io/<slug>` serves both via the same Web Component. Routes: `/appointments` (date-first wizard), `/classes` (session list).

**Mindform is tableless** → has products of type `APPOINTMENTS_SERVICE` only. They are the trigger for the bugs below.

---

## 2. Bugs being fixed

All three are pre-existing on `main` (not introduced this session). QA in a previous session reproduced #1 and #2 with Playwright; #3 was found by reading code.

### Bug 1 — `/availability` does not filter overlapping appointment reservations
For tableless venues, `pacingMaxPerSlot` defaults to `null` ("unlimited"). The slot generator therefore offered the same slot to N customers in a row. Restaurants don't hit this because table assignment is their gate.

### Bug 2 — `createReservation` does not check for time-overlap collisions on `APPOINTMENTS_SERVICE`
The controller has a CLASS branch (capacity guard) and a path that resolves a table assignment, but **no time-only collision check** for tableless appointments. Direct consequence of #1: server happily wrote N `CONFIRMED` reservations for the same wall-clock slot.

### Bug 3 — Logged-in customer's reservation lands as anonymous (no `customerId` link)
Widget had a `customerToken` (JWT signal from `/customer/login`) but `createReservation` API helper never forwarded it as `Authorization: Bearer`. Result: even after login, bookings showed `customerId = null` and the customer portal "Mis Reservaciones" stayed empty for the booking just made. QA in previous session confirmed: Carla logged in, redeemed credits, reservation was created — credits debited correctly but `Reservation.customerId IS NULL`.

---

## 3. Changes summary (v2)

| Repo | File | Change |
|---|---|---|
| `avoqado-server` | `src/services/dashboard/reservationAvailability.service.ts` | **New exports** `effectiveAppointmentPacing(value)` (clamps `Math.max(1, value ?? 1)`) and `countAppointmentOccupancy(client, args)` (overlap count of reservations + holds, filters `classSessionId: null` on both). Existing slot loop refactored to consume the helper. Also exposes `ACTIVE_RESERVATION_STATUSES` for cross-file reuse. |
| `avoqado-server` | `src/controllers/public/reservation.public.controller.ts` | (a) **Bearer→customerId** binding now runs **unconditionally** (was previously gated by `requireAccount`). Token venueId is checked against URL venueId. (b) **`createReservation` collision guard** for `APPOINTMENTS_SERVICE` uses the shared helper. (c) **`createHold` advisory lock**: when the hold is for an appointment, wraps in `prisma.$transaction` with `pg_advisory_xact_lock(hashtext('apt-hold:<venueId>')::bigint)`, then count + 409 on collision + insert — all serialized per venue. |
| `avoqado-booking-widget` | `src/api/booking.ts` | `createReservation` now accepts optional `token` arg → emits `Authorization: Bearer <jwt>` |
| `avoqado-booking-widget` | `src/components/BookingFlow.tsx` | Passes `customerToken.value` to `createReservation` |

### Key invariants the changes rely on
- `ReservationSettings.scheduling.pacingMaxPerSlot` is `Int? null` by default. Venues can override (e.g. 3 cabins → set to 3).
- `ACTIVE_STATUSES = ['PENDING', 'CONFIRMED', 'CHECKED_IN']` — same set already used by the availability service. My controller guard inlines the same enum members (DRY trade-off below).
- `SlotHold` is the existing pre-checkout hold mechanism (Square-style countdown). Active = `expiresAt > now()`.
- Classes go through a separate `classSessionId` branch with its own capacity guard (`ClassSession.capacity`). My collision guard is gated `if (!classSessionId && productId)` so classes bypass.

---

## 4. Full diffs

> **Note:** the diffs embedded below are the **v1** snapshots and are stale.
> For v2, the authoritative diff is the working tree itself — run:
>
> ```bash
> ( cd avoqado-server          && git diff src/controllers/public/reservation.public.controller.ts src/services/dashboard/reservationAvailability.service.ts )
> ( cd avoqado-booking-widget && git diff src/api/booking.ts src/components/BookingFlow.tsx )
> ```
>
> The widget diffs are unchanged from v1 (still 39 lines total). The server
> diffs grew from ~120 lines to ~300 due to the helper extraction and
> `createHold` advisory lock. Reviewer should diff the live working tree.

### Server — `src/services/dashboard/reservationAvailability.service.ts`
```diff
@@ -113,16 +113,45 @@ export async function getAvailableSlots(

   // Get product capacity if productId specified
   let productCapacity: number | null = null
+  let productType: string | null = null
   if (options.productId) {
     const product = await prisma.product.findFirst({
       where: { id: options.productId, venueId },
-      select: { eventCapacity: true },
+      select: { eventCapacity: true, type: true },
     })
+    productType = product?.type ?? null
     if (product?.eventCapacity) {
       productCapacity = Math.floor((product.eventCapacity * onlineCapacityPercent) / 100)
     }
   }

+  // Active slot holds for APPOINTMENTS_SERVICE — counted as soft-reservations
+  // so a customer holding a slot via the Square countdown doesn't have it
+  // offered to someone else mid-checkout. Classes already gate via
+  // ClassSession.capacity, so we skip the lookup for them.
+  const isAppointment = productType === 'APPOINTMENTS_SERVICE'
+  const activeHolds = isAppointment
+    ? await prisma.slotHold.findMany({
+        where: {
+          venueId,
+          expiresAt: { gt: new Date() },
+          startsAt: { lt: dayEnd },
+          endsAt: { gt: dayStart },
+        },
+        select: { startsAt: true, endsAt: true },
+      })
+    : []
+
+  // Tableless studios (Mindform pattern) have NO resource model gating
+  // concurrent appointments — the table-collision logic below is a no-op
+  // when tables.length === 0, and pacingMax defaults to null. Without this
+  // floor of 1, /availability happily offered the SAME slot to N customers
+  // and the controller happily wrote N CONFIRMED reservations for it.
+  // Restaurants with tables keep null = unlimited; table assignment is
+  // their gate. Venues can opt back to overbooking by setting an explicit
+  // pacingMaxPerSlot (e.g. 3 for a studio with 3 cabins).
+  const effectivePacing = pacingMax ?? (isAppointment ? 1 : null)
+
   // Evaluate each slot
   const availableSlots: AvailableSlot[] = []

@@ -131,9 +160,10 @@ export async function getAvailableSlots(

     // Find reservations overlapping this slot
     const overlapping = existingReservations.filter(r => r.startsAt < slotEnd && r.endsAt > slotStart)
+    const overlappingHolds = activeHolds.filter(h => h.startsAt < slotEnd && h.endsAt > slotStart)

-    // Pacing check: total bookings in this slot
-    if (pacingMax !== null && overlapping.length >= pacingMax) {
+    // Pacing check: total bookings + active holds in this slot
+    if (effectivePacing !== null && overlapping.length + overlappingHolds.length >= effectivePacing) {
       continue
     }
```

### Server — `src/controllers/public/reservation.public.controller.ts`
Inserted immediately before the existing `if (req.body.classSessionId)` branch (~line 530).
```diff
+    // ---- Slot collision guard for APPOINTMENTS_SERVICE -------------------
+    // Tableless studios (Mindform pattern) have no resource model to gate
+    // concurrent reservations, so /availability + this controller default
+    // pacing to 1 for APPOINTMENTS_SERVICE bookings. This guard runs
+    // immediately before the service call; the sub-100ms race window between
+    // count and insert is accepted because the slot hold mechanism closes
+    // most of it. Venues can override the pacing limit via
+    // ReservationSettings.pacingMaxPerSlot when they have multiple parallel
+    // resources (e.g. 3 cabins → set to 3).
+    //
+    // Classes don't pass through here (handled by the classSessionId branch
+    // below) and their per-session capacity guard already prevents overlap.
+    if (!req.body.classSessionId && req.body.productId) {
+      const product = await prisma.product.findFirst({
+        where: { id: req.body.productId, venueId: venue.id },
+        select: { type: true },
+      })
+      if (product?.type === 'APPOINTMENTS_SERVICE') {
+        const pacingMax = settings.scheduling?.pacingMaxPerSlot ?? 1
+        const reqStart = new Date(req.body.startsAt)
+        const reqEnd = new Date(req.body.endsAt)
+        const [overlapCount, holdCount] = await Promise.all([
+          prisma.reservation.count({
+            where: {
+              venueId: venue.id,
+              status: { in: [ReservationStatus.PENDING, ReservationStatus.CONFIRMED, ReservationStatus.CHECKED_IN] },
+              classSessionId: null,
+              startsAt: { lt: reqEnd },
+              endsAt: { gt: reqStart },
+            },
+          }),
+          prisma.slotHold.count({
+            where: {
+              venueId: venue.id,
+              expiresAt: { gt: new Date() },
+              startsAt: { lt: reqEnd },
+              endsAt: { gt: reqStart },
+              ...(incomingHoldId ? { id: { not: incomingHoldId } } : {}),
+            },
+          }),
+        ])
+        if (overlapCount + holdCount >= pacingMax) {
+          throw new ConflictError('Este horario ya no está disponible. Por favor elige otro horario.')
+        }
+      }
+    }
```

### Widget — `src/api/booking.ts`
```diff
-export function createReservation(slug: string, data: PublicCreateReservationRequest): Promise<PublicBookingResult> {
-  return request(`${BASE}/venues/${slug}/reservations`, { method: 'POST', body: JSON.stringify(data) })
+export function createReservation(
+  slug: string,
+  data: PublicCreateReservationRequest,
+  /** Optional Bearer JWT. When passed, the server stamps customerId on the
+   *  reservation so the booking shows up in the customer's portal history.
+   *  Anonymous reservations omit this and the row stays guest-only. */
+  token?: string,
+): Promise<PublicBookingResult> {
+  return request(`${BASE}/venues/${slug}/reservations`, {
+    method: 'POST',
+    body: JSON.stringify(data),
+    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
+  })
 }
```

### Widget — `src/components/BookingFlow.tsx`
Single call site update:
```diff
-      })
+      }, customerToken.value ?? undefined /* Bearer token stamps customerId server-side */)
```

---

## 5. Local QA performed (v2)

All against `localhost:3000` with a Mindform-shaped local seed (`avoqado-full` venue, `manicure` product type `APPOINTMENTS_SERVICE`, duration 60min, `pacingMaxPerSlot = null`).

### v1 tests (re-verified after v2 refactor)

| # | Scenario | Expected | Actual |
|---|---|---|---|
| 1 | POST appointment 16:00–17:00 | 200 + confirmationCode | ✅ |
| 2 | POST same slot again | 409 | ✅ |
| 3 | `/availability` after #1 | 16:00, 16:30 hidden, 17:00 present | ✅ |
| 4 | ClassSession (cap 2) + appt at same wall-clock 16:00 | both succeed (different products) | ✅ |
| 5 | 2nd appt at 16:00 with class booked | 409 (class doesn't relax appt) | ✅ |
| 6 | 3rd class with capacity 2/2 | 400 "Disponibles: 0" | ✅ |
| 7 | `availableSpots: false` after class full | ✅ | ✅ |

### v2 tests added for new guard / Bearer

| # | Scenario | Expected | Actual |
|---|---|---|---|
| T1 | **3 concurrent POST /hold for same slot** (no widget — direct curl with `&` and `wait`) | exactly 1 succeeds, 2 return 409 | ✅ 1 holdId returned, 2 × `"Este horario ya no está disponible"` |
| T2 | hold winner converts to reservation | 200 + confirmationCode | ✅ `RES-HBMUEM` |
| T3 | POST /hold same slot after reservation exists | 409 | ✅ |
| T4 | POST /hold for overlapping slot (15:30–16:30 vs 15:00–16:00 reservation) | 409 | ✅ |
| T5 | POST /hold for non-overlapping slot (17:00–18:00) | 201 | ✅ holdId returned |
| T6 | POST /hold for `classSessionId=...` (no advisory lock taken; different path) | 201 | ✅ |
| T7 | POST /hold appointment 20:00 while class session 20:00 holds exist (`classSessionId: null` filter) | 201 — class hold doesn't block appt | ✅ |
| T8 | POST /reservations anonymous (no Bearer, no matching email/phone) | `customerId IS NULL` in DB | ✅ |
| T9 | POST /reservations with valid Bearer JWT | `Reservation.customerId = JWT.sub` in DB | ✅ stamped correctly |
| T10 | Cross-venue forged Bearer | NOT bound (covered by `authenticatedCustomer.venueId === venue.id` check) | code-only |
| TS | `tsc --noEmit` server | clean | ✅ `EXIT=0` |

Test data was cleaned up after each run. Verified zero `Reservation`, `SlotHold`, `ClassSession`, `Customer` rows remain for the QA window.

---

## 6. Known gaps / things I want the reviewer to scrutinize

> **v2 update:** items (a), (b), (c), (e) below were addressed. (d), (f), (g),
> (h) remain mostly as-is — see notes inline.

### a) Bearer→`customerId` is dropped on the server (Bug 3 only half-fixed?) — **FIXED in v2**

The widget now sends `Authorization: Bearer <jwt>`. The server's `tryReadAuthenticatedCustomer(req)` exists but is **only invoked inside the `requireAccount` branch** (`reservation.public.controller.ts:433-446`):

```ts
if (settings.publicBooking.requireAccount) {
  const authenticatedCustomer = tryReadAuthenticatedCustomer(req)
  ...
  if (authenticatedCustomer && authenticatedCustomer.venueId === venue.id) {
    req.body.customerId = authenticatedCustomer.customerId
  }
}
```

Mindform has `requireAccount = false` (anonymous bookings allowed). So even with the Bearer header, the controller never reads it, `req.body.customerId` stays undefined, and the appointment service writes `customerId: undefined`.

There IS a fallback in the **class** path (`reservation.public.controller.ts:1144` matches Customer by email/phone) — but **not** in the appointment path (`reservation.dashboard.service.ts:350` just takes `data.customerId` as-is).

**v2 resolution:** applied the sketch verbatim. Bearer reading is now
unconditional and the `requireAccount` branch only does the gate check
(throw 401 if no auth-context). The appointment service already forwards
`data.customerId` (line 350), so the controller setting it is enough.
QA T9 confirmed: a JWT-authenticated POST stamps `customerId` on the row
exactly as expected, and QA T8 confirmed anonymous POSTs still get
`customerId IS NULL`. Public `body.customerId` is **never** trusted as
identity outside `requireAccount` — same security envelope as before.

### b) Race window between count and insert (collision guard) — **STRONGER in v2**

v1 had a small race window on `createReservation` AND no guard at all on `createHold` (reviewer's strongest finding). v2 changes:

- **`createHold` now uses a per-venue advisory lock**: wrapped in `prisma.$transaction`, runs `SELECT pg_advisory_xact_lock(hashtext('apt-hold:<venueId>')::bigint)` before counting and inserting. Two concurrent POST /hold for the same slot are fully serialized; one wins, the rest see the in-transaction count and 409. QA T1 fired three simultaneous holds for the same slot via shell `&` + `wait` — 1 hold returned, 2 × 409. ✅
- **`createReservation` keeps the count-then-insert pattern** (no advisory lock). The widget always creates a hold first (the standard path), so the lock at `/hold` is the effective serialization layer. The reservation guard is the fallback for direct API or no-hold flows. For Mindform-scale traffic (~1-5 bookings/min) the residual race is acceptable.

The lock key is venue-wide (`apt-hold:<venueId>`) rather than per-slot. Per-slot keys are tempting but break for overlapping ranges (a 15:00–16:00 lock doesn't protect a 15:30–16:30 hold). Venue-wide lock is microseconds in `_xact_lock`. Bumping contention later (per `(venueId, dayBucket)`) is a one-line change.

Alternative designs still rejected: SERIALIZABLE + `FOR UPDATE` would force a refactor of `reservation.dashboard.service.ts`; PG exclusion constraint over `tstzrange` would need a migration + `btree_gist` extension the team hasn't used anywhere. Both are post-launch improvements.

### c) `pacingMax = 0` semantics — **FIXED in v2**

The shared `effectiveAppointmentPacing(v)` helper now does `Math.max(1, v ?? 1)`. Explicit 0 / negative / null all collapse to 1. The bug-via-misconfig is gone.

### d) Status set hard-coded in controller (DRY) — **FIXED in v2**

`ACTIVE_RESERVATION_STATUSES` is now exported from the availability service and consumed by `countAppointmentOccupancy`. The controller no longer inlines the literal — it calls the helper. Drift surface eliminated.

### e) Comment "sub-100ms race window" — **FIXED in v2**

Reworded the controller comment to drop the unverified ms number; now reads: *"A small race window between count and insert remains here; for Mindform-scale concurrency it's acceptable, and the hold endpoint closes it for the standard widget path."*

### f) Widget — token passed only in the multi-product (`createReservation`) call site

I updated **one** call site in `BookingFlow.tsx:977`. Are there other call sites? `grep`:
```
src/components/BookingFlow.tsx:977: api.createReservation(props.venue, {...}, customerToken.value ?? undefined ...)
```
That's the only one. ManageBooking, reschedule, cancel use other endpoints. **Worth a sanity check from the reviewer that `createReservation` isn't called anywhere else.**

### g) Mobile-tab dormancy interaction

The widget has visibility-based catalog refresh. A backgrounded tab whose slot hold has expired will get a 409 on the existing hold-validation path (`controller line 1490: ConflictError("Tu reserva temporal expiro...")`) — not the new path. My guard does NOT 409 on expired holds; it doesn't even see expired holds because of `expiresAt: { gt: new Date() }`. **This is intentional — different error path — but worth confirming I understood the UX flow correctly.**

### h) Pre-existing widget tsc errors (not introduced by me) — **DOC CORRECTED in v2**

§5 table in v1 was wrong: it said both repos tsc clean. Reality:
- **Server**: `tsc --noEmit` exits 0 (verified after v2 changes too).
- **Widget**: `tsc --noEmit` exits 0 BUT prints two pre-existing errors that exist on baseline `main` (`fa79a26`):
  - `src/components/Confirmation.tsx:97` — `number | undefined` not assignable to `string | number`
  - `src/components/VenueSidebarCard.tsx:2` — `CustomerInfo` imported from `../types` but actually defined in `../state/booking`
- Build is not blocked because Vite uses esbuild, not tsc. Out of scope for this PR. Flagging here so the reviewer doesn't trust the §5 line in isolation.

---

## 7. Files for the reviewer to read in order

Server:
1. `src/controllers/public/reservation.public.controller.ts` lines 417–700 (full `createReservation` controller)
2. `src/services/dashboard/reservationAvailability.service.ts` (full file, ~200 lines)
3. `src/services/dashboard/reservation.dashboard.service.ts` lines 330–370 (where `customerId` is written)
4. `prisma/schema.prisma` — search for `model Reservation`, `model SlotHold`, `enum ReservationStatus`, `model ReservationSettings`

Widget:
1. `src/api/booking.ts` (full file, ~230 lines)
2. `src/components/BookingFlow.tsx` lines 950–1010 (the call site)
3. `src/state/booking.ts` lines 40–90 (`customerToken`, `customerInfo`, `setCustomerSession`)

---

## 8. What I want from the review

For each open question in §6, one of:

- ✅ **Ship as-is** — concern is acceptable for the 2-day window.
- ⚠️ **Ship but track** — fine to ship, but file an issue.
- 🛑 **Block** — needs a fix in this same PR.

Plus anything I missed: API surface contracts, data integrity assumptions, error messages (Spanish, customer-facing), security (the Bearer→customerId binding is a real authz surface), test gaps, anything else.

The goal is correctness for one customer launching in 2 days, not perfection. Don't reach for re-architecture; do reach for "this specific edge case will break Mindform on day 1."
