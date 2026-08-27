# AGENTS.md

## 🔴 Verificación pesada: por `avq-verify`, nunca a mano

**Van SIEMPRE por el script, sin importar cuánto tarden:** `./gradlew` (cualquier tarea que
compile), `xcodebuild`, `tsc` / `npm run build`, y cualquier corrida de jest/vitest de más de un
archivo. **Van a pelo:** lint, formato, UN archivo de test, y lo que no reserve memoria en serio.

Esto NO contradice "un compile de un solo proyecto se corre siempre, aunque la máquina esté
saturada": aquello decide **si** verificas (siempre sí), esto decide **cómo** lo lanzas —
haciendo fila en vez de encimarte. Se lanza desde el root del workspace:

```bash
cd /Users/amieva/Documents/Programming/Avoqado
./scripts/avq-verify.sh avoqado-booking-widget <comando>
```

Hace fila: un trabajo pesado a la vez en esta Mac, que corre con ~20 sesiones de IA encima y vive
con el swap al límite. 🧪 Desde el 2026-08-24 este repo va **sólo al Alienware** (tiene CI en GitHub como red extra), con 1 de cada 10 corridas comparada contra la Mac por sorpresa — sigue siendo periodo de prueba hasta el 2026-09-01. Si dice `DIFIEREN` o `INCONCLUSO`, **ningún resultado vale**: investiga y ajusta la regla.

Detalle completo: `Avoqado/CLAUDE.md`, sección "Verificación repartida".


This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## 🔴 Antes de construir: tier + activación (dos decisiones, no una)

Este archivo NO reemplaza al `CLAUDE.md` de este repo — léelo. Lo que más se rompe si lo saltas:

- **Tier** ("¿lo pagó?") y **activación** ("¿lo quiere prendido?") son ejes DISTINTOS: se componen con AND.
- Un switch se justifica **solo** si puedes nombrar dos clientes reales que quieran lo contrario. Si no, es
  comportamiento core y va **sin** toggle — la app no se construye por toggles.
- El switch canónico vive en `avoqado-web-dashboard`. 🔴 **Nunca solo un `UPDATE` en Postgres.**
- El default ON/OFF lo decides tú midiendo el riesgo; pregunta al founder solo si toca dinero, fiscal,
  permisos, stock o algo irreversible (ahí el default es OFF).
- 🔴 **Apagado se VE y se EXPLICA** — nunca desaparecer en silencio.

Regla completa: `avoqado-server/.claude/rules/feature-gating.md` · cross-repo: `CLAUDE.md` del workspace.

## Entorno: varias sesiones de IA trabajan en paralelo (contexto, no un bloqueo)

Casi siempre hay 2+ agentes editando este workspace al mismo tiempo. Es lo normal: **no es una
anomalía, no es motivo para detenerte, preguntar ni "arreglar" nada.** Solo cambia cómo interpretas
lo que ves:

- **Archivos modificados que tú no tocaste** en `git status` / `git diff` = WIP de otra sesión. Normal.
- 🔴 **Nunca** `git reset --hard`, `git checkout .`, `git clean`, `git stash` ni cambies de rama "para
  dejar limpio": el árbol de trabajo es compartido y eso sí destruye trabajo ajeno irrecuperable.
  Es la única regla dura de esta sección.
- **Commitea por rutas explícitas** (`git add <ruta>`), nunca `git add -A` / `git add .`. Si aun así
  se cuela WIP ajeno en tu commit, **no es grave**: no lo reviertas ni lo reescribas — dilo en el reporte.
- **Ruido que no viene de tu cambio**: el dev server hace hot-reload o se reinicia solo, un test/build
  truena en un archivo que no tocaste, un puerto ocupado. Verifica con `git diff <archivo>`: si ese
  cambio no es tuyo, **no lo debuggees ni lo corrijas** — reintenta una vez y, si sigue, anótalo en el
  reporte y continúa con lo tuyo.
- **No mates procesos, servidores, emuladores ni daemons de build que no arrancaste tú**, ni reinicies
  o borres bases de datos locales: otras sesiones están usándolas.
- Si un `Edit` falla porque el archivo cambió debajo de ti, relee y reaplica. Sin drama.
- ¿Quién más está adentro? MCP **Huella**: `quien_trabaja(repo)` y `actividad_reciente(repo)`.

