# OTP Phone-Matching Fix + Smart Paste Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the phone-matching bug (guest-typed formatted numbers never match, breaking name-backfill and guest→customer auto-link) by normalizing inside SQL, and add smart-paste of a full international number in the widget's country picker.

**Architecture:** Server replaces the Prisma `{ endsWith: last10 }` prefilter (which compares raw unnormalized column text) with a `$queryRaw` that strips non-digits in Postgres before comparing — the canonical `phonesMatch()` JS verify stays as defense-in-depth. Widget adds a pure `detectCountryFromFullNumber()` that splits a pasted `+<country><national>` string, wired into the existing national-number `onInput`.

**Tech Stack:** Express + Prisma (`$queryRaw`, `Prisma.sql`) + Jest integration tests (real DB) on the server; Preact + TypeScript + Vite on the widget.

## Global Constraints

- **Work in place, no branch/worktree.** Server on `develop`, widget on `main`. Both repos carry unrelated parallel WIP.
- **Implementers do NOT commit.** Leave changes uncommitted; the controller stages exact paths and commits. Never `git add -A`/`git add .`/`git commit -am`.
- **Server import alias:** `@/` → `src/`. The affected files use RELATIVE imports (`../../utils/phone`) — match that style.
- **Server: never widen phone matching to be less precise than today.** The email branch stays EXACT match; only the phone branch changes.
- **Server SQL normalization must mirror `phoneLast10()` exactly:** strip everything but digits, take the last 10 — i.e. `right(regexp_replace(<col>, '[^0-9]', '', 'g'), 10)`.
- **Widget: smart-detect ONLY when the raw input starts with `+`.** Without a leading `+`, behavior is byte-for-byte unchanged (strip non-digits → national number, no dial change). This is what prevents a plain national number from being misread as a country code.
- **Widget has no test runner** — verify with `npx tsc --noEmit` (exit 0) + `npm run build` (emits `dist/widget.js`) + manual browser paste test.
- **Server single integration test run:** `npx jest --selectProjects=integration --runTestsByPath <path>` from the server repo root. Integration tests use the REAL DB at `DATABASE_URL` — the test MUST clean up everything it creates.

---

## File map

**avoqado-server (`develop`, in place):**
- Modify: `src/services/public/otpAuth.public.service.ts` — `findGuestNameFromPastReservations` phone branch → `$queryRaw`.
- Create: `tests/integration/public/otp-name-backfill.test.ts` — real-DB proof the SQL matches a formatted `guestPhone`.
- Modify: `src/controllers/public/reservation.public.controller.ts` — `matchCandidates` → `$queryRaw` with `Prisma.sql` fragments.

**avoqado-booking-widget (`main`, in place):**
- Modify: `src/data/countries.ts` — add `detectCountryFromFullNumber()`.
- Modify: `src/components/ui/CountryPhoneInput.tsx` — wire smart-detect into the national-number `onInput`.

---

# PART A — avoqado-server

All commands run from `/Users/amieva/Documents/Programming/Avoqado/avoqado-server`. Always prefix Bash with `cd /Users/amieva/Documents/Programming/Avoqado/avoqado-server && ...` (session cwd is a different repo).

### Task 1: Normalize phone in SQL for the name-backfill lookup (+ real-DB integration test)

**Files:**
- Modify: `src/services/public/otpAuth.public.service.ts` (`findGuestNameFromPastReservations`, phone branch, ~lines 96–110)
- Create: `tests/integration/public/otp-name-backfill.test.ts`
- Modify: `tests/unit/services/public/otpAuth.public.service.test.ts` (the phone-path mocks: `reservation.findMany` → `$queryRaw`, since the phone branch no longer calls `findMany`)

**Interfaces:**
- Consumes: existing `prisma` (default export, is the `PrismaClient`), `phoneLast10`, `phonesMatch`, `splitName`, and the exported `verifyOtp({ venueId, channel, destination, code })`.
- Produces: no new exports. `findGuestNameFromPastReservations` now finds reservations whose `guestPhone` matches after digit-normalization, regardless of stored formatting.

