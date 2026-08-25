# Expense Tracker — Architecture Decision Records

> **Project:** Expense Tracker
> **Phase:** 02 — Architecture
> **Date:** August 15, 2026
> **Author:** [Your Name]

---

## ADR-001: Data Model & Storage Engine

**Context**
The expense tracker handles transactions from 4+ sources (manual entry, receipt scan, email import, SMS import) with different metadata shapes per source. The dashboard requires monthly aggregations, category breakdowns, and 6-month trend charts. The app also needs an activity log per transaction ("Created via receipt scan", "AI categorized as Food & Dining").

**Options Considered**
1. **PostgreSQL with JSONB metadata column** — Fixed columns for core fields (amount, date, category, type, user_id), JSONB for variable source-specific metadata. Relational integrity, fast aggregation queries, mature tooling.
2. **MongoDB** — Flexible schema per document. But core transaction fields are uniform, and dashboard aggregation queries (`SUM`, `GROUP BY`) fight MongoDB's strengths. Atlas free tier limited to 512MB.
3. **Full event sourcing** — Every action is an immutable event, current state derived by replay. Natural fit for the activity log. But requires a projection layer for read models, and replay latency becomes a concern at scale.
4. **Postgres + JSONB + events table (hybrid)** — Structured columns for fast queries, JSONB for flexible metadata, a separate append-only `events` table for activity log and auditability. Event-inspired without full event sourcing complexity.

**Decision**
PostgreSQL with JSONB metadata column and a separate `events` table for activity logging. Dashboard aggregations computed on-the-fly via SQL queries (no pre-computed materialized views).

**Trade-offs**
- *Gained:* Fast aggregation via indexed relational columns, schema flexibility via JSONB, activity log via events table, free hosting on Supabase/Neon.
- *Given up:* Full event sourcing learning experience, CQRS read model patterns, replay-based state recovery.
- *Accepted risk:* On-the-fly aggregation may slow down as transaction volume grows.

**Tripwire — Reopen This Decision If:**
- Any dashboard query exceeds **200ms at p95**.
- A single user's transaction count exceeds **10,000 rows**.
- The activity log (events table) needs to be the **source of truth** for transaction state rather than just an audit trail.

If any tripwire fires, introduce materialized read models (CQRS pattern) for the dashboard.

---

## ADR-002: Authentication & Authorization Architecture

**Context**
The expense tracker requires email/password authentication, Google and GitHub OAuth, and session management. A future app ("PayGuard") will share the same user base, requiring Single Sign-On (SSO) across multiple applications. The auth system must function as a centralized Identity Provider (IdP) that multiple client applications can trust.

**Options Considered**
1. **Auth0 free tier** — Managed OIDC provider, supports multiple applications, SSO between them, social login (Google/GitHub), 7,500 MAU free. Zero maintenance. Vendor lock-in risk.
2. **Keycloak (self-hosted)** — Open-source, full OIDC provider, multi-app SSO. Requires 512MB+ RAM, incompatible with free tier. Needs ~$5-7/month VPS minimum.
3. **Ory Stack (Kratos + Hydra)** — Modern, lightweight, open-source identity management. Same hosting constraints as Keycloak.
4. **Custom OIDC-lite service** — Maximum learning value, but weeks of development and likely security vulnerabilities.

**Decision**
Auth0 free tier as the centralized Identity Provider. Expense Tracker registered as one application, future apps (PayGuard, others) as separate clients on the same Auth0 tenant. JWT-based authentication with short-lived access tokens and refresh tokens managed by Auth0.

**Trade-offs**
- *Gained:* Multi-app SSO out of the box, social login (Google/GitHub), secure token management, zero auth code to maintain, focus learning time on distributed systems instead of auth.
- *Given up:* Deep understanding of OIDC internals, control over auth infrastructure, ability to customize auth flows beyond Auth0's configuration.
- *Accepted risk:* Vendor lock-in to Auth0. Migration to self-hosted would require updating all client apps.

**Tripwire — Reopen This Decision If:**
- Monthly active users exceed **7,500** (Auth0 free tier limit).
- A second app (PayGuard) enters **active development** and Auth0's multi-app configuration proves limiting.
- Auth0 changes pricing or free tier terms unfavorably.

If any tripwire fires, migrate to self-hosted Keycloak on the existing Hetzner VPS.

