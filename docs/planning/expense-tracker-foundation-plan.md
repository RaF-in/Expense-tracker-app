# Expense Tracker — Foundation Plan

> **Project:** Expense Tracker
> **Phase:** 03 — Foundation Plan
> **Date:** August 15, 2026
> **Prerequisite:** ADRs from Phase 02
> **Rule:** Every task leaves the repo bootable. No task is complete until `kubectl get pods` shows all pods Running and the verification step passes.

---

## Monorepo Structure

```
expense-tracker/
├── services/
│   ├── core-api/                    # .NET Core (C#)
│   │   ├── src/
│   │   │   ├── Controllers/
│   │   │   ├── Models/
│   │   │   ├── Data/
│   │   │   ├── Middleware/
│   │   │   └── Program.cs
│   │   ├── tests/
│   │   │   └── Integration/
│   │   ├── core-api.csproj
│   │   └── Dockerfile
│   │
│   ├── receipt-service/             # Python
│   │   ├── src/
│   │   │   ├── parser/
│   │   │   ├── queue/
│   │   │   └── main.py
│   │   ├── tests/
│   │   ├── requirements.txt
│   │   └── Dockerfile
│   │
│   └── ingestion-service/           # .NET Core (C#)
│       ├── src/
│       │   └── Program.cs
│       ├── tests/
│       │   └── EmailParserTests.cs
│       ├── ingestion-service.csproj
│       └── Dockerfile
│
├── frontend/                        # React + Vite
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── hooks/
│   │   ├── lib/
│   │   └── main.tsx
│   ├── tests/
│   │   ├── components/
│   │   └── e2e/
│   ├── package.json
│   ├── vite.config.ts
│   ├── playwright.config.ts
│   └── Dockerfile
│
├── k8s/
│   ├── namespace.yaml
│   ├── postgres.yaml                # StatefulSet + PVC + ConfigMap
│   ├── rabbitmq.yaml                # Deployment + Service
│   ├── core-api.yaml                # Deployment + Service
│   ├── receipt-service.yaml         # Deployment + Service
│   ├── ingestion-service.yaml       # Deployment + Service
│   ├── frontend.yaml                # Deployment + Service
│   ├── ingress.yaml                 # Traefik IngressRoute
│   └── secrets.yaml                 # Auth0, DB credentials (templated)
│
├── .github/
│   └── workflows/
│       └── ci.yaml
│
├── Makefile                         # build, deploy, test, logs shortcuts
├── docs/
│   ├── adrs/                        # ADR-001 through ADR-008
│   └── foundation-plan.md           # This document
└── README.md
```

---

## Task Sequence

### Task 00 — Scaffold + All Pods Boot

**Goal:** One command brings up the entire system on Docker Desktop Kubernetes. Every service is a "hello world" that proves its container runs.

**What to build:**

| Component | What it does at this stage |
|-----------|--------------------------|
| `services/core-api/` | Minimal .NET Core Web API. Single endpoint: `GET /` returns `{ "service": "core-api", "status": "running" }`. |
| `services/receipt-service/` | Minimal Python HTTP server (Flask or FastAPI). `GET /` returns `{ "service": "receipt-service", "status": "running" }`. |
| `services/ingestion-service/` | Minimal .NET Core HTTP server (ASP.NET Core Minimal API). `GET /` returns `{ "service": "ingestion-service", "status": "running" }`. |
| `frontend/` | Vite + React. Default Vite welcome page. Builds and serves via nginx in Docker. |
| `k8s/namespace.yaml` | Creates `expense-tracker` namespace. |
| `k8s/postgres.yaml` | Postgres 16 StatefulSet with a PersistentVolumeClaim. No tables yet — just a running instance. |
| `k8s/rabbitmq.yaml` | RabbitMQ Deployment + Service. Default config, management UI accessible. |
| `k8s/*.yaml` (services) | Deployment + ClusterIP Service for each of the 4 app services. |
| `Makefile` | `make build` (builds all Docker images), `make deploy` (kubectl apply), `make status` (kubectl get pods), `make logs svc=core-api`. |

**What it does NOT do:** No routing between services, no database tables, no business logic, no auth.