**Behavior contract the integration test pins:** a `Reservation` with `guestName='Ana TESTNAME'` and a **formatted** `guestPhone='55 9999 0001'`, when a first-time WhatsApp login verifies for `+525599990001`, yields a new `Customer` with `firstName='Ana'`.

- [ ] **Step 1: Confirm the exact current phone branch**

Run: `cd /Users/amieva/Documents/Programming/Avoqado/avoqado-server && sed -n '96,110p' src/services/public/otpAuth.public.service.ts`
Expected: shows the `if (key.phone) { ... prisma.reservation.findMany({ where: { ..., guestPhone: { endsWith: last10 } } }) ... }` block.

- [ ] **Step 2: Write the failing integration test**

Create `tests/integration/public/otp-name-backfill.test.ts` with EXACTLY:

```typescript
/**
 * Integration test (REAL DB): name-backfill on first WhatsApp login must find a
 * past guest reservation even when guestPhone has embedded formatting
 * (spaces/dashes) — the bug /full-testing surfaced.
 *
 * @see src/services/public/otpAuth.public.service.ts (findGuestNameFromPastReservations)
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'test'
process.env.OTP_PEPPER = process.env.OTP_PEPPER || 'test-pepper-backfill'
process.env.ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || 'test-access-secret'
process.env.REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET || 'test-refresh-secret'

import '../../__helpers__/integration-setup'
import crypto from 'crypto'
import prisma from '@/utils/prismaClient'
import { verifyOtp } from '@/services/public/otpAuth.public.service'

// Mirror lib/otp.hashOtpCode so we can plant a challenge the code will accept.
function hashOtpCode(code: string): string {
  return crypto.createHash('sha256').update(`${code}:${process.env.OTP_PEPPER}`).digest('hex')
}

describe('OTP name backfill — formatted guestPhone (integration, real DB)', () => {
  let orgId: string
  let venueId: string
  const PHONE_E164 = '+525599990001'
  const RESERVATION_CODE = 'ITEST-BACKFILL-01'

  beforeAll(async () => {
    const org = await prisma.organization.create({
      data: { name: 'ITEST Backfill Org', email: `itest-backfill-${Date.now()}@test.com`, phone: '5550000000' },
    })
    orgId = org.id
    const venue = await prisma.venue.create({
      data: {
        name: 'ITEST Backfill Venue', slug: `itest-backfill-${Date.now()}`, organizationId: orgId,
        address: 'X', city: 'X', state: 'X', country: 'MX', zipCode: '00000', timezone: 'America/Mexico_City',
      },
    })
    venueId = venue.id
    // Past guest reservation with a FORMATTED phone (spaces inside the last 10 chars).
    await prisma.reservation.create({
      data: {
        venueId, confirmationCode: RESERVATION_CODE, startsAt: new Date(Date.now() - 86400000),
        endsAt: new Date(Date.now() - 86400000 + 3600000), duration: 60,
        guestName: 'Ana TESTNAME', guestPhone: '55 9999 0001', guestEmail: null,
      },
    })
    // Plant an unconsumed OTP challenge the verify path will accept.
    await prisma.otpChallenge.create({
      data: {
        channel: 'whatsapp', destination: PHONE_E164, codeHash: hashOtpCode('123456'),
        expiresAt: new Date(Date.now() + 600000),
      },
    })
  })

  afterAll(async () => {
    await prisma.customer.deleteMany({ where: { venueId } })
    await prisma.reservation.deleteMany({ where: { venueId } })
    await prisma.otpChallenge.deleteMany({ where: { destination: PHONE_E164 } })
    await prisma.consumer.deleteMany({ where: { phone: PHONE_E164 } })
    await prisma.venue.deleteMany({ where: { id: venueId } })
    await prisma.organization.deleteMany({ where: { id: orgId } })
    await prisma.$disconnect()
  })

  it('backfills firstName from a formatted-phone reservation', async () => {
    const result = await verifyOtp({ venueId, channel: 'whatsapp', destination: PHONE_E164, code: '123456' })
    expect(result.customer.firstName).toBe('Ana')
    expect(result.customer.lastName).toBe('TESTNAME')
  })
})
```

- [ ] **Step 3: Run the test to verify it FAILS**

