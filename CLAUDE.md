# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Dev server at http://localhost:5174 (proxies /api → localhost:3000)
npm run build    # IIFE bundle → dist/widget.js
npm run preview  # Preview the built bundle
```

Deploy to CDN (Cloudflare Pages):
```bash
npx wrangler pages deploy dist --project-name avoqado-booking-widget
```

## Architecture

This is a Preact Web Component packaged as a single IIFE file (`dist/widget.js`). Any website can embed it with one `<script>` tag.

### Entry Point: `src/widget.ts`

Defines the `<avoqado-booking>` custom element. Key behavior:
- Creates a Shadow DOM to isolate styles from the host page
- CSS is written as a long inline string (Tailwind utility classes) injected directly into the shadow root — **not via the Tailwind plugin**. This is intentional to avoid Tailwind processing issues in Shadow DOM.
- Observed attributes: `venue`, `locale`, `theme`, `accent-color`, `mode`, `service-id`, `button-text`
- Public JS API: `element.open()` / `element.close()` for popup mode

### State: `src/state/booking.ts`

Preact Signals store. Steps: `0=loading, 1=service, 2=date, 3=time, 4=form, 5=confirmed, 6=manage`.

`hasServiceStep` is a computed signal: service step is skipped when the venue has ≤1 product. `getStepConfig(hasService)` returns the correct step numbers depending on this.

`resetBooking(venueData)` resets all signals and navigates to the first real step.

### API: `src/api/booking.ts`

Plain `fetch()` wrapper — no axios. The `ngrok-skip-browser-warning: '1'` header is included on all requests (harmless in production, required for local dev via ngrok). Base URL comes from `VITE_API_URL` env var.

### i18n: `src/i18n/`

`createT(locale)` returns a `t(key, vars?)` function. Keys use dot notation (e.g. `"common.loading"`). Supported locales: `en`, `es` (default). `{{varName}}` interpolation syntax.

### Components: `src/components/`

- `BookingFlow.tsx` — Main orchestrator, reads signals and renders the correct step
- `ServiceSelector.tsx` — Product/service selection step
- `DatePicker.tsx` — Custom calendar built with `date-fns` (no Radix/react-day-picker)
- `TimeSlotPicker.tsx` — Available time slots grid
- `GuestInfoForm.tsx` — Zod validation, no react-hook-form
- `DepositStep.tsx` — Phase 1 stub: shows "pay at venue" message
- `Confirmation.tsx` — Booking confirmed view, dispatches `avoqado:confirmed` custom event
- `ManageBooking.tsx` — Lookup + cancel via `cancelSecret`
- `ui/` — Button, Input, Spinner, Toast (no external UI library)

### Custom Events

Dispatched on the host element (bubbles through the host page DOM):
- `avoqado:confirmed` — `{ confirmationCode, startsAt, endsAt, productName }`
- `avoqado:cancelled` — `{ confirmationCode, cancelledAt }`
- `avoqado:step-changed` — `{ step }`

### Environment / API URL

| File | `VITE_API_URL` value | Purpose |
|------|---------------------|---------|
| `.env` | `/api/v1/public` | Local dev — uses Vite proxy to `localhost:3000` |
| `.env.production` | `https://api.avoqado.io/api/v1/public` | Production CDN build |

**Never use `.env.local`** — it overrides `.env` and breaks the Vite proxy in dev.

### Vite Config Notes

- `build.lib.formats: ['iife']` — single self-executing file, no ES module imports needed by embedders
- `cssCodeSplit: false` — all CSS in one file (but it's actually injected via the inline string in `widget.ts`, not extracted)
- Proxy: `/api → http://localhost:3000` — only active in dev server (`npm run dev`)

## WordPress Plugin

`wordpress-plugin/avoqado-booking.php` — shortcode `[avoqado_booking venue="slug"]`.

To upload to WordPress: zip the `.php` file first:
```bash
cd wordpress-plugin && zip avoqado-booking.zip avoqado-booking.php
```

## CDN

Production URL: `https://cdn.avoqado.io/widget.js`

Cloudflare WAF has a custom skip rule for `/widget.js` to bypass Bot Fight Mode (SBFM). If the file returns 403 with `cf-mitigated: challenge`, the WAF rule may need to be re-applied via the Cloudflare API.

## Testing

Manual test without WordPress:
```html
<!-- test.html served by Vite dev server -->
<script type="module" src="/src/widget.ts"></script>
<avoqado-booking venue="avoqado-full" locale="es" theme="light"></avoqado-booking>
```
Open `http://localhost:5174/test.html` (not `file://` — CORS blocks API calls from file:// origins).
