# Tasks

> **Date:** 2026-09-10
> **Issue:** #3
> **Phase:** 3 of 5 (Task Generation)
> **Architecture source:** `specs/architecture/ARCH-3-auth0-integration-all-routes-protected.md`
> **Requirements source:** `specs/requirements/REQ-3-auth0-integration-all-routes-protected.md`

**Verification mode note.** No test infrastructure exists in this repository — no xUnit
project, no Vitest, no Playwright — and both ARCH ("Phase 3 must plan checklist-style
verification, not TDD") and REQ scope automated coverage to issue #6. Every task below is
therefore `checklist` or `ui`. Building a harness here was considered and explicitly declined;
it is not an oversight.

**AC-11 amendment.** REQ's AC-11 is worded for reactive refresh ("a token request followed by a
retry of the original call"). ARCH decision A14 chose **proactive** refresh, so the observable
sequence is a token request immediately *preceding* a call that then succeeds. T5 verifies the
amended wording. Recorded here so the QA gate does not fail a working implementation on a
literal reading.

---

## Task T1: Auth0 tenant setup, Secret keys, and deploy guard

> **Status:** done — repo-side checks (template, git history, deploy guard ×3, tenant discovery/JWKS) verified 2026-09-12; developer confirmed runbook steps 0–6 executed with two connections (database + Google; GitHub dropped from scope — see the REQ Decisions Log amendment). The access-token claim decode is re-verified by T5's in-app token-decode check.
> **Verification:** checklist
> **Effort:** m
> **Priority:** critical
> **Depends on:** None
> **Satisfies REQs:** R15, R16, R17, N3
> **Footprint slice:** New: `docs/auth0-setup-runbook.md` (already written — execute and verify); Modified: `k8s/secrets.yaml.template` (+3 AUTH0_* placeholders), `Makefile` (deploy guard verifies required Secret keys)
> **High-risk areas touched:** Auth0 tenant configuration (**H**) — five console artifacts, not in version control, not reviewable in a PR; every developer's local `k8s/secrets.yaml` (**H**) — gitignored, cannot be updated by a pull

### Description

Creates the external identity infrastructure every other task consumes: an Auth0 tenant with a
registered API, an SPA application, two connections (amended 2026-09-12 — GitHub dropped), a test user, and a Post-Login Action that
puts profile claims on the access token. Nothing here is code — it is console state made
reproducible by a runbook, plus the two repo-side changes that stop a missing tenant value from
failing silently later. The runbook (`docs/auth0-setup-runbook.md`) is already written; this task
executes it end to end and proves it is followable.

### Verification Checklist

##### Runbook and tenant

- **Follow `docs/auth0-setup-runbook.md` from an empty Auth0 account** — expected: a working
  `domain`, `clientId`, and `audience` obtained without asking the author a question; every step
  is executable as written _(verifies R17 / AC-1)_
- **Inspect the registered API in the Auth0 console** — expected: API Identifier is exactly
  `https://api.expense-tracker.local`, Signing Algorithm is RS256, and **Allow Offline Access** is
  ON _(verifies R7 prerequisite, ARCH A8 — without this Auth0 issues no refresh token and R7 is
  unimplementable)_
- **Inspect the SPA application settings** — expected: `http://localhost` and
  `http://localhost:5173` appear in Allowed Callback URLs, Allowed Logout URLs, **and** Allowed
  Web Origins; Refresh Token Rotation is ON with reuse interval `0`; grant types are Authorization
  Code + Refresh Token _(verifies R15 / AC-2 — a missing Web Origin breaks refresh, not login, so
  it fails later and elsewhere)_
- **Confirm two connections are enabled** — expected: Database and Google (Auth0 dev keys)
  present and each able to complete a sign-in _(REQ scope, amended 2026-09-12 — GitHub dropped)_
- **Decode a freshly issued access token at jwt.io** — expected: claims
  `https://expense-tracker.local/email` and `https://expense-tracker.local/name` are present on the
  **access token**, not only on the ID token _(verifies R12 / AC-16 prerequisite, ARCH A13 — the
  failure mode is `/api/me` returning 200 with two nulls, which looks like success)_
- **Sign in as a newly created email/password user without verifying the address** — expected:
  sign-in completes; no verification gate blocks the user _(verifies R16 / AC-4)_
- **Confirm the test user exists** — expected: a dedicated email/password test user is created and
  can sign in, unblocking issue #6's Playwright work _(REQ in-scope item)_

##### Repository changes

- **Inspect `k8s/secrets.yaml.template`** — expected: `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, and
  `AUTH0_AUDIENCE` present as placeholders alongside the existing Postgres and RabbitMQ keys
  _(verifies N3 / AC-21)_
- **Run `git log -p` and grep for the real tenant values** — expected: no real domain, clientId, or
  audience appears anywhere in history _(verifies N3 / AC-21)_
- **Run `make deploy` with a `k8s/secrets.yaml` that exists but lacks the three AUTH0_ keys** —
  expected: exits non-zero naming the missing key(s), **before** any `kubectl apply` runs
  _(verifies ARCH A15; guards backward-regression risk for `Makefile` — a pre-existing secrets
  file passes today's file-existence-only check while missing every Auth0 key)_
- **Run `make deploy` with all keys present** — expected: the guard passes and deployment proceeds
  normally _(guards against the new guard blocking a correct setup)_
- **Run `make deploy` with `k8s/secrets.yaml` absent entirely** — expected: the pre-existing
  "copy the template" message still appears, unchanged _(guards the existing guard behavior)_

### Implementation Notes

- **Module(s):** none — external configuration plus `k8s/` and `Makefile`.
- **Pattern reference:** `k8s/secrets.yaml.template` already establishes the
  template-plus-gitignored-real-file pattern; add the three keys in the same `stringData` block.
  The `Makefile` `deploy` target's existing image-inspect and file-existence guards are the shape
  to extend (`Makefile:16-25`).
- **Key decisions:** A15 (deploy guard verifies keys, not just the file); A16 (runbook rather than
  Management API / Terraform automation); A8 (Allow Offline Access is mandatory); A13 (Post-Login
  Action targets the access token).
- **Libraries:** none.
- **High-risk callouts:**
  - *Auth0 tenant configuration (H)* — console state is invisible to code review and to CI. The
    runbook is the only mitigation and it is prose, so the jwt.io decode step is the one check that
    actually proves the Action works. Do not skip it.
  - *Local `k8s/secrets.yaml` (H)* — anyone checking out this branch has a broken cluster until
    they add three keys by hand. The deploy guard moves that discovery from pod-start to
    deploy-time; T6 documents it.
  - The three `AUTH0_*` values are **public by design** — they live in a Secret to keep
    environment-specific values out of git (N3), not because they are credentials.

### Scope Boundaries

- Do NOT automate tenant setup via the Auth0 Management API or Terraform (ARCH A16 — disproportionate for one tenant).
- Do NOT create project-owned Google OAuth credentials (ARCH Out of Scope — dev keys suffice for localhost; the runbook flags the swap as a deployment prerequisite).
- Do NOT configure roles, scopes, or permissions on the API (ARCH Out of Scope — authentication only, REQ decision 10).
- Do NOT set up account linking across connections (ARCH Out of Scope — deferred to issue #4; duplicate accounts across Google/password are **expected behavior** in this task, not a defect).
- Do NOT customize Universal Login branding, MFA, password reset, or signup (ARCH Out of Scope — Auth0 defaults suffice).
- Do NOT enable email verification gating (REQ decision 11).
- Do NOT add Playwright storage state or Resource Owner Password Grant configuration (ARCH Out of Scope — issue #6; creating the test user is where this task stops).
- Only implement the tenant artifacts named in ARCH's "Auth0 Tenant — Configuration Contract" table, the three template placeholders, and the Makefile guard.

### Files Expected

**New files:** _(from ARCH "New files / modules")_
- `docs/auth0-setup-runbook.md` — **already written**; verify and correct only if a step proves unfollowable during execution

**Modified files:** _(from ARCH "Modified files / modules")_
- `k8s/secrets.yaml.template` (+`AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_AUDIENCE` placeholders)
- `Makefile` (`deploy` guard extended to verify the required Secret keys are present, not just the file)

**Must NOT modify:**
- `k8s/secrets.yaml` in version control (gitignored by design — it is filled in locally, never committed)
- `k8s/core-api.yaml`, `k8s/frontend.yaml` (claimed by T2 and T3 respectively)
- `README.md` (claimed by T6)
- `services/ingestion-service`, `services/receipt-service` (ARCH: untouched and not ingress-routed)

---

## Task T2: Core API token validation and `GET /api/me`

> **Status:** not started
> **Verification:** checklist
> **Effort:** l
> **Priority:** critical
> **Depends on:** T1 (needs a real tenant, audience, and issuable tokens)
> **Satisfies REQs:** R10, R11, R12, R13, R14, N1, N4, N5
> **Footprint slice:** New: `services/core-api/src/Auth/Auth0Options.cs`; Modified: `services/core-api/core-api.csproj`, `services/core-api/src/Program.cs`, `k8s/core-api.yaml`
> **High-risk areas touched:** Core API request pipeline (**M**) — the default flips from public to protected for all current and future endpoints; issue #4's `Transaction.UserId` (**M**) — a mangled `sub` becomes wrong data in the first persisted rows

### Description

Builds the actual security boundary: JWT bearer validation against Auth0's JWKS, performed
entirely offline, plus an authorization fallback policy that makes every endpoint protected by
default with exactly two greppable `.AllowAnonymous()` exceptions. Adds `GET /api/me`, which
returns the caller's `sub`, `email`, and `name` from validated claims. Route protection in the
browser is a UX affordance; this task is the part an attacker cannot bypass.

### Verification Checklist

##### Public surface stays public

- **`curl http://localhost/api/health` with no token** — expected: 200 with `{status, timestamp,
  version}`, shape unchanged _(verifies R10 / AC-14; guards backward-regression risk for
  `/api/health` — sweeping the kubelet-facing endpoint into the fallback policy would cause a
  permanent restart loop)_
- **`curl http://localhost:8080/` with no token** — expected: 200 with `{service: "core-api",
  status: "running"}`, unchanged _(verifies ARCH A2; guards the repo-wide service-identity
  convention shared with `ingestion-service` and `receipt-service`)_
- **`grep -n AllowAnonymous services/core-api/src/Program.cs`** — expected: exactly two hits, `/`
  and `/api/health`, and nothing else _(verifies ARCH's "explicit public surface" convention —
  this grep is the complete auditable answer to "what is public?")_

##### Protected endpoint

- **`curl http://localhost/api/me` with no token** — expected: 401 _(verifies R11 / AC-15)_
- **`curl http://localhost/api/me` with a valid access token** — expected: 200 and a body where
  `sub`, `email`, and `name` are all **non-null** _(verifies R12 / AC-16 — a 200 with null `sub` is
  ARCH A10's silent trap and means `MapInboundClaims = false` was not applied)_
- **`curl http://localhost/api/me` with a valid token bearing no custom scopes** — expected: 200
  _(verifies R14 / AC-18 — authentication only, no authorization)_

##### Rejection cases

- **Four separate calls to `/api/me`, one per invalid token** — an expired token, a token whose
  `aud` is a different API, a token from a different Auth0 tenant, and a structurally malformed
  string — expected: **401 in all four cases; never 500** _(verifies R13 / AC-17 and the REQ edge
  case "malformed or truncated Authorization header → 401, no unhandled exception" — an
  unauthenticated caller must not be able to provoke a server error)_
- **Verify the expired-token case is genuinely rejected** — expected: a token expired by ~1 minute
  returns 401, not 200 _(verifies ARCH A19 — with the library's default 5-minute ClockSkew a token
  expired 3 minutes ago validates successfully and R13 reads as broken validation)_
- **`kubectl logs` after the four rejections** — expected: four distinguishable Warning lines
  naming *why* each token was rejected (expired vs. wrong `aud` vs. wrong `iss` vs. malformed), and
  **no token value appears in any log line, in whole or in part** _(ARCH cross-cutting hard rule —
  a JWT fragment in a log is a credential in a log)_

##### Startup and configuration

- **Start the pod with `Auth0__Domain` missing, then with it malformed** — expected: startup fails
  before the server listens; pod enters `CrashLoopBackOff`; `kubectl logs` names the specific
  setting _(verifies N1 / AC-19, ARCH A11)_
- **Repeat for `Auth0__Audience`** — expected: same behavior, naming `Audience`
  _(verifies N1 / AC-19)_
- **Start the pod while the Auth0 tenant is unreachable** — expected: eager JWKS fetch fails, the
  process exits, kubelet backs off and retries, and the pod recovers once Auth0 returns
  _(verifies ARCH forward stress-test "Auth0 unreachable during API startup", A12 — the library
  default of lazy fetch would instead produce a green pod that 401s everything)_
- **`kubectl logs` on a healthy start** — expected: Information-level lines recording the resolved
  domain and audience (public values) and JWKS-fetch success, extending the existing
  `core-api starting up` line _(ARCH cross-cutting: logging)_
- **`kubectl describe pod core-api`** — expected: exactly two env entries from `secretKeyRef`,
  `Auth0__Domain` and `Auth0__Audience`; no other Secret key is injected _(verifies ARCH A6 —
  never `envFrom`)_

##### Resilience and forward-compatibility

- **Issue a burst of `/api/me` calls and inspect logs or outbound traffic** — expected: zero
  outbound HTTP to Auth0 during validation; each check is a local RSA signature verification
  _(verifies N4)_
- **Call `/api/me` with a machine-shaped token carrying no `sub`, `email`, or `name`** — expected:
  the token validates and the response returns nulls rather than throwing or 500ing _(verifies N5
  and ARCH forward stress-test "machine token"; keeps issue #5's service-to-service work additive
  rather than a middleware rewrite)_
- **Restart the core-api pod while a user holds a live token** — expected: the new pod re-fetches
  JWKS at startup and the user's existing token still validates — no re-login _(verifies ARCH
  forward stress-test "Core API pod restarted while a user is active"; validation is stateless)_
