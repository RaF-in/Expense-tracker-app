# Auth0 Setup Runbook — Expense Tracker

> **Issue:** #3 (Task 02 of 05) · satisfies **R17 / AC-1**
> **Audience:** anyone starting from an empty Auth0 account who needs a working
> `domain`, `clientId`, and `audience` without asking the author a question.
> **Scope:** local development only — `http://localhost` (K8s ingress) and
> `http://localhost:5173` (Vite dev server).

Everything here is manual console work. It is deliberately not automated: it happens once per
tenant, and the Auth0 Management API/Terraform route costs more to build and maintain than it
saves for a single tenant (REQ decision 4).

**Time:** ~30 minutes, plus ~5 for the GitHub OAuth App.

---

## What you are building

Five things in the Auth0 console, in this order. Order matters — the Action in step 5 can't be
tested until the Application in step 2 exists.

| # | Thing | Produces |
|---|-------|----------|
| 1 | **API** (a resource server) | `AUTH0_AUDIENCE` |
| 2 | **Application** (SPA type) | `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID` |
| 3 | **Connections** — database, Google (GitHub optional — dropped from issue #3 scope) | sign-in methods |
| 4 | **Test user** | credentials for Task 05 |
| 5 | **Post-Login Action** | `email` + `name` claims in the access token |

> **⚠️ Read this before you start.**
> The single most common way to lose an afternoon on this task is **skipping step 1**. If no API
> is registered — or the frontend requests a token without an `audience` — Auth0 returns an
> **opaque token** (a random string) instead of a JWT. The .NET middleware then fails with a
> signature error that gives no hint the real cause is a missing audience. Do step 1 first.

---

## Step 0 — Create the tenant

1. Sign up at [auth0.com](https://auth0.com) (free tier — 7,500 MAU, per ADR-002).
2. Pick a **region**. This becomes part of your domain and **cannot be changed later**.
3. Auth0 creates a tenant with a domain like `dev-a1b2c3d4.us.auth0.com`.

Record it — this is `AUTH0_DOMAIN`:

```
AUTH0_DOMAIN = dev-a1b2c3d4.us.auth0.com
```

> Store the **bare hostname**, with no `https://` and no trailing slash. The frontend SDK wants
> it bare; the .NET API builds `https://{domain}/` from it internally. Including the scheme
> breaks both in different, confusing ways.

---

## Step 1 — Create the API (this is your `audience`)

**Applications → APIs → + Create API**

| Field | Value |
|-------|-------|
| **Name** | `Expense Tracker API` |
| **Identifier** | `https://api.expense-tracker.local` |
| **JSON Web Token Profile** | Auth0 (default) |
| **Signing Algorithm** | **RS256** (default — do not change to HS256) |

**About the Identifier:** it is an opaque string that Auth0 never calls and that never has to
resolve to anything. It is a URI purely by convention. Once created it **cannot be changed** —
you'd have to delete and recreate the API. Whatever you type here is your `audience`, verbatim,
in both the frontend config and the API config.

**RS256, not HS256:** RS256 signs with a private key Auth0 holds and publishes the matching
public key at `/.well-known/jwks.json`. That is what lets the Core API validate tokens with **no
network call per request** (N4). HS256 uses a shared secret, which would mean putting a signing
secret in your API — a genuine credential, unlike everything else in this runbook.

Click **Create**.

### 1a. Enable offline access — required, easy to miss

Open the API you just created → **Settings** tab → scroll to **Access Settings**:

- ☑️ **Allow Offline Access** → **ON**

**This is not optional.** With it off, Auth0 silently ignores the `offline_access` scope and
issues **no refresh token**. Everything appears to work until the access token expires, at which
point the user is bounced to login mid-session — and **R7 cannot pass**. The failure surfaces
hours after the mistake, which is what makes it expensive.

Leave **Token Expiration (Seconds)** at its default `86400` for now. You will change it
temporarily in step 7 to test R7, and change it back.

Click **Save**.

Record it — this is `AUTH0_AUDIENCE`:

```
AUTH0_AUDIENCE = https://api.expense-tracker.local
```

---

## Step 2 — Create the SPA Application

**Applications → Applications → + Create Application**

| Field | Value |
|-------|-------|
| **Name** | `Expense Tracker SPA` |
| **Type** | **Single Page Web Applications** |

Pick the type carefully. It determines which grant types and which token-storage options Auth0
offers you. "Regular Web Application" is a confidential client that expects a client secret and
will not give you the refresh-token rotation settings in step 2b.

Skip the framework quickstart. Go to the **Settings** tab.

### 2a. URLs

Three separate fields. All three take a **comma-separated** list, and all three need **both**
origins (R15) — one for the K8s ingress, one for the Vite dev server:

| Field | Value |
|-------|-------|
| **Allowed Callback URLs** | `http://localhost, http://localhost:5173` |
| **Allowed Logout URLs** | `http://localhost, http://localhost:5173` |
| **Allowed Web Origins** | `http://localhost, http://localhost:5173` |

What each one does — they fail differently, so the distinction is worth knowing:

- **Callback** — where Auth0 may redirect *back to* after login. Miss it and login dies on
  Auth0's own page with `Callback URL mismatch`, listing the URL it received. Verbose failure.
- **Logout** — where Auth0 may redirect after clearing its session. Miss it and logout fails
  *after* the session is already gone, stranding the user on an Auth0 error page.
- **Web Origins** — which origins may make the CORS calls the SDK uses for silent token renewal.
  Miss it and **login works fine**, then token refresh fails later with an opaque CORS error in
  the console. The quiet one.

> `http://localhost` has no port because port 80 is implied — that is the ingress. Do not write
> `http://localhost:80`; it will not match.
>
> No trailing slashes. `http://localhost/` and `http://localhost` are different strings to Auth0.

Click **Save Changes**.

### 2b. Refresh token rotation

Same Settings page, scroll to **Refresh Token Rotation**:

| Setting | Value |
|---------|-------|
| **Rotation** | **ON** |
| **Reuse Interval** | `0` seconds (default) |
| **Absolute Expiration** | ON — `2592000` seconds (30 days, default) |
| **Inactivity Expiration** | ON — `1296000` seconds (15 days, default) |

**What rotation buys you:** each refresh token is single-use. Using one returns a new one and
invalidates the old. If an attacker steals a refresh token and replays it after the legitimate
user has already used it, Auth0 detects the reuse and **revokes the entire token family** —
logging out the attacker and the user. That detection is the mitigation for storing refresh
tokens in `localStorage`, which is an accepted risk in this architecture (see ARCH-3, C2).

### 2c. Grant types

Same page → **Advanced Settings** (at the bottom) → **Grant Types** tab. Confirm both are ticked:

- ☑️ **Authorization Code** — the login flow (with PKCE, which the SDK adds automatically)
- ☑️ **Refresh Token** — silent renewal (R7)

`Implicit` may also be ticked by default. It is a legacy flow the SDK does not use; leaving it on
is harmless, unticking it is tidier.

Click **Save Changes**.

### 2d. Record the values

From the top of the **Settings** tab:

```
AUTH0_DOMAIN    = dev-a1b2c3d4.us.auth0.com     ← same as step 0
AUTH0_CLIENT_ID = AbCdEf123456...                ← copy from "Client ID"
```

**Ignore the Client Secret entirely.** A SPA is a public client — its code ships to the browser,
so it cannot keep a secret. Security comes from the callback-URL allowlist and PKCE. If you ever
find yourself pasting the client secret into frontend config, something has gone wrong.

---

## Step 3 — Enable connections

Three sign-in methods. Each must be enabled **and** associated with the `Expense Tracker SPA`
application — a connection that exists but isn't linked to the app won't appear on the login page.

### 3a. Database (email + password)

**Authentication → Database**

`Username-Password-Authentication` exists by default. Open it → **Applications** tab →
toggle **Expense Tracker SPA → ON**.

No email-verification gating is configured (REQ decision 11): a user who signs up and never
verifies their address still reaches `/dashboard` (R16). This is the default behavior — you do
not need to change anything to get it. Do **not** enable any "require verified email" rule.

### 3b. Google

**Authentication → Social → + Create Connection → Google**

Leave **Client ID** and **Client Secret** blank to use **Auth0 development keys**. Then
**Applications** tab → toggle **Expense Tracker SPA → ON**.

You will see a banner warning that dev keys are in use. That is expected and correct for this
task — it is localhost-only (REQ open question 2). Dev keys are rate-limited and show Auth0's
name rather than yours on the consent screen.

> **Before any real deployment:** replace these with project-owned OAuth credentials from the
> Google Cloud Console. This is a known prerequisite, not a surprise. Deferred here deliberately.

### 3c. GitHub — OPTIONAL (dropped from issue #3 scope)

> **Dropped from scope on 2026-09-12 (developer decision):** the project ships with database and
> Google connections only. Keep this section if you want GitHub later — it requires no code
> change, only the steps below plus enabling the connection on the SPA application.

GitHub does **not** offer Auth0 development keys, so this one needs a real OAuth App. Two parts.

**Part 1 — create the OAuth App on GitHub:**

[github.com/settings/developers](https://github.com/settings/developers) → **OAuth Apps** →
**New OAuth App**

| Field | Value |
|-------|-------|
| **Application name** | `Expense Tracker (local)` |
| **Homepage URL** | `http://localhost` |
| **Authorization callback URL** | `https://YOUR_AUTH0_DOMAIN/login/callback` |

The callback URL points at **Auth0**, not at your app — substitute your real domain, e.g.
`https://dev-a1b2c3d4.us.auth0.com/login/callback`. This is the step people get wrong: GitHub
redirects to Auth0, and Auth0 then redirects to you. Note it is `https://` here, unlike your
localhost URLs.

Click **Register application**, then **Generate a new client secret**. Copy both the Client ID
and the secret — **the secret is shown once**.

**Part 2 — wire it into Auth0:**

**Authentication → Social → + Create Connection → GitHub**

| Field | Value |
|-------|-------|
| **Client ID** | from the GitHub OAuth App |
| **Client Secret** | from the GitHub OAuth App |
| **Attributes** | ☑️ **Email address** (plus the defaults) |

Tick **Email address** explicitly. Without it, GitHub users arrive with no `email` claim, and the
avatar-initials fallback chain (R5) has nothing to fall back to before the generic icon.

Then **Applications** tab → toggle **Expense Tracker SPA → ON**.

> **Expect duplicate accounts.** Signing in with Google, GitHub, and email/password using the
> same address produces **three separate users with three different `sub` values**. This is
> correct behavior for this task, not a defect. Account linking is deferred to issue #4, where it
> lands before the first `Transaction.UserId` is ever persisted — a config change rather than a
> data migration (REQ decision 12).

---

## Step 4 — Create a test user

**User Management → Users → + Create User**

| Field | Value |
|-------|-------|
| **Email** | `qa@expense-tracker.local` |
| **Password** | generate a strong one |
| **Connection** | `Username-Password-Authentication` |

Store the password in your password manager. This user is not needed for Task 02 itself — it
exists so Task 05's Playwright suite (#6) is unblocked without another console trip.

---

## Step 5 — Post-Login Action: add profile claims to the access token

**This step is what makes `/api/me` return `email` and `name` (R12 / AC-16).**

Auth0 access tokens contain only `iss`, `sub`, `aud`, `exp`, `azp`, and `scope`. The `profile`
and `email` scopes populate the **ID token** and the `/userinfo` endpoint — **not** the access
token. The Core API only ever sees the access token (correctly — the ID token must never be sent
to it), so without this Action `/api/me` returns `sub` plus two nulls.

That failure mode returns **200**, which is why it looks like it works.

**Actions → Library → + Build Custom**

| Field | Value |
|-------|-------|
| **Name** | `Add profile claims to access token` |
| **Trigger** | **Login / Post Login** |
| **Runtime** | Node 22 (recommended default) |

Replace the editor contents with:

```js
exports.onExecutePostLogin = async (event, api) => {
  const namespace = 'https://expense-tracker.local';

  api.accessToken.setCustomClaim(`${namespace}/email`, event.user.email ?? null);
  api.accessToken.setCustomClaim(`${namespace}/name`, event.user.name ?? null);
};
```

Click **Deploy**.

Then attach it: **Actions → Triggers → post-login** → drag `Add profile claims to access token`
from the right-hand panel onto the flow between **Start** and **Complete** → **Apply**.

**Deploying is not enough — an Action that isn't in the flow never runs.** This is the second
place this step quietly fails.

### Why the namespace

Auth0 rejects custom claims on non-namespaced names to avoid collisions with OIDC standard
claims. The namespace must look like a URL and **must not** be an `auth0.com` domain. It never
has to resolve. The resulting claim keys are:

```
https://expense-tracker.local/email
https://expense-tracker.local/name
```

⚠️ **These strings must match the Core API exactly.** They are read verbatim in
`services/core-api/src/Program.cs`. A typo in either place yields nulls, not an error.

`?? null` matters: GitHub users frequently have no `name`, and machine-to-machine tokens (Task
04, #5) have neither — no human logged in, so this Action never ran. The API reads these claims
null-safely and returns nulls rather than throwing, which is what makes N5 hold.

---

## Step 6 — Put the values into the cluster

You now have three values:

```
AUTH0_DOMAIN    = dev-a1b2c3d4.us.auth0.com
AUTH0_CLIENT_ID = AbCdEf123456...
AUTH0_AUDIENCE  = https://api.expense-tracker.local
```

### 6a. Kubernetes (`http://localhost`)

If you have not created your local secrets file yet:

```bash
cp k8s/secrets.yaml.template k8s/secrets.yaml
```

Edit `k8s/secrets.yaml` and fill in the three `AUTH0_*` keys alongside the existing Postgres and
RabbitMQ values. `k8s/secrets.yaml` is **gitignored**; `k8s/secrets.yaml.template` carries
placeholders only, and no real tenant value is ever committed (N3).

### 6b. Vite dev server (`http://localhost:5173`)

```bash
cp frontend/config.js.template frontend/public/config.js
```

Edit it with the same three values. `frontend/public/config.js` is gitignored, exactly mirroring
the `k8s/secrets.yaml` pattern.

### 6c. Deploy

```bash
make build
make deploy
make restart
```

> **Are these secret?** Not cryptographically — a SPA `clientId`, `domain`, and `audience` are
> visible in any browser's network tab and are public by design. They live in a K8s Secret to
> keep environment-specific values out of git (N3), not because they are credentials. The values
> that genuinely *are* credentials — `POSTGRES_PASSWORD`, `RABBITMQ_DEFAULT_PASS` — live in the
> same Secret but are **never** injected into the frontend pod. See ARCH-3, C8.

---

## Step 7 — Temporarily shorten the token lifetime to verify R7

R7/AC-11 requires proving that silent token renewal genuinely works. The refresh code path never
executes during a normal session, so a configuration-only check passes while renewal is actually
broken — a missing `offline_access`, rotation disabled, an interceptor that never refreshes. The
only honest test is to make a token expire while you watch.

**To test:**

1. **Applications → APIs → Expense Tracker API → Settings**
2. **Token Expiration (Seconds)**: `86400` → **`60`**
3. **Save**
4. Log in to the app. Open devtools → Network. Wait ~70 seconds.
5. Trigger an API call (navigate to a page that fetches).
6. **Expect:** a request to `https://YOUR_DOMAIN/oauth/token` immediately followed by the API
   call succeeding. No visible interruption, no redirect to login.

**🔴 Then restore it:**

1. **Token Expiration (Seconds)**: back to **`86400`**
2. **Save**

Do not skip the restore. A 60-second lifetime left in place generates constant refresh traffic
and makes every later debugging session strange. This step is called out explicitly in R17
because it is exactly the kind of temporary change that gets forgotten.

---

## Verification checklist

Work through these before declaring the tenant done:

- [ ] `curl http://localhost/api/health` → **200**, no token needed (R10)
- [ ] `curl http://localhost/api/me` → **401** (R11)
- [ ] Visiting `http://localhost/expenses` while logged out → Auth0 login, and after signing in
      you land on **`/expenses`**, not `/dashboard` (R2)
- [ ] Login works with **email/password**, **Google**, and **GitHub** (step 3)
- [ ] Login works from **both** `http://localhost` and `http://localhost:5173` (R15)
- [ ] NavBar avatar shows initials; a GitHub account without a `name` falls back to the email
      local-part (R5)
- [ ] Devtools → Network → an `/api/me` request carries `Authorization: Bearer …`, and pasting
      the token into [jwt.io](https://jwt.io) shows an `aud` equal to your **API identifier** —
      confirming it is the access token, not the ID token (R6)
- [ ] That same decoded token contains `https://expense-tracker.local/email` (step 5)
- [ ] `/api/me` with a valid token → **200** with `sub`, `email`, `name` populated (R12)
- [ ] R7 verified per step 7 — **and the token lifetime restored to `86400`**
- [ ] After logout, visiting `/dashboard` prompts for login rather than signing you straight
      back in (R9)
- [ ] `git status` shows no `k8s/secrets.yaml` and no `frontend/public/config.js` (N3)

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Token is a short random string, not three dot-separated parts | No `audience` in the token request, or no API registered | Step 1; confirm the frontend sends `audience` |
| .NET logs a signature validation error, token looks fine | Same as above — an opaque token has no signature to validate | Step 1 |
| `Callback URL mismatch` on Auth0's page | URL not in **Allowed Callback URLs** | Step 2a — the error names the exact URL received |
| Login works, refresh fails with a CORS error | Origin missing from **Allowed Web Origins** | Step 2a — the quiet one |
| User bounced to login when the token expires | `Allow Offline Access` off, or `offline_access` not requested | Step 1a |
| `/api/me` returns **200** with `email: null`, `name: null` | Action not deployed, not attached to the flow, or namespace mismatch | Step 5 — check the trigger flow, not just the Library |
| `/api/me` returns 401 with a token that decodes fine | `aud` mismatch, or the **ID token** was sent instead of the access token | Compare the token's `aud` to `AUTH0_AUDIENCE` |
| Expired token still returns **200** | .NET's default `ClockSkew` is **5 minutes** | Expected unless `ClockSkew` is lowered — see ARCH-3, Phase E |
| "Sign in" logs you straight back in with no prompt | Only local tokens were cleared; Auth0's session cookie survived | Logout must hit Auth0's `/v2/logout` (R9) |
| core-api pod in `CrashLoopBackOff` | Missing/malformed `Auth0__Domain` or `Auth0__Audience` | `make logs svc=core-api` — the message names the setting (N1) |
| frontend pod exits at startup | Missing `AUTH0_*` env var | `make logs svc=frontend` — the entrypoint names the variable |
| Three accounts for one person | Expected — `sub` is connection-specific | Deferred to #4 (REQ decision 12) |

---

## What this runbook deliberately does not cover

Out of scope for issue #3, each with a reason:

- **Production / non-localhost environments** — deployment is Task 05 and beyond.
- **Project-owned Google OAuth credentials** — dev keys suffice for localhost; required before
  any real deployment.
- **Account linking across connections** — issue #4, before the first persisted `UserId`.
- **Machine-to-machine (M2M) applications** — issue #5, with the caller that needs them.
- **Roles, scopes, permissions** — nothing to authorize until data exists (REQ decision 10).
- **Universal Login branding, MFA, password reset customization** — Auth0 defaults suffice.
