# Architecture: Auth0 Integration — All Routes Protected

> **Date:** 2026-09-10
> **Issue:** #3
> **Phase:** 2 of 5 (System Architecture)
> **Requirements source:** `specs/requirements/REQ-3-auth0-integration-all-routes-protected.md`
> **Tasks:** `specs/tasks/TASKS-3-auth0-integration-all-routes-protected.md`
> **Type:** infrastructure
>
> **Amendment (2026-09-12, developer decision):** the GitHub connection is **dropped from
> scope** — connections are Database and Google only. See the Decisions Log amendment in
> `REQ-3-auth0-integration-all-routes-protected.md`. GitHub can be added later via the runbook
> with no code change.

## Architecture Summary

Identity is delegated entirely to Auth0; this task builds the two independent defenses that
consume it. In the browser, an `Auth0Provider` wraps the router and a single `ProtectedRoute`
gate renders one of three states — resolving, unauthenticated, authenticated — so no protected
chrome can render before identity is known. In the Core API, `JwtBearer` validates Auth0 access
tokens **entirely offline** against a JWKS fetched once at startup, and an authorization
*fallback policy* makes every endpoint protected by default, with exactly two greppable
`.AllowAnonymous()` exceptions (`/` and `/api/health`).

The one genuinely novel piece of infrastructure is **runtime configuration for the SPA**. Vite
bakes `VITE_*` variables into the bundle at build time, so a Kubernetes Secret mounted into the
frontend pod can never reach the browser — the pod runs nginx, while the code that needs the
values runs on the user's machine. A container-start entrypoint bridges that gap by rendering
`config.js` from environment variables, which keeps one frontend image valid in every
environment (N2) and preserves build-once-deploy-everywhere.

Two library behaviors force design decisions the requirements did not anticipate: Auth0 access
tokens carry **no** `email` or `name` claim (fixed by a Post-Login Action adding namespaced
custom claims), and .NET silently rewrites `sub` to a WS-Federation URI unless
`MapInboundClaims` is disabled. Both fail *quietly* — returning 200 with null fields — which is
why they are settled here rather than discovered mid-implementation.

No database, no user table, no session store. `sub` is the permanent identifier that issue #4
will persist as `Transaction.UserId`.

## High-Level Structure

```
Browser
  │
  ├────────────────────▶ Auth0 tenant  (external — configured, not coded)
  │                        • Universal Login
  │                        • /oauth/token        — issue + refresh
  │                        • /.well-known/jwks.json — public signing keys
  │                        • Post-Login Action   — injects namespaced claims
  │
  ▼
ingress-nginx  ·  http://localhost
  │
  ├─ /     ──▶ frontend pod (nginx, static dist/)
  │              NEW  docker-entrypoint.d/40-app-config.sh → renders config.js at boot
  │              MOD  AuthProvider · ProtectedRoute · useApi · NavBar avatar + logout
  │
  └─ /api  ──▶ core-api pod (ASP.NET Core Minimal API)
                 NEW  Auth0Options (validated at startup)
                 MOD  JwtBearer + FallbackPolicy + eager JWKS + GET /api/me
```

**Auth0 is not in the API's request path.** The Core API contacts Auth0 exactly once, at startup,
to fetch signing keys. Every subsequent validation is a local RSA signature check (N4) — an Auth0
outage cannot take the API down.

### Flow 1 — logged-out visitor deep-links to `/expenses` (R2, R3)

```
GET /expenses → nginx → index.html (try_files, already in place)
  → <script src="/config.js">   window.__APP_CONFIG__ available synchronously
  → AuthProvider boots, Auth0 SDK checks for an existing session
  → isLoading           → ProtectedRoute renders FULL-PAGE loader, no NavBar   (R3)
  → not authenticated   → loginWithRedirect({ appState: { returnTo: "/expenses" } })
  → Auth0 Universal Login → user signs in → back to http://localhost?code=…
  → SDK exchanges code → onRedirectCallback(appState) → navigate("/expenses")   (R2)
```

### Flow 2 — an authenticated API call (R6, R7, R8)

```
component → useApi()
  → getAccessTokenSilently()      SDK returns cached token, or exchanges the
                                  refresh token if expired  (proactive — A14)
  → fetch("/api/me", { Authorization: "Bearer <access token>" })
  → refresh itself fails → loginWithRedirect()             (R8)
```

### Flow 3 — API-side validation (R11–R13, N1, N4)

```
startup:   bind Auth0__Domain / Auth0__Audience
           → missing or malformed → ValidateOnStart throws → process exits
                                    → CrashLoopBackOff naming the setting     (N1)
           → eager fetch of OIDC discovery + JWKS → cached                    (N4, A12)

request:   FallbackPolicy requires an authenticated user
           → absent / expired / wrong aud / wrong iss / malformed → 401       (R11, R13)
           → valid → claims exposed to endpoint code                          (R12)
           → "/" and "/api/health" are .AllowAnonymous()                       (R10, A2)
```

## Tech Choices

