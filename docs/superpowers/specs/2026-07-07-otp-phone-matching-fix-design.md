# OTP phone-matching fix + smart paste — design

Date: 2026-07-07
Repos touched: `avoqado-server` (fix), `avoqado-booking-widget` (feature)
Follows: `2026-07-07-whatsapp-otp-login-polish-design.md` (this fixes a bug found
while `/full-testing` that shipped work)

## Problem

**Confirmed via `/full-testing` with a live local database, not just static
review.** The name-backfill (on first WhatsApp login) and the guest-booking
auto-link both use a SQL-level coarse prefilter —
`{ guestPhone: { endsWith: last10 } }` / `{ phone: { endsWith: phoneLast10Digits } }`
— that compares the **raw, unnormalized column value** against a **digits-only**
search key. When the stored phone has a formatting character (space, dash,
parenthesis) anywhere inside the last 10 characters — e.g. `"55 0000 0001"` — the
literal-suffix comparison never matches, so the row is never even fetched. The
canonical, format-tolerant `phonesMatch()` (added in the prior round) never gets
a chance to run, because its input never arrives.

**Severity confirmed empirically:** of the 16 non-null `guestPhone` values that
already exist in the test venue (`avoqado-full`), **16/16 (100%) have embedded
formatting** (`"1-622-355-8295 x355"`, `"973-518-3686 x2036"`, etc.). This is not
an edge case — it's the dominant shape of real guest-typed phone data.

## Design

### 1. Server: normalize inside the SQL comparison (avoqado-server)

Replace the Prisma `{ endsWith: last10 }` filters with a raw SQL comparison that
normalizes the stored column **the same way** `phoneLast10()` normalizes the
search key, so the comparison is apples-to-apples:

```sql
right(regexp_replace("guestPhone", '[^0-9]', '', 'g'), 10) = <last10>
```

This mirrors `phoneLast10()`'s own logic (`replace(/\D/g,'').slice(-10)`) —
strip everything but digits, then take the last 10 — just run inside Postgres
instead of JS, so the comparison happens on both sides of the query the same
way. `$queryRaw` is already an established pattern in
`reservation.public.controller.ts` (used for the enrolled-count aggregate), so
this isn't a new technique for the codebase.

Applied in exactly the two places affected:
- `otpAuth.public.service.ts` → `findGuestNameFromPastReservations` (the phone
  branch — email branch is exact-match and unaffected).
- `reservation.public.controller.ts` → the `matchCandidates` phone branch (the
  email OR-clause is exact-match and unaffected).

The subsequent JS `phonesMatch()` verification step **stays** — it's now
redundant for the common case (the SQL match is already precise), but it's
cheap defense-in-depth against a last-10-digit coincidence between two
genuinely different numbers, and keeps the "coarse filter, canonical verify"
shape consistent with the rest of the matching logic.

**Testing implication:** the existing Task 2 unit test mocks
`prisma.reservation.findFirst`/`findMany`. Once the phone branch becomes a raw
`$queryRaw`, mocking it would only prove "the mock was called with some SQL
string" — it would NOT verify the SQL is actually correct against Postgres
(wrong quoting, wrong regex escaping, etc. would still pass a mocked test). The
project already has a real, no-mock **integration test project**
(`tests/integration/**`, `tests/__helpers__/integration-setup.ts`, real Prisma
client against `TEST_DATABASE_URL`/`DATABASE_URL`). This fix's real
verification belongs there — a new integration test that seeds a `Reservation`
with a formatted `guestPhone`, then calls the affected code path and asserts
the match is found. The existing unit test's *other* assertions (backfill
happens only on the create-branch, `splitName` behavior, no-match case) are
unaffected by this change and stay as unit tests.

### 2. Widget: detect a pasted/typed full international number (avoqado-booking-widget)

**New export in `src/data/countries.ts`:**

```typescript
export function detectCountryFromFullNumber(raw: string): { dial: string; national: string } | null
```

Only activates when the input **starts with `+`** — the one unambiguous signal
that "this is a full international number, country code included." Without a
leading `+`, the function returns `null` and today's behavior (treat digits as
the national number, no dial-code change) is completely unchanged — this is
what prevents a plain national number like `5512345678` from being
misinterpreted as starting with Brazil's dial code `55`.