Run: `cd /Users/amieva/Documents/Programming/Avoqado/avoqado-server && npx jest --selectProjects=integration --runTestsByPath tests/integration/public/otp-name-backfill.test.ts`
Expected: FAIL — `firstName` is `null` (received) not `'Ana'`, because the current `{ endsWith: '5599990001' }` never matches the stored `'55 9999 0001'`.

- [ ] **Step 4: Apply the SQL fix**

In `src/services/public/otpAuth.public.service.ts`, replace ONLY the `prisma.reservation.findMany({...})` call inside the `if (key.phone)` branch. Current:

```typescript
    const candidates = await prisma.reservation.findMany({
      where: { venueId, guestName: { not: null }, guestPhone: { endsWith: last10 } },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { guestName: true, guestPhone: true },
    })
```

Replace with (normalize the stored column in SQL — same strip-and-last-10 as `phoneLast10`):

```typescript
    // Coarse prefilter by trailing 10 digits, normalizing the STORED column in
    // SQL (strip non-digits, take last 10) so guest-typed formatting
    // ("55 9999 0001") still matches — a Prisma `endsWith` compares the raw
    // string and would miss it. phonesMatch below is the canonical verify.
    const candidates = await prisma.$queryRaw<{ guestName: string | null; guestPhone: string | null }[]>`
      SELECT "guestName", "guestPhone"
      FROM "Reservation"
      WHERE "venueId" = ${venueId}
        AND "guestName" IS NOT NULL
        AND right(regexp_replace("guestPhone", '[^0-9]', '', 'g'), 10) = ${last10}
      ORDER BY "createdAt" DESC
      LIMIT 20
    `
```

Leave the following line (`const match = candidates.find(c => phonesMatch(c.guestPhone, key.phone))`) and everything else in the function unchanged.

- [ ] **Step 4b: Update the existing unit test's phone-path mocks (findMany → $queryRaw)**

The phone branch now calls `prisma.$queryRaw`, not `prisma.reservation.findMany`, so the existing unit test at `tests/unit/services/public/otpAuth.public.service.test.ts` must mock `$queryRaw` for the phone path (the email path still uses `reservation.findFirst` and is unchanged). `prismaMock.$queryRaw` exists as a `jest.fn()` (helper line 262). Make exactly these three edits:

Edit 1 — in the top-level `beforeEach` (the default "no past reservation"), add a `$queryRaw` default. Change:

```typescript
    prismaMock.reservation.findMany.mockResolvedValue([])
    prismaMock.reservation.findFirst.mockResolvedValue(null)
```

to:

```typescript
    prismaMock.reservation.findMany.mockResolvedValue([])
    prismaMock.reservation.findFirst.mockResolvedValue(null)
    prismaMock.$queryRaw.mockResolvedValue([]) // phone-path backfill now uses $queryRaw
```

Edit 2 — in the test `'seeds firstName/lastName from the most recent past guest reservation'`, change:

```typescript
      prismaMock.reservation.findMany.mockResolvedValue([{ guestName: 'Juan Pérez López', guestPhone: '5512345678' }])
```

to:

```typescript
      prismaMock.$queryRaw.mockResolvedValue([{ guestName: 'Juan Pérez López', guestPhone: '5512345678' }])
```

Edit 3 — in the test `'creates a nameless customer when no past named reservation exists'`, change:

```typescript
      prismaMock.reservation.findMany.mockResolvedValue([])
```

to:

```typescript
      prismaMock.$queryRaw.mockResolvedValue([])
```

- [ ] **Step 5: Run the integration test to verify it PASSES**

Run: `cd /Users/amieva/Documents/Programming/Avoqado/avoqado-server && npx jest --selectProjects=integration --runTestsByPath tests/integration/public/otp-name-backfill.test.ts`
Expected: PASS (1 passing; `firstName='Ana'`, `lastName='TESTNAME'`).

- [ ] **Step 5b: Run the existing unit test to verify it still PASSES**

Run: `cd /Users/amieva/Documents/Programming/Avoqado/avoqado-server && npx jest tests/unit/services/public/otpAuth.public.service.test.ts`
Expected: PASS (all green — the phone-path tests now drive `$queryRaw`; email/no-match/create-scoping unchanged).

