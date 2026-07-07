# WhatsApp OTP Login Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a searchable country-code dropdown and a shadcn-style 6-box OTP input to the widget's "Entrar con WhatsApp" login, fix the "Hola, null" greeting, and (server-side) backfill a returning customer's name from past guest bookings using canonical phone matching.

**Architecture:** Two repos. `avoqado-booking-widget` (Preact/IIFE, no test runner) gets a new country dataset, two new UI components, and wiring changes in `CustomerPortal.tsx`. `avoqado-server` (Express/Prisma/Jest) gets two small pure phone helpers, an OTP-login name backfill, and a canonical-match upgrade to the existing class-booking guest→customer auto-link. The OTP request/verify HTTP contract is unchanged, so the two repos deploy independently.

**Tech Stack:** Preact + `@preact/signals`, TypeScript, Vite (widget); Express, Prisma, `libphonenumber-js`, Jest (server).

## Global Constraints

- **Deploy order (workspace rule):** `avoqado-server` deploys first, then the widget. Both changes are backward-compatible, so either can ship alone without breaking the other.
- **Never remove or rename a field in an API response.** The OTP verify response (`AuthResponse`) shape is unchanged by this work.
- **Widget has no test framework** — do NOT add one. Widget verification = `npx tsc --noEmit` (must exit 0) + `npm run build` (must emit `dist/widget.js`) + manual `test.html`.
- **Widget CSS** is inline style objects / the shadow-root style string — no Tailwind plugin, no external UI library, keep the bundle small (this is why the widget must NOT import `libphonenumber-js`).
- **Server import alias:** `@/` → `src/`. Server phone canonicalization uses the EXISTING `normalizePhoneE164` from `@/utils/phone`.
- **Server tests:** `cd avoqado-server && npx jest <path>` for a single file. Unit tests live under `tests/unit/**`.
- **Widget dev server:** `npm run dev` → http://localhost:5176 ; manual page is `test.html` (open `http://localhost:5176/test.html`, never `file://`).
- **No tier gating needed:** this is polish + a bugfix on the existing (untiered) customer-portal login, not a new gated capability. No MCP or sales-deck change (API contract and customer-visible capabilities unchanged).

---

## File map

**avoqado-server:**
- Modify: `src/utils/phone.ts` — add `phoneLast10` + `phonesMatch` beside existing `normalizePhoneE164`.
- Modify test: `tests/unit/utils/phone.test.ts` — cover the two new helpers.
- Modify: `src/services/public/otpAuth.public.service.ts` — name backfill in `resolveIdentity`'s create-new-customer branch; local `splitName`.
- Modify test: `tests/unit/services/public/otpAuth.public.service.test.ts` — cover the backfill branch.
- Modify: `src/controllers/public/reservation.public.controller.ts` — canonical guest→customer auto-link (class path, ~line 1884).

**avoqado-booking-widget:**
- Create: `src/data/countries.ts` — country list (Mexico first) + `flagEmoji`.
- Create: `src/components/ui/CountryPhoneInput.tsx` — merged flag/dial-code + national-number field with searchable dropdown.
- Create: `src/components/ui/OtpInput.tsx` — 6-box segmented OTP input with auto-submit.
- Modify: `src/components/CustomerPortal.tsx` — wire both components; fix "Hola, null".
- Modify: `src/i18n/es.json`, `src/i18n/en.json` — country-search copy.

---

# PART A — avoqado-server (deploy first)

All commands in Part A run from `/Users/amieva/Documents/Programming/Avoqado/avoqado-server`.

### Task 1: Canonical phone helpers

**Files:**
- Modify: `src/utils/phone.ts`
- Test: `tests/unit/utils/phone.test.ts`

**Interfaces:**
- Consumes: existing `normalizePhoneE164(input: string): string | null` (already in this file).
- Produces:
  - `phoneLast10(input: string): string | null` — trailing 10 digits, or `null` if fewer than 10 digits present.
  - `phonesMatch(a: string | null | undefined, b: string | null | undefined): boolean` — `true` when both normalize to the same E.164 value; falls back to last-10-digit equality only when at least one side is not a parseable valid E.164 number; `false` if either input is empty.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/utils/phone.test.ts` (keep the existing `normalizePhoneE164` block):

```typescript
import { normalizePhoneE164, phoneLast10, phonesMatch } from '@/utils/phone'

describe('phoneLast10', () => {
  it('returns the last 10 digits, stripping formatting', () => {
    expect(phoneLast10('+52 55 1234 5678')).toBe('5512345678')
    expect(phoneLast10('(55) 1234-5678')).toBe('5512345678')
    expect(phoneLast10('+14155551234')).toBe('4155551234')
  })

  it('returns null when fewer than 10 digits', () => {
    expect(phoneLast10('12345')).toBeNull()
    expect(phoneLast10('')).toBeNull()
  })
})