| Area | Decision | Alternatives Considered | Rationale |
|---|---|---|---|
| Frontend SDK | `@auth0/auth0-react` v2 | `@auth0/auth0-spa-js` direct; `oidc-client-ts` | Provides `Auth0Provider`, `useAuth0`, and `appState` round-tripping — R2's deep-link restore comes free. Named in the foundation plan §Task 02. |
| Token storage | `useRefreshTokens: true`, `cacheLocation: 'localstorage'`, rotation enabled | `cacheLocation: 'memory'` (SDK default); BFF with httpOnly cookie | Memory cache holds no refresh token across a reload and falls back to hidden-iframe silent auth, which third-party-cookie blocking breaks. R3 explicitly tests a page reload. BFF is stronger but requires a backend session layer outside this task's scope. |
| Scopes requested | `openid profile email offline_access` | Omit `offline_access` | Without `offline_access` Auth0 issues **no refresh token** and R7 cannot pass. Also requires `Allow Offline Access` on the API (runbook §1a). |
| Frontend HTTP layer | Hand-rolled `useApi()` hook over native `fetch` | axios + interceptors; TanStack Query now | Two call sites exist; the wrapper is ~20 lines. ARCH-2 established deliberate dependency minimalism. The refresh/retry machinery axios interceptors usually carry already lives inside `getAccessTokenSilently()`. ADR-007 places TanStack Query with real data — issue #4. |
| SPA runtime config | `envsubst` renders `config.js` from env in `/docker-entrypoint.d/` at container start | Build-time `VITE_*`; `config.json` fetched before render; `GET /api/config` on the Core API | Preserves build-once-deploy-everywhere — the artifact tested is the artifact shipped (N2). Uses a documented hook in the nginx base image, needs no `ENTRYPOINT` override, and `envsubst` is already present (no `apk add`). A `.js` global is available synchronously, avoiding a config loading state in front of the auth loading state. |
| Config → pod | Explicit `env:` + `secretKeyRef` per key | `envFrom: secretRef` on the deployments | Least privilege, and required for name mapping — core-api needs `Auth0__Domain`, the frontend needs `AUTH0_DOMAIN`, from one Secret key. See A6. |
| Backend auth package | `Microsoft.AspNetCore.Authentication.JwtBearer` 10.0.x | `Auth0.AspNetCore.Authentication` | The Auth0 package targets cookie-based MVC login flows. For bearer-token validation on an API the Microsoft package is correct and adds no vendor coupling. |
| Protected-by-default | `AuthorizationOptions.FallbackPolicy = RequireAuthenticatedUser()` | `.RequireAuthorization()` per endpoint | Inverts the failure mode: forgetting to think about a new endpoint yields a 401, not a silent public hole. Makes "no endpoint is born unprotected" a property of the pipeline rather than a habit. |
| Claim name handling | `MapInboundClaims = false` | Library default | Default maps `sub` to `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier`, so `User.FindFirst("sub")` returns null for a valid token. `sub` becomes `Transaction.UserId` in #4 — a mangled value here is wrong data one ticket later. |
| Clock skew | `ClockSkew = TimeSpan.FromSeconds(30)` | Library default (5 minutes) | With the default, a token expired 3 minutes ago validates successfully, so R13/AC-17's expired-token check returns **200** and reads as broken validation. 30s keeps the test honest while tolerating real drift. |
| Config binding + fail-fast | Options pattern: `AddOptions<Auth0Options>().Bind().Validate().ValidateOnStart()` | Manual null-checks in `Program.cs` | Throws during host build, before the server listens → process exits → `CrashLoopBackOff` with a structured message naming the setting. Exactly N1. |
| JWKS acquisition | Eager fetch at startup | Lazy on first request (library default) | The library default means a wrong tenant produces a green pod that 401s everything — precisely the failure REQ decision 7 exists to prevent. Eager fetch also removes the network call from the *first* request, a stronger N4. Trade-off: an Auth0 outage blocks a deploy. |
| Profile claims | Post-Login **Action** adds namespaced custom claims to the access token | API calls `/userinfo` per request; return `sub` only | Access tokens carry no `email`/`name`. `/userinfo` would put outbound HTTP in the hot path, violating N4. `sub`-only contradicts R12/AC-16. |
| Token refresh strategy | **Proactive** — `getAccessTokenSilently()` before each call | Reactive 401 → refresh → retry | Fewer requests, no retry logic. Requires an AC-11 wording amendment (see Open Questions). |

## Patterns & Conventions

- **Template + gitignored real file** — `frontend/config.js.template` → `frontend/public/config.js`
  mirrors the established `k8s/secrets.yaml.template` → `k8s/secrets.yaml` pattern exactly, so one
  mechanism and one mental model covers both dev and cluster (N3).
- **Fail fast and name the cause** — applied in three places: `ValidateOnStart` (API config), eager
  JWKS fetch (tenant reachability), and the entrypoint's env validation (frontend config). A
  crash-loop that names a setting beats a green pod that 401s everything (REQ decision 7).
- **Explicit public surface** — `FallbackPolicy` plus two `.AllowAnonymous()` calls means
  `grep -n AllowAnonymous Program.cs` is the complete, auditable answer to "what is public?"
- **`app.kubernetes.io/*` labelling** — unchanged; no new manifests, only edits to existing ones.
- **Minimal dependency footprint** (ARCH-2) — exactly one npm package and one NuGet package added.
  No axios, no TanStack Query, no Tailwind.
- **README "First-run setup" for one-time manual work** — established by the `secrets.yaml` copy and
  the ingress-nginx install; the Auth0 tenant runbook follows it.
- **Route-level screens live in `pages/`** (ARCH-2 module boundaries) — `LoginError.tsx` goes there,
  not in `auth/`, despite belonging to the auth flow.

## Data Models

**No persisted entities.** This task introduces no database, no user table, and no session store —
identity lives entirely in Auth0 (ADR-002). The models below are in-memory configuration and
claim shapes that downstream code depends on.

### Auth0Options (Core API)

**Purpose:** the API's Auth0 configuration, bound from environment and validated before the host starts.

