# Requirements: Auth0 Integration — All Routes Protected

> **Date:** 2026-09-09
> **Issue:** #3
> **Type:** infrastructure
> **Source:** GitHub issue #3 (Task 02 of 05) + `docs/planning/expense-tracker-foundation-plan.md` §Task 02
> **Phase:** 1 of 5 (Requirement Engineering)

## Summary

Expense Tracker currently has three fully public pages and an API that asks nothing of its
callers. This task introduces user authentication end to end: the React SPA sends
unauthenticated visitors to Auth0 to log in, carries the resulting token on every API call, and
the .NET Core API validates that token before serving anything beyond its health check.

The deliverable is not a feature users asked for — it is the security floor every later ticket
builds on. From this point forward the project's working rule is **no endpoint is born
unprotected**, and this task is what makes that rule enforceable.

Identity lives entirely in Auth0. No user table, no password handling, no session store of our
own — a deliberate consequence of ADR-002, which selected Auth0's free tier as a centralized
identity provider so a future second application ("PayGuard") can share one user base via SSO.

## Problem & Motivation

**Trigger.** Task 01 (#2) delivered a working request path — browser → nginx → Core API — with
no notion of who is asking. Task 03 (#4) introduces the first persisted data, and every
`Transaction` row is keyed by a user identity (`UserId`, the Auth0 `sub`). Authentication must
therefore exist *before* there is data to attribute, not after.

**Who benefits.** End users get real accounts with a choice of sign-in methods. The team gets a
protected-by-default posture: adding auth after a dozen endpoints already exist means auditing
each one and inevitably missing some.

**Cost of not doing it.** Task 03 cannot correctly attribute a transaction to anyone. Any
endpoint written in the interim ships public and needs retrofitting. Retrofitting auth is
notoriously the point at which "we'll secure it later" becomes a security incident.

**Why Auth0 rather than our own.** Per ADR-002: multi-app SSO out of the box, social login,
managed token lifecycle, and zero auth code to maintain — trading away control and OIDC depth
for time better spent on the distributed-systems learning goals. The decision has an explicit
tripwire at 7,500 monthly active users.

## Users & Consumers

- **End user (human, browser)** — needs to sign in with email/password or Google, stay
  signed in across a working session without re-authenticating, see that the app knows who they
  are, and sign out completely.
- **React SPA** — needs Auth0 configuration at runtime, an access token for every API call, and
  a way to renew that token without interrupting the user.
- **Core API (.NET)** — needs to validate Auth0-issued tokens offline and expose the caller's
  identity to endpoint code.
- **Kubernetes kubelet** — needs `GET /api/health` to stay reachable without credentials, or
  liveness and readiness probes fail and pods restart forever.
- **Future: Ingestion Service** — will call the Core API with no human behind the request. Not
  built here, but it constrains how the middleware is written (see N5).

## Functional Requirements

| ID | Requirement | Acceptance Criterion |
|----|-------------|----------------------|
| R1 | All three SPA routes require authentication | Visiting `/dashboard`, `/expenses`, or `/settings` while logged out redirects to the Auth0 login page. None renders its content first. **(AC-5)** |
| R2 | The originally requested path survives login | Visiting `/expenses` logged out and completing login lands the user on `/expenses`, not `/dashboard`. **(AC-6)** |
| R3 | No protected content appears before auth resolves | With the network throttled to slow 3G, reloading `/dashboard` shows a full-page loading state; no dashboard content or NavBar links appear before auth state resolves. **(AC-7)** |
| R4 | A failed or cancelled login lands somewhere recoverable | Cancelling at the Auth0 consent screen returns the user to a public error screen with a working "Try again" button that restarts login. No redirect loop; no raw Auth0 error text shown. **(AC-8)** |
| R5 | The NavBar avatar identifies the signed-in user | Initials derive from `name`; absent that, the email local-part; absent both, a generic person icon. Verified in all three cases; never blank. **(AC-9)** |
| R6 | Every API call carries the access token | Browser network tab shows `Authorization: Bearer <token>` on all `/api/*` requests, and the token's `aud` matches the registered API identifier (confirming it is the access token, not the ID token). **(AC-10)** |
| R7 | Token expiry is invisible to the user | With the Auth0 access-token lifetime temporarily set to 60 seconds, the first API call after expiry succeeds with no visible interruption; the network tab shows a token request followed by a retry of the original call. The lifetime is then restored. **(AC-11)** |
| R8 | Unrecoverable session loss returns the user to login | With the refresh token revoked in the Auth0 dashboard, the next API call sends the user to login rather than leaving a broken page. **(AC-12)** |
| R9 | Logout ends both the app session and the Auth0 session | After logout, navigating to `/dashboard` redirects to Auth0 and presents a login prompt — it does not sign the user straight back in. **(AC-13)** |
| R10 | The health endpoint stays public | `curl http://localhost/api/health` with no token returns 200; K8s liveness and readiness probes stay green. **(AC-14)** |
| R11 | `/api/me` requires a valid token | `curl http://localhost/api/me` with no token returns 401. **(AC-15)** |
| R12 | `/api/me` returns the caller's identity | With a valid token, returns 200 and a body containing `sub`, `email`, and `name`. **(AC-16)** |
| R13 | Invalid tokens are rejected without exception | `/api/me` returns 401 for each of: an expired token, a token whose `aud` is a different API, a token from a different Auth0 tenant, and a structurally malformed string. Four separate checks. **(AC-17)** |
| R14 | Authentication only — no authorization | A valid token bearing no custom scopes returns 200 from `/api/me`. **(AC-18)** |
| R15 | Login works from both local entry points | Login succeeds from the K8s ingress (`http://localhost`) and from the Vite dev server (`http://localhost:5173`); both are registered as callback, logout, and web-origin URLs. **(AC-2)** |
| R16 | Unverified email addresses are not blocked | A user who signs up with email/password and never verifies the address still reaches `/dashboard`. **(AC-4)** |
| R17 | Tenant setup is reproducible, not remembered | A written runbook lives in the repo; someone starting from an empty Auth0 account can follow it end to end and obtain a working `domain`, `clientId`, and `audience` without asking the author a question. It includes restoring the token lifetime changed for R7. **(AC-1)** |

## Non-Functional Requirements

| ID | Requirement | Acceptance Criterion |
|----|-------------|----------------------|
| N1 | Misconfiguration fails loudly at startup | Starting the Core API with the Auth0 audience or domain missing or malformed causes startup to fail; the pod enters `CrashLoopBackOff` and `kubectl logs` names the specific missing setting. **(AC-19)** |
| N2 | One frontend image runs in every environment | Changing the Auth0 domain in the K8s Secret and restarting the frontend pod changes where the browser is sent for login, with no image rebuild. **(AC-20)** |
| N3 | No Auth0 credential is committed | Auth0 domain, clientId, and audience live only in the K8s Secret; `k8s/secrets.yaml.template` carries placeholders. `git log -p` contains no real tenant values. **(AC-21)** |
| N4 | Token validation adds no per-request network call | The Core API fetches Auth0's JWKS once and caches it; validating a request performs no outbound HTTP. Verified by inspecting logs or traffic during a burst of `/api/me` calls. |
| N5 | The middleware does not assume a human caller | Token handling treats a machine token (no user `sub`, no `email`) as a validation-and-claims concern rather than an error, so Task 04's service-to-service work is additive. Reviewed at implementation; not independently testable until #5 exists. |

## Behaviors & Domain Rules

### Route protection

Every route in the SPA is protected. There is no public page other than the login-error screen
(R4) and Auth0's own hosted login. `/` redirects to `/dashboard`, which is itself protected.

Auth state has **three** values, not two: authenticated, unauthenticated, and *not yet known*.
The third is the one that causes bugs — treating "not yet known" as "unauthenticated" produces a
spurious redirect on every page load, while treating it as "authenticated" flashes protected
content to logged-out visitors. R3 exists to force the third state to be handled explicitly.

### Tokens

Auth0 returns two tokens with different jobs:

- **ID token** — describes the user; consumed by the frontend for display (R5).
- **Access token** — authorizes API calls; consumed and validated by the Core API (R6, R12).

The ID token must never be sent to the API, and the access token must never be trusted by the
frontend as a source of profile display data.

The Core API validates four things on every request: signature (RS256, against Auth0's published
JWKS), `iss` matching the tenant, `aud` matching the registered API identifier, and `exp` in the
future. All four must pass. Validation is entirely local — no call to Auth0 per request (N4).

### Session lifetime

Access tokens are short-lived by design. Renewal is silent: on a 401 the SDK exchanges the
refresh token for a new access token and retries the original call (R7). Only when renewal
itself fails does the user go back to login (R8). Refresh token rotation is enabled, so each
refresh token is single-use and reuse of an old one signals theft.

### Identity and accounts

`sub` is the permanent user identifier and the value Task 03 will persist as
`Transaction.UserId`. It is **connection-specific**: the same person signing in via Google
and email/password produces two distinct `sub` values.

**Task 02 knowingly ships with those duplicates.** They are harmless while no data exists, which
is precisely why resolution belongs in Task 03 (#4) — before the first row is written, when it
is a configuration change rather than a data migration. Anyone testing this task will see
duplicate users; that is expected behavior here, not a defect.

### Configuration

Auth0 values reach the Core API as environment variables from a K8s Secret. They reach the SPA
at **runtime**, not build time (N2) — the browser, not the pod, is the consumer, and Vite
compiles `VITE_*` variables into the bundle, so a mounted env var alone never reaches the
running page. The mechanism is an architecture decision (Phase 2); the requirement is that one
image works everywhere and a config change needs no rebuild.

**Why these rules matter:**

- Protecting routes and validating tokens are independent defenses. Route protection is a UX
  affordance a user can bypass by calling the API directly; token validation is the actual
  security boundary. Both are required — neither substitutes for the other.
- `sub` becomes a foreign key in Task 03. Every decision about identity here has a data-shaped
  consequence one ticket later.
- Fail-fast configuration (N1) matters more than usual in Kubernetes, where a silently
  misconfigured pod stays green and its symptom — every request 401ing — looks identical to an
  authentication bug. A crash-loop points straight at the cause.
- The public health endpoint (R10) is not an oversight to be tightened later. Protecting it
  would make kubelet probes fail and put the deployment into a restart loop.

**Common mistakes:**

- **Not registering an API in Auth0, or omitting `audience` in the token request.** Auth0 then
  returns an *opaque* token — a random string with no claims — instead of a JWT. The .NET
  middleware fails with a signature error that gives no hint the cause is a missing audience.
  This is the single most likely way to lose an afternoon on this task.
- **Sending the ID token to the API.** It often validates far enough to look like it works,
  then fails on `aud`, producing a confusing partial success.
- **Clearing local tokens and calling it logout.** Auth0's own session cookie survives, so the
  next "Sign in" click logs straight back in with no prompt — which reads as a broken logout.
- **Treating "auth not yet resolved" as "unauthenticated."** Causes a redirect to Auth0 on every
  page load, even for signed-in users.
- **Assuming build-time env vars reach the browser in Kubernetes.** They do not; the Secret is
  mounted into a pod serving a bundle that was compiled elsewhere.
- **Hardcoding the deep-link return to `/dashboard`** because it is what the happy path shows.

## Edge Cases & Failure Modes

| Scenario | Decision | Rationale |
|----------|----------|-----------|
| Unauthenticated user deep-links to `/expenses` | Capture the path, restore it after login | Bookmarks and shared links are normal navigation; dropping them is a visible regression |
| Page loads while Auth0 SDK is still resolving session | Full-page loading state | Prevents a flash of protected content; avoids a spurious redirect for signed-in users |
| Access token expires mid-session | Silent refresh, then retry the failed call | The user has done nothing wrong and should notice nothing; a redirect would lose in-progress work |
| Refresh token is revoked or expired | Redirect to login | Genuinely unrecoverable without user action |
| User cancels at the Auth0 consent screen | Public error screen with "Try again" | Auto-retrying traps a user who deliberately backed out |
| Social connection (Google) fails or is misconfigured | Same error screen; raw Auth0 error logged, not displayed | Users cannot act on `invalid_request`; developers need it in logs |
| User has no `name` claim | Initials from email local-part | Social profiles may omit `name` (e.g. a Google account without one) |
| User has neither `name` nor `email` | Generic person icon | A blank circle reads as a broken UI |
| Core API starts with missing or malformed Auth0 config | Fail fast; crash-loop with the setting named | A quiet blanket-401 is indistinguishable from an auth bug |
| Auth0 tenant unreachable when the API needs JWKS | Startup fails; cached keys serve existing traffic once fetched | Making it a per-request dependency would put an external service in the hot path |
| Token from a different Auth0 tenant | 401 | `iss` validation; otherwise any Auth0 customer's token would be accepted |
| Token for a different API (`aud` mismatch) | 401 | Prevents a token minted for another service being replayed here |
| Expired token | 401 | Frontend handles renewal (R7); the API's job is to reject |
| Malformed or truncated `Authorization` header | 401, no unhandled exception | Must not return 500 — an unauthenticated caller should not be able to produce a server error |
| Same email across Google and password | Two separate accounts, accepted for now | Deferred to #4; see Behaviors → Identity and accounts |
| Unverified email/password signup | Allowed through to the app | No email-dependent feature exists yet; gating adds a state that is easy to get stuck in locally |
| kubelet probes `/api/health` with no credentials | 200 | Protecting it would cause a permanent restart loop |
| Service calling the API with no human user | Out of scope; must not break the middleware's assumptions | Deferred to #5; constrains this task via N5 |

## Decisions Log

> **Amendment (2026-09-12, developer decision):** the **GitHub connection is dropped from
> scope**. The tenant ships with database (email/password) and Google only — the developer does
> not want a personal GitHub OAuth App for this project. Effects: "three connections" reads as
> two throughout this document; duplicate-account behavior spans Google + password; the
> no-`name` avatar case stays in scope (social profiles may omit `name`). GitHub can be added
> later by following the runbook — no code change is required.

| # | Decision | Alternatives Considered | Chosen Because |
|---|----------|-------------------------|----------------|
| 1 | Preserve deep link across login | Always land on `/dashboard` | Bookmarked and shared links are how people navigate; the state to carry is small |
| 2 | Full-page loading state while auth resolves | App shell with a loading body | Rendering chrome before identity is known risks a flash of protected content |
| 3 | Silent refresh, then retry on 401 | Immediate login redirect; visible "session expired" message | Expiry is not user error; a redirect discards in-progress work |
| 4 | Tenant setup as a written runbook | Assume tenant exists; automate via Management API/Terraform | Console work cannot be automated cheaply, but it can be made reproducible; automation is disproportionate for one tenant |
| 5 | Initials: `name` → email → generic icon | `name` → email only; prefer the Auth0 `picture` | Social logins frequently omit `name`; the icon guarantees the avatar is never blank. `picture` adds a remote-image failure path for no functional gain |
| 6 | Logout ends app **and** Auth0 session, landing on login | Local session only; goodbye page | Local-only leaves the Auth0 cookie alive, so "Sign in" silently re-authenticates — indistinguishable from broken logout |
| 7 | Core API fails fast on bad Auth0 config | Boot with health green and 401 everything; boot but fail the probe | A crash-loop names the cause; a quiet blanket-401 masquerades as an auth bug |
| 8 | SPA config injected at runtime | Build-time bake into the bundle | Vite bakes `VITE_*` at build time, so the issue's "mount as env vars" cannot work as written; runtime injection keeps one image across dev, CI, and prod |
| 9 | Login errors → public error screen with "Try again" | Bounce straight back to Auth0; show the raw error | Auto-retry traps a user who cancelled; raw Auth0 errors are not actionable by users |
| 10 | Authentication only — no scopes or roles | Require a scope on `/api/me` | No data exists to scope; a scope pattern established against one endpoint is speculative. Revisit in Task 03 when rows have owners |
| 11 | Email verification not gated | Block unverified users until confirmed | No email-dependent feature exists; gating adds a state that is easy to get stuck in during local development |
| 12 | Account linking deferred to #4 (Task 03) | Enable linking now; restrict to one connection type | Must land before the first persisted `UserId`, not before the first login. Restricting connections would contradict the ticket's stated goal. Issue #4 updated to carry it |
| 13 | Service-to-service auth deferred to #5 (Task 04) | Introduce an M2M application now | The mechanism belongs with the caller that needs it. Recorded here as constraint N5 so Task 04 is additive rather than a middleware rewrite |
| 14 | R7 verified by temporarily shortening token lifetime | Assert SDK configuration and rotation settings only | The refresh code path never executes in a normal session, so a config-only check passes while renewal is genuinely broken (missing `offline_access`, refresh tokens disabled, interceptor never retrying) |

## Scope Boundaries

### In Scope

- Auth0 tenant configuration: SPA Application, registered API (audience), callback / logout /
  web-origin URLs for `http://localhost` and `http://localhost:5173`, refresh token rotation.
- Connections enabled: database (email/password), Google (Auth0 dev keys). GitHub was dropped
  by developer decision on 2026-09-12 — see the Decisions Log amendment.
- A written setup runbook committed to the repo (R17).
- Frontend: `Auth0Provider`, `ProtectedRoute` wrapping all three routes, login-error screen,
  logout control, avatar initials, and an interceptor attaching the access token with silent
  refresh and retry.
- Core API: JWT bearer validation middleware (issuer, audience, signature, expiry), a public
  `GET /api/health`, and a protected `GET /api/me` returning `sub`, `email`, `name`.
- K8s: Auth0 domain, clientId, and audience in the Secret; a runtime path for delivering the
  SPA's configuration.
- A test user in Auth0 for Task 05's Playwright suite.

### Out of Scope

- **Any database or persisted user record** (reason: Task 03 / #4 — identity lives in Auth0 for now).
- **Account linking across connections** (reason: deferred to #4; must precede the first
  persisted `UserId`. Duplicate accounts are expected behavior in this task).
- **Service-to-service authentication and email-ingestion user attribution** (reason: deferred
  to #5; constrains this task only via N5).
- **Authorization — roles, scopes, permissions** (reason: nothing to scope until data exists).
- **Any protected endpoint other than `/api/me`** (reason: the ticket's stated boundary).
- **Email verification gating** (reason: decision 11).
- **Production or non-local environments** — localhost only (reason: deployment is Task 05 and beyond).
- **Automated CI authentication** — Playwright storage state and the Resource Owner Password
  Grant (reason: Task 05 / #6). A test user is created here so that work is unblocked.
- **Password reset, signup customization, MFA, Universal Login branding** (reason: Auth0 defaults
  suffice; no requirement has been stated).
- **A test asserting that all future `/api/*` routes require auth** (reason: only one protected
  endpoint exists; belongs with the Task 05 harness).

## Open Questions

- **How the SPA receives its configuration at runtime** (env-substituted file served by nginx, a
  small config endpoint, or another mechanism).
  - **Impact if unresolved:** N2 cannot be implemented; a build-time fallback would make the
    frontend image environment-specific and break the one-image goal.
  - **Suggested default:** generate a small config file from environment variables at container
    startup and load it before the app boots. This is a Phase 2 (plan-architecture) decision.

- **Whether Google uses Auth0's shared development keys or project-owned OAuth credentials.**
  - **Impact if unresolved:** dev keys work on localhost but are rate-limited and unsuitable for
    production, so the choice resurfaces at deployment.
  - **Suggested default:** dev keys for this task, since it is localhost-only; note the swap in
    the runbook as a prerequisite for any real deployment.

- **Access token lifetime for normal operation.**
  - **Impact if unresolved:** Auth0's 24-hour default is long for a token that cannot be revoked
    mid-life; too short adds refresh traffic.
  - **Suggested default:** accept the Auth0 default for this task and revisit when real data
    exists. R7 requires only that renewal demonstrably works, whatever the lifetime.

---
_This requirements document is the input for the **plan-architecture** skill._
_Next step: `/plan-architecture from: specs/requirements/REQ-3-auth0-integration-all-routes-protected.md`_