- **Issue a CORS preflight `OPTIONS` to `/api/me` from origin `http://localhost:5173`** —
  expected: the preflight succeeds and is **not** 401'd _(verifies ARCH A20; guards
  backward-regression risk for `Program.cs` middleware ordering — a preflight carries no
  `Authorization` header, so if the fallback policy runs before `UseCors` every Vite-dev API call
  breaks while the ingress path keeps working. **This is the nastiest bug in the task: it passes
  every check made through `http://localhost`.** Must be checked from `:5173` explicitly.)_

### Implementation Notes

- **Module(s):** `services/core-api/src/Auth/` (configuration shape and validation only — no
  endpoint logic, no claim reading) and `services/core-api/src/Program.cs` (pipeline composition,
  endpoint registration).
- **Pattern reference:** `Program.cs` is currently a flat top-level-statements Minimal API
  (`services/core-api/src/Program.cs:1-30`) with a CORS policy, two `MapGet` endpoints, and a
  startup log line. `Auth0Options.cs` is the **first structural file** in core-api — establish
  `src/Auth/` as a directory here.
- **Key decisions:**
  - **A4 / FallbackPolicy** — `AuthorizationOptions.FallbackPolicy = RequireAuthenticatedUser()`,
    not `.RequireAuthorization()` per endpoint. This inverts the failure mode: a forgotten future
    endpoint 401s instead of shipping public. It is the deliverable, not an implementation detail.
  - **A10 / `MapInboundClaims = false`** — without it, .NET rewrites `sub` to
    `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier` and
    `User.FindFirst("sub")` returns **null for a perfectly valid token**. Fails as a 200 with a
    null field, not as an error.
  - **A19 / `ClockSkew = TimeSpan.FromSeconds(30)`** — the 5-minute default makes R13's expired
    check return 200.
  - **A11 / Options pattern** — `AddOptions<Auth0Options>().Bind().Validate().ValidateOnStart()`.
    Throws during host build, before the server listens.
  - **A12 / eager JWKS fetch** at startup rather than the library's lazy default.
  - **A20 / middleware order** — `UseCors` stays **ahead of** `UseAuthentication` and
    `UseAuthorization`.
  - **A2 / `GET /` stays public** via an explicit `.AllowAnonymous()`, made a greppable exception
    rather than an accident.
  - **A13** — read the namespaced claims `https://expense-tracker.local/email` and
    `https://expense-tracker.local/name` verbatim; access tokens carry no standard `email`/`name`.
  - `Authority` is derived as `https://{Domain}/` — the **trailing slash is required** by the OIDC
    discovery convention. `Domain` itself is a bare host with no scheme.
  - `RequireHttpsMetadata` stays at its default `true` — the Auth0 domain is HTTPS even when the
    app runs on `http://localhost`, so there is nothing to relax.