**Key fields:**
| Field | Type / Constraint | Notes |
|---|---|---|
| `Domain` | `string`, required, non-empty, hostname shape | Bare host (`dev-xxx.us.auth0.com`) — no scheme. `Authority` is derived as `https://{Domain}/`; a trailing slash is required by the OIDC discovery convention. |
| `Audience` | `string`, required, non-empty | Must equal the Auth0 API Identifier exactly. A mismatch produces 401 on every request with a valid-looking token. |

**Lifecycle:** bound at host build → validated by `ValidateOnStart()` → immutable for the process
lifetime. Invalid → exception → process exit → `CrashLoopBackOff` (N1).

### AppConfig (Frontend)

**Purpose:** Auth0 settings delivered to the browser at runtime rather than compiled into the bundle.

**Key fields:**
| Field | Type / Constraint | Notes |
|---|---|---|
| `domain` | `string`, required | Bare host, matching `Auth0Options.Domain`. |
| `clientId` | `string`, required | SPA client. Public by design — a public client cannot hold a secret. |
| `audience` | `string`, required | **Must** be passed on the token request, or Auth0 returns an opaque token instead of a JWT. |

**Lifecycle:** rendered into `config.js` by the container entrypoint (or copied from the template
for Vite dev) → read and validated by `config.ts` at module load → consumed by `AuthProvider`.
A missing or blank field throws before React mounts, surfacing a "Configuration error" page
rather than a white screen.

### Identity claims (the `/api/me` shape)

**Purpose:** the caller's identity as read from a validated access token. Not persisted here;
`sub` becomes `Transaction.UserId` in issue #4.

**Key fields:**
| Field | Type / Constraint | Notes |
|---|---|---|
| `sub` | `string`, present on every token | Permanent, **connection-specific** identifier. The same person via Google and password yields two distinct values — expected in this task, resolved in #4. |
| `email` | `string \| null` | From custom claim `https://expense-tracker.local/email`. Null for machine tokens. |
| `name` | `string \| null` | From custom claim `https://expense-tracker.local/name`. Can be null for social accounts. |

**Relationships:** none in this task. `sub` becomes the logical FK from `Transaction.UserId` in #4.

**Lifecycle:** claims exist only for the duration of a request. Nothing is written anywhere.

## API Contracts / Interfaces

### Core API — HTTP

**Boundary:** HTTP API (ASP.NET Core Minimal API)

**Operations:**

| Method/Op | Path / Signature | Purpose | Errors / Returns |
|---|---|---|---|
| GET | `/` | Service identity probe; convention shared with `ingestion-service` and `receipt-service` | 200 `{ service, status }`. Unchanged. Anonymous. |
| GET | `/api/health` | Liveness/connectivity probe | 200 `{ status, timestamp, version }`. Unchanged. Anonymous. |
| GET | `/api/me` | Return the authenticated caller's identity | 200 `{ sub, email, name }` · 401 when the token is absent, expired, malformed, or has a wrong `iss`/`aud` |

**Auth requirements:** `/api/me` requires a valid Auth0 access token. `/` and `/api/health` are the
only anonymous endpoints. Every future endpoint is protected by default (fallback policy) and must
opt out explicitly to be public.

**Error production:** all 401s are emitted by the JwtBearer middleware before endpoint code runs —
including for a malformed `Authorization` header. No endpoint contains a try/catch, and no
unauthenticated caller can provoke a 500 (R13).

### Auth0 Tenant — Configuration Contract

**Boundary:** external system, configured through the Auth0 console. Not in version control.
Click-by-click procedure: `docs/auth0-setup-runbook.md`.

| Setting | Required value | Why |
|---|---|---|
| API Identifier | `https://api.expense-tracker.local` | Becomes `audience`; immutable after creation |
| API Signing Algorithm | RS256 | Enables offline validation via public JWKS (N4) |
| API → Allow Offline Access | **ON** | Without it no refresh token is issued and R7 cannot pass |
| API → Token Expiration | `86400` (temporarily `60` to verify R7, then restored) | REQ decision 14 |
| Application type | Single Page Application | Public client; enables rotation settings |
| Allowed Callback URLs | `http://localhost, http://localhost:5173` | R15 |
| Allowed Logout URLs | `http://localhost, http://localhost:5173` | R9, R15 |
| Allowed Web Origins | `http://localhost, http://localhost:5173` | CORS for silent renewal — its absence breaks refresh, not login |
| Refresh Token Rotation | ON, reuse interval `0` | Single-use tokens + reuse detection; mitigates `localStorage` storage (A7) |
| Grant Types | Authorization Code, Refresh Token | Login and silent renewal |
| Connections | Database, Google (Auth0 dev keys) | REQ scope (amended 2026-09-12 — GitHub dropped) |
| Post-Login Action | Sets `https://expense-tracker.local/email` and `.../name` on the **access token** | R12 — see A13 |

**Consumed by:** `config.ts` / `AuthProvider` (domain, clientId, audience) and `Auth0Options`
(domain, audience). The Action's namespace strings are read verbatim in `Program.cs`.

### Frontend — internal module interfaces

**Boundary:** internal modules

| Method/Op | Path / Signature | Purpose | Errors / Returns |
|---|---|---|---|
| `useApi()` | `() => (path: string, init?: RequestInit) => Promise<Response>` | Authenticated fetch: acquires a token, attaches `Authorization` | Refresh failure → `loginWithRedirect()`; HTTP errors returned to the caller unmodified |
| `getInitials()` | `(user?: User) => string \| null` | Avatar initials: `name` → email local-part → `null` (generic icon) | Pure; never throws, never returns `""` (R5) |
| `config` | `AppConfig` (module-level export) | Validated runtime configuration | Throws at module load if any field is missing |

