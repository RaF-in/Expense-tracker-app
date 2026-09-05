# Architecture: End-to-End Route Resolves (Frontend → Core API)

> **Date:** 2026-09-05
> **Issue:** #2
> **Phase:** 2 of 5 (System Architecture)
> **Requirements source:** Standalone brief — see Inferred Requirements (`specs/context/2.md`, sourced from GitHub issue #2)
> **Tasks:** TASKS-2-e2e-route-resolves.md
> **Type:** feature

## Architecture Summary

This task wires the first real network path through the cluster: browser → Ingress → frontend or core-api, on the same origin. It installs `ingress-nginx` as the cluster's ingress controller (a one-time, documented manual step — not part of `make deploy`), adds a standard `networking.k8s.io/Ingress` routing `/api/*` to `core-api` and `/*` to `frontend`, gives `core-api` a `GET /api/health` endpoint plus a CORS allowlist, and turns the frontend from a single inline component into a routed app shell (NavBar + 3 placeholder pages) that fetches `/api/health` on the Dashboard route and displays connection status. No new services, no persistence, no auth — this task proves the plumbing, nothing else.

## Inferred Requirements (Mode B)

| ID | Inferred Requirement | Source |
|----|----|----|
| R1 | Browser can reach both frontend and core-api through one Ingress on `localhost`, no port-forwarding required to verify boot. | Issue #2 goal statement |
| R2 | `core-api` exposes `GET /api/health` returning `{status, timestamp, version}`. | Issue #2 "What to build" table |
| R3 | `core-api` allows cross-origin calls from the frontend's origin(s), including a host-run Vite dev server. | Issue #2 CORS line + developer confirmation (Vite dev workflow is real) |
| R4 | Frontend has client-side routing across `/dashboard`, `/expenses`, `/settings` with a shared NavBar/layout shell and a dark theme. | Issue #2 "What to build" table |
| R5 | Dashboard route fetches `/api/health` on mount and visibly shows "Connected to API ✓" or a failure state. | Issue #2 verification block |
| R6 | No auth, no database, no real data — routing/plumbing only. | Issue #2 "NOT in scope" |

## High-Level Structure

```
Browser
  │
  ▼
ingress-nginx (NEW — one-time Helm/manifest install, cluster infra, not an app image)
  ├─ path /api  ──▶  Service core-api  (port 80 → 8080)  [MODIFIED: +GET /api/health, +CORS]
  └─ path /     ──▶  Service frontend  (port 80 → 80)    [MODIFIED: +React Router, +pages, +fetch]
```

- **Ingress** is new cluster wiring (`k8s/ingress.yaml`) plus a one-time controller install, following the same "external piece already in `k8s/`" pattern as Postgres/RabbitMQ.
- **Core API** grows one endpoint on its existing Minimal API pipeline (`Program.cs`) — no new files.
- **Frontend** goes from a single inline `App()` to router + layout shell + 3 route components + one fetch-on-mount call — the largest footprint of the three.
- Once both are behind the same Ingress origin (`localhost`), browser→API calls are same-origin; CORS only becomes load-bearing for the confirmed host-run Vite dev workflow (`npm run dev` calling the in-cluster API), where it's a real requirement.

## Tech Choices

| Area | Decision | Alternatives Considered | Rationale |
|----|----|----|----|
| Ingress controller | `ingress-nginx`, installed via the upstream pinned "cloud" provider manifest (`kubectl apply -f .../controller-v1.11.3/deploy/static/provider/cloud/deploy.yaml`), documented as a new README "First-run setup" step | Traefik via Helm (issue's literal ask, matches ADR-008); Docker Desktop's built-in ingress toggle | Developer chose nginx-ingress explicitly over Traefik after weighing AWS/EKS portability — both are production-grade there, but this deviates from ADR-008's named choice (recorded as a deliberate divergence, see Open Questions / ADR note). |
| Ingress resource shape | Standard `networking.k8s.io/Ingress`, `ingressClassName: nginx`, host-agnostic (no `host:` field), `/api` → core-api, `/` → frontend, no path rewrite | Traefik `IngressRoute` CRD; rewrite `/api` at the ingress and register plain `/health` on core-api | Standard `Ingress` is portable across nginx/ALB; keeping the `/api` prefix on core-api routes matches the issue text verbatim and avoids a rewrite-annotation to maintain. |
| CORS origins | Hardcoded two-origin allowlist in `Program.cs`: `http://localhost`, `http://localhost:5173` | Config-driven origin list (`appsettings.json`) | Task 00 deliberately has no config-loading yet (D3 in ARCH-1). Matches that precedent; revisit when real env-based config exists. |
| React Router | `react-router-dom` (latest v6), classic `<BrowserRouter>` + `<Routes>`/`<Route>` | Data router (`createBrowserRouter`) | No loaders/actions needed — pages are static placeholders; TanStack Query (ADR-007) is the intended future server-state layer, not router loaders. |
| Health fetch | Plain `fetch()` in a `useEffect`/`useState` on the Dashboard page | Install TanStack Query now | ADR-007 picked TanStack Query for *real* data later; installing it for one status fetch is premature — matches Task 00's minimalism. |
| Styling | Plain CSS file with `:root` dark-theme custom properties | Tailwind + shadcn/ui now | Issue scope says "dark theme CSS variables," not Tailwind; neither is installed yet, and ADR-007's Tailwind/shadcn decision targets later UI-heavy tasks. |
| Vite dev proxy | `server.proxy` in `vite.config.ts`: `/api` → `http://localhost:8080` | Rely on CORS alone for host-run dev | Dashboard fetches the *relative* path `/api/health`; without a proxy that 404s against Vite's own dev server. Required to make the confirmed host-run dev workflow actually functional; CORS remains a defensive backstop. |

## Patterns & Conventions

- **`app.kubernetes.io/*` labeling** — the new `k8s/ingress.yaml` follows the same label set (`part-of`, `name`, `component`) as `core-api.yaml`/`frontend.yaml`.
- **README "First-run setup" for one-time cluster prep** — the `secrets.yaml` copy step already established this pattern; the ingress-nginx install follows it rather than being wired into `make deploy`.
- **No config-loading system** — carried forward from Task 00 (ARCH-1, decision D3); CORS origins stay literal until that changes.
- **Minimal dependency footprint** — Task 00 explicitly limited frontend deps to `react`/`react-dom`/`vite`/`typescript`; this task adds only `react-router-dom`, nothing else (no Tailwind, no TanStack Query yet).

## API Contracts / Interfaces

### Core API — Health Endpoint

**Boundary:** HTTP API (ASP.NET Core Minimal API)

**Operations:**

| Method/Op | Path / Signature | Purpose | Errors / Returns |
|----|----|----|----|
| GET | `/api/health` | Liveness/connectivity probe for the frontend to display | 200 `{ "status": "ok", "timestamp": "<ISO-8601 UTC>", "version": "0.1.0" }`. No error cases — literal response. |

**Auth requirements:** None — unauthenticated by design (plumbing probe, not a data endpoint).

## Module Boundaries

| Module / Package | Responsibility | Allowed Dependencies |
|----|----|----|
| `frontend/src/components/` | Shared chrome (Layout, NavBar) | React, `react-router-dom` |
| `frontend/src/pages/` | Route-level screens (Dashboard, Expenses, Settings) | React, `react-router-dom`, browser `fetch` |
| `frontend/src/main.tsx` | App entry: router root + theme import | `App.tsx`, `react-router-dom`, `styles/theme.css` |
| `services/core-api/src/Program.cs` | HTTP surface (routes, CORS policy) | ASP.NET Core Minimal API only — no new project files at this scope |

## Change Footprint

### New files / modules

| Path | Purpose | Pattern reference |
|----|----|----|
| `k8s/ingress.yaml` | Standard `Ingress`, `/api`→core-api, `/`→frontend | `k8s/core-api.yaml` (labeling/namespace convention) |
| `frontend/src/App.tsx` | Root component: `<Layout>` + `<Routes>` | — |
| `frontend/src/components/Layout.tsx` | Page chrome wrapper (NavBar + content area) | — |
| `frontend/src/components/NavBar.tsx` | Nav links (Dashboard/Expenses/Settings) + avatar placeholder | — |
| `frontend/src/pages/Dashboard.tsx` | Fetches `/api/health` on mount, shows connection status | — |
| `frontend/src/pages/Expenses.tsx` | "Coming soon" placeholder | — |
| `frontend/src/pages/Settings.tsx` | "Coming soon" placeholder | — |
| `frontend/src/styles/theme.css` | Dark theme `:root` CSS variables | — |

### Modified files / modules

| Path | What changes here |
|----|----|
| `services/core-api/src/Program.cs` | Add `AddCors`/`UseCors` (two-origin allowlist); add `MapGet("/api/health", ...)`. |
| `frontend/src/main.tsx` | Remove inline `App()`; wrap `<App />` in `<BrowserRouter>`; import `styles/theme.css`. |
| `frontend/package.json` | Add `react-router-dom` dependency. |
| `frontend/vite.config.ts` | Add `server.proxy` entry: `/api` → `http://localhost:8080`. |
| `README.md` | New "First-run setup" step (one-time `ingress-nginx` install); update "Verify" section to describe browsing via the Ingress at `http://localhost`. |

### Deleted / replaced

None.

### Touched but not changed (silent-regression hotspots)

| Path | Why it matters |
|----|----|
| `frontend/nginx.conf` | SPA fallback (`try_files ... /index.html`) already handles client-side route refreshes — confirmed sufficient, no change needed. |
| `k8s/core-api.yaml`, `k8s/frontend.yaml` | Service definitions referenced by name from the new Ingress; ports/selectors already match, no change needed. |
| `Makefile` | No change — ingress controller install stays a manual README step, not part of `build`/`deploy`. |

## Areas of Impact

| Area | Impact | Risk (L/M/H) | Why |
|----|----|----|----|
| Local dev bootstrap (README, first-run) | New manual one-time step (ingress-nginx install) | M | Easy to forget/skip; if missed, `make deploy` still succeeds but the app is unreachable via `http://localhost` with a confusing symptom (connection refused, not an app error). |
| CORS config | Two hardcoded origins added to `Program.cs` | L | Small blast radius; will need revisiting once real config/env separation exists (tripwire, not a bug today). |
| Vite dev proxy | New `server.proxy` config | L | Additive only — doesn't touch the `make build`/`deploy` path, only the optional host-run dev loop. |
| Frontend routing | New router, layout, pages | L | Purely additive; nginx SPA fallback already anticipated this. |
| ADR-008 divergence (Traefik → nginx-ingress, local only) | Local dev ingress controller no longer matches ADR-008's named choice | M | If an AWS/EKS migration later assumes Traefik-specific config (IngressRoute CRDs, Traefik middleware), that assumption is now wrong for local dev parity. Worth a follow-up note in ADR-008 itself. |

**Contract changes:** New public contract — `GET /api/health` response shape (`status`, `timestamp`, `version`). No consumers exist yet beyond the new Dashboard page, so no breaking-change risk today.

**Cross-cutting ripples:** Build/deploy documentation (README) gains a new prerequisite step; no CI, no feature flags, no migrations touched.

## Cross-Cutting Concerns

- **Errors:** `fetch('/api/health')` failure (network error, non-2xx, controller not installed) is caught in Dashboard's `useEffect` and rendered as "Connection failed" — no retry, no error boundary. Core-api's route can't throw (returns a literal object).
- **Logging & metrics:** No new logging beyond existing startup log; `/api/health` requests are not individually logged, matching Task 00's minimal-logging precedent.
- **Auth / authz:** None — `/api/health` is unauthenticated by design; explicitly out of scope for this task.
- **Performance:** Non-issue at this scope — one static JSON endpoint, one client-side fetch on mount.
- **Security:** CORS allowlist is literal (no wildcard, no origin reflection). `/api/health` returns no sensitive data. No TLS on the Ingress — consistent with README's existing "local dev only, no external exposure" framing.
- **Migrations / rollout:** No data migrations. Rollout is manual (`make build && make deploy` + the new one-time ingress-nginx install), consistent with Task 00's rollout model. Existing pods are unaffected — the Ingress addition is purely additive routing in front of already-running Services.

## Architecture Decisions Log

| # | Decision | Alternatives | Chosen Because | Satisfies REQs |
|----|----|----|----|----|
| A1 | Ingress controller: `ingress-nginx` | Traefik via Helm; Docker Desktop's built-in ingress | Developer's explicit call after weighing AWS/EKS portability; both are production-grade there — deviates from ADR-008's named Traefik choice (recorded, not silently overridden) | R1 |
| A2 | Standard `networking.k8s.io/Ingress`, host-agnostic, `/api` prefix kept on core-api routes | Traefik `IngressRoute` CRD; rewrite `/api` at ingress | Portable resource type; keeps issue's literal `/api/health` path with no rewrite annotation to maintain | R1, R2 |
| A3 | CORS: hardcoded two-origin allowlist in `Program.cs` | Config-driven origin list | No config-loading system exists yet (Task 00 D3 precedent); revisit later | R3 |
| A4 | React Router: classic `<BrowserRouter>`/`<Routes>` | Data router (`createBrowserRouter`) | No loaders needed at this scope; TanStack Query is the future server-state layer per ADR-007 | R4 |
| A5 | Health fetch: plain `fetch()` + `useState`/`useEffect` | Install TanStack Query now | Premature for one status fetch; matches Task 00 minimalism | R5 |
| A6 | Styling: plain CSS custom properties | Tailwind + shadcn/ui now | Issue scope only asks for CSS variables; Tailwind/shadcn deferred to later UI-heavy tasks per ADR-007 | R4 |
| A7 | Vite dev proxy added to `vite.config.ts` | CORS-only, no proxy | Required to make the confirmed host-run `npm run dev` workflow actually functional (relative fetch path would 404 without it) | R3 |
| A8 | ingress-nginx install: one-time manual README step | Wire into `make deploy` | It's cluster infrastructure, not an app image — doesn't fit the guarded app build/deploy loop | R1 |

## Risk & Stress-Test Scenarios

### Forward — runtime failure scenarios

| Scenario | How the Design Handles It |
|----|----|
| ingress-nginx controller not installed / not ready when `make deploy` runs | `kubectl apply -f k8s/ingress.yaml` still succeeds (Ingress object doesn't require the controller to exist), but `http://localhost` connection-refuses until the controller comes up — mitigated by an explicit, ordered README step before "Verify." |
| Two browser tabs hit `/dashboard` simultaneously | Stateless GET, no shared mutable state — no race condition possible. |
| `core-api` pod restarts while a health check is in flight | `fetch` rejects, Dashboard shows "Connection failed"; recovers on refresh once the Service routes to the new pod — this is the scenario the task exists to make visible, not hide. |
| Rollback needed after this deploy breaks boot | `git revert` + `make build && make deploy` — no persistent state (DB/queue) touched by this task, so rollback is clean. |

### Backward — regression risk per touched area (brownfield only)

| Touched area (from Change Footprint) | What could regress | How we'd know / mitigation |
|----|----|----|
| `frontend/nginx.conf` (touched-but-not-changed) | New client-side routes (`/expenses`, `/settings`) 404 on hard refresh | Verified in Phase D2: existing `try_files ... /index.html` fallback already handles this — no change needed, no regression surface. |
| `k8s/core-api.yaml` / `frontend.yaml` (touched-but-not-changed) | Existing port-forward-based verification in README breaks | Services are unmodified — Ingress only references them by name/port; port-forward paths keep working unchanged. |
| `services/core-api/src/Program.cs` — CORS newly added | An existing caller gets unexpectedly blocked | CORS only *widens* browser access (default is same-origin-only); it can't restrict any existing caller, so no regression risk here. |

## Open Questions

- Should ADR-008 itself be amended to reflect the nginx-ingress-for-local / Traefik-or-ALB-for-AWS split, or left as-is until the actual AWS migration task?
  - **Impact if unresolved:** ADR-008 will read as contradicting what's actually running locally, confusing future readers (including future-you).
  - **Suggested default:** Leave ADR-008 unchanged for now; this ARCH doc is the record of the divergence. Revisit ADR-008 when the AWS/EKS deployment task actually starts.

## Out of Scope

- Auth, database, real data (reason: explicitly excluded by issue #2 — plumbing-only task).
- TLS on the Ingress (reason: local dev only, no external exposure — matches existing README framing).
- Tailwind/shadcn UI library adoption (reason: issue scope only calls for CSS variables; deferred to a later UI-heavy task per ADR-007).
- TanStack Query adoption (reason: one status fetch doesn't justify the dependency yet; deferred to when real data-fetching needs arrive).
- Config-loading system / env-based CORS origins (reason: no config system exists yet in the project; tripwire only).