**Verification — Boot ✓:**
```bash
make build && make deploy
kubectl get pods -n expense-tracker
# Expected: 6 pods, all STATUS: Running
#   core-api-xxxxx          1/1  Running
#   receipt-service-xxxxx   1/1  Running
#   ingestion-service-xxxxx 1/1  Running
#   frontend-xxxxx          1/1  Running
#   postgres-0              1/1  Running
#   rabbitmq-xxxxx          1/1  Running

kubectl port-forward svc/core-api 8080:80 -n expense-tracker
curl http://localhost:8080/
# Returns: { "service": "core-api", "status": "running" }
```

**Commit message:** `task-00: scaffold monorepo, all 6 pods boot on k8s`

---

### Task 01 — End-to-End Route Resolves (Frontend → Core API)

**Goal:** A browser request travels through K8s Ingress to the frontend, the frontend makes an API call through the same Ingress to the Core API, and the result is displayed. This proves the network plumbing works.

**What to build:**

| Component | What changes |
|-----------|-------------|
| Core API | Add `GET /api/health` → `{ "status": "ok", "timestamp": "...", "version": "0.1.0" }`. Configure CORS to allow frontend origin. |
| Frontend | Install React Router. Create app shell layout: NavBar (logo + Dashboard / Expenses / Settings links + user avatar placeholder), main content area, dark theme CSS variables. Add 3 routes: `/dashboard`, `/expenses`, `/settings` — each renders a placeholder page. On `/dashboard` mount, fetch `/api/health` and display connection status. |
| K8s Ingress | Traefik IngressRoute: `/api/*` → core-api Service, `/*` → frontend Service. TLS not required locally. |

**What it does NOT do:** No auth, no database, no real data. NavBar links work (client-side routing), but pages are empty placeholders with "Coming soon" text.

**Verification — Boot ✓:**
```bash
make build && make deploy
# Open browser → http://localhost (or configured Ingress host)
# See: NavBar with dark theme, "Dashboard" page showing "Connected to API ✓"
# Click "Expenses" → navigates client-side, shows placeholder
# Click "Settings" → navigates client-side, shows placeholder
# Open DevTools Network tab → confirm /api/health returned 200
```

**Commit message:** `task-01: end-to-end route, frontend fetches from core-api through ingress`

---

### Task 02 — Auth Integration (Auth0)

**Goal:** Every route is protected. Unauthenticated users are redirected to Auth0 login. Authenticated requests carry a JWT that the Core API validates. From this point forward, no endpoint is born unprotected.

**What to build:**

| Component | What changes |
|-----------|-------------|
| Auth0 tenant | Create application (SPA type) for Expense Tracker. Configure allowed callback URLs, logout URLs, web origins. Enable Google and GitHub social connections. |
| Frontend | Install `@auth0/auth0-react`. Wrap app in `Auth0Provider`. Create `ProtectedRoute` component that redirects to Auth0 login if not authenticated. Wrap all routes (`/dashboard`, `/expenses`, `/settings`) in `ProtectedRoute`. Display user initials in NavBar avatar from Auth0 `user` object. Add `LogoutButton`. Attach `Authorization: Bearer <token>` to all API calls via an Axios/fetch interceptor. |
| Core API | Add JWT Bearer authentication middleware. Validate Auth0 tokens (issuer, audience). `GET /api/health` remains public (for K8s liveness probes). All future `/api/*` endpoints require valid JWT. Add `GET /api/me` (protected) → returns decoded user claims (sub, email, name). |
| K8s Secrets | Store Auth0 domain, client ID, audience as K8s Secret. Mount into Core API and frontend pods as environment variables. |

**What it does NOT do:** No database, no transactions. The only protected endpoint is `/api/me`.

**Dev workflow consideration:** For local development, Auth0 works against `http://localhost`. No mock needed — Auth0 free tier supports localhost callbacks. For CI (Task 05), tests will use Auth0's Resource Owner Password Grant to obtain a token programmatically, or use a test user with Playwright's storage state.

**Verification — Boot ✓:**
```bash
make build && make deploy
# Open browser → http://localhost
# Immediately redirected to Auth0 login page
# Log in with Google or email/password
# Redirected back → see NavBar with user initials (e.g., "JD")
# Dashboard shows "Connected to API ✓" (health check still works)

# Verify protection:
curl http://localhost/api/me
# Returns: 401 Unauthorized

curl http://localhost/api/me -H "Authorization: Bearer <valid_token>"
# Returns: { "sub": "auth0|...", "email": "...", "name": "..." }
```