**Asume concurrencia, no conflicto. Sigue programando.**

## Verificar sí; cuánto verificar lo decide la máquina

Esta Mac (10 núcleos / 32 GB) está compartida con las demás sesiones y vive cerca del límite.

**Pasan por el chequeo de capacidad, y SOLO estas:** `./gradlew assemble*` / `bundle*`, `xcodebuild`,
la suite de tests completa, el typecheck de todo el monorepo.
**No pasan nunca — se corren siempre, aunque la máquina esté saturada:** typecheck o build de UN
proyecto, UN archivo de test, lint. Cuestan segundos: la carga NO es excusa para saltárselos.

```bash
sysctl -n hw.ncpu vm.loadavg   # núcleos y { 1min 5min 15min }
sysctl -n vm.swapusage         # 'free' es la señal que más importa
pgrep -fl "GradleDaemon|KotlinCompileDaemon|xcodebuild|jest|vitest|tsc" | head
```

- **Si swap `free` < 2 GB, o load de 1 min > 2× núcleos, o ya hay un build ajeno corriendo: no arranques.**
  Adelanta lo que no dependa de eso y reintenta (cada ~2 min, tope ~10 min). Si sigue saturado, corre la
  verificación corta y reporta la larga como pendiente — no te quedes esperando indefinidamente.
- **Nunca dos builds pesados a la vez**: dos daemons de Kotlin a `-Xmx6g` tumban la máquina.
- Única excepción a "no mates procesos ajenos": si `pgrep` no muestra ningún build activo,
  `./gradlew --stop` libera daemons ociosos (4–6 GB cada uno, viven 2 h sin usarse) — dilo en el reporte.
  Los servidores de dev, emuladores y bases de datos NO se tocan.
- Si el typecheck pelón (`npx tsc --noEmit`) revienta por memoria, usa el script del repo (`npm run build`).

**La carga nunca compra "no lo verifiqué" — compra "lo verifiqué en corto".** Si cambiaste código, se
comprueba antes de decir que está listo. Lo que la máquina decide es el *tamaño*: typecheck solo del
proyecto tocado, el archivo de test en vez de la suite completa, `assembleDebug` en vez de
`assembleRelease`. **Lo que difieras va explícito en el reporte, con el comando exacto para correrlo.**
Un "listo" que esconde lo que no se corrió es un reporte falso.

| Qué tocaste | Mínimo obligatorio |
|---|---|
| Dinero, fechas/timezone, tiers, permisos, stock, pagos/reembolsos, migraciones de datos | **Test primero (TDD)** + suite del módulo. No negociable: esto no se difiere ni con la máquina en llamas. |
| Cualquier otro código | Que compile / typechee el proyecto tocado. Un cambio que no compila no es un cambio. |
| Cambio amplio, o antes de commitear/lanzar | Suite completa + build completo. Aquí sí se espera capacidad. |
| Markdown, docs, comentarios, copy sin lógica | Nada. |

"No era importante" es una conclusión que se justifica en el reporte, no un default. Si dudas, córrelo.

## Commands

```bash
npm run dev      # Dev server at http://localhost:5176 (proxies /api → localhost:3000)
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
Open `http://localhost:5176/test.html` (not `file://` — CORS blocks API calls from file:// origins).

## 🔴 Cómo hablarle al founder

Regla completa en `~/.claude/CLAUDE.md` (aplica a todos sus proyectos) y en
`Avoqado/.claude/rules/como-hablarle-al-founder.md`.

- **Cuando le pidas una opinión o le hagas una pregunta: explícale FÁCIL.** Analogías antes que
  jerga, y **diagrama** (`mcp__visualize__show_widget`) siempre que sean dos caminos, dos
  mecanismos, un flujo o un antes/después. Una pregunta a la vez, opciones cortas, la consecuencia
  de cada una en una línea.
- **Las respuestas largas están bien** — le sirve que razones y no adivines.
- 🔴 **SIEMPRE cierra con 2-3 líneas en lenguaje llano**: qué pasó, qué significa para él, y qué
  necesitas de él. Sin ese cierre, el contenido puede ser correcto y aun así no llegarle.