---

## ADR-003: Backend Architecture & API Design

**Context**
The app has distinct backend responsibilities: transaction CRUD, dashboard aggregation, receipt AI processing, and email ingestion. These have different scaling characteristics, deployment cadences, and runtime requirements. The project uses this as a learning vehicle for distributed systems and polyglot microservices.

**Options Considered**
1. **Monolith** — All logic in one deployable. Simple, but no distributed systems learning, and AI processing would block HTTP request threads.
2. **Modular monolith** — One deployable with internal module boundaries. Clean architecture but still a single process — doesn't teach inter-service communication.
3. **Microservices (3 services)** — Separate services along natural domain boundaries with different language runtimes. Real distributed systems patterns, but operational overhead of 3 deployments.
4. **Microservices (5+ services)** — Over-decomposed. Dashboard as a separate read service, email and SMS as separate services, etc. Engineering for problems that don't exist.

**Decision**
Three microservices with a polyglot stack:

| Service | Language | Responsibility |
|---------|----------|---------------|
| **Core API** | .NET Core (C#) | Transaction CRUD, dashboard aggregation queries, user preferences. Owns the Postgres database. |
| **Receipt Processing Service** | Python | Receives receipt images, runs OCR/AI extraction, returns structured data (merchant, amount, date, category, confidence). |
| **Ingestion Service** | Java | Monitors email inbox for forwarded transaction emails, parses content, creates transactions via Core API. |

Frontend-to-Core API communication via **REST**. API surface maps directly to UI screens:

```
GET    /api/dashboard/summary?month=2026-08
GET    /api/dashboard/category-breakdown?month=2026-08
GET    /api/dashboard/monthly-trend?months=6
GET    /api/transactions?page=1&category=food&search=pizza
POST   /api/transactions
PUT    /api/transactions/{id}
DELETE /api/transactions/{id}
POST   /api/receipts/upload
GET    /api/receipts/{id}/status
```

Frontend: **React** (Vite SPA).

**Trade-offs**
- *Gained:* Real distributed systems learning, polyglot experience (.NET, Python, Java), independent deployment of services, AI processing isolated from request threads.
- *Given up:* Simplicity of a monolith, single-language debugging, shared code via imports (must use HTTP/messaging instead).
- *Accepted risk:* Three different runtimes means three dependency management systems (NuGet, pip, Maven/Gradle), three Dockerfiles, and context-switching cost when debugging across services.

**Tripwire — Reopen This Decision If:**
- Operational overhead of 3 services exceeds development velocity (spending more time on infra than features).
- Any service boundary proves artificial (two services always change together for every feature).
- If the team grows, re-evaluate whether the polyglot approach helps or hinders onboarding.

---

## ADR-004: Real-time Updates & Inter-Service Communication

**Context**
The dashboard must reflect changes "immediately" when a user adds/removes/updates an expense. Additionally, the Ingestion Service can create transactions from email while the user is viewing the dashboard — requiring server-to-client push. The three backend services also need to communicate with each other, particularly for asynchronous receipt processing.

**Options Considered — Frontend Push**
1. **Optimistic UI + refetch on navigation** — Simple, but won't show email-imported transactions until page refresh.
2. **WebSocket** — Bidirectional, persistent connection. More than needed — the frontend only needs to receive, not send over the socket.
3. **Server-Sent Events (SSE)** — Unidirectional server-to-client push over HTTP. Lighter than WebSocket, perfect for "new transaction arrived" notifications.
4. **Polling** — Frontend polls every N seconds. Wasteful and introduces unnecessary latency.

**Options Considered — Inter-Service Communication**
1. **Synchronous HTTP** — One service calls another's REST endpoint and waits. Simple, but receipt AI processing takes 3-5 seconds, blocking Core API threads.
2. **RabbitMQ (async message queue)** — Durable queues with acknowledgment, dead-letter queues for failures, decoupled services. Industry-standard for task queues.
3. **Redis Pub/Sub** — Simpler but fire-and-forget; messages lost if consumer is down.
4. **Apache Kafka** — High-throughput event streaming. Overkill for 10-50 receipt scans per day.

**Decision**
- **SSE** for frontend push (dashboard receives live updates when email-imported or receipt-scanned transactions are created).
- **RabbitMQ** (CloudAMQP free tier — 1M messages/month) for async communication between Core API and Receipt Processing Service.
- **Synchronous HTTP** for Ingestion Service → Core API (simple REST calls to create transactions; no long-running processing involved).
- **60-second configurable timeout** on receipt processing. If no result from Receipt Service within 60 seconds, Core API pushes an error to the frontend via SSE.

Communication flow:
```
[Receipt Upload]
Frontend → Core API (REST) → RabbitMQ → Receipt Service (Python)
Receipt Service → RabbitMQ → Core API → SSE → Frontend

[Email Ingestion]
Ingestion Service (polls inbox) → Core API (REST) → SSE → Frontend

[Manual CRUD]
Frontend → Core API (REST) → SSE → Frontend (optimistic + confirmation)
```

**Trade-offs**
- *Gained:* Live dashboard updates from all sources, non-blocking receipt processing, resilient message delivery (RabbitMQ persists messages if consumer is down), retry capability via dead-letter queues.
- *Given up:* Simplicity of synchronous-only communication, single-request-response mental model.
- *Accepted risk:* RabbitMQ is an additional infrastructure dependency. If CloudAMQP goes down, receipt processing stops (manual CRUD and dashboard still work).

**Tripwire — Reopen This Decision If:**
- Message volume exceeds **500K messages/month** (CloudAMQP free tier pressure).
- Need for **guaranteed message ordering** arises (RabbitMQ ordering is per-queue; cross-queue ordering requires Kafka).
- SSE connection management becomes complex (many concurrent users holding open connections).

---

## ADR-005: Receipt Processing Pipeline

**Context**
Users can upload receipt images (PNG, JPG, PDF up to 10MB). The system must extract merchant name, amount, date, suggested category, and line items with confidence scores. The extracted data is presented for user review and confirmation before becoming a transaction.

**Options Considered — OCR/AI Engine**
1. **Claude Vision API** — Excellent document understanding, high accuracy on receipts. Costs per API call.
2. **Google Cloud Vision + Document AI** — Enterprise-grade OCR. Free tier limited, then pay-per-use.
3. **Tesseract OCR + LLM for structuring** — Open-source, free, self-hosted. Lower accuracy but zero API cost. Can be upgraded later.

**Options Considered — Image Storage**
1. **Cloudflare R2 / Supabase Storage** — Store original receipt images, reference URL in Postgres. Enables re-processing, visual verification, tax compliance.
2. **No image storage** — Discard images after extraction. Simpler, no storage cost, no binary asset management.

**Decision**
- **Tesseract OCR + LLM** (Python service) for receipt extraction. Tesseract handles raw OCR, an LLM structures the raw text into merchant/amount/date/category/items with confidence scores.
- **No receipt image storage.** Images are discarded after extraction. The extracted structured data (with confidence scores) is stored in the Postgres transaction row.

Processing flow:
```
Image uploaded → Receipt Service receives via RabbitMQ
  → Tesseract extracts raw text
  → LLM structures into {merchant, amount, date, category, items, confidence}
  → Result published to RabbitMQ → Core API stores extracted data
  → SSE pushes result to frontend → User reviews and confirms
  → Image discarded
```

**Trade-offs**
- *Gained:* Zero storage cost for images, no binary asset management, simpler architecture, no privacy concerns around storing financial documents.
- *Given up:* Ability to re-process receipts when upgrading to a better AI engine, visual verification of OCR errors by users, tax-proof receipt storage, the "Attached Receipt" UI feature (screen 2c — will be removed).
- *Accepted risk:* Tesseract accuracy is lower than commercial APIs. Users cannot verify extraction errors against the original image.

**Tripwire — Reopen This Decision If:**
- Tesseract OCR accuracy falls below **85%** on real-world receipts (measured by user correction rate on the review screen).
- Users request a **"show original receipt"** feature.
- Need to **re-process old receipts** after upgrading the AI engine.
- Tax compliance requirements demand **original receipt retention**.

If the accuracy tripwire fires, upgrade to Claude Vision API or Google Document AI. If the storage tripwire fires, add Cloudflare R2 (10GB free) for image storage.

---

## ADR-006: Email Ingestion Pipeline

**Context**
Users should be able to have transaction emails (bank alerts, Amazon orders, payment confirmations) automatically converted into expenses. The system needs access to these emails without reading the user's entire inbox.

**Options Considered**
1. **Manual email forwarding** — User manually forwards each transaction email. Functional but tedious; low adoption.
2. **Auto-forwarding rule (set once)** — User creates a Gmail/Outlook filter rule to auto-forward emails from specific senders (amazon.com, bank alerts) to a dedicated app inbox. Set once, fully automated, privacy-safe.
3. **OAuth email access** — App reads user's inbox directly via Gmail/Outlook API. Seamless UX but massive privacy responsibility, requires Google's OAuth verification process for sensitive scopes, stores refresh tokens.

**Decision**
Auto-forwarding rule approach. Each user receives a unique intake email address (e.g., `jd-a1b2@intake.yourapp.com`). Users set up forwarding rules in their email provider to forward transaction emails to their unique address.

Processing flow:
```
User's Gmail → auto-forward rule → jd-a1b2@intake.yourapp.com
  → Java Ingestion Service polls inbox via IMAP (every 60 seconds)
  → Identifies user by unique intake address
  → Parses email body (regex for known formats + LLM fallback for unknown)
  → POST /api/transactions on Core API
  → SSE push → user's dashboard updates live
```

SMS ingestion is **deferred** — email is sufficient for the initial release.

**Trade-offs**
- *Gained:* Zero access to user's inbox (privacy-safe), no OAuth token storage, no Google verification process, simple IMAP-based implementation, user controls exactly which emails are forwarded.
- *Given up:* Seamless zero-setup UX (user must manually create forwarding rules), ability to retroactively scan past emails, automatic discovery of transaction emails.
- *Accepted risk:* Users may not set up forwarding correctly. Different email providers have different forwarding UIs — documentation needed for each. User might forget to add new senders to their filter.

**Tripwire — Reopen This Decision If:**
- User adoption of email ingestion is below **20%** due to setup friction.
- Users consistently request **zero-setup "Connect Gmail"** integration.
- A second ingestion source (SMS) is prioritized, making an OAuth-based unified ingestion platform more attractive.

---

## ADR-007: Frontend Architecture

**Context**
The frontend is a single-page application that communicates with the .NET Core API via REST. It must render a dashboard with 4 summary cards and 4 charts, a transaction list with search/filter/pagination, transaction creation/editing forms with receipt upload, and a receipt scan review screen. The app supports dark mode. The developer is learning React through this project.

**Options Considered — Framework**
1. **Vite + React (SPA)** — Client-side only, fast dev server, deploy as static files. No server-side rendering.
2. **Next.js** — SSR/SSG, API routes, server components. Adds complexity for features not needed (SEO irrelevant for a logged-in app).
3. **Remix** — Server-first React. Same unnecessary SSR overhead.

**Options Considered — State Management**
1. **Redux Toolkit** — Global store with actions/reducers. Overkill for this app's state complexity.
2. **Zustand** — Lighter global store. Still unnecessary given the state patterns.
3. **TanStack Query + useState/useContext** — TanStack Query for server state (API data), React built-ins for UI state (filters, modals, form inputs).

**Options Considered — UI Styling**
1. **shadcn/ui + Tailwind CSS** — Accessible, customizable components on Tailwind. Can match the dark theme mockups exactly.
2. **Material UI** — Opinionated design language that would clash with the app's custom dark theme.
3. **Pure Tailwind** — Full control but requires building every interactive component from scratch.

**Decision**

| Layer | Choice |
|-------|--------|
| Build tool | Vite |
| Framework | React (SPA) |
| Routing | React Router |
| Server state | TanStack Query |
| UI state | useState + useContext |
| Styling | Tailwind CSS |
| Components | shadcn/ui |
| Charts | Recharts |
| Auth | @auth0/auth0-react SDK |
| Deployment | Vercel free tier (static files) |

**Trade-offs**
- *Gained:* Simple mental model (client-only SPA), fast development with shadcn/ui pre-built components, TanStack Query handles caching/refetching/optimistic updates automatically, Vercel free tier for hosting, design system matches mockups.
- *Given up:* SSR/SSG capabilities (not needed), global state management patterns (not needed), full custom component control (shadcn covers 90% of needs).
- *Accepted risk:* SPA means no SEO (acceptable for a logged-in app). Initial bundle size may grow — code splitting with React.lazy can address this later.

**Tripwire — Reopen This Decision If:**
- A **public-facing marketing/landing page** is needed (add a static site or Next.js for that page only).
- Bundle size exceeds **500KB gzipped** (introduce code splitting).
- State management becomes complex enough that useState/useContext feels unwieldy across 10+ components sharing state (evaluate Zustand).

---

## ADR-008: Deployment & DevOps Strategy

**Context**
The system consists of 4 deployable units (React SPA, .NET Core API, Python Receipt Service, Java Ingestion Service) plus 3 external managed services (Auth0, Supabase Postgres, CloudAMQP RabbitMQ). The developer wants to learn Kubernetes. Budget allows ~€5-10/month for infrastructure.

**Options Considered**
1. **Free tier platforms (Railway, Render, Vercel)** — Zero cost, but no Kubernetes learning, cold-start issues, platform-specific constraints.
2. **Docker Compose on a VPS** — Simpler orchestration, cheaper, but no K8s learning.
3. **k3s on a single Hetzner VPS** — Lightweight Kubernetes, real K8s manifests, Traefik ingress, ~€5/month. Full K8s learning on a budget.
4. **Managed Kubernetes (GKE/EKS/AKS)** — Production-grade but $70-150/month minimum for control plane alone.

**Decision**

| Component | Deployment Target |
|-----------|------------------|
| React SPA | Vercel free tier (static files, global CDN) |
| .NET Core API | k3s on Hetzner CX22 (~€4.50/month) |
| Python Receipt Service | k3s on same Hetzner node |
| Java Ingestion Service | k3s on same Hetzner node |
| Postgres | Supabase free tier (managed) |
| RabbitMQ | CloudAMQP free tier (managed) |
| Auth | Auth0 free tier (managed) |
| Container Registry | GitHub Container Registry (free for public repos) |
| CI/CD | GitHub Actions (free for public repos) |
| Ingress / TLS | Traefik (bundled with k3s) + Let's Encrypt |

CI/CD pipeline:
```
git push → GitHub Actions triggered
  → Build Docker image for changed service
  → Push to GitHub Container Registry
  → kubectl apply -f manifests/ to k3s cluster
  → Traefik routes traffic, Let's Encrypt handles TLS
```

**Trade-offs**
- *Gained:* Real Kubernetes experience (manifests, Deployments, Services, ConfigMaps, Secrets, Ingress, health checks, rolling updates), Docker containerization skills, full control over infrastructure, CI/CD with GitHub Actions.
- *Given up:* Simplicity of platform-as-a-service deployment (Railway/Render), zero-ops experience, automatic scaling.
- *Accepted risk:* Single-node k3s has no high availability — if the Hetzner node goes down, all backend services are offline. VPS maintenance (OS updates, disk space monitoring) is the developer's responsibility.

**Tripwire — Reopen This Decision If:**
- Single-node k3s **cannot handle the load** (CPU/RAM exhaustion).
- **Uptime requirements** exceed what a single node can provide (need HA).
- Monthly cost exceeds **€15/month** (re-evaluate managed vs self-hosted).
- Operational overhead of managing the VPS **exceeds 2 hours/month**.

If load tripwire fires, add a second Hetzner node and join it to the k3s cluster. If HA is needed, move to a 3-node cluster with etcd.

---

## Summary — All Decisions at a Glance

| ADR | Decision | Key Tripwire |
|-----|----------|-------------|
| 001 — Storage | Postgres + JSONB + events table, on-the-fly aggregation | Dashboard query > 200ms p95 |
| 002 — Auth | Auth0 free tier (centralized IdP for multi-app SSO) | MAU > 7,500 or second app in active dev |
| 003 — Backend | 3 microservices (.NET Core + Python + Java), REST API | Operational overhead exceeds dev velocity |
| 004 — Real-time | SSE for frontend push, RabbitMQ for inter-service async | Message volume > 500K/month |
| 005 — Receipt | Tesseract + LLM, no image storage | OCR accuracy < 85% |
| 006 — Email | Auto-forwarding rules, IMAP polling every 60s | Adoption < 20% due to setup friction |
| 007 — Frontend | Vite + React + TanStack Query + shadcn/ui + Tailwind | Bundle > 500KB gzipped |
| 008 — Deployment | k3s on Hetzner VPS, Vercel for SPA, GitHub Actions CI/CD | Single node can't handle load |