When a leading `+` is present: strip to digits, then try each known dial code
**longest-first** and return the first whose value prefixes the digit string
(with at least one digit remaining for the national number). Longest-first
matching is required for correctness, not just preference — several Caribbean/
NANP entries in `COUNTRIES` are stored as their full `1XXX` shared-country-code
value (e.g. Bermuda `1441`, Cayman `1345`), and checking those before the bare
`1` (US/Canada) is what correctly distinguishes them. The sorted-by-length list
is computed once at module load, not on every keystroke.

**Wiring into `CountryPhoneInput.tsx`:** the national-number input's existing
`onInput` handler gains one branch — if `detectCountryFromFullNumber(rawValue)`
returns a match, call both `onDialCodeChange(dial)` and
`onNationalNumberChange(national)`; otherwise, keep today's exact behavior
(`onNationalNumberChange(rawValue.replace(/\D/g, ''))`). No new event handler
is needed: a paste fires the same `input` event as typing, so the browser
delivers the full pasted string to this one handler in a single call — this is
what makes "paste a full number → country auto-selects" work with no dedicated
paste-handling code.

## Data flow

```
Server (per matching lookup):
  raw guestPhone/phone from DB, arbitrary formatting
    → SQL: right(regexp_replace(col, '[^0-9]', '', 'g'), 10) = <last10 of search key>
    → candidates fetched (now correctly, regardless of formatting)
    → phonesMatch() JS verify (unchanged, still the canonical adjudicator)

Widget (national-number field, onInput):
  raw value (typed char or full pasted string)
    → starts with '+' ?
        no  → strip non-digits → onNationalNumberChange (unchanged today)
        yes → detectCountryFromFullNumber → match found?
                yes → onDialCodeChange(dial) + onNationalNumberChange(national)
                no  → strip non-digits → onNationalNumberChange (fallback, unchanged)
```

## Error handling / edge cases

- Server: a `guestPhone`/`phone` value with fewer than 10 total digits never
  matches (`phoneLast10` already returns `null` for those on the search-key
  side; no candidates are fetched, same as today for a too-short number).
- Server: NULL `guestPhone`/`phone` rows are excluded by the existing
  `guestName IS NOT NULL` / customer-existence conditions — no new NULL-handling
  needed in the raw SQL beyond what's already implicit (regexp_replace on NULL
  yields NULL, which never equals a non-null `last10`).
- Widget: pasting `+` followed by digits that don't match ANY known dial code
  (e.g. a typo) falls through to the existing behavior — digits stripped,
  treated as national number, dial code unchanged. No error shown; this is a
  silent, safe fallback, consistent with the rest of the phone field's
  permissive input handling.
- Widget: pasting a `+`-prefixed number that matches a dial code but leaves
  zero remaining digits (e.g. just `+52`) does not split — `detectCountryFromFullNumber`
  requires at least one digit after the matched dial code.

## Out of scope (explicitly deferred, not silently dropped)

- **Phone format validation on `/auth/otp/request`** (the Menor from the
  `/full-testing` report — `phone` accepts any non-empty string, unlike
  `email`). Not included in this round at the user's explicit choice.
- **Scoping `OtpChallenge` by `venueId`** (the architectural note from the same
  report). Requires a schema migration; not included at the user's explicit
  choice. Recorded in project memory (`otp-challenge-not-venue-scoped.md`) for
  a future round.

## Testing

- Server: extend the existing unit test for the pieces unaffected by the SQL
  change (create-branch-only scoping, `splitName`, no-match case). Add a new
  integration test (`tests/integration/**`, real DB) that seeds a `Reservation`
  with formatted `guestPhone` and asserts the backfill/auto-link now finds it —
  this is the test that actually proves the raw SQL is correct against
  Postgres, which a mock cannot.
- Widget: manual verification via the dev server + `<avoqado-portal>` — paste a
  full `+52...` number and confirm the country button updates and the national
  field shows only the remaining digits; confirm a plain digit-only paste is
  completely unaffected (regression check against the existing behavior).