**Commit message:** `task-02: auth0 integration, all routes protected, jwt validation on api`

---

### Task 03 — Data Model + Database (Core API → Postgres)

**Goal:** The Core API connects to Postgres inside the K8s cluster, runs migrations, seeds data, and serves it through an authenticated endpoint. The frontend displays real data from the database.

**What to build:**

| Component | What changes |
|-----------|-------------|
| Core API — Models | `Transaction` entity: `Id` (Guid), `UserId` (string, from Auth0 sub), `Type` (enum: Expense/Income), `Amount` (decimal), `Currency` (string, default "USD"), `Category` (string), `Description` (string), `Date` (DateOnly), `Source` (enum: Manual/ReceiptScan/EmailImport), `Tags` (string[]), `Metadata` (JSONB), `CreatedAt`, `UpdatedAt`. |
| Core API — Models | `Event` entity: `Id` (Guid), `TransactionId` (Guid, FK), `EventType` (string), `Payload` (JSONB), `CreatedAt`. |
| Core API — Data | EF Core `AppDbContext` with `DbSet<Transaction>` and `DbSet<Event>`. Postgres JSONB column mapping for `Metadata` and `Payload`. |
| Core API — Migrations | Initial migration creating both tables with indexes on `UserId`, `Date`, `Category`. |
| Core API — Seed | On startup (dev environment only), seed 6 transactions for a known test user: Pizza Hut ($24.50, Food), Shell Gas ($45.00, Transport), Salary ($8,450, Income), Netflix ($15.99, Subscriptions), Rent ($1,570, Housing), Amazon ($89.99, Shopping). Create corresponding events ("TransactionCreated" for each). |
| Core API — Endpoints | `GET /api/transactions` — returns paginated transactions for authenticated user. `GET /api/dashboard/summary?month=2026-08` — returns `{ income, expenses, savings, transactionCount }` computed on-the-fly. |
| Frontend | On `/dashboard`: fetch `/api/dashboard/summary` and display the 4 summary cards (Total Income, Total Expenses, Net Savings, Transactions) using real data. On `/expenses`: fetch `/api/transactions` and render a basic table with Description, Category, Date, Amount columns. No styling polish — just functional data display. |
| K8s | Update Postgres manifest with a named database. Core API Deployment gets `DATABASE_URL` from K8s Secret. |

**What it does NOT do:** No create/update/delete endpoints. No charts. No receipt upload. No styled components (raw HTML table is fine). Data flows one direction: DB → API → Frontend.

**Verification — Boot ✓:**
```bash
make build && make deploy
# Open browser → login → Dashboard
# See 4 summary cards with real numbers:
#   Total Income: $8,450 | Total Expenses: $5,245.48 | Net Savings: $3,204.52 | Transactions: 6
# Click "Expenses" → see table with 6 seeded transactions

# Verify data layer directly:
kubectl exec -it postgres-0 -n expense-tracker -- psql -U postgres -d expense_tracker
\dt
# Shows: transactions, events tables
SELECT COUNT(*) FROM transactions;
# Returns: 6
SELECT SUM(amount) FROM transactions WHERE type = 'Expense';
# Returns: 5245.48
```

**Commit message:** `task-03: ef-core models, postgres migration, seeded data, dashboard reads from db`

---

### Task 04 — Inter-Service Messaging (RabbitMQ Wiring)

**Goal:** The Core API can publish a message to RabbitMQ. The Receipt Service can consume it. The Ingestion Service can call the Core API via HTTP. All services report their dependency health. This proves the messaging backbone works before any real features use it.

**What to build:**