## Module Boundaries

| Module / Package | Responsibility | Allowed Dependencies |
|---|---|---|
| `frontend/src/config.ts` | Read and validate `window.__APP_CONFIG__` | None (browser globals only) |
| `frontend/src/auth/` | Auth0 wiring, the route gate, authenticated fetch, initials | React, `react-router-dom`, `@auth0/auth0-react`, `config.ts` |
| `frontend/src/components/` | Shared chrome (Layout, NavBar) | React, `react-router-dom`, `@auth0/auth0-react` (NavBar only), `auth/initials` |
| `frontend/src/pages/` | Route-level screens | React, `react-router-dom`, `auth/useApi` |
| `frontend/docker-entrypoint.d/` | Render `config.js` from env at container start | POSIX shell + `envsubst` only |
| `services/core-api/src/Auth/` | Auth0 configuration shape and validation | ASP.NET options/validation primitives only |
| `services/core-api/src/Program.cs` | Pipeline composition, endpoint registration | Auth package, `Auth/` |

**Rules for crossing:**
- `pages/` never calls `getAccessTokenSilently()` directly — it goes through `useApi()`, so token
  handling has exactly one implementation for issue #4 to inherit.
- `config.ts` is the sole reader of `window.__APP_CONFIG__`; no other module touches the global.
- `Auth/` holds configuration shape only — no endpoint logic, no claim reading.
- The entrypoint script is the only writer of `config.js`; application code never writes it.

## Change Footprint

### New files / modules

| Path | Purpose | Pattern reference |
|---|---|---|
| `frontend/src/config.ts` | Read + validate `window.__APP_CONFIG__`; throw naming the missing key | New — no config layer existed |
| `frontend/src/auth/AuthProvider.tsx` | `Auth0Provider` + `onRedirectCallback` deep-link restore | New |
| `frontend/src/auth/ProtectedRoute.tsx` | Three-state gate (resolving / error / unauthenticated / authenticated) | New |
| `frontend/src/auth/useApi.ts` | Authenticated fetch hook; refresh failure → login | New |
| `frontend/src/auth/initials.ts` | Pure `user → initials \| null` (R5) | New |
| `frontend/src/pages/LoginError.tsx` | Public error screen + "Try again" (R4) | `pages/` = route-level screens (ARCH-2) |
| `frontend/config.js.template` | `window.__APP_CONFIG__` with `${AUTH0_*}` placeholders | Mirrors `k8s/secrets.yaml.template` |
| `frontend/docker-entrypoint.d/40-app-config.sh` | Validate 3 env vars, `envsubst` → `html/config.js`, exit ≠ 0 on missing/malformed | nginx image's documented startup hook |
| `services/core-api/src/Auth/Auth0Options.cs` | `Domain` + `Audience` with validation attributes | First structural file in core-api |
| `docs/auth0-setup-runbook.md` ✅ *written* | Tenant setup end to end (R17) | `docs/` alongside ADRs and the foundation plan |

### Modified files / modules

| Path | What changes here |
|---|---|
| `frontend/package.json` | `+ @auth0/auth0-react` — the only new frontend dependency |
| `frontend/package-lock.json` | Regenerated by `npm install` |
| `frontend/index.html` | `<script src="/config.js">` **before** the module script |
| `frontend/src/main.tsx` | Provider nesting: `BrowserRouter` → `AuthProvider` → `App` |
| `frontend/src/App.tsx` | Route tree restructured: public `/login-error`, then nested gate → chrome → pages |
| `frontend/src/components/Layout.tsx` | `{ children }` prop → `<Outlet />` |
| `frontend/src/components/NavBar.tsx` | Placeholder `div` → initials avatar from `useAuth0().user`; logout control added |
| `frontend/nginx.conf` | `location = /config.js` with `Cache-Control: no-store` |
| `frontend/Dockerfile` | `COPY` config template + entrypoint script into the runtime stage; make it executable |
| `frontend/.dockerignore` | `+ public/config.js` — keeps dev tenant values out of the image layer |
| `services/core-api/core-api.csproj` | `+ Microsoft.AspNetCore.Authentication.JwtBearer` 10.0.x |
| `services/core-api/src/Program.cs` | Options bind + `ValidateOnStart`; `AddAuthentication().AddJwtBearer` with `MapInboundClaims = false` and `ClockSkew` 30s; eager JWKS fetch; `FallbackPolicy`; `UseAuthentication`/`UseAuthorization` **after** `UseCors`; `.AllowAnonymous()` on `/` and `/api/health`; `GET /api/me` |
| `k8s/secrets.yaml.template` | `+ AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_AUDIENCE` placeholders |
| `k8s/core-api.yaml` | `env:` + `secretKeyRef` → `Auth0__Domain`, `Auth0__Audience` (2 keys only) |
| `k8s/frontend.yaml` | `env:` + `secretKeyRef` → the 3 `AUTH0_*` vars (3 keys only; never `envFrom`) |
| `Makefile` | `deploy` guard extended to verify the required Secret keys are present, not just the file |
| `README.md` | First-run setup: 3 new Secret keys, runbook link, dev `config.js` copy step; browser verification steps corrected |
| `.gitignore` | `+ frontend/public/config.js` |

### Deleted / replaced

| Path | Reason |
|---|---|
| `frontend/src/components/NavBar.tsx` — the `aria-label="avatar placeholder"` `div` | Replaced by the real initials avatar (R5) |
| `frontend/src/components/Layout.tsx` — the `children` prop signature | Replaced by `<Outlet />` so `Layout` can be a nested route element (R3) |

