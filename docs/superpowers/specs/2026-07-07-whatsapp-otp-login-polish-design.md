# WhatsApp OTP login polish — design

Date: 2026-07-07
Repos touched: `avoqado-booking-widget` (primary), `avoqado-server` (two small, contained changes)

## Problem

The "Entrar con WhatsApp" login screen in the booking widget's `CustomerPortal` has three issues:

1. The phone field has no country-code selector — users must know to type their
   country's dial code themselves, or the number is silently misinterpreted.
2. The 6-digit code field is a plain text input, not the segmented box UI
   ([shadcn Input OTP](https://ui.shadcn.com/docs/components/base/input-otp))
   the founder wants.
3. After verifying, the portal header shows the literal text "Hola, null" for
   customers who have no name on file yet.

## Root cause investigation

**Issue 3 traces to a real backend data gap, not just a display bug.** Guest
bookings through the widget (`reservation.public.controller.ts:1911`) never
create a `Customer` row — they only store `guestName`/`guestPhone`/`guestEmail`
inline on the `Reservation`. A `Customer` row is only ever created by: (a)
email/password registration, or (b) a first WhatsApp OTP login
(`otpAuth.public.service.ts` → `resolveIdentity`). So a customer who has
booked before (guest name required, `guestName: z.string().min(1)` in the
widget's `GuestInfoForm`) but never registered/logged in still gets a
brand-new, blank `Customer` on their first WhatsApp login — hence `firstName:
null`, which the widget's template-literal greeting then renders as the
literal word "null".

**A related, forward-looking gap:** the guest-booking auto-link
(`reservation.public.controller.ts:1889`, `matchedCustomer` lookup) compares
`body.guestPhone` **raw/unnormalized** against `customer.phone`. The OTP flow
normalizes phone to `+<digits>` before writing `Customer.phone`, but
`registerCustomer` and `updateProfile` (`customerPortal.public.service.ts`)
both write `Customer.phone` **raw, exactly as submitted** — so phone storage
is not consistently normalized platform-wide. This means the auto-link (and
the backfill lookup added by this change) can't rely on exact string
equality; they need tolerant matching. Fully normalizing every write path is
a larger, separate effort (would need a backfill migration across existing
rows) and is **out of scope** for this change — documented as a known
limitation below.

## Design

### 1. Country-code dropdown (widget only)

**New files:**
- `src/data/countries.ts` — ~195 countries as `{ iso2, name, dial }`, Mexico
  pinned first, then alphabetical. `flagEmoji(iso2)` computes the flag emoji
  from the ISO code at render time (regional-indicator-symbol trick) instead
  of storing 195 emoji strings.
- `src/components/ui/CountryPhoneInput.tsx` — one merged field: a flag +
  dial-code button on the left (opens a dropdown panel) and the national
  number input on the right. Matches the existing `Input` component's
  height/border/focus-ring so it looks native to the widget.

**Dropdown panel:** auto-focused search input filtering by country name or
dial code; ArrowUp/ArrowDown to move highlight, Enter to select, Escape to
close; closes on outside click. There is no existing dropdown/select pattern
in this codebase to reuse, so outside-click detection uses
`event.composedPath()` (not `event.target`) since this runs inside a Shadow
DOM and plain `target`-based checks retarget incorrectly across the shadow
boundary.

**Wiring into `CustomerPortal.tsx`:** one new state field, `otpDialCode`
(default `'52'`). `otpPhone` keeps holding just the national digits as it
does today. `otpDestination()` composes:
`phone: '+' + otpDialCode + otpPhone.replace(/\D/g, '')`. This produces
exactly the `+<digits>` shape both server-side `normalizePhone` functions
already expect (verified by reading `otpAuth.public.service.ts` and
`whatsapp.service.ts`) — **no `avoqado-server` change needed for sending or
requesting the OTP.**

Scope: only the primary "Entrar con WhatsApp" phone field. The
register/edit-profile/guest-booking phone fields are untouched.

**Known limitation:** dial codes shared by multiple countries (e.g. `+1` for
US/Canada/Caribbean) resolve to one representative country, not a full
disambiguation picker. No per-country number-length validation. Acceptable
for this widget; a stricter implementation would use a library like
`libphonenumber-js`, which conflicts with this codebase's no-external-UI-lib,
bundle-size-sensitive convention.

### 2. Segmented OTP input

**New file:** `src/components/ui/OtpInput.tsx` — 6 separate single-digit
`<input maxLength={1}>` boxes (not a hidden-input-overlay, which is how
shadcn's underlying library does it — simpler and dependency-free in
Preact). Handles auto-advance on type, backspace-to-previous, arrow-key
navigation, and pasting a full 6-digit code across all boxes at once. Styled
with the same border/radius/focus-ring language as the rest of the widget.

**Auto-submit:** exposes `onComplete()`, fired once when the 6th digit
lands. `CustomerPortal.handleVerifyOtp` becomes callable without a real
`Event` (mirrors `handleSendOtp`, which already accepts an optional event),
guarded by the existing `otpSubmitting` flag so a manual button click can't
double-fire alongside auto-submit. The "Entrar" button remains as a visual
fallback.

### 3. "Hola, null" — display fix + name backfill

**Widget fix** (`CustomerPortal.tsx:594`): stop concatenating a possibly-null
value into the greeting string. Render just `t('portal.hello')` ("Hola")
when there's no `firstName`/`email`, instead of
`` `${t('portal.hello')}, ${customer.firstName || customer.email}` `` (which
renders the literal word "null" via JS template-literal stringification when
both operands are `null`).

**Server fix** (`otpAuth.public.service.ts`): in `resolveIdentity`'s
"create a new customer" branch **only** (never touches an already-existing
customer, so no risk of clobbering a name someone intentionally left blank),
look up that venue's most recent `Reservation` with a matching guest
phone/email and a non-null `guestName`, and seed `firstName`/`lastName` from
it via a `splitName()` helper (same first-word/rest-of-words split already
used in `auth.consumer.service.ts` — mirrored locally rather than importing
across bounded contexts).

### 4. Guest-booking auto-link — canonical phone matching (forward-looking fix)

**Revised after discovery:** `avoqado-server` **already depends on
`libphonenumber-js`** and already ships `src/utils/phone.ts` with a tested
`normalizePhoneE164(input)` helper. The "libphonenumber is too heavy"
constraint only ever applied to the **widget** IIFE bundle — on the server,
canonical E.164 normalization is free and already in use. So the server-side
matching uses real E.164 canonicalization, not a hand-rolled `endsWith`
heuristic.

**Extend the existing `src/utils/phone.ts`** (avoqado-server) with two small
pure helpers alongside the existing `normalizePhoneE164`:
- `phoneLast10(input)` → last 10 digits (or `null` if fewer), used as a cheap
  coarse SQL prefilter (`endsWith`) that catches every formatting variant
  since all variants of a number share the same trailing 10 digits.
- `phonesMatch(a, b)` → `true` when both normalize to the same E.164 string;
  falls back to a last-10-digit comparison only when one side can't be parsed
  to a valid E.164 number. This is the canonical verify that eliminates the
  false positives a bare `endsWith` prefilter would admit.

Reused in **both**:
- `reservation.public.controller.ts:1889` (`matchedCustomer` lookup) —
  coarse-prefilter candidate customers by `phone endsWith last10`, then accept
  only those where `phonesMatch(customer.phone, body.guestPhone)`, alongside
  the existing exact-email match.
- The new backfill lookup in `otpAuth.public.service.ts` (§3), matching the
  login destination against `Reservation.guestPhone` the same way.

One shared, canonical matching helper instead of writing a fuzzy heuristic
twice. This does **not** touch the widget bundle, so the "keep the widget
light" decision stands.

## Data flow summary

```
Widget phone step:
  CountryPhoneInput → { otpDialCode, otpPhone } → otpDestination()
    → POST /public/venues/:slug/auth/otp/request { phone: "+525512345678" }
    → otpAuth.public.service.requestOtp → normalizePhone (unchanged) → sendOtpWhatsApp (unchanged)

Widget code step:
  OtpInput (6 boxes) → otpCode → onComplete() → handleVerifyOtp()
    → POST .../auth/otp/verify { phone, code }
    → otpAuth.public.service.verifyOtp → resolveIdentity
        → no existing Customer found → phoneMatchCandidates(destination)
          → Reservation lookup (venueId + guestPhone/guestEmail candidates, guestName not null)
          → splitName(guestName) → seeds firstName/lastName on customer.create
    → { token, customer } returned (unchanged response shape)

Widget renders:
  customer.firstName || customer.email → display name, or nothing (never "null")
```

## Error handling / edge cases

- No matching country typed in the search box → dropdown shows an empty
  state, selection unchanged.
- Pasting a non-numeric or too-short string into the OTP boxes → non-digit
  characters stripped, only fills as many boxes as valid digits provided.
- Backfill lookup finds no matching reservation → `splitName(undefined)`
  returns `{}`, customer is created exactly as it is today (no regression).
- `phoneMatchCandidates` last-10 `endsWith` match is intentionally scoped to
  a single venue's data (`venueId` filter always present) to bound
  false-positive risk to "two different customers of the same venue share a
  10-digit phone suffix" — considered acceptably rare.

## Testing

- Widget: manual verification via `test.html` — select a non-MX country,
  confirm the composed `phone` sent to the API; type and paste into the OTP
  boxes and confirm auto-submit fires exactly once; log in with a phone that
  has no prior bookings (blank greeting, no "null") and with a phone that has
  a prior guest booking (backfilled name shows correctly).
- Server: existing OTP request/verify behavior and response contract are
  unchanged, so existing tests should keep passing unmodified. Add a focused
  test for `resolveIdentity`'s backfill branch and for
  `phoneMatchCandidates`.

## Out of scope

- Backfilling/normalizing existing `Customer.phone` rows and adding
  `normalizePhoneE164` to every write site (`registerCustomer`,
  `updateProfile`) so all *stored* phone data is canonical. `phonesMatch`
  already makes read-time matching correct regardless of stored format, so a
  historical migration is a separate, larger effort with no user-facing
  urgency once matching is canonical.
- Per-country phone number length/format validation **in the widget**
  (the server's `normalizePhoneE164` validates, but the widget picker does
  not gate submission on it).
- Applying the country-code dropdown to any other phone field in the widget
  (register, edit-profile, guest booking).