- **Libraries:** `Microsoft.AspNetCore.Authentication.JwtBearer` 10.0.x — the only new NuGet
  package. Not `Auth0.AspNetCore.Authentication`, which targets cookie-based MVC login flows.
- **High-risk callouts:**
  - *Core API request pipeline (M)* — high leverage by design, but a middleware-ordering mistake
    401s everything including CORS preflight. Addressed by the two `.AllowAnonymous()` checks, the
    `grep` check, and the explicit `:5173` preflight check.
  - *Issue #4's `Transaction.UserId` (M)* — `sub` becomes a logical foreign key one ticket later.
    A mangled value here is a data migration, not a code fix. Addressed by the non-null `sub` check
    plus T1's jwt.io decode.
  - Claims must be read **null-safely** — a machine token legitimately has none (N5).
  - Add a pinning comment on the existing CORS block explaining why `AllowAnyHeader()` is
    deliberate: a later "tidy-up" to an explicit list omitting `Authorization` breaks every
    Vite-dev API call while the ingress path keeps working.

### Scope Boundaries

- Do NOT add any protected endpoint other than `/api/me` (ARCH Out of Scope — the ticket's stated boundary).
- Do NOT add scopes, roles, or permission checks (ARCH Out of Scope — nothing to authorize until data exists; REQ decision 10).
- Do NOT add liveness or readiness probes (ARCH A1 / Out of Scope — the developer's decision; revisit with issue #4, when readiness should check Postgres while liveness stays dependency-free). AC-14's probe clause consequently has nothing to verify; R10 is verified by the `curl` half only.
- Do NOT add a database, user table, or session store (ARCH Out of Scope — issue #4).
- Do NOT add an M2M application or service-to-service authentication (ARCH Out of Scope — issue #5; N5 constrains this task only by requiring null-safe claim reading).
- Do NOT write a test asserting that all future `/api/*` routes require auth (ARCH Out of Scope — only one protected endpoint exists; belongs with the issue #6 harness).
- Do NOT touch the `ingestion-service` or `receipt-service` public `GET /` endpoints — "no endpoint is born unprotected" is a **core-api** rule in this task, and neither service is ingress-routed.
- Do NOT relax `RequireHttpsMetadata`, and do NOT introduce a try/catch in endpoint code — all 401s are emitted by middleware before endpoint code runs.
- Only implement the four files in the Footprint slice.

### Files Expected

**New files:** _(from ARCH "New files / modules")_
- `services/core-api/src/Auth/Auth0Options.cs` — `Domain` + `Audience` with validation attributes; first structural file in core-api

**Modified files:** _(from ARCH "Modified files / modules")_
- `services/core-api/core-api.csproj` (+`Microsoft.AspNetCore.Authentication.JwtBearer` 10.0.x)
- `services/core-api/src/Program.cs` (options bind + `ValidateOnStart`; `AddAuthentication().AddJwtBearer` with `MapInboundClaims = false` and 30s `ClockSkew`; eager JWKS fetch; `FallbackPolicy`; `UseAuthentication`/`UseAuthorization` **after** `UseCors`; `.AllowAnonymous()` on `/` and `/api/health`; `GET /api/me`; `OnAuthenticationFailed` logging; pinning comment on the CORS block)
- `k8s/core-api.yaml` (`env:` + `secretKeyRef` → `Auth0__Domain`, `Auth0__Audience` — **2 keys only**, never `envFrom`)

**Must NOT modify:**
- `services/core-api/src/Program.cs` — the CORS block itself (silent-regression hotspot; `AllowAnyHeader()` already permits `Authorization`, so no edit is needed — add the explanatory comment only, covered by the preflight check above)
- `services/ingestion-service/`, `services/receipt-service/` (out of scope per ARCH)
- `frontend/` (claimed by T3, T4, T5)
- `k8s/secrets.yaml.template`, `Makefile` (claimed by T1)

---

## Task T3: SPA runtime configuration delivery

> **Status:** not started
> **Verification:** checklist
> **Effort:** l
> **Priority:** critical
> **Depends on:** T1 (needs the three real `AUTH0_*` values in the Secret)
> **Satisfies REQs:** N2, N3
> **Footprint slice:** New: `frontend/src/config.ts`, `frontend/config.js.template`, `frontend/docker-entrypoint.d/40-app-config.sh`; Modified: `frontend/index.html`, `frontend/nginx.conf`, `frontend/Dockerfile`, `frontend/.dockerignore`, `k8s/frontend.yaml`, `.gitignore`
> **High-risk areas touched:** Frontend container boot (**M**) — a brand-new startup stage that can fail, written in shell with no type checker

### Description

Solves the one genuinely novel infrastructure problem in this issue: Vite bakes `VITE_*` variables
into the bundle at build time, so a Kubernetes Secret mounted into the frontend pod can never reach
the browser — the pod runs nginx while the code that needs the values runs on the user's machine. A
container-start entrypoint bridges that gap by rendering `config.js` from environment variables,
keeping one frontend image valid in every environment and preserving build-once-deploy-everywhere.
This is the first runtime-config mechanism in the repo; issue #4 will reuse the pattern for
`DATABASE_URL`.

### Verification Checklist

##### Rendering and failure behavior

- **`docker run` the frontend image with the three `AUTH0_*` env vars set, then
  `curl http://<container>/config.js`** — expected: a JavaScript file assigning
  `window.__APP_CONFIG__` with the exact domain, clientId, and audience passed in
  _(verifies N2)_
- **`docker run` the image with `AUTH0_DOMAIN` unset** — expected: the entrypoint exits non-zero,
  **naming the missing variable**, and the container does not go on to serve a page that cannot
  boot _(verifies ARCH's "fail fast and name the cause" convention; the frontend-container-boot
  M-risk area)_
- **Repeat with `AUTH0_CLIENT_ID` unset, then `AUTH0_AUDIENCE` unset** — expected: same behavior,
  each naming its own variable
- **`docker run` with a blank (empty-string) `AUTH0_AUDIENCE`** — expected: the entrypoint treats
  blank as missing and exits non-zero _(a blank value otherwise renders a syntactically valid
  config that fails much later, at Auth0, as an opaque-token error)_

##### Image hygiene

- **`docker run --rm --entrypoint cat <image> /usr/share/nginx/html/config.js`** (i.e. before the
  entrypoint runs) — expected: **no dev tenant values present** — the file is absent or contains
  only placeholders _(verifies ARCH A18; guards backward-regression risk for
  `frontend/.dockerignore`, which ignores `node_modules`/`dist` but not `public/`. A gitignored dev
  `public/config.js` would be copied by `COPY . .` into `dist/` and baked into an image layer — the
  entrypoint overwrites it at runtime, so **nothing misbehaves and nothing is noticed**.)_
- **`git status` after creating a local `frontend/public/config.js`** — expected: the file is
  ignored and never appears as untracked _(verifies N3)_

##### Serving

- **`curl -I http://localhost/config.js`** — expected: `Cache-Control: no-store` present, so a
  Secret change is picked up by browsers without a hard refresh
- **View source on `http://localhost`** — expected: `<script src="/config.js">` appears **before**
  the module script, making `window.__APP_CONFIG__` available synchronously with no config loading
  state in front of the auth loading state
- **Load `http://localhost/expenses` and `http://localhost/settings` directly** — expected: both
  still serve `index.html` and resolve client-side _(guards backward-regression risk for
  `frontend/nginx.conf` — the new `location = /config.js` block must not break the existing
  `try_files $uri $uri/ /index.html` deep-link fallback)_

##### Configuration validation and delivery

- **Serve a `config.js` with a blank `clientId` and load the app** — expected: a plain
  "Configuration error" page naming the missing key — **never a white screen** _(ARCH cross-cutting:
  `config.ts` throws at module load)_
- **Change `AUTH0_DOMAIN` in the K8s Secret, then `make deploy && make restart` with no image
  rebuild** — expected: the browser is sent to the new domain for login _(verifies N2 / AC-20 — the
  core claim of this task)_
- **`kubectl exec` into the frontend pod and run `env`** — expected: exactly the three `AUTH0_*`
  variables from `secretKeyRef`; **`POSTGRES_PASSWORD` and every other Secret key are absent**
  _(verifies ARCH A6 / N3 — `envFrom` would inject every Secret key into a pod whose entrypoint
  writes environment variables into a publicly served file)_
- **Copy `frontend/config.js.template` to `frontend/public/config.js`, fill it in, and run
  `npm run dev`** — expected: the Vite dev server on `:5173` boots with the same configuration
  mechanism, no `VITE_*` variables involved

### Implementation Notes

- **Module(s):** `frontend/src/config.ts` (sole reader of `window.__APP_CONFIG__`; depends on
  browser globals only) and `frontend/docker-entrypoint.d/` (POSIX shell + `envsubst` only — the
  only writer of `config.js`; application code never writes it).
- **Pattern reference:** `frontend/config.js.template` → `frontend/public/config.js` mirrors the
  established `k8s/secrets.yaml.template` → `k8s/secrets.yaml` pattern **exactly**, so one mechanism
  and one mental model covers both dev and cluster. The entrypoint uses the nginx image's documented
  `/docker-entrypoint.d/` startup hook — no `ENTRYPOINT` override needed, and `envsubst` is already
  present in `nginx:stable-alpine` (no `apk add`). Current `Dockerfile` runtime stage is
  `frontend/Dockerfile:9-16`; current nginx config is `frontend/nginx.conf`.
- **Key decisions:** A5 (render at container start, not build-time `VITE_*`, not a JSON fetch, not
  `GET /api/config` — which would add a third public endpoint and make the SPA unable to boot when
  the API is down); A6 (explicit `secretKeyRef` per key, never `envFrom`); A18 (`public/config.js`
  in `.dockerignore`).
- **Libraries:** none — `envsubst` from the base image and plain TypeScript.
- **High-risk callouts:**
  - *Frontend container boot (M)* — shell has no type checker, and a bug here means the frontend
    serves a page that cannot boot. Mitigated by validating all three variables and exiting
    non-zero with the variable named; four separate checklist items exercise that path.
  - The script must be made **executable** in the Dockerfile (`chmod +x`) — a non-executable file
    in `/docker-entrypoint.d/` is silently skipped by the nginx entrypoint, producing a running
    container with no `config.js` at all.
  - `config.js` costs one round trip on cold load and is permanently uncached by design. Injecting
    the values into `index.html` via nginx `sub_filter` would remove it and is recorded in ARCH as
    the known optimization if page-load latency ever matters — do not implement it here.

### Scope Boundaries

- Do NOT use nginx `sub_filter` to inject config into `index.html` (ARCH Out of Scope — recorded optimization; the extra round trip is invisible on localhost).
- Do NOT add a `GET /api/config` endpoint on the Core API (ARCH A5 — would add a third public endpoint and couple SPA boot to API availability).
- Do NOT introduce `VITE_*` build-time variables for Auth0 values (the entire point of this task is that they cannot work in Kubernetes).
- Do NOT use `envFrom: secretRef` on the frontend deployment (ARCH A6 — injects `POSTGRES_PASSWORD` into a pod that writes env vars into a publicly served file).
- Do NOT add Auth0 SDK wiring, providers, or route gating here (claimed by T4 — this task ends at a validated `config` export).
- Do NOT commit `frontend/public/config.js`.
- Only implement the nine files in the Footprint slice.

### Files Expected

**New files:** _(from ARCH "New files / modules")_
- `frontend/src/config.ts` — read + validate `window.__APP_CONFIG__`; throw at module load naming the missing key
- `frontend/config.js.template` — `window.__APP_CONFIG__` with `${AUTH0_*}` placeholders; mirrors `k8s/secrets.yaml.template`
- `frontend/docker-entrypoint.d/40-app-config.sh` — validate 3 env vars, `envsubst` → `html/config.js`, exit non-zero on missing/malformed

**Modified files:** _(from ARCH "Modified files / modules")_
- `frontend/index.html` (`<script src="/config.js">` **before** the module script)
- `frontend/nginx.conf` (`location = /config.js` with `Cache-Control: no-store`)
- `frontend/Dockerfile` (`COPY` config template + entrypoint script into the runtime stage; make it executable)
- `frontend/.dockerignore` (+`public/config.js`)
- `k8s/frontend.yaml` (`env:` + `secretKeyRef` → the 3 `AUTH0_*` vars — **3 keys only**, never `envFrom`)
- `.gitignore` (+`frontend/public/config.js`)

**Must NOT modify:**
- `frontend/vite.config.ts` (silent-regression hotspot — unchanged and still correct, but `npm run dev` now carries an invisible external prerequisite: `http://localhost:5173` registered in Auth0, covered by T1)
- `frontend/src/main.tsx`, `frontend/src/App.tsx`, `frontend/src/components/`, `frontend/src/pages/` (claimed by T4 and T5)
- `services/core-api/` (claimed by T2)

---

## Task T4: Auth provider, route gate, and login-error screen

> **Status:** not started
> **Verification:** ui
> **Effort:** l
> **Priority:** critical
> **Depends on:** T1 (tenant), T3 (`config.ts` must exist and validate)
> **Satisfies REQs:** R1, R2, R3, R4, R15, R16
> **Footprint slice:** New: `frontend/src/auth/AuthProvider.tsx`, `frontend/src/auth/ProtectedRoute.tsx`, `frontend/src/pages/LoginError.tsx`; Modified: `frontend/src/main.tsx`, `frontend/src/App.tsx`, `frontend/src/components/Layout.tsx`, `frontend/package.json`, `frontend/package-lock.json`; Deleted/replaced: `Layout.tsx`'s `children` prop signature
> **High-risk areas touched:** `frontend/src/App.tsx` route tree (**M**) — every route now passes through new gating code; provider ordering and the `StrictMode` double-redirect are both easy to get subtly wrong

### Description

Wraps the router in `Auth0Provider` and puts a single three-state gate in front of every route, so
no protected chrome can render before identity is known. Auth state has **three** values, not two —
authenticated, unauthenticated, and *not yet known* — and the third is the one that causes bugs:
treating it as "unauthenticated" produces a spurious redirect on every page load, while treating it
as "authenticated" flashes protected content to logged-out visitors. The route tree is restructured
so `NavBar` sits structurally **inside** the gate, making R3 a property of the shape rather than
something to remember.

This task is sized above the usual 2–4 production files because the provider nesting, the
`Outlet` conversion, and the gate are one atomic restructure that cannot be half-landed in a
compiling state.

### Verification Checklist

##### Route protection

- **Visit `/dashboard` while logged out** — expected: redirect to the Auth0 login page; **no
  dashboard content renders first** _(verifies R1 / AC-5)_
- **Visit `/expenses` while logged out** — expected: same _(verifies R1 / AC-5)_
- **Visit `/settings` while logged out** — expected: same _(verifies R1 / AC-5)_
- **Visit `/` while logged out** — expected: redirects toward `/dashboard`, which is itself
  protected, so the user lands at Auth0 _(REQ: "`/` redirects to `/dashboard`, which is itself
  protected")_
- **Visit `/expenses` logged out and complete login** — expected: lands on **`/expenses`**, not
  `/dashboard` _(verifies R2 / AC-6 — the common mistake is hardcoding the return to `/dashboard`
  because it is what the happy path shows)_

##### The third auth state

- **Throttle the network to slow 3G and reload `/dashboard` while signed in** — expected: a
  **full-page loading state**; no dashboard content and **no NavBar links** appear before auth
  state resolves _(verifies R3 / AC-7; this is the criterion the nested-gate structure of A17
  exists to satisfy)_
- **Reload the page while signed in** — expected: the user stays signed in with no re-login and no
  flash of the login redirect _(verifies R3, ARCH A7 — proves `cacheLocation: 'localstorage'` plus
  refresh tokens; a memory cache holds no refresh token across a reload)_

##### Login failure paths

- **Cancel at the Auth0 consent screen** — expected: land on the public `/login-error` screen with
  a working "Try again" button that restarts login; **no redirect loop**; **no raw Auth0 error text
  displayed**; the raw error **is** present via `console.error` _(verifies R4 / AC-8 and the REQ
  edge case "user cancels at the Auth0 consent screen")_
- **Trigger a misconfigured social connection** — expected: the same error screen; raw Auth0 error
  logged, not displayed _(verifies REQ edge case "social connection fails or is misconfigured" —
  users cannot act on `invalid_request`; developers need it in logs)_
- **Reach `/login-error` while logged out** — expected: it renders as a **public** route, not
  gated; a gated error screen would be a redirect loop

##### Entry points and connections

- **Complete login from `http://localhost` (ingress)** — expected: success _(verifies R15 / AC-2)_
- **Complete login from `http://localhost:5173` (Vite dev)** — expected: success _(verifies R15 /
  AC-2 — exercises the CORS-preflight ordering pinned by T2's A20 check from the browser side)_
- **Sign in with each of the two connections** — database, Google — expected: both reach the
  app _(REQ scope as amended 2026-09-12; the same person via both connections yields two
  distinct `sub` values and therefore two accounts — **expected behavior in this task**,
  resolved in issue #4)_
- **Sign up with email/password and do not verify the address** — expected: reaches `/dashboard`
  _(verifies R16 / AC-4)_

##### Regression guards

- **Attempt login and count redirects under React `StrictMode`** — expected: exactly one login
  redirect per attempt; no duplicate redirects and no login loop _(guards ARCH backward-regression
  risk for `App.tsx` + `main.tsx` — `loginWithRedirect` called during render double-fires under
  `StrictMode`. The redirect must live in a `useEffect`.)_
- **Complete a login end to end and confirm `useNavigate` does not throw** — expected: the
  post-login `onRedirectCallback` navigation succeeds _(guards the same risk from the other side —
  `AuthProvider` placed **outside** `BrowserRouter` makes `useNavigate` throw at the end of every
  login; A17 fixes the order as `BrowserRouter` → `AuthProvider` → `App`)_
- **Run `npm run build`** — expected: `tsc -b` passes with no consumer still passing `children` to
  `Layout` _(guards ARCH backward-regression risk for `Layout.tsx`'s signature change — a consumer
  still passing `children` renders nothing; the only consumer is `App.tsx`)_

#### Testable Seams

None automated — no Vitest harness exists in this repository, and introducing one was explicitly
declined for this issue (automated coverage lands with issue #6). The seams that *would* get
component tests, recorded for #6: `ProtectedRoute`'s three-state render branching,
`AuthProvider`'s `onRedirectCallback` appState handling, and `LoginError`'s "Try again" handler.

### Implementation Notes

- **Module(s):** `frontend/src/auth/` (Auth0 wiring and the route gate — may depend on React,
  `react-router-dom`, `@auth0/auth0-react`, `config.ts`) and `frontend/src/pages/` (route-level
  screens). Per ARCH module boundaries, `LoginError.tsx` goes in `pages/`, **not** `auth/`, despite
  belonging to the auth flow — `pages/` is where route-level screens live.
- **Pattern reference:** current `App.tsx` wraps `<Routes>` in `<Layout>`
  (`frontend/src/App.tsx:8-18`); the new shape nests public `/login-error`, then the gate, then the
  chrome, then the pages. `Layout.tsx` currently takes `{ children }`
  (`frontend/src/components/Layout.tsx:4`) and becomes an `<Outlet />` host. `main.tsx` currently
  nests `StrictMode` → `BrowserRouter` → `App` (`frontend/src/main.tsx:7-13`).
- **Key decisions:**
  - **A17 / nested gate → chrome routes** — `ProtectedRoute` does *not* render `Layout` itself.
    Nesting puts `NavBar` structurally inside the gate, so there is no code path that renders nav
    links before auth resolves. R3 is enforced by shape rather than by remembering.
  - **A7 / `useRefreshTokens: true`, `cacheLocation: 'localstorage'`** with rotation enabled — a
    memory cache cannot survive the page reload R3 tests.
  - **A8 / scopes** — request `openid profile email offline_access`. Without `offline_access`
    Auth0 issues **no refresh token** and T5's R7 cannot pass.
  - The **`audience` must be passed on the token request**, or Auth0 returns an *opaque* token
    instead of a JWT and the .NET middleware fails with a signature error that gives no hint of the
    cause. REQ names this "the single most likely way to lose an afternoon on this task."
  - Provider order is fixed: `BrowserRouter` → `AuthProvider` → `App`.
  - `ProtectedRoute` handles four render outcomes: resolving (full-page loader), error
    (`<Navigate to="/login-error">`), unauthenticated (`loginWithRedirect` from a `useEffect`, with
    `appState: { returnTo }`), authenticated (render children).
- **Libraries:** `@auth0/auth0-react` v2 — the **only** new frontend dependency (ARCH-2 minimal
  dependency footprint: no axios, no TanStack Query, no Tailwind).
- **High-risk callouts:**
  - *`App.tsx` route tree (M)* — both classic failures (provider outside the router; redirect
    during render under `StrictMode`) fail visibly on the first login attempt, which is why two
    explicit regression checks target them.
  - Raw Auth0 error text is `console.error`'d and **never rendered** — users cannot act on
    `invalid_request`.
  - **No token value is ever logged**, including in debugging `console.log` calls (ARCH
    cross-cutting hard rule).

### Scope Boundaries

- Do NOT add axios or TanStack Query (ARCH A9 / Tech Choices — ADR-007 places TanStack Query with real data in issue #4).
- Do NOT build the authenticated fetch layer, the avatar, or logout here (claimed by T5).
- Do NOT create any public page other than `/login-error` (REQ: "There is no public page other than the login-error screen and Auth0's own hosted login").
- Do NOT display raw Auth0 error text to the user (REQ decision 9).
- Do NOT auto-retry login after a cancellation (REQ decision 9 — auto-retry traps a user who deliberately backed out).
- Do NOT implement account linking or attempt to de-duplicate accounts across connections (ARCH Out of Scope — issue #4; duplicates are expected here).
- Do NOT add MFA, password reset, or Universal Login branding (ARCH Out of Scope).
- Only implement the files in the Footprint slice; the route tree restructure stops at wiring the gate.

### Files Expected

**New files:** _(from ARCH "New files / modules")_
- `frontend/src/auth/AuthProvider.tsx` — `Auth0Provider` + `onRedirectCallback` deep-link restore
- `frontend/src/auth/ProtectedRoute.tsx` — three-state gate (resolving / error / unauthenticated / authenticated)
- `frontend/src/pages/LoginError.tsx` — public error screen + "Try again" (`pages/` = route-level screens, per ARCH-2)

**Modified files:** _(from ARCH "Modified files / modules")_
- `frontend/package.json` (+`@auth0/auth0-react` — the only new frontend dependency)
- `frontend/package-lock.json` (regenerated by `npm install`)
- `frontend/src/main.tsx` (provider nesting: `BrowserRouter` → `AuthProvider` → `App`)
- `frontend/src/App.tsx` (route tree restructured: public `/login-error`, then nested gate → chrome → pages)
- `frontend/src/components/Layout.tsx` (`{ children }` prop → `<Outlet />`; the `children` signature is **replaced**, per ARCH "Deleted / replaced")

**Must NOT modify:**
- `frontend/src/pages/Dashboard.tsx` (silent-regression hotspot — its behavior shifts because the component now mounts only after login; claimed by T5, which adds the explanatory comment)
- `frontend/src/components/NavBar.tsx` (claimed by T5)
- `frontend/vite.config.ts` (unchanged and still correct)
- `frontend/src/config.ts`, `frontend/nginx.conf`, `frontend/Dockerfile` (claimed by T3)
- `services/core-api/` (claimed by T2)
- `README.md` (claimed by T6)

---

## Task T5: Authenticated fetch, identity chrome, and logout

> **Status:** not started
> **Verification:** ui
> **Effort:** m
> **Priority:** high
> **Depends on:** T2 (a protected `/api/me` to call), T4 (the provider and gate must exist)
> **Satisfies REQs:** R5, R6, R7, R8, R9
> **Footprint slice:** New: `frontend/src/auth/useApi.ts`, `frontend/src/auth/initials.ts`; Modified: `frontend/src/components/NavBar.tsx`; Deleted/replaced: NavBar's `aria-label="avatar placeholder"` div. Also touches `frontend/src/pages/Dashboard.tsx` — **comment only**
> **High-risk areas touched:** Issue #4 (**M**) — `useApi()` is the single token-handling implementation issue #4 inherits

### Description

Carries the access token to the API and shows the user that the app knows who they are. `useApi()`
is a ~20-line hook over native `fetch` that acquires a token proactively before each call — the
refresh and retry machinery that axios interceptors usually carry already lives inside
`getAccessTokenSilently()`. The NavBar's placeholder circle becomes a real initials avatar with a
logout control that ends the Auth0 session as well as the local one.

**Note on AC-11:** REQ's wording describes reactive refresh; ARCH A14 chose proactive. The
verification below reflects the amended wording — a token request *precedes* the call, which then
succeeds, with no retry.

### Verification Checklist

##### Token transport

- **Open the browser network tab and trigger an `/api/me` call** — expected:
  `Authorization: Bearer <token>` present on the request _(verifies R6 / AC-10)_
- **Decode that token and inspect `aud`** — expected: matches the registered API identifier
  `https://api.expense-tracker.local`, confirming it is the **access token, not the ID token**
  _(verifies R6 / AC-10; REQ names sending the ID token as a classic failure — it often validates
  far enough to look like it works, then fails on `aud`)_
- **Grep the frontend source for `getAccessTokenSilently`** — expected: it appears **only** in
  `useApi.ts`; no `pages/` component calls it directly _(verifies ARCH's module-crossing rule —
  token handling must have exactly one implementation for issue #4 to inherit)_

##### Session continuity

- **Temporarily set the Auth0 access-token lifetime to 60 seconds, wait for expiry, then trigger an
  API call** — expected: the call succeeds with **no visible interruption**, and the network tab
  shows a token request **immediately preceding** the API call, which then succeeds — no retry of a
  failed call _(verifies R7 / AC-11 **as amended per ARCH A14**)_
- **Restore the token lifetime to `86400` afterwards** — expected: the runbook's Step 7 restore
  procedure is followed _(verifies R17's requirement that the runbook covers restoring this)_
- **Revoke the refresh token in the Auth0 dashboard, then trigger an API call** — expected: the
  user is sent to login rather than left on a broken page _(verifies R8 / AC-12 and the REQ edge
  case "refresh token is revoked or expired")_
- **Open the app in two tabs and let both refresh concurrently** — expected: neither tab is logged
  out; the whole token family is not revoked _(verifies ARCH forward stress-test "two tabs refresh
  simultaneously" — rotation makes each refresh token single-use, so concurrent refreshes can look
  like reuse; `auth0-spa-js` serialises refreshes across tabs. Checked explicitly because the
  symptom, "randomly logged out with two tabs open," is otherwise baffling.)_

##### Identity display

- **Sign in as a user with a `name` claim** — expected: the avatar shows initials derived from
  `name` _(verifies R5 / AC-9)_
- **Sign in as a user with no `name` but with an `email`** (possible with a nameless social
  profile) — expected: the
  avatar shows initials from the **email local-part** _(verifies R5 / AC-9 and the REQ edge case
  "user has no `name` claim")_
- **Sign in as a user with neither `name` nor `email`** — expected: a **generic person icon** —
  `getInitials()` returns `null`, never `""`; the avatar is **never blank** _(verifies R5 / AC-9
  and the REQ edge case "user has neither `name` nor `email`" — a blank circle reads as broken UI)_
- **Repeat across both connections** — database, Google — expected: a correct,
  non-blank avatar in every case _(ARCH backward-regression mitigation for `NavBar.tsx`)_

##### Logout

- **Click logout, then navigate to `/dashboard`** — expected: redirect to Auth0 which **presents a
  login prompt** — it does **not** sign the user straight back in _(verifies R9 / AC-13; REQ names
  "clearing local tokens and calling it logout" as a classic failure — the Auth0 session cookie
  survives and the next sign-in is silent, which reads as broken logout)_

##### Regression guards

- **Inspect the `/api/health` request in the network tab** — expected: it carries **no**
  `Authorization` header and still returns 200 _(verifies ARCH A3; guards backward-regression risk
  for `Dashboard.tsx` — routing the health check through auth would make a token failure and a dead
  API produce the same on-screen symptom, destroying the diagnostic value of the only diagnostic in
  the app)_
- **Read `Dashboard.tsx`** — expected: a comment explains that the health call is deliberately
  unauthenticated **and** that the component now mounts only *after* login, so the call that used
  to fire on page load now fires post-authentication _(guards the silent-regression hotspot — the
  changed behavior is invisible in the diff, and without the comment the next reader "fixes" it
  back)_
- **Trigger an API call that returns 4xx and one that returns 5xx** — expected: the response
  reaches the calling component **unmodified**; no redirect to login, no retry storm; the
  component's existing states handle it _(ARCH cross-cutting: only *refresh* failure redirects;
  HTTP errors are returned as-is)_

#### Testable Seams

None automated — no Vitest harness exists (see T4). `getInitials()` is the purest unit in the
change (`user → initials | null`, never throws, never returns `""`) and is the first thing that
should get a test when the harness lands with issue #6; `useApi`'s refresh-failure branch is the
second.

### Implementation Notes

- **Module(s):** `frontend/src/auth/` (`useApi.ts`, `initials.ts`) and
  `frontend/src/components/` (NavBar may depend on `@auth0/auth0-react` and `auth/initials`).
- **Pattern reference:** `NavBar.tsx` currently ends with an `aria-label="avatar placeholder"` div
  using `marginLeft: "auto"` (`frontend/src/components/NavBar.tsx:34-42`) — the real avatar
  replaces it in place, keeping the inline-style convention used throughout the component.
  `Dashboard.tsx`'s `fetch("/api/health")` (`frontend/src/pages/Dashboard.tsx:10`) is the shape
  `useApi()` wraps — and the one call site that deliberately stays outside it.
- **Key decisions:**
  - **A9 / hand-rolled `useApi()`** over native `fetch`, no axios. Two call sites exist; the
    wrapper is ~20 lines.
  - **A14 / proactive refresh** — call `getAccessTokenSilently()` before each request rather than
    reacting to a 401. Simpler, strictly fewer requests, and the SDK already checks expiry
    client-side. This is what amends AC-11.
  - **A3 / the health check stays unauthenticated** and outside `useApi`.
  - **R5 / initials chain** — `name` → email local-part → `null` (generic icon). `getInitials()` is
    pure, never throws, and **never returns `""`**.
  - Logout must call the SDK's logout with a `returnTo`, ending the **Auth0** session, not just
    clearing local tokens (REQ decision 6).
  - Interface contract: `useApi(): (path: string, init?: RequestInit) => Promise<Response>` —
    refresh failure triggers `loginWithRedirect()`; HTTP errors are returned to the caller
    unmodified.
- **Libraries:** `@auth0/auth0-react` (added by T4). No new dependency in this task.
- **High-risk callouts:**
  - *Issue #4 (M)* — `useApi()` is the single token-handling implementation the next ticket
    inherits. Keeping `getAccessTokenSilently()` out of `pages/` is what makes that inheritance
    clean.
  - The ID token never leaves the browser; the access token is never trusted as a source of profile
    display data (REQ: Tokens).
  - **No token value is ever logged**, in whole or in part, including in debugging `console.log`
    calls (ARCH cross-cutting hard rule).

### Scope Boundaries

- Do NOT add axios, interceptors, or TanStack Query (ARCH A9 — ADR-007 places TanStack Query with real data in issue #4).
- Do NOT route `/api/health` through `useApi()` (ARCH A3 — it would destroy the diagnostic value of the app's only diagnostic).
- Do NOT use the Auth0 `picture` claim for the avatar (REQ decision 5 — adds a remote-image failure path for no functional gain).
- Do NOT add a reactive 401-retry backstop (settled: AC-11 is amended to proactive per A14).
- Do NOT add a "session expired" message or any visible interruption on refresh (REQ decision 3 — expiry is not user error).
- Do NOT show a goodbye page on logout or implement local-only logout (REQ decision 6).
- Do NOT modify `Dashboard.tsx` beyond adding the explanatory comment.
- Only implement the files in the Footprint slice.

### Files Expected

**New files:** _(from ARCH "New files / modules")_
- `frontend/src/auth/useApi.ts` — authenticated fetch hook; refresh failure → login
- `frontend/src/auth/initials.ts` — pure `user → initials | null` (R5)

**Modified files:** _(from ARCH "Modified files / modules")_
- `frontend/src/components/NavBar.tsx` (placeholder `div` → initials avatar from `useAuth0().user`; logout control added — the `aria-label="avatar placeholder"` div is **replaced**, per ARCH "Deleted / replaced")
- `frontend/src/pages/Dashboard.tsx` (**comment only** — explaining that the health call is deliberately unauthenticated and now fires post-login)

**Must NOT modify:**
- `frontend/src/pages/Dashboard.tsx` — its `fetch("/api/health")` logic (silent-regression hotspot; the comment is the only permitted change)
- `frontend/src/App.tsx`, `frontend/src/main.tsx`, `frontend/src/components/Layout.tsx` (claimed by T4)
- `frontend/src/config.ts` and the container-config files (claimed by T3)
- `services/core-api/` (claimed by T2)
- `README.md` (claimed by T6)

---

## Task T6: Correct the README for the authenticated flow

> **Status:** not started
> **Verification:** checklist
> **Effort:** s
> **Priority:** high
> **Depends on:** T1, T2, T3, T4, T5 (the README cannot be written accurately until the full flow exists)
> **Satisfies REQs:** N3 (spirit) — closes the documented regression in ARCH's "Touched but not changed" table
> **Footprint slice:** Modified: `README.md`
> **High-risk areas touched:** `README.md` accuracy (**M**) — silent documentation rot whose failure mode is a developer concluding the deploy is broken; every developer's local `k8s/secrets.yaml` (**H**) — the README is the only channel that tells them to add three keys

### Description

The README's browser verification steps become false the moment T4 lands: "Open `http://localhost`
… should show Connected to API ✓" now redirects to Auth0 first, so following the README verbatim
looks exactly like a broken deploy. This task corrects them and documents the first-run setup a
fresh checkout now requires. It is split out because the README spans every other task's surface
and cannot be written accurately until they have all landed.

### Verification Checklist

- **Follow the README's browser verification steps on a running cluster** — expected: what the
  README describes is what actually happens — a redirect to Auth0, then login, then the dashboard
  _(guards ARCH backward-regression risk for `README.md`; the failure mode being closed is a
  developer concluding the deploy is broken)_
- **Run the README's `curl` steps verbatim** — expected: `curl http://localhost/api/health` → 200
  and `curl http://localhost:8080/` → 200, both still accurate **as already written** _(guards
  against over-correcting: ARCH A2 confirms these two steps remain valid and must not be "fixed")_
- **Read the first-run setup section** — expected: it names all three new Secret keys
  (`AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_AUDIENCE`), links `docs/auth0-setup-runbook.md`, and
  gives the dev step of copying `frontend/config.js.template` to `frontend/public/config.js`
  _(addresses the **H**-risk "every developer's local `k8s/secrets.yaml`" area — the file is
  gitignored, so it cannot be updated by a pull)_
- **Read the rollout section** — expected: the order is documented as update `k8s/secrets.yaml` →
  `make build` → `make deploy` → `make restart`, and it states that skipping the first crash-loops
  both pods **loudly and by design** _(ARCH: migrations / rollout — this is a breaking change for
  every existing checkout)_
- **Bring the project up on a fresh clone following only the README** — expected: it works end to
  end with no undocumented step and no question for the author _(the overall test of this task)_

### Implementation Notes

- **Module(s):** documentation only.
- **Pattern reference:** the README's existing "First-run setup" section already carries one-time
  manual work — the `k8s/secrets.yaml` copy step and the ingress-nginx install. The Auth0 runbook
  link follows that established convention rather than introducing a new one.
- **Key decisions:** A2 (the two `curl` steps stay valid); A16 (the runbook is a load-bearing
  artifact, not a courtesy — the tenant cannot be reconstructed from the repo, so the link matters);
  A15 (the `make deploy` guard now catches a missing key earlier, which the README should mention
  so the error message is expected rather than alarming).
- **Libraries:** none.
- **High-risk callouts:**
  - *README accuracy (M)* — ARCH's stated mitigation is "update in the same commit as the code, not
    afterwards." Splitting this into its own task trades that for accuracy across the whole flow;
    it must therefore land **before** the issue is considered complete, not after.
  - Do not document Auth0 tenant values themselves — link the runbook (N3).

### Scope Boundaries

- Do NOT restructure the README beyond the sections affected by this change.
- Do NOT put real Auth0 tenant values in the README (N3 — link the runbook instead).
- Do NOT document liveness/readiness probes (ARCH A1 — none were added).
- Do NOT document production or non-local deployment (ARCH Out of Scope — localhost only).
- Do NOT duplicate the runbook's content into the README — link it.
- Only modify the first-run setup, verification, and rollout sections.

### Files Expected

**Modified files:** _(from ARCH "Modified files / modules")_
- `README.md` (first-run setup: 3 new Secret keys, runbook link, dev `config.js` copy step; browser verification steps corrected; rollout order documented)

**Must NOT modify:**
- `docs/auth0-setup-runbook.md` (owned by T1)
- Any source, manifest, or Makefile file — this task is documentation only

---

## Coverage Notes

**Acceptance criteria.** AC-1 through AC-21 are each claimed by at least one task, with one
exception: **AC-14's liveness/readiness probe clause has nothing to verify** under ARCH A1, which
declined to add probes. Per ARCH's Open Questions, R10 is verified by the `curl` half only (T2).

**Change Footprint.** Every row of ARCH's "New files / modules" and "Modified files / modules"
tables is claimed by exactly one task. `docs/auth0-setup-runbook.md` is already written; T1 claims
it for execution and verification rather than authorship.

**Silent-regression hotspots.** Each "Touched but not changed" entry has an explicit guard:
`Dashboard.tsx` → T5, `README.md` → T6 (and T6's "do not over-correct the `curl` steps" item),
`Makefile` deploy guard → T1, `Program.cs` CORS block → T2's `:5173` preflight check,
`frontend/.dockerignore` → T3's pre-entrypoint `cat` check, `frontend/vite.config.ts` → T4's
`:5173` login check. Repo-wide test infrastructure → addressed by the verification-mode note at the
top of this document. `ingestion-service` / `receipt-service` → recorded as out of scope in T2.