No files are removed.

### Touched but not changed (silent-regression hotspots)

| Path | Why it matters |
|---|---|
| `frontend/src/pages/Dashboard.tsx` | Its `fetch("/api/health")` stays plain and unauthenticated (A3), but the component now mounts only **after** login — a call that used to fire on page load now fires post-authentication. Code is correct; the changed behavior is invisible in the diff. Warrants a comment. |
| `README.md` — "Open `http://localhost` … should show Connected to API ✓" | Now redirects to Auth0 first. Following the README verbatim looks like a broken deploy. The `curl` steps remain accurate: `/api/health` → 200 and `localhost:8080/` → 200 (A2). |
| `Makefile` — `deploy` guard | Pre-existing `secrets.yaml` files pass a file-existence check while missing all three Auth0 keys. Addressed by A15; without it, failure surfaces at pod start rather than deploy time. |
| `frontend/vite.config.ts` | Unchanged and still correct, but `npm run dev` now carries an invisible external prerequisite: `http://localhost:5173` registered in Auth0 (R15). |
| `services/core-api/src/Program.cs` — the CORS block | `AllowAnyHeader()` already permits `Authorization`, so no edit is needed. Anyone later "tightening" it to an explicit list that omits `Authorization` breaks every Vite-dev API call while the ingress path keeps working — a dev-only failure. Warrants a pinning comment. |
| `frontend/.dockerignore` | Ignores `node_modules`/`dist` but not `public/`. A gitignored dev `public/config.js` would be copied by `COPY . .` into `dist/` and baked into an image layer; the entrypoint overwrites it at runtime, so nothing misbehaves and nothing is noticed. Addressed by A18. |
| `services/ingestion-service`, `services/receipt-service` | Both expose an identical public `GET /`. Neither is routed by `k8s/ingress.yaml`, so neither is externally reachable. "No endpoint is born unprotected" is a **core-api** rule in this task — recorded so it does not read as an oversight. |
| Repo-wide test infrastructure | None exists — no xUnit project, no Vitest, no Playwright. Every acceptance criterion is a manual browser/curl check. Phase 3 must plan checklist-style verification, not TDD. |

## Areas of Impact

| Area | Impact | Risk (L/M/H) | Why |
|---|---|---|---|
| Auth0 tenant configuration | Five console artifacts must exist and match the code exactly | **H** | Not in version control, not reviewable in a PR, not testable in CI. R12, R15, R16 and the entire login flow depend on console state. The runbook is the only mitigation and it is prose. |
| Every developer's local `k8s/secrets.yaml` | Three keys must be added manually | **H** | Gitignored, so it cannot be updated by a pull. Anyone checking out this branch has a broken cluster until they read the README. A15 moves detection earlier. |
| Frontend container boot | Brand-new startup stage that can fail | **M** | Shell has no type checker; a bug here means the frontend serves a page that cannot boot. Mitigated by validating and exiting non-zero with the variable named. |
| `frontend/src/App.tsx` route tree | Every route now passes through new gating code | **M** | Provider ordering (`AuthProvider` must be inside `BrowserRouter`) and the `StrictMode` double-redirect are both easy to get subtly wrong. |
| Core API request pipeline | Default changes from public to protected for all current and future endpoints | **M** | High leverage — that is the point — but a middleware-ordering mistake 401s everything, including CORS preflight. |
| `README.md` accuracy | Browser verification steps become false | **M** | Silent documentation rot; the failure mode is a developer concluding the deploy is broken. |
| Issue #4 (Task 03 — data model) | Consumes `sub` as `Transaction.UserId` | **M** | `MapInboundClaims = false` (A10) and the claims decision (A13) determine whether that value is correct. A mangled `sub` becomes wrong data in the first persisted rows. |
| Issue #5 (Task 04 — service-to-service) | Machine tokens must not break the middleware | **L** | N5 satisfied for free: no scope assertions, and claims are read null-safely, so a machine token validates and yields nulls rather than throwing. |
| Issue #6 (Task 05 — CI/e2e) | Test user created here unblocks Playwright | **L** | No coupling beyond credentials existing. |
| Sibling services | None | **L** | Untouched and not ingress-routed. |

**Contract changes:**
- `GET /api/me` is **new** — no existing consumer.
- `GET /` and `GET /api/health` are **unchanged** in shape and remain anonymous; the README `curl`
  steps for both stay valid.
- The **implicit** contract change is the pipeline default: every future `/api/*` endpoint requires a
  valid token unless it explicitly opts out. This is the deliverable, and it is what issue #4
  inherits.
- The Auth0 tenant configuration contract (above) becomes a hard external dependency of the build.

**Cross-cutting ripples:**
- **Auth** — a fallback policy now governs every endpoint that will ever be added to this service.
- **Build/deploy** — the frontend image gains a startup stage; `make deploy` gains a stricter guard;
  ordering (`build` → `deploy` → `restart`) becomes load-bearing after a Secret change.
- **Configuration** — first runtime-config mechanism in the repo; establishes the pattern issue #4
  will reuse for `DATABASE_URL`.
- **Secrets** — the Secret grows three non-credential keys; consumers must be wired per-key so
  genuine credentials never reach the frontend pod.
- **Observability** — first structured auth-failure logging in the project.
- **Documentation** — README and a new runbook; the runbook is a load-bearing artifact, not a
  courtesy, since the tenant cannot be reconstructed from the repo.
- **Migrations** — none. No database exists.

## Cross-Cutting Concerns

