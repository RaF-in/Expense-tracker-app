# Tasks

## Task T1: Core API health endpoint + CORS

> **Status:** done
> **Verification:** checklist
> **Effort:** xs
> **Priority:** high
> **Depends on:** None
> **Satisfies REQs:** R2, R3
> **Footprint slice:** Modified: `services/core-api/src/Program.cs` (add `AddCors`/`UseCors` two-origin allowlist; add `MapGet("/api/health", ...)`)
> **High-risk areas touched:** None (ARCH rates CORS config as Risk L)

### Description

Adds a liveness/connectivity probe (`GET /api/health`) to core-api and a CORS allowlist so the frontend (through the Ingress, and via the host-run Vite dev server) can call it. This is the backend half of the end-to-end plumbing check — no persistence, no auth, a literal response object.

### Verification Checklist

- **Build passes** — `dotnet build` from `services/core-api/` — expected: exits 0, no compile errors.
- **Health endpoint shape** — `curl -s localhost:8080/api/health` (run locally, e.g. via `dotnet run`) — expected: HTTP 200, JSON body `{ "status": "ok", "timestamp": "<ISO-8601 UTC>", "version": "0.1.0" }` _(verifies R2)_.
- **CORS allows frontend origin** — `curl -sI -H "Origin: http://localhost" localhost:8080/api/health` — expected: response includes `Access-Control-Allow-Origin: http://localhost` _(verifies R3)_.
- **CORS allows Vite dev origin** — `curl -sI -H "Origin: http://localhost:5173" localhost:8080/api/health` — expected: response includes `Access-Control-Allow-Origin: http://localhost:5173` _(verifies R3)_.
- **CORS rejects untrusted origin** — `curl -sI -H "Origin: http://evil.example" localhost:8080/api/health` — expected: no `Access-Control-Allow-Origin` header in the response _(verifies R3 boundary, guards A3's literal-allowlist decision)_.
- **Regression guard: existing root route unchanged** — `curl -s localhost:8080/` — expected: still returns `{ "service": "core-api", "status": "running" }` unchanged _(guards backward-regression risk in the file being modified)_.

### Implementation Notes

- **Module(s):** `services/core-api/src/Program.cs` (HTTP surface — routes, CORS policy). No new project files at this scope, per ARCH's Module Boundaries.
- **Pattern reference:** existing `app.MapGet("/", ...)` in `Program.cs` — follow the same minimal-API inline-lambda style for the new `/api/health` route.
- **Key decisions:** A3 — CORS is a hardcoded two-origin allowlist (`http://localhost`, `http://localhost:5173`) directly in `Program.cs`; no config-loading system exists yet (Task 00 D3 precedent), so do not introduce one here.
- **Libraries:** ASP.NET Core Minimal API only (`Microsoft.AspNetCore.Cors` is part of the shared framework — no new NuGet package).
- **High-risk callouts:** None — ARCH rates this area L risk; CORS only widens browser access from same-origin default, so it cannot break an existing caller.

### Scope Boundaries

- Do NOT add auth, database access, or real data to `/api/health` or any other route (ARCH Out of Scope).
- Do NOT introduce a config-loading system or env-based CORS origins — literal allowlist only (ARCH Out of Scope, A3).
- Do NOT add per-request logging for `/api/health` — matches Task 00's minimal-logging precedent (ARCH Cross-Cutting Concerns).
- Only implement the one new route and the CORS policy — no other changes to `Program.cs`.

### Files Expected

**New files:** None.

**Modified files:**
- `services/core-api/src/Program.cs` (add `AddCors`/`UseCors` two-origin allowlist; add `MapGet("/api/health", ...)`)

**Must NOT modify:**
- `services/core-api/core-api.csproj` (no new dependencies needed — CORS is part of the ASP.NET Core shared framework)

---

## Task T2: Ingress routing + first-run docs

> **Status:** done
> **Verification:** checklist
> **Effort:** s
> **Priority:** high
> **Depends on:** T1 (verifying `/api/health` through the Ingress requires T1's endpoint to exist)
> **Satisfies REQs:** R1
> **Footprint slice:** New: `k8s/ingress.yaml`; Modified: `README.md` (new "First-run setup" step + updated "Verify" section); Touched but not changed: `k8s/core-api.yaml`, `k8s/frontend.yaml`, `Makefile`
> **High-risk areas touched:** Local dev bootstrap (README, first-run) — Risk M: easy to forget/skip, symptom is confusing (connection refused, not an app error) if missed. ADR-008 divergence (Traefik → nginx-ingress) — Risk M: recorded divergence, not a bug, but worth surfacing in review.

### Description

Adds a standard Kubernetes `Ingress` routing `/api/*` to `core-api` and `/*` to `frontend`, so the browser reaches both through one origin (`http://localhost`) with no port-forwarding. Documents the one-time `ingress-nginx` controller install as a new README "First-run setup" step, following the existing `secrets.yaml`-copy precedent rather than wiring it into `make deploy`.

### Verification Checklist

- **Ingress applies cleanly** — `kubectl apply -f k8s/ingress.yaml` (after `ingress-nginx` controller is installed per the new README step) — expected: exits 0, `Ingress` object created.
- **API reachable through Ingress** — `curl -s http://localhost/api/health` — expected: HTTP 200, same body shape as T1 (`status`, `timestamp`, `version`) _(verifies R1)_.
- **Frontend reachable through Ingress** — `curl -sI http://localhost/` — expected: HTTP 200, frontend HTML served _(verifies R1)_.
- **Regression guard: port-forward paths still work** — `kubectl port-forward svc/core-api 8080:80 -n expense-tracker` and `kubectl port-forward svc/frontend 8082:80 -n expense-tracker`, then curl each — expected: both still respond as before, unaffected by the new Ingress _(guards backward-regression risk for `k8s/core-api.yaml`, `k8s/frontend.yaml`)_.
- **Regression guard: build/deploy loop unaffected** — `make build && make deploy` — expected: still exits 0, no changes required to `Makefile` _(guards backward-regression risk for `Makefile`)_.
- **README documents first-run step** — manual read — expected: new "First-run setup" section names the exact `ingress-nginx` install command, ordered before the "Verify" section which now describes browsing via `http://localhost`.

### Implementation Notes

- **Module(s):** `k8s/` manifests (cluster infra, not an app image) and `README.md` docs, per ARCH's High-Level Structure.
- **Pattern reference:** `k8s/core-api.yaml` for the `app.kubernetes.io/*` label set (`part-of`, `name`, `component`) to mirror on the new `Ingress`; the existing `secrets.yaml`-copy step in README for how a one-time manual setup step is documented.
- **Key decisions:** A1 — use `ingress-nginx` (installed via the pinned upstream "cloud" provider manifest), a deliberate divergence from ADR-008's named Traefik choice; A2 — standard `networking.k8s.io/Ingress`, host-agnostic (no `host:` field), `/api` prefix kept on core-api routes with no rewrite annotation; A8 — controller install stays a manual README step, not part of `make deploy`.
- **Libraries:** None (pure Kubernetes manifest + docs).
- **High-risk callouts:** The M-risk "easy to skip" first-run step is mitigated by the README ordering check above (step must appear before "Verify"); the ADR-008 divergence is a recorded decision (ARCH Open Questions), not something this task resolves — no ADR-008 edit is in scope here.

### Scope Boundaries

- Do NOT wire the `ingress-nginx` controller install into `make deploy` or any Makefile target — it is cluster infrastructure, not an app image (ARCH A8, Out of Scope via Touched-but-not-changed on `Makefile`).
- Do NOT add a `host:` field to the Ingress or configure TLS — local dev only, no external exposure (ARCH Out of Scope).
- Do NOT modify `k8s/core-api.yaml` or `k8s/frontend.yaml` — ports/selectors already match; the Ingress references them by name only.
- Do NOT amend ADR-008 — ARCH's Open Questions defers that to the actual AWS/EKS migration task.

### Files Expected

**New files:**
- `k8s/ingress.yaml` (standard `Ingress`, `/api` → core-api Service, `/` → frontend Service; pattern reference: `k8s/core-api.yaml` labeling/namespace convention)

**Modified files:**
- `README.md` (new "First-run setup" step for the one-time `ingress-nginx` install; updated "Verify" section describing browsing via the Ingress at `http://localhost`)

**Must NOT modify:**
- `k8s/core-api.yaml` (silent-regression hotspot — covered by regression-guard check above)
- `k8s/frontend.yaml` (silent-regression hotspot — covered by regression-guard check above)
- `Makefile` (silent-regression hotspot — controller install is a manual step, not a build/deploy step)

---

## Task T3: Frontend app shell + routing

> **Status:** done
> **Verification:** ui
> **Effort:** m
> **Priority:** high
> **Depends on:** T1 (Dashboard's "Connected to API ✓" check needs a real `/api/health` endpoint to verify against)
> **Satisfies REQs:** R4, R5, R6
> **Footprint slice:** New: `frontend/src/App.tsx`, `frontend/src/components/Layout.tsx`, `frontend/src/components/NavBar.tsx`, `frontend/src/pages/Dashboard.tsx`, `frontend/src/pages/Expenses.tsx`, `frontend/src/pages/Settings.tsx`, `frontend/src/styles/theme.css`; Modified: `frontend/src/main.tsx`, `frontend/package.json`, `frontend/vite.config.ts`; Touched but not changed: `frontend/nginx.conf`
> **High-risk areas touched:** Frontend routing — Risk L (purely additive; nginx SPA fallback already anticipated this, per ARCH).

### Description

Replaces the single inline `App()` in `main.tsx` with a routed app shell: a `Layout` (NavBar + content area) and three routes (`/dashboard`, `/expenses`, `/settings`) using `react-router-dom`. The Dashboard route fetches `/api/health` on mount and visibly shows connection status — the user-facing proof that the frontend→API plumbing works end to end.

### Verification Checklist

- **NavBar renders and links to all three routes** — load the app, inspect the NavBar — expected: logo, "Dashboard"/"Expenses"/"Settings" links, and an avatar placeholder are all visible; dark theme CSS variables are applied (`:root` custom properties from `theme.css`) _(verifies R4)_.
- **Client-side navigation works** — click each NavBar link in sequence — expected: URL changes to `/dashboard`, `/expenses`, `/settings` with no full-page reload (verify via DevTools Network tab showing no new document request) _(verifies R4)_.
- **Placeholder pages show "Coming soon"** — navigate to `/expenses` and `/settings` — expected: each renders "Coming soon" text, no data or forms _(verifies R6)_.
- **Dashboard shows success state** — with core-api reachable, navigate to `/dashboard` — expected: page fetches `/api/health` on mount and displays "Connected to API ✓" _(verifies R5)_.
- **Dashboard shows failure state** — with core-api unreachable (stop the service, or block the request via DevTools) — expected: page displays a "Connection failed" (or equivalent) state, no unhandled exception in the console _(verifies R5, ARCH Cross-Cutting error handling)_.
- **Hard refresh on placeholder routes doesn't 404** — navigate directly to `http://localhost/expenses` (full browser navigation, not client-side) and hard-refresh `/settings` — expected: page loads correctly via `nginx.conf`'s existing `try_files ... /index.html` fallback, no 404 _(guards backward-regression risk for `frontend/nginx.conf`)_.
- **Host-run dev proxy works** — run `npm run dev`, load the app from the Vite dev server, navigate to `/dashboard` — expected: the relative `/api/health` fetch resolves through `vite.config.ts`'s `server.proxy` to `localhost:8080` with no CORS error in the console _(verifies A7's dev workflow requirement, backed by T1's CORS allowlist)_.
- **No auth/database/real-data UI present** — scan all three pages — expected: no login form, no data tables, no persisted state; placeholders only _(verifies R6)_.

#### Testable Seams

- `NavBar` — renders all three links + avatar placeholder (render test).
- `Dashboard` — renders "Connected to API ✓" vs. failure state depending on mocked `fetch` resolution/rejection (conditional-state test).
- `Layout` — renders `NavBar` plus its children in the content area (render test).

### Implementation Notes

- **Module(s):** `frontend/src/components/` (shared chrome: Layout, NavBar), `frontend/src/pages/` (route-level screens), `frontend/src/main.tsx` (app entry: router root + theme import), per ARCH's Module Boundaries.
- **Pattern reference:** none exists yet in this codebase (currently a single inline `App()` in `main.tsx`) — this task establishes the pattern other frontend tasks will follow.
- **Key decisions:** A4 — classic `<BrowserRouter>` + `<Routes>`/`<Route>` (not a data router — no loaders needed for static placeholders); A5 — plain `fetch()` in a `useEffect`/`useState` on Dashboard, not TanStack Query (premature for one status fetch); A6 — plain CSS file with `:root` dark-theme custom properties, not Tailwind/shadcn; A7 — `vite.config.ts` `server.proxy` for `/api` → `http://localhost:8080`, required because the Dashboard fetches a relative path that would otherwise 404 against Vite's own dev server.
- **Libraries:** add `react-router-dom` (latest v6) to `frontend/package.json` — the only new dependency (ARCH's "minimal dependency footprint" precedent: no Tailwind, no TanStack Query at this scope).
- **High-risk callouts:** Frontend routing is L risk per ARCH because `nginx.conf`'s `try_files` fallback was already confirmed sufficient — the hard-refresh checklist item above is the direct verification of that claim, not a new risk to design around.

### Scope Boundaries

- Do NOT install Tailwind, shadcn/ui, or any UI component library — issue scope asks only for CSS custom properties (ARCH Out of Scope, A6).
- Do NOT install TanStack Query or any data-fetching library — one status fetch doesn't justify it yet (ARCH Out of Scope, A5).
- Do NOT add auth, database calls, or real data to any page — placeholders only (ARCH Out of Scope).
- Do NOT add retry logic or an error boundary around the Dashboard fetch — a single caught failure state is sufficient at this scope (ARCH Cross-Cutting Concerns: "no retry, no error boundary").
- Do NOT modify `frontend/nginx.conf` — its existing SPA fallback already handles the new routes.

### Files Expected

**New files:**
- `frontend/src/App.tsx` (root component: `<Layout>` + `<Routes>`)
- `frontend/src/components/Layout.tsx` (page chrome wrapper: NavBar + content area)
- `frontend/src/components/NavBar.tsx` (nav links + avatar placeholder)
- `frontend/src/pages/Dashboard.tsx` (fetches `/api/health` on mount, shows connection status)
- `frontend/src/pages/Expenses.tsx` ("Coming soon" placeholder)
- `frontend/src/pages/Settings.tsx` ("Coming soon" placeholder)
- `frontend/src/styles/theme.css` (dark theme `:root` CSS variables)

**Modified files:**
- `frontend/src/main.tsx` (remove inline `App()`; wrap `<App />` in `<BrowserRouter>`; import `styles/theme.css`)
- `frontend/package.json` (add `react-router-dom` dependency)
- `frontend/vite.config.ts` (add `server.proxy` entry: `/api` → `http://localhost:8080`)

**Must NOT modify:**
- `frontend/nginx.conf` (silent-regression hotspot — covered by hard-refresh checklist item above; existing `try_files` fallback is already sufficient)