describe('phonesMatch', () => {
  it('matches two formats of the same Mexican number', () => {
    expect(phonesMatch('+525512345678', '55 1234 5678')).toBe(true)
    expect(phonesMatch('5512345678', '+52 (55) 1234-5678')).toBe(true)
  })

  it('does not match different numbers', () => {
    expect(phonesMatch('+525512345678', '+525599999999')).toBe(false)
  })

  it('returns false when either side is empty', () => {
    expect(phonesMatch('+525512345678', '')).toBe(false)
    expect(phonesMatch(null, '+525512345678')).toBe(false)
    expect(phonesMatch(undefined, undefined)).toBe(false)
  })

  it('falls back to last-10 match when one side is not valid E.164', () => {
    // "5512345678xx" is unparseable; last-10 of both is 5512345678
    expect(phonesMatch('5512345678', '99-5512345678')).toBe(true)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/unit/utils/phone.test.ts`
Expected: FAIL — `phoneLast10`/`phonesMatch` are not exported.

- [ ] **Step 3: Implement the helpers**

Append to `src/utils/phone.ts` (below the existing `normalizePhoneE164`):

```typescript
// Trailing 10 digits of a phone string (national significant number for MX/US),
// used as a cheap, format-agnostic coarse filter before a canonical verify.
// Returns null when the input has fewer than 10 digits.
export function phoneLast10(input: string): string | null {
  const digits = (input ?? '').replace(/\D/g, '')
  return digits.length >= 10 ? digits.slice(-10) : null
}

// True when a and b are the same phone number. Prefers canonical E.164 equality
// (via normalizePhoneE164); when one side can't be parsed to a valid E.164
// number (messy historical/guest-typed data), falls back to comparing the last
// 10 digits. Returns false if either side is empty.
export function phonesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  const na = normalizePhoneE164(a)
  const nb = normalizePhoneE164(b)
  if (na && nb) return na === nb
  const la = phoneLast10(a)
  const lb = phoneLast10(b)
  return !!la && la === lb
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/unit/utils/phone.test.ts`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add src/utils/phone.ts tests/unit/utils/phone.test.ts
git commit -m "feat(phone): add phoneLast10 + phonesMatch canonical matchers"
```

---

### Task 2: Backfill customer name on first WhatsApp login

**Files:**
- Modify: `src/services/public/otpAuth.public.service.ts`
- Test: `tests/unit/services/public/otpAuth.public.service.test.ts`

**Interfaces:**
- Consumes: `phonesMatch` from `@/utils/phone` (Task 1).
- Produces: no new exports. `resolveIdentity` (already private) now seeds `firstName`/`lastName` on the customer it creates when a past guest reservation on the same phone/email carries a `guestName`.

**Behavior contract (what the test pins):** When `resolveIdentity` creates a brand-new `Customer` for a phone that has a prior `Reservation` with a non-null `guestName`, the new customer's `firstName` (and `lastName`, if the name has 2+ words) are seeded from the most recent such reservation. When there is no prior named reservation, the customer is created exactly as before (`firstName`/`lastName` unset). Existing customers are never modified by this path.

- [ ] **Step 1: Read the current file to anchor the edit**

Run: `sed -n '1,10p;72,94p' src/services/public/otpAuth.public.service.ts`
Confirm the imports block and the `resolveIdentity` function match what this task edits.

- [ ] **Step 2: Write the failing test**

Create/extend `tests/unit/services/public/otpAuth.public.service.test.ts`. If the file already has a test harness, add this `describe` block; otherwise create the file with it. This test mocks Prisma so it runs as a unit test.

```typescript
import { verifyOtp } from '@/services/public/otpAuth.public.service'

// ---- Prisma mock ----
const mockPrisma = {
  otpChallenge: {
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  consumer: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
  },
  customer: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  reservation: {
    findFirst: jest.fn(),
  },
}

jest.mock('@/utils/prismaClient', () => ({ __esModule: true, default: mockPrisma }))
jest.mock('@/services/whatsapp.service', () => ({ sendOtpWhatsApp: jest.fn() }))
jest.mock('@/services/email.service', () => ({ __esModule: true, default: { sendOtpCodeEmail: jest.fn() } }))
jest.mock('@/jwt.service', () => ({ generateCustomerToken: () => 'test-token' }))
jest.mock('@/lib/otp', () => ({
  generateOtpCode: () => '123456',
  hashOtpCode: (c: string) => `hash:${c}`,
  normalizeEmail: (e: string) => e.trim().toLowerCase(),
}))

describe('verifyOtp — name backfill on new customer', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // Valid, unconsumed, matching challenge
    mockPrisma.otpChallenge.findFirst.mockResolvedValue({
      id: 'ch1', destination: '+525512345678', consumedAt: null,
      expiresAt: new Date(Date.now() + 60_000), attempts: 0, maxAttempts: 5,
      codeHash: 'hash:123456',
    })
    mockPrisma.otpChallenge.update.mockResolvedValue({})
    // No existing Consumer or Customer → create paths
    mockPrisma.consumer.findMany.mockResolvedValue([])
    mockPrisma.consumer.create.mockResolvedValue({ id: 'cons1' })
    mockPrisma.customer.findUnique.mockResolvedValue(null)
    mockPrisma.customer.findFirst.mockResolvedValue(null)
  })

  it('seeds firstName/lastName from the most recent past guest reservation', async () => {
    mockPrisma.reservation.findFirst.mockResolvedValue({ guestName: 'Juan Pérez López', guestPhone: '5512345678' })
    mockPrisma.customer.create.mockImplementation(({ data }: any) =>
      Promise.resolve({ id: 'cust1', firstName: data.firstName ?? null, lastName: data.lastName ?? null, email: null, phone: data.phone ?? null }),
    )

    const res = await verifyOtp({ venueId: 'v1', channel: 'whatsapp', destination: '+525512345678', code: '123456' })

    expect(mockPrisma.customer.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ firstName: 'Juan', lastName: 'Pérez López' }) }),
    )
    expect(res.customer.firstName).toBe('Juan')
  })

  it('creates a nameless customer when no past named reservation exists', async () => {
    mockPrisma.reservation.findFirst.mockResolvedValue(null)
    mockPrisma.customer.create.mockImplementation(({ data }: any) =>
      Promise.resolve({ id: 'cust1', firstName: data.firstName ?? null, lastName: data.lastName ?? null, email: null, phone: data.phone ?? null }),
    )

    const res = await verifyOtp({ venueId: 'v1', channel: 'whatsapp', destination: '+525512345678', code: '123456' })

    expect(res.customer.firstName).toBeNull()
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx jest tests/unit/services/public/otpAuth.public.service.test.ts`
Expected: FAIL — either `reservation.findFirst` is never called (backfill not implemented) or the `customer.create` assertion fails because `firstName`/`lastName` aren't seeded.

- [ ] **Step 4: Implement the backfill**

In `src/services/public/otpAuth.public.service.ts`:

(a) Add the import at the top (near the other imports):

```typescript
import { phonesMatch, phoneLast10 } from '@/utils/phone'
```

(b) Add a local `splitName` helper just above `resolveIdentity`:

```typescript
// First word → firstName, remaining words → lastName. Mirrors the split used in
// auth.consumer.service.ts (kept local to avoid a cross-bounded-context import).
function splitName(name?: string | null): { firstName?: string; lastName?: string } {
  if (!name) return {}
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return {}
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') || undefined }
}

// Look up a name from this identity's most recent past guest reservation, so a
// returning guest who booked without ever registering doesn't land on a blank
// "Hola" after their first WhatsApp login. Matching is canonical (phonesMatch)
// for phone; exact for email. Bounded to the venue + a small recent window.
async function findGuestNameFromPastReservations(
  venueId: string,
  key: { phone?: string; email?: string },
): Promise<{ firstName?: string; lastName?: string }> {
  if (key.email) {
    const r = await prisma.reservation.findFirst({
      where: { venueId, guestEmail: key.email, guestName: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { guestName: true },
    })
    return splitName(r?.guestName)
  }
  if (key.phone) {
    const last10 = phoneLast10(key.phone)
    if (!last10) return {}
    // Coarse prefilter by trailing 10 digits (format-agnostic), newest first,
    // then canonical-verify in JS to drop false positives.
    const candidates = await prisma.reservation.findMany({
      where: { venueId, guestName: { not: null }, guestPhone: { endsWith: last10 } },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { guestName: true, guestPhone: true },
    })
    const match = candidates.find(c => phonesMatch(c.guestPhone, key.phone))
    return splitName(match?.guestName)
  }
  return {}
}
```

(c) In `resolveIdentity`, change ONLY the `customer.create` in the "not found" branch to seed the name. Replace:

```typescript
  if (!customer) {
    customer = await prisma.customer.create({
      data: { venueId, consumerId: consumer.id, provider: 'PHONE', ...(key.phone ? { phone: key.phone } : { email: key.email }) },
    })
  } else if (!customer.consumerId) {
```

with:

```typescript
  if (!customer) {
    const seededName = await findGuestNameFromPastReservations(venueId, key)
    customer = await prisma.customer.create({
      data: {
        venueId,
        consumerId: consumer.id,
        provider: 'PHONE',
        ...(key.phone ? { phone: key.phone } : { email: key.email }),
        ...(seededName.firstName ? { firstName: seededName.firstName } : {}),
        ...(seededName.lastName ? { lastName: seededName.lastName } : {}),
      },
    })
  } else if (!customer.consumerId) {
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx jest tests/unit/services/public/otpAuth.public.service.test.ts`
Expected: PASS (both cases).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0 (no type errors introduced).

- [ ] **Step 7: Commit**

```bash
git add src/services/public/otpAuth.public.service.ts tests/unit/services/public/otpAuth.public.service.test.ts
git commit -m "feat(otp): backfill customer name from past guest bookings on first WhatsApp login"
```

---

### Task 3: Canonical guest→customer auto-link (class booking)

**Files:**
- Modify: `src/controllers/public/reservation.public.controller.ts` (the `matchedCustomer` block, ~lines 1884–1893)

**Interfaces:**
- Consumes: `phonesMatch`, `phoneLast10` from `@/utils/phone` (Task 1).
- Produces: no new exports. The class-booking reservation now links to an existing `Customer` when the guest phone matches **canonically** (formatting-independent), not just byte-for-byte, plus the existing exact-email match.

**Note:** This is a controller-internal change inside a Serializable transaction; the codebase has no unit test around this block and adding one would require heavy Prisma-transaction mocking out of proportion to the change. The matching logic itself (`phonesMatch`) is unit-tested in Task 1. Verification here is typecheck + build + the existing public test suite + a manual reasoning check.

- [ ] **Step 1: Confirm the exact current block**

Run: `sed -n '1881,1894p' src/controllers/public/reservation.public.controller.ts`
Expected to show the `matchedCustomer = body.guestEmail || body.guestPhone ? await tx.customer.findFirst({ where: { venueId, OR: [...] } }) : null` block.

- [ ] **Step 2: Add the phone-util import**

At the top of the file, confirm whether `@/utils/phone` (or a relative path) is already imported. This file uses relative imports (e.g. `'../../services/...'`). Add near the other imports:

```typescript
import { phonesMatch, phoneLast10 } from '../../utils/phone'
```

- [ ] **Step 3: Replace the auto-link block with canonical matching**

Replace:

```typescript
    const matchedCustomer =
      body.guestEmail || body.guestPhone
        ? await tx.customer.findFirst({
            where: {
              venueId,
              OR: [...(body.guestEmail ? [{ email: body.guestEmail }] : []), ...(body.guestPhone ? [{ phone: body.guestPhone }] : [])],
            },
            select: { id: true },
          })
        : null
```

with:

```typescript
    // Auto-link matching: exact email OR canonical phone. Phone is matched
    // format-independently — coarse-prefilter existing customers by the trailing
    // 10 digits, then canonical-verify with phonesMatch — because guest-typed and
    // stored phone strings aren't consistently normalized across write paths.
    const phoneLast10Digits = body.guestPhone ? phoneLast10(body.guestPhone) : null
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
    const matchedCustomer =
      matchCandidates.find(c => (body.guestEmail && c.email === body.guestEmail) || phonesMatch(c.phone, body.guestPhone)) ?? null
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: Run the public test suite (regression guard)**

Run: `npx jest tests/unit/controllers/public`
Expected: PASS (no regressions; this block has no dedicated test but the suite must stay green).

- [ ] **Step 6: Commit**

```bash
git add src/controllers/public/reservation.public.controller.ts
git commit -m "fix(reservation): canonical phone matching for guest->customer auto-link"
```

---

# PART B — avoqado-booking-widget (deploy after server)

All commands in Part B run from `/Users/amieva/Documents/Programming/Avoqado/avoqado-booking-widget`.

### Task 4: Country dataset + flag helper

**Files:**
- Create: `src/data/countries.ts`

**Interfaces:**
- Produces:
  - `interface Country { iso2: string; name: string; dial: string }`
  - `const COUNTRIES: Country[]` — Mexico first, then alphabetical by Spanish name.
  - `flagEmoji(iso2: string): string` — regional-indicator flag from an ISO-3166 alpha-2 code.
  - `DEFAULT_DIAL = '52'`

- [ ] **Step 1: Create the file**

Create `src/data/countries.ts` with the exact content:

```typescript
export interface Country {
  iso2: string
  name: string
  dial: string
}

/** Default dial code — Mexico, the core market. */
export const DEFAULT_DIAL = '52'

/** ISO-3166 alpha-2 → flag emoji via regional-indicator symbols. */
export function flagEmoji(iso2: string): string {
  return iso2
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .replace(/./g, c => String.fromCodePoint(127397 + c.charCodeAt(0)))
}

// Mexico pinned first (core market); the rest alphabetical by Spanish name.
export const COUNTRIES: Country[] = [
  { iso2: 'MX', name: 'México', dial: '52' },
  { iso2: 'AF', name: 'Afganistán', dial: '93' },
  { iso2: 'AL', name: 'Albania', dial: '355' },
  { iso2: 'DE', name: 'Alemania', dial: '49' },
  { iso2: 'AD', name: 'Andorra', dial: '376' },
  { iso2: 'AO', name: 'Angola', dial: '244' },
  { iso2: 'AI', name: 'Anguila', dial: '1264' },
  { iso2: 'AG', name: 'Antigua y Barbuda', dial: '1268' },
  { iso2: 'SA', name: 'Arabia Saudita', dial: '966' },
  { iso2: 'DZ', name: 'Argelia', dial: '213' },
  { iso2: 'AR', name: 'Argentina', dial: '54' },
  { iso2: 'AM', name: 'Armenia', dial: '374' },
  { iso2: 'AW', name: 'Aruba', dial: '297' },
  { iso2: 'AU', name: 'Australia', dial: '61' },
  { iso2: 'AT', name: 'Austria', dial: '43' },
  { iso2: 'AZ', name: 'Azerbaiyán', dial: '994' },
  { iso2: 'BS', name: 'Bahamas', dial: '1242' },
  { iso2: 'BH', name: 'Baréin', dial: '973' },
  { iso2: 'BD', name: 'Bangladés', dial: '880' },
  { iso2: 'BB', name: 'Barbados', dial: '1246' },
  { iso2: 'BE', name: 'Bélgica', dial: '32' },
  { iso2: 'BZ', name: 'Belice', dial: '501' },
  { iso2: 'BJ', name: 'Benín', dial: '229' },
  { iso2: 'BM', name: 'Bermudas', dial: '1441' },
  { iso2: 'BY', name: 'Bielorrusia', dial: '375' },
  { iso2: 'BO', name: 'Bolivia', dial: '591' },
  { iso2: 'BA', name: 'Bosnia y Herzegovina', dial: '387' },
  { iso2: 'BW', name: 'Botsuana', dial: '267' },
  { iso2: 'BR', name: 'Brasil', dial: '55' },
  { iso2: 'BN', name: 'Brunéi', dial: '673' },
  { iso2: 'BG', name: 'Bulgaria', dial: '359' },
  { iso2: 'BF', name: 'Burkina Faso', dial: '226' },
  { iso2: 'BI', name: 'Burundi', dial: '257' },
  { iso2: 'BT', name: 'Bután', dial: '975' },
  { iso2: 'CV', name: 'Cabo Verde', dial: '238' },
  { iso2: 'KH', name: 'Camboya', dial: '855' },
  { iso2: 'CM', name: 'Camerún', dial: '237' },
  { iso2: 'CA', name: 'Canadá', dial: '1' },
  { iso2: 'QA', name: 'Catar', dial: '974' },
  { iso2: 'TD', name: 'Chad', dial: '235' },
  { iso2: 'CL', name: 'Chile', dial: '56' },
  { iso2: 'CN', name: 'China', dial: '86' },
  { iso2: 'CY', name: 'Chipre', dial: '357' },
  { iso2: 'CO', name: 'Colombia', dial: '57' },
  { iso2: 'KM', name: 'Comoras', dial: '269' },
  { iso2: 'CG', name: 'Congo', dial: '242' },
  { iso2: 'CD', name: 'Congo (RD)', dial: '243' },
  { iso2: 'KP', name: 'Corea del Norte', dial: '850' },
  { iso2: 'KR', name: 'Corea del Sur', dial: '82' },
  { iso2: 'CI', name: 'Costa de Marfil', dial: '225' },
  { iso2: 'CR', name: 'Costa Rica', dial: '506' },
  { iso2: 'HR', name: 'Croacia', dial: '385' },
  { iso2: 'CU', name: 'Cuba', dial: '53' },
  { iso2: 'CW', name: 'Curazao', dial: '599' },
  { iso2: 'DK', name: 'Dinamarca', dial: '45' },
  { iso2: 'DM', name: 'Dominica', dial: '1767' },
  { iso2: 'EC', name: 'Ecuador', dial: '593' },
  { iso2: 'EG', name: 'Egipto', dial: '20' },
  { iso2: 'SV', name: 'El Salvador', dial: '503' },
  { iso2: 'AE', name: 'Emiratos Árabes Unidos', dial: '971' },
  { iso2: 'ER', name: 'Eritrea', dial: '291' },
  { iso2: 'SK', name: 'Eslovaquia', dial: '421' },
  { iso2: 'SI', name: 'Eslovenia', dial: '386' },
  { iso2: 'ES', name: 'España', dial: '34' },
  { iso2: 'US', name: 'Estados Unidos', dial: '1' },
  { iso2: 'EE', name: 'Estonia', dial: '372' },
  { iso2: 'ET', name: 'Etiopía', dial: '251' },
  { iso2: 'PH', name: 'Filipinas', dial: '63' },
  { iso2: 'FI', name: 'Finlandia', dial: '358' },
  { iso2: 'FJ', name: 'Fiyi', dial: '679' },
  { iso2: 'FR', name: 'Francia', dial: '33' },
  { iso2: 'GA', name: 'Gabón', dial: '241' },
  { iso2: 'GM', name: 'Gambia', dial: '220' },
  { iso2: 'GE', name: 'Georgia', dial: '995' },
  { iso2: 'GH', name: 'Ghana', dial: '233' },
  { iso2: 'GI', name: 'Gibraltar', dial: '350' },
  { iso2: 'GD', name: 'Granada', dial: '1473' },
  { iso2: 'GR', name: 'Grecia', dial: '30' },
  { iso2: 'GL', name: 'Groenlandia', dial: '299' },
  { iso2: 'GP', name: 'Guadalupe', dial: '590' },
  { iso2: 'GU', name: 'Guam', dial: '1671' },
  { iso2: 'GT', name: 'Guatemala', dial: '502' },
  { iso2: 'GF', name: 'Guayana Francesa', dial: '594' },
  { iso2: 'GG', name: 'Guernsey', dial: '44' },
  { iso2: 'GN', name: 'Guinea', dial: '224' },
  { iso2: 'GQ', name: 'Guinea Ecuatorial', dial: '240' },
  { iso2: 'GW', name: 'Guinea-Bisáu', dial: '245' },
  { iso2: 'GY', name: 'Guyana', dial: '592' },
  { iso2: 'HT', name: 'Haití', dial: '509' },
  { iso2: 'HN', name: 'Honduras', dial: '504' },
  { iso2: 'HK', name: 'Hong Kong', dial: '852' },
  { iso2: 'HU', name: 'Hungría', dial: '36' },
  { iso2: 'IN', name: 'India', dial: '91' },
  { iso2: 'ID', name: 'Indonesia', dial: '62' },
  { iso2: 'IQ', name: 'Irak', dial: '964' },
  { iso2: 'IR', name: 'Irán', dial: '98' },
  { iso2: 'IE', name: 'Irlanda', dial: '353' },
  { iso2: 'IS', name: 'Islandia', dial: '354' },
  { iso2: 'KY', name: 'Islas Caimán', dial: '1345' },
  { iso2: 'VG', name: 'Islas Vírgenes Británicas', dial: '1284' },
  { iso2: 'VI', name: 'Islas Vírgenes de EE. UU.', dial: '1340' },
  { iso2: 'IL', name: 'Israel', dial: '972' },
  { iso2: 'IT', name: 'Italia', dial: '39' },
  { iso2: 'JM', name: 'Jamaica', dial: '1876' },
  { iso2: 'JP', name: 'Japón', dial: '81' },
  { iso2: 'JE', name: 'Jersey', dial: '44' },
  { iso2: 'JO', name: 'Jordania', dial: '962' },
  { iso2: 'KZ', name: 'Kazajistán', dial: '7' },
  { iso2: 'KE', name: 'Kenia', dial: '254' },
  { iso2: 'KG', name: 'Kirguistán', dial: '996' },
  { iso2: 'KI', name: 'Kiribati', dial: '686' },
  { iso2: 'KW', name: 'Kuwait', dial: '965' },
  { iso2: 'LA', name: 'Laos', dial: '856' },
  { iso2: 'LS', name: 'Lesoto', dial: '266' },
  { iso2: 'LV', name: 'Letonia', dial: '371' },
  { iso2: 'LB', name: 'Líbano', dial: '961' },
  { iso2: 'LR', name: 'Liberia', dial: '231' },
  { iso2: 'LY', name: 'Libia', dial: '218' },
  { iso2: 'LI', name: 'Liechtenstein', dial: '423' },
  { iso2: 'LT', name: 'Lituania', dial: '370' },
  { iso2: 'LU', name: 'Luxemburgo', dial: '352' },
  { iso2: 'MO', name: 'Macao', dial: '853' },
  { iso2: 'MK', name: 'Macedonia del Norte', dial: '389' },
  { iso2: 'MG', name: 'Madagascar', dial: '261' },
  { iso2: 'MY', name: 'Malasia', dial: '60' },
  { iso2: 'MW', name: 'Malaui', dial: '265' },
  { iso2: 'MV', name: 'Maldivas', dial: '960' },
  { iso2: 'ML', name: 'Malí', dial: '223' },
  { iso2: 'MT', name: 'Malta', dial: '356' },
  { iso2: 'MA', name: 'Marruecos', dial: '212' },
  { iso2: 'MQ', name: 'Martinica', dial: '596' },
  { iso2: 'MU', name: 'Mauricio', dial: '230' },
  { iso2: 'MR', name: 'Mauritania', dial: '222' },
  { iso2: 'FM', name: 'Micronesia', dial: '691' },
  { iso2: 'MD', name: 'Moldavia', dial: '373' },
  { iso2: 'MC', name: 'Mónaco', dial: '377' },
  { iso2: 'MN', name: 'Mongolia', dial: '976' },
  { iso2: 'ME', name: 'Montenegro', dial: '382' },
  { iso2: 'MS', name: 'Montserrat', dial: '1664' },
  { iso2: 'MZ', name: 'Mozambique', dial: '258' },
  { iso2: 'MM', name: 'Myanmar', dial: '95' },
  { iso2: 'NA', name: 'Namibia', dial: '264' },
  { iso2: 'NR', name: 'Nauru', dial: '674' },
  { iso2: 'NP', name: 'Nepal', dial: '977' },
  { iso2: 'NI', name: 'Nicaragua', dial: '505' },
  { iso2: 'NE', name: 'Níger', dial: '227' },
  { iso2: 'NG', name: 'Nigeria', dial: '234' },
  { iso2: 'NO', name: 'Noruega', dial: '47' },
  { iso2: 'NC', name: 'Nueva Caledonia', dial: '687' },
  { iso2: 'NZ', name: 'Nueva Zelanda', dial: '64' },
  { iso2: 'OM', name: 'Omán', dial: '968' },
  { iso2: 'NL', name: 'Países Bajos', dial: '31' },
  { iso2: 'PK', name: 'Pakistán', dial: '92' },
  { iso2: 'PW', name: 'Palaos', dial: '680' },
  { iso2: 'PS', name: 'Palestina', dial: '970' },
  { iso2: 'PA', name: 'Panamá', dial: '507' },
  { iso2: 'PG', name: 'Papúa Nueva Guinea', dial: '675' },
  { iso2: 'PY', name: 'Paraguay', dial: '595' },
  { iso2: 'PE', name: 'Perú', dial: '51' },
  { iso2: 'PF', name: 'Polinesia Francesa', dial: '689' },
  { iso2: 'PL', name: 'Polonia', dial: '48' },
  { iso2: 'PT', name: 'Portugal', dial: '351' },
  { iso2: 'PR', name: 'Puerto Rico', dial: '1787' },
  { iso2: 'GB', name: 'Reino Unido', dial: '44' },
  { iso2: 'CF', name: 'República Centroafricana', dial: '236' },
  { iso2: 'CZ', name: 'República Checa', dial: '420' },
  { iso2: 'DO', name: 'República Dominicana', dial: '1809' },
  { iso2: 'RE', name: 'Reunión', dial: '262' },
  { iso2: 'RW', name: 'Ruanda', dial: '250' },
  { iso2: 'RO', name: 'Rumanía', dial: '40' },
  { iso2: 'RU', name: 'Rusia', dial: '7' },
  { iso2: 'WS', name: 'Samoa', dial: '685' },
  { iso2: 'AS', name: 'Samoa Americana', dial: '1684' },
  { iso2: 'KN', name: 'San Cristóbal y Nieves', dial: '1869' },
  { iso2: 'SM', name: 'San Marino', dial: '378' },
  { iso2: 'VC', name: 'San Vicente y las Granadinas', dial: '1784' },
  { iso2: 'LC', name: 'Santa Lucía', dial: '1758' },
  { iso2: 'ST', name: 'Santo Tomé y Príncipe', dial: '239' },
  { iso2: 'SN', name: 'Senegal', dial: '221' },
  { iso2: 'RS', name: 'Serbia', dial: '381' },
  { iso2: 'SC', name: 'Seychelles', dial: '248' },
  { iso2: 'SL', name: 'Sierra Leona', dial: '232' },
  { iso2: 'SG', name: 'Singapur', dial: '65' },
  { iso2: 'SY', name: 'Siria', dial: '963' },
  { iso2: 'SO', name: 'Somalia', dial: '252' },
  { iso2: 'LK', name: 'Sri Lanka', dial: '94' },
  { iso2: 'SZ', name: 'Suazilandia', dial: '268' },
  { iso2: 'ZA', name: 'Sudáfrica', dial: '27' },
  { iso2: 'SD', name: 'Sudán', dial: '249' },
  { iso2: 'SS', name: 'Sudán del Sur', dial: '211' },
  { iso2: 'SE', name: 'Suecia', dial: '46' },
  { iso2: 'CH', name: 'Suiza', dial: '41' },
  { iso2: 'SR', name: 'Surinam', dial: '597' },
  { iso2: 'TH', name: 'Tailandia', dial: '66' },
  { iso2: 'TW', name: 'Taiwán', dial: '886' },
  { iso2: 'TZ', name: 'Tanzania', dial: '255' },
  { iso2: 'TJ', name: 'Tayikistán', dial: '992' },
  { iso2: 'TL', name: 'Timor Oriental', dial: '670' },
  { iso2: 'TG', name: 'Togo', dial: '228' },
  { iso2: 'TO', name: 'Tonga', dial: '676' },
  { iso2: 'TT', name: 'Trinidad y Tobago', dial: '1868' },
  { iso2: 'TN', name: 'Túnez', dial: '216' },
  { iso2: 'TM', name: 'Turkmenistán', dial: '993' },
  { iso2: 'TR', name: 'Turquía', dial: '90' },
  { iso2: 'TV', name: 'Tuvalu', dial: '688' },
  { iso2: 'UA', name: 'Ucrania', dial: '380' },
  { iso2: 'UG', name: 'Uganda', dial: '256' },
  { iso2: 'UY', name: 'Uruguay', dial: '598' },
  { iso2: 'UZ', name: 'Uzbekistán', dial: '998' },
  { iso2: 'VU', name: 'Vanuatu', dial: '678' },
  { iso2: 'VA', name: 'Vaticano', dial: '379' },
  { iso2: 'VE', name: 'Venezuela', dial: '58' },
  { iso2: 'VN', name: 'Vietnam', dial: '84' },
  { iso2: 'YE', name: 'Yemen', dial: '967' },
  { iso2: 'DJ', name: 'Yibuti', dial: '253' },
  { iso2: 'ZM', name: 'Zambia', dial: '260' },
  { iso2: 'ZW', name: 'Zimbabue', dial: '263' },
]
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Sanity-check the data at build time**

Run:
```bash
node -e "const {execSync}=require('child_process'); const src=require('fs').readFileSync('src/data/countries.ts','utf8'); const n=(src.match(/iso2:/g)||[]).length; if(n<190){console.error('too few countries:',n);process.exit(1)} if(!src.includes(\"iso2: 'MX'\")){console.error('MX missing');process.exit(1)} console.log('countries ok:',n)"
```
Expected: prints `countries ok: <n>` with n ≥ 190.

- [ ] **Step 4: Commit**

```bash
git add src/data/countries.ts
git commit -m "feat(widget): add country dial-code dataset + flag helper"
```

---

### Task 5: CountryPhoneInput component

**Files:**
- Create: `src/components/ui/CountryPhoneInput.tsx`

**Interfaces:**
- Consumes: `COUNTRIES`, `flagEmoji`, `type Country` from `../../data/countries` (Task 4).
- Produces:

```typescript
interface CountryPhoneInputProps {
  dialCode: string
  nationalNumber: string
  onDialCodeChange: (dial: string) => void
  onNationalNumberChange: (num: string) => void
  numberPlaceholder: string
  searchPlaceholder: string
  noResultsText: string
}
export function CountryPhoneInput(props: CountryPhoneInputProps): JSX.Element
```

- [ ] **Step 1: Create the component**

Create `src/components/ui/CountryPhoneInput.tsx`:

```tsx
import { h } from 'preact'
import { useState, useRef, useEffect, useMemo } from 'preact/hooks'
import { COUNTRIES, flagEmoji, type Country } from '../../data/countries'

interface CountryPhoneInputProps {
  dialCode: string
  nationalNumber: string
  onDialCodeChange: (dial: string) => void
  onNationalNumberChange: (num: string) => void
  numberPlaceholder: string
  searchPlaceholder: string
  noResultsText: string
}

export function CountryPhoneInput({
  dialCode, nationalNumber, onDialCodeChange, onNationalNumberChange,
  numberPlaceholder, searchPlaceholder, noResultsText,
}: CountryPhoneInputProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [focused, setFocused] = useState(false)

  // First country whose dial matches, for the flag shown on the button.
  const selected: Country =
    COUNTRIES.find(c => c.dial === dialCode) ?? COUNTRIES[0]

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return COUNTRIES
    return COUNTRIES.filter(
      c => c.name.toLowerCase().includes(q) || c.dial.includes(q.replace(/\D/g, '')),
    )
  }, [query])

  // Close on outside click. composedPath() is required because this renders
  // inside the widget's Shadow DOM, where event.target retargets to the host.
  useEffect(() => {
    if (!open) return
    function onDocMouseDown(e: MouseEvent) {
      const path = e.composedPath()
      if (rootRef.current && !path.includes(rootRef.current)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [open])

  // Focus the search box when the panel opens.
  useEffect(() => {
    if (open) {
      setQuery('')
      setHighlight(0)
      // defer so the input exists
      setTimeout(() => searchRef.current?.focus(), 0)
    }
  }, [open])

  function choose(c: Country) {
    onDialCodeChange(c.dial)
    setOpen(false)
  }

  function onSearchKeyDown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(h + 1, filtered.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (filtered[highlight]) choose(filtered[highlight]) }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false) }
  }

  const borderColor = focused ? 'var(--avq-accent, #6366f1)' : 'var(--avq-border, #e8eaed)'

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <div style={{
        display: 'flex', alignItems: 'stretch', height: '46px',
        borderRadius: '12px', border: `1.5px solid ${borderColor}`,
        background: 'var(--avq-bg, #ffffff)', overflow: 'hidden',
        transition: 'border-color 0.2s ease',
      }}>
        {/* Dial-code button */}
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            padding: '0 10px', border: 'none',
            borderRight: '1.5px solid var(--avq-border, #e8eaed)',
            background: 'var(--avq-muted, #f8f9fb)', cursor: 'pointer',
            fontSize: '15px', color: 'var(--avq-fg, #111827)', whiteSpace: 'nowrap',
          }}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <span style={{ fontSize: '18px', lineHeight: 1 }}>{flagEmoji(selected.iso2)}</span>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>+{dialCode}</span>
          <span style={{ fontSize: '10px', opacity: 0.6 }}>▾</span>
        </button>
        {/* National number */}
        <input
          type="tel"
          inputMode="numeric"
          value={nationalNumber}
          placeholder={numberPlaceholder}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onInput={e => onNationalNumberChange((e.target as HTMLInputElement).value.replace(/\D/g, ''))}
          style={{
            flex: 1, minWidth: 0, border: 'none', outline: 'none',
            padding: '0 14px', fontSize: '15px',
            background: 'transparent', color: 'var(--avq-fg, #111827)',
          }}
        />
      </div>

      {open && (
        <div
          role="listbox"
          style={{
            position: 'absolute', zIndex: 50, top: 'calc(100% + 4px)', left: 0, right: 0,
            background: 'var(--avq-bg, #ffffff)',
            border: '1.5px solid var(--avq-border, #e8eaed)', borderRadius: '12px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)', overflow: 'hidden',
          }}
        >
          <div style={{ padding: '8px', borderBottom: '1px solid var(--avq-border, #e8eaed)' }}>
            <input
              ref={searchRef}
              type="text"
              value={query}
              placeholder={searchPlaceholder}
              onInput={e => { setQuery((e.target as HTMLInputElement).value); setHighlight(0) }}
              onKeyDown={onSearchKeyDown}
              style={{
                width: '100%', height: '38px', borderRadius: '8px',
                border: '1.5px solid var(--avq-border, #e8eaed)', outline: 'none',
                padding: '0 12px', fontSize: '14px', boxSizing: 'border-box',
                background: 'var(--avq-bg, #ffffff)', color: 'var(--avq-fg, #111827)',
              }}
            />
          </div>
          <div style={{ maxHeight: '240px', overflowY: 'auto' }}>
            {filtered.length === 0 ? (
              <div style={{ padding: '16px', textAlign: 'center', fontSize: '13px', color: 'var(--avq-muted-fg, #6b7280)' }}>
                {noResultsText}
              </div>
            ) : (
              filtered.map((c, i) => (
                <button
                  key={c.iso2}
                  type="button"
                  role="option"
                  aria-selected={c.dial === dialCode}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => choose(c)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '10px', width: '100%',
                    padding: '9px 12px', border: 'none', cursor: 'pointer', textAlign: 'left',
                    background: i === highlight ? 'var(--avq-muted, #f8f9fb)' : 'transparent',
                    fontSize: '14px', color: 'var(--avq-fg, #111827)',
                  }}
                >
                  <span style={{ fontSize: '18px', lineHeight: 1 }}>{flagEmoji(c.iso2)}</span>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                  <span style={{ color: 'var(--avq-muted-fg, #6b7280)', fontVariantNumeric: 'tabular-nums' }}>+{c.dial}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: completes, emits `dist/widget.js`.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/CountryPhoneInput.tsx
git commit -m "feat(widget): add CountryPhoneInput with searchable dial-code dropdown"
```

---

### Task 6: OtpInput component (6 boxes, auto-submit)

**Files:**
- Create: `src/components/ui/OtpInput.tsx`

**Interfaces:**
- Produces:

```typescript
interface OtpInputProps {
  value: string                       // current code, 0..6 digits
  onChange: (code: string) => void
  onComplete: (code: string) => void  // fired once when the 6th digit lands
  disabled?: boolean
  length?: number                     // default 6
}
export function OtpInput(props: OtpInputProps): JSX.Element
```

- [ ] **Step 1: Create the component**

Create `src/components/ui/OtpInput.tsx`:

```tsx
import { h } from 'preact'
import { useRef } from 'preact/hooks'

interface OtpInputProps {
  value: string
  onChange: (code: string) => void
  onComplete: (code: string) => void
  disabled?: boolean
  length?: number
}

export function OtpInput({ value, onChange, onComplete, disabled, length = 6 }: OtpInputProps) {
  const refs = useRef<(HTMLInputElement | null)[]>([])
  const digits = value.split('').slice(0, length)

  function emit(next: string) {
    const clean = next.replace(/\D/g, '').slice(0, length)
    onChange(clean)
    if (clean.length === length) onComplete(clean)
  }

  function setAt(i: number, d: string) {
    const arr = value.split('')
    arr[i] = d
    // rebuild compactly so we never leave holes
    const rebuilt = arr.join('').replace(/\D/g, '').slice(0, length)
    emit(rebuilt)
    if (d && i < length - 1) refs.current[i + 1]?.focus()
  }

  function onInput(i: number, e: Event) {
    const raw = (e.target as HTMLInputElement).value.replace(/\D/g, '')
    if (!raw) { setAt(i, ''); return }
    if (raw.length > 1) {
      // pasted / multiple chars typed into one box → distribute from i
      const merged = (value.slice(0, i) + raw).replace(/\D/g, '').slice(0, length)
      emit(merged)
      const nextIdx = Math.min(merged.length, length - 1)
      refs.current[nextIdx]?.focus()
      return
    }
    setAt(i, raw)
  }

  function onKeyDown(i: number, e: KeyboardEvent) {
    if (e.key === 'Backspace') {
      if (digits[i]) { setAt(i, '') }
      else if (i > 0) { refs.current[i - 1]?.focus(); setAt(i - 1, '') }
    } else if (e.key === 'ArrowLeft' && i > 0) { refs.current[i - 1]?.focus() }
    else if (e.key === 'ArrowRight' && i < length - 1) { refs.current[i + 1]?.focus() }
  }

  function onPaste(e: ClipboardEvent) {
    e.preventDefault()
    const text = (e.clipboardData?.getData('text') ?? '').replace(/\D/g, '').slice(0, length)
    if (text) { emit(text); refs.current[Math.min(text.length, length - 1)]?.focus() }
  }

  return (
    <div style={{ display: 'flex', gap: '8px', justifyContent: 'space-between' }} onPaste={onPaste}>
      {Array.from({ length }).map((_, i) => (
        <input
          key={i}
          ref={el => (refs.current[i] = el)}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={digits[i] ?? ''}
          disabled={disabled}
          onInput={e => onInput(i, e)}
          onKeyDown={e => onKeyDown(i, e)}
          onFocus={e => (e.target as HTMLInputElement).select()}
          style={{
            width: '100%', height: '52px', textAlign: 'center',
            fontSize: '22px', fontWeight: '600', fontVariantNumeric: 'tabular-nums',
            borderRadius: '12px', border: '1.5px solid var(--avq-border, #e8eaed)',
            background: 'var(--avq-bg, #ffffff)', color: 'var(--avq-fg, #111827)',
            outline: 'none', boxSizing: 'border-box',
            transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
          }}
          onFocusCapture={undefined}
        />
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0. (If TS complains about the unused `onFocusCapture={undefined}` attribute, remove that line — it's a no-op placeholder.)

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: completes, emits `dist/widget.js`.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/OtpInput.tsx
git commit -m "feat(widget): add segmented OtpInput with auto-submit"
```

---

### Task 7: Wire into CustomerPortal + fix "Hola, null" + i18n

**Files:**
- Modify: `src/components/CustomerPortal.tsx`
- Modify: `src/i18n/es.json`, `src/i18n/en.json`

**Interfaces:**
- Consumes: `CountryPhoneInput` (Task 5), `OtpInput` (Task 6), `DEFAULT_DIAL` (Task 4).

- [ ] **Step 1: Add i18n keys**

In `src/i18n/es.json`, inside the `"otp"` object (after `"emailLabel"`), add:

```json
    "countrySearchPlaceholder": "Buscar país o lada",
    "countryNoResults": "Sin resultados",
```

In `src/i18n/en.json`, inside the `"otp"` object (after `"emailLabel"`), add:

```json
    "countrySearchPlaceholder": "Search country or code",
    "countryNoResults": "No results",
```

- [ ] **Step 2: Add imports to CustomerPortal.tsx**

After the existing `import { Input } from './ui/Input'` line, add:

```typescript
import { CountryPhoneInput } from './ui/CountryPhoneInput'
import { OtpInput } from './ui/OtpInput'
import { DEFAULT_DIAL } from '../data/countries'
```

- [ ] **Step 3: Add dial-code state**

After the line `const [otpPhone, setOtpPhone] = useState('')`, add:

```typescript
  const [otpDialCode, setOtpDialCode] = useState(DEFAULT_DIAL)
```

- [ ] **Step 4: Compose the destination with the dial code**

Replace the `otpDestination` function:

```typescript
  function otpDestination(): { phone?: string; email?: string } {
    return otpChannel === 'phone'
      ? { phone: otpPhone.trim() }
      : { email: otpEmail.trim() }
  }
```

with:

```typescript
  function otpDestination(): { phone?: string; email?: string } {
    return otpChannel === 'phone'
      ? { phone: `+${otpDialCode}${otpPhone.replace(/\D/g, '')}` }
      : { email: otpEmail.trim() }
  }
```

And replace `otpDestinationFilled`:

```typescript
  function otpDestinationFilled(): boolean {
    return otpChannel === 'phone' ? !!otpPhone.trim() : !!otpEmail.trim()
  }
```

with:

```typescript
  function otpDestinationFilled(): boolean {
    return otpChannel === 'phone' ? !!otpPhone.replace(/\D/g, '') : !!otpEmail.trim()
  }
```

- [ ] **Step 5: Make verify callable without an event (auto-submit)**

Replace the signature line of `handleVerifyOtp`:

```typescript
  async function handleVerifyOtp(e: Event) {
    e.preventDefault()
    if (otpCode.trim().length < 6) return
```

with:

```typescript
  async function handleVerifyOtp(e?: Event) {
    if (e) e.preventDefault()
    if (otpSubmitting) return
    if (otpCode.trim().length < 6) return
```

- [ ] **Step 6: Reset dial code on logout**

In `handleLogout`, after the line `setOtpPhone('')`, add:

```typescript
    setOtpDialCode(DEFAULT_DIAL)
```

- [ ] **Step 7: Replace the phone Input with CountryPhoneInput**

Replace this block (the phone branch of the phone-step form):

```tsx
              {otpChannel === 'phone' ? (
                <div>
                  <label style={labelStyle}>{t('otp.phoneLabel')}</label>
                  <Input
                    type="tel"
                    value={otpPhone}
                    placeholder={t('form.phonePlaceholder')}
                    onInput={(e) => setOtpPhone((e.target as HTMLInputElement).value)}
                  />
                </div>
              ) : (
```

with:

```tsx
              {otpChannel === 'phone' ? (
                <div>
                  <label style={labelStyle}>{t('otp.phoneLabel')}</label>
                  <CountryPhoneInput
                    dialCode={otpDialCode}
                    nationalNumber={otpPhone}
                    onDialCodeChange={setOtpDialCode}
                    onNationalNumberChange={setOtpPhone}
                    numberPlaceholder={t('form.phonePlaceholder')}
                    searchPlaceholder={t('otp.countrySearchPlaceholder')}
                    noResultsText={t('otp.countryNoResults')}
                  />
                </div>
              ) : (
```

- [ ] **Step 8: Replace the code Input with OtpInput**

Replace this block (the code-entry field):

```tsx
              <div>
                <label style={labelStyle}>{t('otp.codeLabel')}</label>
                <Input
                  type="text"
                  value={otpCode}
                  placeholder="123456"
                  onInput={(e) => setOtpCode((e.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 6))}
                />
              </div>
```

with:

```tsx
              <div>
                <label style={labelStyle}>{t('otp.codeLabel')}</label>
                <OtpInput
                  value={otpCode}
                  onChange={setOtpCode}
                  onComplete={() => handleVerifyOtp()}
                  disabled={otpSubmitting}
                />
              </div>
```

- [ ] **Step 9: Fix "Hola, null"**

Replace the greeting expression:

```tsx
            {customer
              ? `${t('portal.hello')}, ${customer.firstName || customer.email}`
              : t('portal.title')}
```

with:

```tsx
            {customer
              ? (customer.firstName || customer.email)
                ? `${t('portal.hello')}, ${customer.firstName || customer.email}`
                : t('portal.hello')
              : t('portal.title')}
```

- [ ] **Step 10: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: tsc exit 0; build emits `dist/widget.js`.

- [ ] **Step 11: Manual verification**

Start the dev server: `npm run dev`. Open `http://localhost:5176/test.html`. Then:

1. Reach the "Entrar con WhatsApp" screen (the login is the default portal entry — click the account/portal entry point in the widget).
2. Confirm the phone field shows a flag + `+52` button. Click it → the dropdown opens with a focused search box, Mexico first. Type `colom` → Colombia (+57) filters in. Select it → button shows Colombia's flag + `+57`.
3. Switch back to Mexico (`+52`), type a national number, and verify (via DevTools Network) that the `otp/request` payload `phone` is `+52` + the digits you typed (no spaces).
4. Enter the code screen. Confirm 6 separate boxes render. Type 6 digits → focus auto-advances and the form auto-submits on the 6th digit (a verify request fires without clicking "Entrar"). Test paste: copy `123456`, paste into the first box → all boxes fill and it submits.
5. Confirm no "null" appears anywhere in the greeting after login (the header should read "Hola" or "Hola, <name>", never "Hola, null").

- [ ] **Step 12: Commit**

```bash
git add src/components/CustomerPortal.tsx src/i18n/es.json src/i18n/en.json
git commit -m "feat(widget): country-code picker + segmented OTP boxes in WhatsApp login; fix Hola,null greeting"
```

---

## Out of scope (intentionally not done)

- **Appointment-path guest auto-link.** Only the class-booking path has a guest→customer auto-link; the appointment path (`reservation.dashboard.service.ts:createReservation`) links by `customerId` only. The Task 2 name backfill already covers returning appointment-only guests (it reads all past named reservations regardless of type), so no appointment auto-link is added here.
- **Historical `Customer.phone` normalization migration.** `phonesMatch` makes read-time matching correct regardless of stored format; a data migration is deferred.
- **Per-country number-length validation in the widget** (the widget accepts any national digits; the server's `normalizePhoneE164` still validates on its own paths).

## Self-review notes

- Spec §1 (country dropdown) → Tasks 4, 5, 7. Spec §2 (OTP boxes + auto-submit) → Tasks 6, 7. Spec §3 (display fix + backfill) → Task 7 step 9 + Task 2. Spec §4 (canonical auto-link) → Tasks 1, 3.
- Type consistency: `phonesMatch`/`phoneLast10` signatures identical across Tasks 1→2→3; `CountryPhoneInput`/`OtpInput` prop names identical across Tasks 5/6→7; `otpDestination()` returns the same `{ phone?, email? }` shape the API layer already expects (`src/api/booking.ts:251,255`) — no API change.
- No placeholders: all code blocks are complete; the country list is full data (≥190 entries), not a stub.