- **Errors:** six surfaces, each terminating somewhere recoverable. Missing/invalid
  `window.__APP_CONFIG__` → `config.ts` throws at module load → a plain "Configuration error" page
  (never a white screen). Auth0 login error or user cancellation → `ProtectedRoute` reads
  `useAuth0().error` → `<Navigate to="/login-error">`, with raw Auth0 text `console.error`'d and
  never displayed (R4). Silent-refresh failure → `useApi` catches → `loginWithRedirect()` (R8).
  API 4xx/5xx → returned unmodified to the calling component, which keeps its existing states.
  Invalid API config or unreachable JWKS at startup → exception → pod exits naming the setting (N1).
  Missing env var in the frontend container → entrypoint exits non-zero naming the variable.

- **Logging & metrics:** the Core API adds a `JwtBearerEvents.OnAuthenticationFailed` handler logging
  *why* a token was rejected — expired vs. wrong `aud` vs. wrong `iss` vs. malformed — at Warning.
  Without it R13's four cases are four indistinguishable 401s. Startup logs the resolved domain and
  audience (public values) and JWKS-fetch success at Information, extending the existing
  `app.Logger.LogInformation` startup line. Frontend logs Auth0 errors via `console.error` only.
  **Hard rule: no token value is ever logged, in whole or in part, on either side** — a JWT fragment
  in a log is a credential in a log. Applies to debugging `console.log` too. No metrics
  infrastructure exists yet; none is introduced.

- **Auth / authz:** authentication only — no scopes, roles, or permissions anywhere (R14, REQ
  decision 10). Enforced by `FallbackPolicy` in middleware, before any endpoint code runs. Two
  `.AllowAnonymous()` exceptions. Token validation checks signature (RS256 against cached JWKS),
  `iss`, `aud`, and `exp` — all four must pass, all four locally.

- **Performance:** token validation is a local RSA signature check — microseconds, zero I/O (N4).
  `ConfigurationManager` refreshes JWKS in the background and re-fetches on signature failure
  (throttled), so Auth0 key rotation needs no deploy. `config.js` costs one round trip on cold load
  and is permanently uncached by design; injecting the values into `index.html` via nginx
  `sub_filter` would remove it and is recorded as the known optimization if page-load latency ever
  matters. No scale concerns: single replica, no data, no queries.

- **Security:** `RequireHttpsMetadata` stays at its default `true` — the Auth0 domain is HTTPS even
  when the app is on `http://localhost`, so there is nothing to relax, and relaxing it is a habit
  that follows people to production. The ID token never leaves the browser; the access token is
  never trusted for profile display. Refresh tokens in `localStorage` are an accepted XSS risk,
  mitigated by rotation with reuse detection; a BFF holding tokens in an httpOnly cookie is the
  recorded upgrade path. The three `AUTH0_*` values are public by design and live in a Secret to
  keep environment-specific values out of git (N3), not because they are credentials — genuine
  credentials in the same Secret are never injected into the frontend pod (A6).

- **Migrations / rollout:** no database, no migrations, nothing to preserve. This is a **breaking
  change for every existing checkout**: the order is update `k8s/secrets.yaml` → `make build` →
  `make deploy` → `make restart`. Skipping the first crash-loops both pods, loudly and by design.
  Rollback is `git revert` + rebuild + restart; the Auth0 tenant configuration can remain in place
  and is harmless. Localhost only — no backward-compatibility obligations exist.

## Architecture Decisions Log