- [ ] **Step 6: Typecheck the touched file's project**

Run: `cd /Users/amieva/Documents/Programming/Avoqado/avoqado-server && NODE_OPTIONS='--max-old-space-size=8192' npx tsc --noEmit 2>&1 | grep -E "otpAuth.public.service|otp-name-backfill" || echo "no type errors in touched files"`
Expected: `no type errors in touched files`. (The bigger heap avoids an OOM on this repo's large Prisma type graph. Pre-existing errors elsewhere from parallel WIP are acceptable; errors in these two files are not.)

- [ ] **Step 7: Report (do NOT commit)**

Report status, the three files changed (`src/services/public/otpAuth.public.service.ts`, `tests/integration/public/otp-name-backfill.test.ts`, `tests/unit/services/public/otpAuth.public.service.test.ts`), RED/GREEN evidence (integration test), the existing-unit-test result, and tsc result. The controller commits.

---

### Task 2: Normalize phone in SQL for the guest→customer auto-link

**Files:**
- Modify: `src/controllers/public/reservation.public.controller.ts` (the `matchCandidates` block, ~lines 1894–1909)

**Interfaces:**
- Consumes: `Prisma` (already imported at line 13: `import { Prisma } from '@prisma/client'`), `phonesMatch`, `phoneLast10` (already imported), the transaction client `tx`.
- Produces: no new exports. The class-booking auto-link now matches an existing `Customer` by normalized phone regardless of stored formatting; email match stays exact.

**Note:** This is the identical SQL-normalization pattern proven against real Postgres by Task 1's integration test. The class-booking flow is a large serializable transaction; a dedicated integration test for it is disproportionate, so verification here is tsc + the existing public controller unit suite staying green (the SQL correctness itself is covered by Task 1).

- [ ] **Step 1: Confirm the exact current block**

Run: `cd /Users/amieva/Documents/Programming/Avoqado/avoqado-server && sed -n '1894,1910p' src/controllers/public/reservation.public.controller.ts`
Expected: shows `const matchCandidates = body.guestEmail || phoneLast10Digits ? await tx.customer.findMany({ where: { venueId, OR: [...] }, ... }) : []`.

- [ ] **Step 2: Replace the Prisma findMany with a normalized `$queryRaw`**

Replace exactly this block:

```typescript
    const matchCandidates =
      body.guestEmail || phoneLast10Digits
        ? await tx.customer.findMany({
            where: {
              venueId,
              OR: [
                ...(body.guestEmail ? [{ email: body.guestEmail }] : []),
                ...(phoneLast10Digits ? [{ phone: { endsWith: phoneLast10Digits } }] : []),
              ],
            },
            select: { id: true, email: true, phone: true },
          })
        : []
```

with (email stays exact; phone normalizes the stored column in SQL):

```typescript
    // Fetch candidate customers: exact email OR normalized-phone last-10 match.
    // The phone side strips non-digits from the STORED "phone" column in SQL so
    // formatting differences don't hide a real returning customer (a Prisma
    // `endsWith` compares raw text and misses "55 1234 5678"). phonesMatch below
    // is the canonical verify. Column names are compile-time literals here.
    const emailCond = body.guestEmail ? Prisma.sql`"email" = ${body.guestEmail}` : Prisma.sql`FALSE`
    const phoneCond = phoneLast10Digits
      ? Prisma.sql`right(regexp_replace("phone", '[^0-9]', '', 'g'), 10) = ${phoneLast10Digits}`
      : Prisma.sql`FALSE`
    const matchCandidates =
      body.guestEmail || phoneLast10Digits
        ? await tx.$queryRaw<{ id: string; email: string | null; phone: string | null }[]>`
            SELECT "id", "email", "phone"
            FROM "Customer"
            WHERE "venueId" = ${venueId}
              AND (${emailCond} OR ${phoneCond})
          `
        : []
```

Leave the following `const matchedCustomer = matchCandidates.find(...)` line and everything else unchanged.

- [ ] **Step 3: Typecheck**

Run: `cd /Users/amieva/Documents/Programming/Avoqado/avoqado-server && NODE_OPTIONS='--max-old-space-size=8192' npx tsc --noEmit 2>&1 | grep -E "reservation.public.controller" || echo "no type errors in touched file"`
Expected: `no type errors in touched file`. (Bigger heap avoids OOM.)

- [ ] **Step 4: Run the public controller suite (regression guard)**

Run: `cd /Users/amieva/Documents/Programming/Avoqado/avoqado-server && npx jest tests/unit/controllers/public`
Expected: PASS (same green as before — this block has no dedicated unit test; the suite must not regress).

- [ ] **Step 5: Report (do NOT commit)**

Report status, the one file changed, tsc result, and the suite result. The controller commits.

---

# PART B — avoqado-booking-widget

All commands run from `/Users/amieva/Documents/Programming/Avoqado/avoqado-booking-widget`.

### Task 3: `detectCountryFromFullNumber()` in the country dataset

**Files:**
- Modify: `src/data/countries.ts` (add one exported function + one module-level constant)

**Interfaces:**
- Consumes: the existing `COUNTRIES: Country[]` array in the same file.
- Produces:
  - `detectCountryFromFullNumber(raw: string): { dial: string; national: string } | null` — returns `null` unless `raw` (trimmed) starts with `+`; otherwise strips to digits and returns the longest dial code that prefixes the digits (with ≥1 national digit remaining), else `null`.

- [ ] **Step 1: Add the function**

Append to `src/data/countries.ts` (after the `COUNTRIES` array):

```typescript
// Unique dial codes, longest first — so "+1441" (Bermuda) is tried before "+1"
// (US/Canada). Computed once at module load, not per keystroke.
const DIALS_LONGEST_FIRST: string[] = [...new Set(COUNTRIES.map(c => c.dial))].sort(
  (a, b) => b.length - a.length,
)

/**
 * When the user pastes/enters a FULL international number (must start with "+"),
 * split it into { dial, national }. Returns null when there is no leading "+"
 * (so a plain national number is never mis-parsed) or no dial code prefixes it
 * with at least one national digit left over.
 */
export function detectCountryFromFullNumber(raw: string): { dial: string; national: string } | null {
  if (!raw.trim().startsWith('+')) return null
  const digits = raw.replace(/\D/g, '')
  if (!digits) return null
  for (const dial of DIALS_LONGEST_FIRST) {
    if (digits.startsWith(dial) && digits.length > dial.length) {
      return { dial, national: digits.slice(dial.length) }
    }
  }
  return null
}
```

- [ ] **Step 2: Typecheck**

Run: `cd /Users/amieva/Documents/Programming/Avoqado/avoqado-booking-widget && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Sanity-check the function's behavior (no test runner in this repo)**

Run this one-off node check (compiles the TS on the fly via the existing esbuild in node_modules is overkill; instead assert against the source with a tiny inline JS port to confirm the ALGORITHM, then rely on tsc for the real types):

```bash
cd /Users/amieva/Documents/Programming/Avoqado/avoqado-booking-widget && node -e '
const src = require("fs").readFileSync("src/data/countries.ts","utf8");
// crude: pull dial codes out of the source to simulate the match
const dials = [...new Set([...src.matchAll(/dial: \x27(\d+)\x27/g)].map(m=>m[1]))].sort((a,b)=>b.length-a.length);
function detect(raw){ if(!raw.trim().startsWith("+"))return null; const d=raw.replace(/\D/g,""); if(!d)return null; for(const dl of dials){ if(d.startsWith(dl)&&d.length>dl.length) return {dial:dl,national:d.slice(dl.length)};} return null;}
const cases = [
  ["+525512956265", {dial:"52",national:"5512956265"}],
  ["+52 55 1234 5678", {dial:"52",national:"5512345678"}],
  ["+14155551234", {dial:"1",national:"4155551234"}],
  ["+14411234567", {dial:"1441",national:"234567"}],
  ["5512956265", null],
  ["55 1234 5678", null],
  ["+52", null],
  ["", null],
];
let ok=true;
for(const [inp,exp] of cases){ const got=detect(inp); const g=JSON.stringify(got), e=JSON.stringify(exp); if(g!==e){ok=false; console.log("FAIL",inp,"got",g,"exp",e);} }
console.log(ok?"ALGORITHM OK":"ALGORITHM MISMATCH");
'
```
Expected: `ALGORITHM OK`. (This validates the matching logic; `tsc` validates the actual TypeScript.)

- [ ] **Step 4: Report (do NOT commit)**

Report status, the one file changed, tsc result, sanity-check result. Controller commits.

---

### Task 4: Wire smart-detect into the national-number input

**Files:**
- Modify: `src/components/ui/CountryPhoneInput.tsx` (imports + the `type="tel"` input's `onInput`)

**Interfaces:**
- Consumes: `detectCountryFromFullNumber` from `../../data/countries` (Task 3), the existing `onDialCodeChange`/`onNationalNumberChange` props.

- [ ] **Step 1: Add the import**

In `src/components/ui/CountryPhoneInput.tsx`, the existing import is:

```typescript
import { COUNTRIES, flagEmoji, type Country } from '../../data/countries'
```

Change it to also import the new function:

```typescript
import { COUNTRIES, flagEmoji, detectCountryFromFullNumber, type Country } from '../../data/countries'
```

- [ ] **Step 2: Update the national-number `onInput`**

Replace exactly this line (the `type="tel"` input's handler):

```typescript
          onInput={e => onNationalNumberChange((e.target as HTMLInputElement).value.replace(/\D/g, ''))}
```

with:

```typescript
          onInput={e => {
            const raw = (e.target as HTMLInputElement).value
            // Pasting a full "+<country><national>" number auto-selects the
            // country and keeps only the national digits. A paste fires this
            // same input event with the whole string, so no paste handler is
            // needed. Plain digit input (no leading "+") is unchanged.
            const detected = detectCountryFromFullNumber(raw)
            if (detected) {
              onDialCodeChange(detected.dial)
              onNationalNumberChange(detected.national)
            } else {
              onNationalNumberChange(raw.replace(/\D/g, ''))
            }
          }}
```

- [ ] **Step 3: Typecheck + build**

Run: `cd /Users/amieva/Documents/Programming/Avoqado/avoqado-booking-widget && npx tsc --noEmit && npm run build`
Expected: tsc exit 0; build emits `dist/widget.js`.

- [ ] **Step 4: Manual browser verification**

Ensure the widget dev server is running (`npm run dev` → http://localhost:5176; if not running, start it). Open `http://localhost:5176/` and use the `<avoqado-portal>` section (3). Drive it (Playwright MCP or by hand):
1. In the phone field, paste `+525512956265`. **Expected:** the dial button changes to `🇲🇽 +52`, and the national field shows `5512956265` (no `+`, no `52` prefix).
2. Clear, paste `+14155551234`. **Expected:** dial button shows `+1` (🇨🇦 or 🇺🇸 — either is fine, both share +1), national field shows `4155551234`.
3. Clear, type/paste `5512956265` (no `+`). **Expected:** dial button stays at whatever was selected (default `+52`), national field shows `5512956265` — i.e. UNCHANGED from today's behavior (regression check).

- [ ] **Step 5: Report (do NOT commit)**

Report status, the one file changed, tsc/build result, and the 3 manual-check outcomes. Controller commits.

---

## Out of scope (deferred at the user's explicit choice)

- Phone format validation on `/auth/otp/request` (the Menor). Not in this round.
- Scoping `OtpChallenge` by `venueId` (architectural note; needs a schema migration). Recorded in project memory `otp-challenge-not-venue-scoped.md`.

## Self-review notes

- Spec §1 (server SQL normalization) → Tasks 1 & 2 (otpAuth + reservation controller). Spec §2 (widget smart paste) → Tasks 3 & 4 (`detectCountryFromFullNumber` + wiring). Testing section → Task 1 integration test (real DB) + Task 2 suite guard + Task 4 manual browser.
- Type consistency: `detectCountryFromFullNumber(raw: string): { dial: string; national: string } | null` identical in Task 3 (definition) and Task 4 (consumption). `$queryRaw` row shapes match the `.find()`/`splitName` consumers left unchanged in both server tasks.
- No placeholders: every step has exact code/commands. The email branch stays EXACT match in Task 2 (constraint honored). Smart-detect gated on leading `+` in Task 3 (constraint honored).