| Component | What changes |
|-----------|-------------|
| Core API | RabbitMQ client (e.g., `RabbitMQ.Client` NuGet package). On startup, connect to RabbitMQ and declare queue `receipt-processing`. Add `POST /api/debug/test-publish` (dev-only endpoint) that publishes a test JSON message `{ "test": true, "timestamp": "..." }` to the queue. Update health endpoint: `GET /api/health` returns `{ "status": "ok", "postgres": "ok", "rabbitmq": "ok" }`. |
| Receipt Service | RabbitMQ consumer (e.g., `pika` library). On startup, connect to RabbitMQ and consume from `receipt-processing` queue. On message received, log `"Received message: {body}"` to stdout. Add health endpoint: `GET /health` returns `{ "status": "ok", "rabbitmq": "ok" }`. |
| Ingestion Service | HTTP client that can call Core API's `POST /api/transactions`. For now, a health endpoint only: `GET /health` returns `{ "status": "ok", "core_api_reachable": true/false }` (checks if Core API's health endpoint responds via K8s internal DNS: `http://core-api.expense-tracker.svc.cluster.local/api/health`). |
| K8s | Add liveness and readiness probes to all service Deployments pointing at their health endpoints. This means K8s will auto-restart a pod if it loses its database or RabbitMQ connection. |

**What it does NOT do:** No real receipt processing. No real email ingestion. The test-publish endpoint is behind a dev-only flag and will be removed when real receipt upload is built. No timeout logic yet — that comes with the actual receipt feature.

**Verification — Boot ✓:**
```bash
make build && make deploy

# Verify health checks include dependencies:
curl http://localhost/api/health
# Returns: { "status": "ok", "postgres": "ok", "rabbitmq": "ok" }

# Test publish → consume:
curl -X POST http://localhost/api/debug/test-publish
# Returns: { "published": true, "queue": "receipt-processing" }

kubectl logs -l app=receipt-service -n expense-tracker
# Shows: "Received message: {"test": true, "timestamp": "..."}"

# Verify K8s probes are working:
kubectl describe pod -l app=core-api -n expense-tracker | grep -A3 "Liveness\|Readiness"
# Shows configured probe endpoints
```

**Commit message:** `task-04: rabbitmq wiring, publish from core-api, consume in receipt-service, health probes`

---

### Task 05 — Test Harness with Teeth

**Goal:** A minimal but meaningful test suite that catches the failures you actually care about. Every test uses the real infrastructure (Testcontainers for Postgres and RabbitMQ) — no in-memory fakes. CI pipeline runs all tests on every push.

**What to build:**

#### Test Strategy — Oracle Map

| Layer | Oracle | What it catches | Cost |
|-------|--------|----------------|------|
| Data layer | Testcontainers (Postgres) | Migration errors, JSONB bugs, query logic, constraint violations | Medium — ~5s per test (container startup) |
| Parsing logic | Unit tests (pure functions) | OCR text parsing errors, email parsing errors | Cheap — <1ms per test |
| UI rendering | Vitest + React Testing Library | Component rendering bugs, data mapping errors | Cheap — ~100ms per test |
| User journey | Playwright | Full auth → data → UI flow, integration between all layers | Expensive — ~10s per test |

#### The 7 Tests

**Core API — xUnit + Testcontainers (2 tests)**

File: `services/core-api/tests/Integration/TransactionTests.cs`

```
Test 1: CreateAndReadTransaction
  → Spin up Testcontainers Postgres
  → Run EF Core migrations against it
  → Insert a transaction (type: Expense, amount: 24.50, category: "Food & Dining",
     metadata: { "source_detail": "receipt_scan", "confidence": 0.95 })
  → Read it back via repository
  → Assert all fields match, including JSONB metadata deserialization
  → Assert corresponding Event was created with type "TransactionCreated"
  CATCHES: Migration failures, JSONB serialization bugs, EF Core mapping errors,
           FK constraint between Transaction and Event

Test 2: DashboardAggregation
  → Same Testcontainers Postgres
  → Insert 3 transactions:
     - Expense $100 (Food, Aug 2026)
     - Expense $200 (Transport, Aug 2026)
     - Income $1000 (Salary, Aug 2026)
  → Call dashboard summary logic for Aug 2026
  → Assert: income = 1000, expenses = 300, savings = 700, count = 3
  CATCHES: Aggregation query bugs, GROUP BY errors, type filtering, month boundary handling
```

**Receipt Service — pytest (1 test)**

File: `services/receipt-service/tests/test_parser.py`