| # | Decision | Alternatives | Chosen Because | Satisfies REQs |
|---|---|---|---|---|
| A1 | No liveness/readiness probes added | Add both pointing at `/api/health` | Developer's call. Consequence recorded: AC-14's probe clause has nothing to verify, so R10 is tested by the `curl` half only. Revisit with issue #4, when readiness should check Postgres while liveness stays dumb. | R10 (partial) |
| A2 | `GET /` stays public via explicit `.AllowAnonymous()` | Protect it (breaks README); delete it | It is a repo-wide convention — `ingestion-service` and `receipt-service` expose an identical endpoint — and returns only a hardcoded service name. Made an explicit, greppable exception rather than an accident. | R10 |
| A3 | Health check stays unauthenticated, outside `useApi` | Route it through the authenticated client | Routing it through auth makes a token failure and a dead API produce the same on-screen symptom, destroying the diagnostic value of the only diagnostic in the app. Narrows R6 to data endpoints; AC-10 is fully verifiable against `/api/me`. | R6, R10 |
| A4 | Protected-by-default via `FallbackPolicy` | `.RequireAuthorization()` per endpoint | Inverts the failure mode — a forgotten endpoint 401s instead of shipping public. Converts the project rule into a property of the pipeline. | R11, R14 |
| A5 | SPA config rendered at container start | Build-time `VITE_*`; JSON fetch; `GET /api/config` | Preserves build-once-deploy-everywhere; a Secret change needs a pod restart, not a rebuild. `/api/config` would add a third public endpoint and make the SPA unable to boot when the API is down. | N2 |
| A6 | Explicit `secretKeyRef` per key; never `envFrom` | `envFrom: secretRef` | `envFrom` injects **every** Secret key, including `POSTGRES_PASSWORD`, into a pod whose entrypoint writes env vars into a publicly served file. Also required for name mapping (`Auth0__Domain` vs `AUTH0_DOMAIN`) from one Secret key. | N3 |
| A7 | `localStorage` + refresh token rotation | `memory` cache; BFF with httpOnly cookie | Memory cannot survive the page reload R3 tests. Rotation with reuse detection is the mitigation; BFF is the recorded upgrade path if this ever leaves localhost. | R3, R7, R8 |
| A8 | Request `offline_access` | Omit it | Without it Auth0 issues no refresh token and R7 is unimplementable. Paired with `Allow Offline Access` on the API. | R7 |
| A9 | Hand-rolled `useApi()`; no axios | axios + interceptors; TanStack Query now | Two call sites; the wrapper is ~20 lines. Refresh/retry logic already lives in the SDK. ADR-007 places TanStack Query with real data (#4). | R6 |
| A10 | `MapInboundClaims = false` | Library default | Default rewrites `sub` to a WS-Federation URI, so `FindFirst("sub")` returns null for a valid token — a 200 with a null field, not an error. `sub` becomes `Transaction.UserId` in #4. | R12 |
| A11 | Options pattern + `ValidateOnStart()` | Manual null-checks | Throws before the server listens; the pod crash-loops with the setting named, rather than going green and 401ing everything. | N1 |
| A12 | Eager JWKS fetch at startup | Lazy fetch (library default) | The library default contradicts the REQ's own edge case and produces the exact "green pod, blanket 401" failure decision 7 exists to prevent. Also removes the network call from the first request. Trade-off: an Auth0 outage blocks a deploy — acceptable while localhost-only. | N4, N1 |
| A13 | Post-Login Action adds namespaced claims to the access token | API calls `/userinfo` per request; return `sub` only | Access tokens carry no `email`/`name`; without this `/api/me` returns 200 with two nulls — a failure that looks like success. `/userinfo` would violate N4; `sub`-only contradicts AC-16. | R12, N4, N5 |
| A14 | Proactive refresh before each call | Reactive 401 → refresh → retry | Simpler and strictly fewer requests; the SDK already checks expiry client-side. Requires an AC-11 wording amendment. | R7 |
| A15 | `make deploy` guard verifies required Secret keys | Leave the file-existence check | A pre-existing `secrets.yaml` passes today's guard while missing every Auth0 key. Same fail-fast logic the rest of the task insists on, moved one step earlier. | N1 (spirit) |
| A16 | Tenant setup as a written runbook in `docs/` | Automate via Management API or Terraform | Console work cannot be automated cheaply but can be made reproducible; automation is disproportionate for one tenant. | R17 |
| A17 | Nested gate → chrome routes; `Layout` takes `<Outlet />` | `ProtectedRoute` renders `Layout` itself | Puts `NavBar` structurally inside the gate, so there is no code path that renders nav links before auth resolves — R3 enforced by shape rather than by remembering. | R3 |
| A18 | `public/config.js` added to `.dockerignore` | Leave it | `COPY . .` would otherwise bake dev tenant values into an image layer; the entrypoint overwrites the file at runtime so nothing misbehaves and nothing is noticed. | N3 |
| A19 | `ClockSkew` lowered to 30 seconds | Library default of 5 minutes | With the default, a token expired 3 minutes ago returns **200** and R13's expired-token check reads as broken validation. | R13 |
| A20 | `UseCors` stays ahead of `UseAuthentication`/`UseAuthorization` | Any other ordering | A CORS preflight `OPTIONS` carries no `Authorization` header; if the fallback policy sees it first, every preflight 401s — breaking **only** the Vite dev workflow, since the ingress path is same-origin. | R15, N5 |

## Risk & Stress-Test Scenarios

### Forward — runtime failure scenarios

| Scenario | How the Design Handles It |
|---|---|
| Auth0 unreachable during API startup | Eager JWKS fetch fails → process exits → kubelet backoff retries → recovers when Auth0 returns. Intended (A12). |
| Auth0 unreachable for 30s while the API is running | Cached JWKS keeps serving; zero impact on validation (N4). |
| Auth0 unreachable while a user is logging in | The browser cannot reach Auth0 at all, so the user sees the browser's own network error — not our `/login-error` screen. **GAP — accepted**: no code of ours is running at that moment. |
| Access token expires mid-session | `getAccessTokenSilently()` exchanges the refresh token before the call; the user notices nothing (R7, A14). |
| Refresh token revoked or expired | `getAccessTokenSilently()` throws → `useApi` → `loginWithRedirect()` (R8). |
| Two tabs refresh simultaneously | Rotation makes each refresh token single-use, so concurrent refreshes could look like reuse and revoke the whole family. `auth0-spa-js` serialises refreshes across tabs to prevent this. Named explicitly because the symptom — "randomly logged out with two tabs open" — is otherwise baffling. |
| Malformed or truncated `Authorization` header | Rejected by middleware as 401 before endpoint code runs; no unhandled exception, no 500 (R13). |
| Token from a different tenant, or for a different API | `iss` / `aud` validation → 401 (R13). |
| Machine token with no `sub`, `email`, or `name` | Validates normally; claims read null-safely; `/api/me` returns nulls rather than throwing (N5, #5 stays additive). |
| Core API pod restarted while a user is active | New pod re-fetches JWKS at startup; the user's token is unaffected — validation is stateless. |
| Frontend pod restarted after a Secret change | Entrypoint re-renders `config.js` with the new values; `no-store` guarantees browsers pick them up. No image rebuild (N2). |
| Auth0 rotates its signing keys | `ConfigurationManager` re-fetches on signature failure (throttled) — no deploy required. |
| 10K → 10M rows | Not applicable — no persistence in this task. |
| Ship it and it breaks | `git revert` + `make build` + `make deploy` + `make restart`. Tenant configuration can stay; it is inert without the code. |

### Backward — regression risk per touched area

| Touched area | What could regress | How we'd know / mitigation |
|---|---|---|
| `Program.cs` — middleware ordering | 🔴 CORS preflight `OPTIONS` 401s if the fallback policy runs before `UseCors`, breaking **every** Vite-dev API call while the ingress path keeps working. The nastiest bug in this task: it passes every check made through `http://localhost`. | A20 pins the ordering; verify explicitly from `http://localhost:5173`, not just the ingress. |
| `App.tsx` + `main.tsx` | `loginWithRedirect` called during render double-fires under `StrictMode` → duplicate redirects or a login loop. `AuthProvider` outside `BrowserRouter` → `useNavigate` throws at the end of every login. | Redirect lives in `useEffect` (D.3); provider order fixed by A17. Both fail visibly on the first login attempt. |
| `Layout.tsx` signature change | A consumer still passing `children` renders nothing. Only consumer is `App.tsx` — verified by inspection. | TypeScript compile error; `tsc -b` runs as part of `npm run build`. |
| `NavBar.tsx` | Avatar renders blank when `name` and `email` are both absent — possible with social accounts. | `getInitials()` returns `null`, and `null` renders the generic person icon; never `""` (R5). Verify with both connections. |
| `Dashboard.tsx` (unchanged) | Behavior shifts silently — the health call now fires post-login. Anyone reading the file assumes startup. | Add a comment; note it in the task spec so it is not "fixed" back. |
| `README.md` (unchanged steps) | Browser verification instructions become false; a developer concludes the deploy is broken. | Update in the same commit as the code, not afterwards. |
| `.dockerignore` gap | Dev tenant values baked into an image layer; runtime overwrite hides it entirely. | A18 closes it; verify with `docker run --rm --entrypoint cat <image> /usr/share/nginx/html/config.js` before the entrypoint runs. |
| `k8s/secrets.yaml` (gitignored) | Existing local files silently lack all three keys. | A15 catches it at deploy; both pods fail loudly at start otherwise. |
| CORS block (unchanged) | A later "tidy-up" to an explicit header list omitting `Authorization` breaks dev-only. | Pinning comment explaining why it is permissive. |
| `/api/health`, `/` | Accidentally swept into the fallback policy → kubelet-facing endpoint 401s. | Two explicit `.AllowAnonymous()` calls; `curl` both with no token as the first post-deploy check. |
| Issue #4's `Transaction.UserId` | A mangled or null `sub` becomes wrong data in the first persisted rows — a data migration, not a code fix. | A10 plus decoding a real token at jwt.io during verification (runbook checklist). |

## Open Questions

- **AC-11 wording no longer matches the design.** It expects "a token request followed by a *retry*
  of the original call," which describes reactive refresh; A14 is proactive, so the observed
  sequence is "token request, then the call succeeds."
  - **Impact if unresolved:** the QA gate fails a working implementation on a literal reading.
  - **Suggested default:** amend AC-11 to "a token request precedes the API call, which then
    succeeds." Alternatively add a reactive 401-retry-once backstop (~10 lines) to match the
    original wording and cover the narrow case of revocation between the token check and the call.

- **AC-14's probe clause has nothing to verify** under A1.
  - **Impact if unresolved:** an acceptance criterion that cannot pass or fail.
  - **Suggested default:** verify R10 via the `curl` half only; revisit probes with issue #4, when
    readiness should check Postgres while liveness stays dependency-free.

- **Access-token lifetime for normal operation** (carried from the REQ).
  - **Impact if unresolved:** Auth0's 24-hour default is long for a token that cannot be revoked
    mid-life; too short adds refresh traffic.
  - **Suggested default:** accept `86400` for this task. R7 requires only that renewal demonstrably
    works, which the runbook's temporary-60s procedure proves.

- **Google connection uses Auth0 development keys** (carried from the REQ).
  - **Impact if unresolved:** dev keys are rate-limited and unsuitable beyond localhost, so the
    choice resurfaces at deployment.
  - **Suggested default:** dev keys here; the runbook already flags the swap as a prerequisite for
    any real deployment.

- **No test infrastructure exists in the repository.**
  - **Impact if unresolved:** Phase 3 may generate TDD-style tasks with nowhere to put a test.
  - **Suggested default:** treat this task's verification as checklist-mode against the runbook's
    checklist and the REQ's acceptance criteria. Automated coverage arrives with issue #6.

## Out of Scope

- **Any database or persisted user record** (reason: issue #4 — identity lives in Auth0 for now).
- **Kubernetes liveness/readiness probes** (reason: A1, developer's decision; revisit with #4).
- **Account linking across connections** (reason: deferred to #4; must land before the first
  persisted `UserId`. Duplicate accounts across Google/password are expected behavior here).
- **Service-to-service authentication and M2M applications** (reason: deferred to #5; constrains
  this task only via N5).
- **Authorization — roles, scopes, permissions** (reason: nothing to authorize until data exists).
- **Any protected endpoint other than `/api/me`** (reason: the ticket's stated boundary).
- **Email verification gating** (reason: REQ decision 11; no email-dependent feature exists).
- **Production or non-local environments** (reason: deployment is issue #6 and beyond).
- **Automated CI authentication — Playwright storage state, Resource Owner Password Grant**
  (reason: issue #6; a test user is created here so that work is unblocked).
- **Project-owned Google OAuth credentials** (reason: dev keys suffice for localhost; flagged in the
  runbook as a deployment prerequisite).
- **Password reset, signup customization, MFA, Universal Login branding** (reason: Auth0 defaults
  suffice; no requirement stated).
- **A test asserting that all future `/api/*` routes require auth** (reason: only one protected
  endpoint exists; belongs with the #6 harness).
- **nginx `sub_filter` injection of config into `index.html`** (reason: recorded optimization;
  the extra round trip is invisible on localhost).