```
Test 3: ParseRawOcrText
  → Input: raw OCR text string simulating Tesseract output:
     "WHOLE FOODS MARKET\n123 Main St\nOrganic Bananas  $3.49\nAlmond Milk  $4.99\n
      SUBTOTAL $8.48\nTAX $0.68\nTOTAL $9.16\n08/14/2026"
  → Call parser function (pure function, no I/O)
  → Assert: merchant = "Whole Foods Market", amount = 9.16, date = "2026-08-14",
     items = ["Organic Bananas", "Almond Milk"]
  CATCHES: Regex/parsing errors in the most failure-prone code path.
           This is a pure function — the cheapest possible test for the highest-risk logic.
```

**Ingestion Service — xUnit (1 test)**

File: `services/ingestion-service/tests/EmailParserTests.cs`

```
Test 4: ParseAmazonOrderEmail
  → Input: raw email body string simulating an Amazon order confirmation
     (subject: "Your Amazon.com order #123-456", body contains "$89.99", "Aug 10, 2026")
  → Call email parser function (pure function, no I/O)
  → Assert: merchant = "Amazon", amount = 89.99, date = "2026-08-10",
     category = "Shopping"
  CATCHES: Email parsing errors. Different email formats are the primary failure mode
           of the ingestion service — testing one known format establishes the pattern.
```

**Frontend — Vitest + React Testing Library (1 test)**

File: `frontend/tests/components/TransactionList.test.tsx`

```
Test 5: RenderTransactionList
  → Render <TransactionList> with mock data:
     [{ description: "Pizza Hut", amount: -24.50, category: "Food & Dining", date: "Aug 15" },
      { description: "Salary", amount: 8450, category: "Income", date: "Aug 1" }]
  → Assert: 2 rows rendered
  → Assert: "Pizza Hut" text present, "-$24.50" displayed, "Food & Dining" label shown
  → Assert: "Salary" text present, "+$8,450.00" displayed (positive formatting for income)
  CATCHES: Data mapping errors (wrong field names), formatting bugs (negative amounts,
           currency display), rendering with real component tree.
```

**E2E — Playwright (2 tests)**

File: `frontend/tests/e2e/critical-journeys.spec.ts`

```
Test 6: DashboardShowsData
  → Navigate to /
  → Auth0 login (using saved auth state from a setup step)
  → Wait for dashboard to load
  → Assert: "Total Income" card shows "$8,450"
  → Assert: "Total Expenses" card shows a dollar amount (not $0, not empty)
  → Assert: "Transactions" card shows "6"
  CATCHES: Full round-trip — auth, API call, Postgres query, frontend rendering.
           If this test passes, the entire spine of the application works.

Test 7: AddExpenseAppearsInList
  → Navigate to /expenses
  → Auth0 login (saved state)
  → Record current transaction count
  → Click "Add Transaction" (FAB button)
  → Fill form: amount = 55.00, category = "Transport", description = "Uber ride"
  → Click "Save Expense"
  → Wait for redirect to /expenses
  → Assert: transaction count increased by 1
  → Assert: "Uber ride" appears in the list
  → Assert: "$55.00" appears in the row
  CATCHES: Form submission, API write path, TanStack Query cache invalidation,
           UI update after mutation. The most critical user journey.
```

#### Playwright Auth Strategy

Playwright tests authenticate once in a global setup step using Auth0's test user, save the auth state (cookies + localStorage) to a file, and reuse it across all tests. This avoids logging in for every test (slow) and avoids mocking auth (unfaithful).

```
// playwright global-setup.ts
// 1. Launch browser
// 2. Navigate to app → redirected to Auth0
// 3. Log in as test user (email/password from env vars)
// 4. Save storage state to auth-state.json
// 5. All tests load auth-state.json before running
```

#### CI Pipeline — GitHub Actions

File: `.github/workflows/ci.yaml`

```yaml
# Trigger
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

# Jobs (in order)
jobs:
  test-core-api:
    # Checkout → Setup .NET → Run xUnit tests
    # Testcontainers spins up its own Postgres — no external dependency
    # Duration: ~30s

  test-receipt-service:
    # Checkout → Setup Python → pip install → Run pytest
    # Pure function test — no containers needed
    # Duration: ~5s

  test-ingestion-service:
    # Checkout → Setup .NET → Run xUnit tests
    # Pure function test — no containers needed
    # Duration: ~10s

  test-frontend:
    # Checkout → Setup Node → npm install → Run Vitest
    # JSDOM environment — no browser needed
    # Duration: ~10s

  test-e2e:
    # Needs: [test-core-api, test-receipt-service, test-ingestion-service, test-frontend]
    # Checkout → Build all Docker images → Docker Compose up (test environment)
    # Run Playwright against the running system
    # Auth0 test user credentials from GitHub Secrets
    # Duration: ~60s
    # Artifacts: Playwright HTML report + screenshots on failure

  deploy:
    # Needs: [test-e2e]
    # Only on: push to main (not PRs)
    # Build images → Push to GitHub Container Registry → kubectl apply to k3s
```

**Total CI time estimate:** ~2 minutes for the full pipeline.

#### What Tests Are NOT Included (and Why)

| Omitted test type | Why |
|-------------------|-----|
| Core API unit tests | CRUD logic is trivial; integration tests with Testcontainers catch the same bugs with higher fidelity. Add unit tests only when pure business logic (not I/O) grows complex. |
| Screenshot / visual diff tests | Design is still evolving. Pixel tests would flake on every CSS change. Revisit after design stabilizes. |
| Receipt Service integration test | No real receipt processing feature exists yet. Add when Tesseract + LLM pipeline is built. |
| Ingestion Service integration test | No real email polling exists yet. Add when IMAP integration is built. |
| Load / performance tests | Premature. Add when tripwire from ADR-001 (dashboard query > 200ms) approaches. |
| RabbitMQ messaging tests | The publish/consume path has no business logic yet. Test when receipt processing feature uses it. |

**Verification — Boot ✓:**
```bash
# Run all tests locally:
make test
# Output:
#   core-api:          2 passed (TransactionTests)
#   receipt-service:   1 passed (test_parser)
#   ingestion-service: 1 passed (EmailParserTest)
#   frontend:          1 passed (TransactionList)
#   e2e:               2 passed (Dashboard, AddExpense)
#   Total: 7 passed, 0 failed

# Push to GitHub → Actions tab shows green pipeline
# Deploy step pushes to k3s cluster
```

**Commit message:** `task-05: test harness — 7 tests, testcontainers, playwright e2e, github actions ci`

---

## Summary — Foundation Task Sequence

| Task | What boots after | Proves |
|------|-----------------|--------|
| **00** — Scaffold + pods boot | 6 K8s pods Running | Dockerfiles build, K8s manifests valid, all runtimes start |
| **01** — E2E route resolves | Browser → NavBar → "Connected to API ✓" | Ingress routing, CORS, frontend↔backend network path |
| **02** — Auth integration | Login redirect → JWT → protected `/api/me` | Auth0 flow, JWT validation, every endpoint born protected |
| **03** — Model + database | Dashboard shows seeded data from Postgres | EF Core, migrations, JSONB, aggregation queries, auth+data together |
| **04** — RabbitMQ wiring | Core API publishes → Receipt Service logs | Message queue networking, publish/consume across languages, health probes |
| **05** — Test harness | 7 tests green, CI pipeline green | Testcontainers fidelity, parsing oracles, E2E journey, automated deploy |

After Task 05, the repository is a **zero-feature runnable application** with:
- All 4 services running on Kubernetes
- Authentication protecting every route
- A live database with schema and seed data
- Inter-service messaging working
- 7 tests verifying the critical paths
- A CI/CD pipeline that deploys on green

**No product features exist yet.** The dashboard shows raw numbers, the expenses page shows an unstyled table, there's no add/edit/delete, no receipt scanning, no email ingestion. But the foundation is verified, and every product feature from here on is just filling in screens on a working skeleton.

---

## What Comes Next (Phase 06 — Build)

Product features will be built on this skeleton in priority order:

1. Transaction CRUD (POST/PUT/DELETE endpoints + frontend forms)
2. Dashboard charts (Recharts — donut, bar, line, trend)
3. Receipt scanning (Tesseract + LLM pipeline through RabbitMQ)
4. Email ingestion (IMAP polling + parsing)
5. Settings page (user preferences, email intake address setup)
6. Dark/light theme toggle
7. Export functionality

Each feature gets its own test(s) added to the harness. The skeleton ensures every feature has immediate feedback: boot ✓, tests ✓, deploy ✓.
