# Architecture: Scaffold Monorepo — All 6 Pods Boot on Local Kubernetes

> **Date:** August 28, 2026
> **Issue:** #1
> **Phase:** 2 of 5 (System Architecture)
> **Requirements source:** `specs/requirements/REQ-1-scaffold-monorepo.md`
> **Tasks:** `specs/tasks/TASKS-1-scaffold-monorepo.md`
> **Type:** infrastructure

## Architecture Summary

The repo goes from zero code to a bootable skeleton of the ADR-003 architecture: four hello-world application services (two .NET Minimal APIs, one FastAPI service, one Vite+React SPA served by nginx) plus Postgres 16 and RabbitMQ, all as plain Kubernetes manifests applied into a single `expense-tracker` namespace on Docker Desktop. A Makefile is the only operator entry point — `build` produces four locally-tagged images, `deploy` applies manifests behind two fail-fast guards, `status`/`logs` are the debugging surface, `teardown` deletes the namespace for a complete reset. Application images are never pushed to or pulled from a registry: they carry a `:local` tag with an explicit `imagePullPolicy: IfNotPresent`, which makes Kubernetes' own defaults enforce the local-only guarantee. Nothing talks to anything — no service connects to Postgres or RabbitMQ, no probes, no ingress — because the deliverable is proof that containers build, start, and answer, verified by port-forward.

## High-Level Structure

Greenfield — every artifact is new. The structure follows the foundation plan's monorepo layout normatively (Tasks 01–05 expect it).

```
expense-tracker/
├── services/
│   ├── core-api/            # .NET Minimal API — GET / status JSON
│   ├── receipt-service/     # FastAPI — GET / status JSON
│   └── ingestion-service/   # .NET Minimal API — GET / status JSON
├── frontend/                # Vite + React (TS) — minimal page, nginx-served
├── k8s/                     # one manifest per workload + namespace + secrets
├── Makefile                 # build / deploy / status / logs svc= / teardown
└── README.md                # prerequisites + clone-to-running
```

Runtime topology — namespace `expense-tracker` on Docker Desktop Kubernetes:

```
┌────────────────────────────────────────────────────────────┐
│  core-api          Deployment, svc :80 → 8080               │
│  receipt-service   Deployment, svc :80 → 8000               │
│  ingestion-service Deployment, svc :80 → 8080               │
│  frontend (nginx)  Deployment, svc :80 → 80                  │
│                                                              │
│  postgres-0        StatefulSet, svc :5432, PVC 1Gi           │
│  rabbitmq          Deployment, svc :5672 + :15672 (mgmt)     │
│                                                              │
│  Secret: expense-tracker-secrets                            │
│    → envFrom into postgres + rabbitmq ONLY; no app reads it  │
└────────────────────────────────────────────────────────────┘
        ▲ port-forward (developer-chosen local port) — the only "client"
```

**Boot flow:** `make build` (4 multi-stage Docker builds → local image store) → `make deploy` (guard images → guard secrets → apply `namespace.yaml` + `secrets.yaml` → apply `k8s/` directory → six workloads converge).

**Verify flow:** `kubectl port-forward svc/<name> <local-port>:80 -n expense-tracker` → `GET /` → per-service status JSON (or rendered page for the frontend).

**No inter-service data flow exists — that absence is a requirement, not a gap.** Port-forward is the only supported ingress (D2: Docker Desktop Kubernetes ships no ingress controller).

## Tech Choices

| Area | Decision | Alternatives Considered | Rationale |
|------|----------|-------------------------|-----------|
| receipt-service framework | FastAPI + uvicorn | Flask; stdlib `http.server` | Same hello-world cost; Tasks 03+ grow into async OCR/AI + queue consumption without a framework swap |
| .NET service shape | ASP.NET Core Minimal API (`Program.cs`) | MVC controllers scaffold | R1/R3 say "minimal"; controllers arrive with real features |
| Frontend language | TypeScript | JavaScript | Foundation plan's toolchain (`main.tsx`); ADR-007 stack |
| Runtime versions | Pinned by major tag, current LTS at implementation: .NET 10, Python 3.12, Node 22, nginx stable-alpine, `postgres:16`, `rabbitmq:3.13-management` | .NET 8 (window closes Nov 2026 — don't scaffold onto it); Python 3.13; Node 24 | LTS lifecycle outlives the foundation phase; exact tags sanity-checked at implementation, the *rule* is the decision |
| App image tags | `expense-tracker/<svc>:local`, explicit `imagePullPolicy: IfNotPresent`, never pushed | `:latest` (K8s defaults to `Always` pull — the silent `ErrImagePull` trap); digest pinning (meaningless without a registry) | Non-`latest` tags default to `IfNotPresent` — Kubernetes' own defaults enforce "use the local image, never fetch" (N1) |
| Ports | Runtime-native inside containers (8080 .NET / 8000 uvicorn / 80 nginx), uniform Service `port: 80 → targetPort: <native>` | Force everything to 80 via env vars | Idiomatic containers; uniform verification commands across services |
| RabbitMQ management UI | `rabbitmq:3.13-management` image variant | Stock image + plugin enabled via config | Plugin baked in — one less moving part; creds via Secret env |
| Postgres storage | `volumeClaimTemplates`, 1Gi, cluster-default StorageClass (none specified) | Standalone PVC object; explicit `hostpath` StorageClass | Canonical StatefulSet pairing; re-apply finds and reuses the PVC (D8 stance: reuse, no durability claim); no Docker-Desktop-specific name baked in |
| Frontend serving | Multi-stage Dockerfile: node build → nginx serves static assets; SPA fallback (`try_files … /index.html`) via committed `frontend/nginx.conf` | Vite dev server in container ("appears to work locally and is wrong" — R6); defer SPA fallback to Task 01 | R6 mandates built assets; React Router arrives in Task 01 — two lines now vs a 404-on-refresh debugging session later |
| Resources | Requests only (`~100m/128Mi` app pods, `~250m/256Mi` postgres/rabbitmq), no limits | Requests + limits | Six pods must coexist on any standard Docker Desktop allocation; limits would manufacture OOM kills a hello-world can't justify |
| Operator entry point | Makefile with five targets; guards as pre-conditions | Shell scripts; Taskfile; skaffold | REQ-mandated surface; zero new toolchain deps |

## Patterns & Conventions

- **Local-only images** — `:local` tags + `IfNotPresent` everywhere for app images; the mechanism (Docker Desktop shares its image store with its Kubernetes; `expense-tracker/<svc>:local` normalizes to `docker.io/expense-tracker/…` and resolves locally) is documented in the README so nobody "fixes" the unqualified name by adding a registry prefix.
- **One-file-per-workload manifests** — plain YAML in `k8s/`, no kustomize/overlays/helm; D1: a configuration layer would defeat "nothing to configure".
- **Namespace-in-metadata** — every manifest carries `namespace: expense-tracker`; nothing depends on `kubectl -n` flags.
- **Labels** — `app.kubernetes.io/part-of: expense-tracker`, `app.kubernetes.io/name: <service>`, `app.kubernetes.io/component: <backend|frontend|database|broker>`; selectors match on `name` only.
- **Credentials only in `secrets.yaml`** — manifests carry Secret references, never literals; reviewable invariant (N4).
- **Sealed build units** — each service directory is its own Docker build context; nothing outside a service's directory enters its image.
- **Deliberately not applied** — no liveness/readiness probes (D3: no health beyond process start), no ConfigMaps (nothing to configure — flagged deviation from the foundation plan's `postgres.yaml` annotation, which mentions a ConfigMap), no ingress/CI/tests/NetworkPolicy/HPA/PDB (all REQ out-of-scope).

## Data Models

No business entities exist in this task. The only structured data is the Secret.

### Secret: `expense-tracker-secrets`

**Purpose:** Postgres and RabbitMQ credentials for the local environment; the pattern Auth0's credentials arrive in later (D10).

**Key fields:**

| Field | Type / Constraint | Notes |
|-------|-------------------|-------|
| `POSTGRES_USER` | string, required | Consumed by postgres StatefulSet via `envFrom.secretRef` |
| `POSTGRES_PASSWORD` | string, required | Same |
| `POSTGRES_DB` | string, required | Template ships real value `expense_tracker` — a name, not a credential |
| `RABBITMQ_DEFAULT_USER` | string, required | Consumed by rabbitmq Deployment via `envFrom.secretRef` |
| `RABBITMQ_DEFAULT_PASS` | string, required | Same; R9's management-UI login uses these values |

**Lifecycle:** `k8s/secrets.yaml.template` (committed, placeholder values that parse but are unusable — N4) → developer copies to `k8s/secrets.yaml` (gitignored — R12) and edits → applied by `make deploy` before workloads. Auth0 keys join the same file in a later task.

## API Contracts / Interfaces

### Application services (core-api, receipt-service, ingestion-service)

**Boundary:** HTTP (ClusterIP Service, reachable only via port-forward)

**Operations:**

| Method/Op | Path | Purpose | Errors / Returns |
|-----------|------|---------|------------------|
| GET | `/` | Identify self, prove process answers | `200`, `application/json`, body `{"service":"<directory-name>","status":"running"}`; any other path → framework-default `404` |

Contract notes: keys are exactly `service` and `status`; the `service` value is the directory name verbatim; serialized whitespace/key-order is not asserted (semantic JSON equality). No service reads any env var beyond its listen port — no connection strings, queue names, or peer URLs exist anywhere in these images.

### frontend

**Boundary:** HTTP (ClusterIP Service, reachable via port-forward in a browser)

**Operations:**

| Method/Op | Path | Purpose | Errors / Returns |
|-----------|------|---------|------------------|
| GET | `/` (and any path) | Render minimal page naming "Expense Tracker" with a visible running indication — not Vite's starter content | `200`, `text/html` from built static assets; SPA fallback serves `index.html` on unknown paths |

### Makefile (the system's operator API)

**Boundary:** CLI — the only supported write-path entry point; targets are sequential, stop on first failure, propagate non-zero exits.

**Operations:**

| Method/Op | Signature | Purpose | Errors / Returns |
|-----------|-----------|---------|------------------|
| build | `make build` | Build 4 images as `expense-tracker/{core-api,receipt-service,ingestion-service,frontend}:local`, each from its own directory as context | Names the failing service on build failure; exits non-zero |
| deploy | `make deploy` | Guard A (all 4 images in local Docker store) → Guard B (`k8s/secrets.yaml` exists) → apply `namespace.yaml` + `secrets.yaml` → apply `k8s/` | Guards run **before any kubectl call** — nothing is created on guard failure (R18/R19); guard messages are actionable text (name the missing thing and the fix: `make build` / copy the template, see README); kubectl failures propagate; idempotent (R20) |
| status | `make status` | `kubectl get all,pvc -n expense-tracker` — pods and states incl. non-Running | Degrades to kubectl's own error pre-deploy; it's a read |
| logs | `make logs svc=<name>` | Resolve `<name>` to workload (`deployment/<name>`; postgres → `sts/postgres`) and stream logs | Missing/unknown `svc` → non-zero exit listing the six valid names |
| teardown | `make teardown` | `kubectl delete ns expense-tracker --ignore-not-found` — PVC dies with the namespace | Idempotent; tearing down a clean cluster succeeds silently |

**Auth requirements:** none — local-only, single developer; port-forward is developer-initiated localhost access.

## Module Boundaries

| Module / Package | Responsibility | Allowed Dependencies |
|------------------|-----------------|-----------------------|
| `services/core-api/` | .NET Minimal API answering `GET /` | Own directory only |
| `services/receipt-service/` | FastAPI app answering `GET /` | Own directory only (fastapi, uvicorn) |
| `services/ingestion-service/` | .NET Minimal API answering `GET /` | Own directory only |
| `frontend/` | Vite+React build → static assets | Own directory only; nginx.conf lives here |
| `k8s/` | Declarative local-environment topology | No dependencies; references images by local tag and the Secret by name |
| `Makefile` | Operator surface; guards; apply sequencing | Docker CLI, kubectl, file tests |

Boundary rules: no service references another service or the infra (no env vars, config keys, or DNS names pointing at `postgres`/`rabbitmq` in any app Deployment — those arrive with the task that earns them); the Makefile is the only write path (README shows `kubectl get`/`port-forward` for verification only); credentials exist only in `secrets.yaml`.

## Change Footprint

_The concrete answer to "where does this land in the codebase?" — produced during the Phase D2 walk._

### New files / modules

| Path | Purpose | Pattern reference |
|------|---------|-------------------|
| `services/core-api/src/Program.cs` | Minimal API, `GET /` status JSON | Grows in Task 01 (+`/api/health`, CORS), schema task (+DB wiring) |
| `services/core-api/core-api.csproj` | Project metadata only | First dependency arrives with DB work |
| `services/core-api/Dockerfile` | Multi-stage sdk → aspnet runtime | Only touched on runtime-version bumps |
| `services/ingestion-service/src/Program.cs` | Same shape as core-api | Email-parsing task grows it |
| `services/ingestion-service/ingestion-service.csproj` | Project metadata only | — |
| `services/ingestion-service/Dockerfile` | Multi-stage sdk → aspnet runtime | Rare changes |
| `services/receipt-service/src/main.py` | FastAPI app, `GET /` | Receipt pipeline task (+queue consumer, OCR) |
| `services/receipt-service/requirements.txt` | fastapi + uvicorn only | OCR/AI libs later |
| `services/receipt-service/Dockerfile` | Multi-stage python → slim | Rare changes |
| `frontend/package.json`, `vite.config.ts`, `index.html`, `src/main.tsx` | Minimal app naming itself + running status | Task 01 (+React Router, Tailwind, shadcn — ADR-007) |
| `frontend/Dockerfile` | node build stage → nginx serve stage | No path to a dev server exists (R6) |
| `frontend/nginx.conf` | Server block with SPA fallback | Task 01's router depends on it |
| `k8s/namespace.yaml` | `expense-tracker` namespace | — |
| `k8s/secrets.yaml.template` | Committed placeholder Secret (5 keys, `stringData`) | Absorbs Auth0 keys later (D10) |
| `k8s/postgres.yaml` | StatefulSet (PVC via `volumeClaimTemplates`, 1Gi) + Service `:5432`, creds via `envFrom.secretRef` | Schema task consumes it |
| `k8s/rabbitmq.yaml` | Deployment (`3.13-management`) + Service with named ports `amqp:5672`, `management:15672`, creds via `envFrom.secretRef` | Receipt pipeline task consumes it |
| `k8s/core-api.yaml`, `receipt-service.yaml`, `ingestion-service.yaml`, `frontend.yaml` | Deployment + ClusterIP Service each, per manifest conventions | Each grows independently |
| `Makefile` | Five targets per the contracts above | New targets add without redefining deploy semantics |
| `.gitignore` | **Created** (none exists): `k8s/secrets.yaml` + standard build artifacts | Grows with toolchains |

### Modified files / modules

| Path | What changes here |
|------|-------------------|
| `README.md` | Rewritten from a single line: prerequisites (Docker Desktop w/ K8s enabled + selected context, kubectl, make — **no language SDKs**, builds happen in Docker), first-run secrets step, build/deploy/verify sequence |

### Deleted / replaced

None — greenfield.

### Touched but not changed (silent-regression hotspots)

None — no existing code. Forward-looking analog captured under Areas of Impact (what Tasks 01–05 inherit from these files).

## Areas of Impact

_Broader-than-files impact — modules, services, teams, contracts, cross-cutting effects._

| Area | Impact | Risk (L/M/H) | Why |
|------|--------|--------------|-----|
| Local Docker Desktop cluster | Entire system lands in one namespace; teardown fully recovers | M | Wrong kubectl context is the residual risk (D14, accepted, README prerequisite) |
| Task 01 (route resolves) | Consumes frontend + core-api scaffolds; Minimal API + nginx fallback mean it extends, not rewrites | L | Chosen for exactly this |
| Schema task (~Task 02) | Consumes postgres StatefulSet + Secret wiring; PVC-durability question lands there by design (D8) | L | Deliberate deferral |
| Repo conventions | `:local` tags, image naming, guard pattern, one-file-per-workload — every future service copies these | M | A mistake here propagates silently to all successors |
| External consumers / teams | None | L | No public APIs, no shared cluster, single developer |

**Contract changes:** none — nothing existed before.

**Cross-cutting ripples:** build/deploy pipeline conventions (Makefile + local images) are the ripple; auth, telemetry, migrations are all absent by scope and unaffected.

## Cross-Cutting Concerns

- **Errors:** three tiers, one owner each — operator mistakes → Makefile guards (actionable message, zero side effects, nothing created); build failures → `make build` stops and names the failing service; runtime failures → K8s restarts, `make status` surfaces non-Running states, `make logs` reaches output (the REQ's entire debugging surface). HTTP errors are framework-default 404s; no service has a failure mode of its own.
- **Logging & metrics:** one startup line per service (name + listen port) so logs are non-empty; stdout only; no metrics/tracing/dashboards — nothing to observe. Probes deferred (D3).
- **Auth / authz:** none — no endpoint has anything to protect. Auth-shaped artifacts only: the secrets-file pattern (built for Auth0's arrival) and RabbitMQ's management-UI login as infrastructure verification (local throwaway creds).
- **Performance:** N3 is the entire budget — requests-only resources, one replica each, no caching or query patterns; the concern is coexistence of six pods, not throughput.
- **Security:** N4 — only credential material in version control is the template's unusable placeholders; real `secrets.yaml` gitignored; manifests carry Secret references, never literals. No external exposure: Services are ClusterIP, reached only via developer-initiated localhost port-forward. Infra images are official upstream, pinned by major/minor.
- **Migrations / rollout:** nothing to migrate (no data, no schema). Deploy = apply (idempotent, R20); rollback = teardown + git revert (complete: every manifest kind is namespaced, no cluster-scoped residue); inner loop = edit manifest → `make deploy` again. Reproducibility from clean state is acceptance (N5).

## Architecture Decisions Log

| # | Decision | Alternatives | Chosen Because | Satisfies REQs |
|---|----------|--------------|----------------|----------------|
| A1 | Scaffold exactly the foundation-plan layout; no tests/CI/ingress/probes/ConfigMaps (ConfigMap omission is a flagged deviation from the plan's annotation — nothing needs config) | Scaffold full future structure incl. empty `tests/` dirs | Scaffold only what Task 00 needs; structure grows when features arrive (confirmed in Phase A) | R5–R7, D2/D3 |
| A2 | FastAPI + uvicorn for receipt-service; Minimal API for both .NET services | Flask; stdlib http.server; MVC controllers | Same hello-world cost; no framework swap when real work arrives | R1–R3 |
| A3 | Runtimes pinned by major tag, current LTS (expected .NET 10, Python 3.12, Node 22, nginx stable-alpine; `postgres:16`, `rabbitmq:3.13-management`) | .NET 8; Python 3.13; Node 24; floating tags | LTS lifecycle outlives the foundation phase; exact tags sanity-checked at implementation | R5, R8, R9, N3 |
| A4 | Images `expense-tracker/<svc>:local`, explicit `IfNotPresent`, never pushed/pulled; name normalization documented | `:latest` tags; GHCR push per ADR-008 prod path | Non-latest + IfNotPresent makes K8s defaults enforce local-only; registry round-trips unjustified for dev (REQ D4) | N1, R5, R13, R18 |
| A5 | Runtime-native container ports, uniform Service `:80 → targetPort` | Force all containers to :80 | Idiomatic images; uniform verification commands | R1–R4, R10 |
| A6 | Frontend: TypeScript, minimal identifying page (not Vite starter), multi-stage build, nginx serves static assets, SPA fallback via committed `frontend/nginx.conf` | Vite dev server in container; defer SPA fallback | R6 mandates built assets; fallback is two lines now vs 404-on-refresh later (REQ D12) | R4, R6 |
| A7 | Postgres StatefulSet, storage via `volumeClaimTemplates` (1Gi, cluster-default StorageClass), creds via `envFrom.secretRef` | Deployment + standalone PVC; explicit hostpath StorageClass | Canonical pairing; re-apply reuses PVC per D8 (reuse, no durability claim) | R8, R11 |
| A8 | RabbitMQ `-management` image, Service named ports `amqp:5672` + `management:15672`, creds via `envFrom.secretRef` | Stock image + plugin config | Plugin baked in; R9's login verifies plugin + reachability + secret wiring at once (REQ D11) | R9, R11 |
| A9 | One Secret, 5 keys; app Deployments reference no Secret; manifests never carry credential literals | Wire secrets into apps "since they're right there"; commit throwaway values | Hello-world rule + N4; the pattern is built for Auth0's arrival (REQ D10) | R11, R12, N4 |
| A10 | Makefile five targets per contracts; guards before any kubectl call with actionable messages; teardown `--ignore-not-found` | Deploy-anyway-and-read-ImagePullBackOff; strict teardown | First-run failures must be legible (REQ D7); idempotent teardown (REQ D9) | R13–R20, N5 |
| A11 | Deploy sequence: namespace + secrets first, then the directory; idempotency = native `kubectl apply` semantics | Single directory apply (alphabetical — postgres can race the Secret into a transient `CreateContainerConfigError`); scripted ordering logic | Removes the confusing transient state at zero cost; no ordering logic to maintain (stress-test F3 amendment) | R14, R20 |
| A12 | Labels `part-of`/`name`/`component`, selectors on `name`; replicas 1; requests-only resources | Limits; multi-replica | N3 coexistence by construction; labels extend for ingress selectors later | N3 |
| A13 | Host toolchain = Docker Desktop (K8s enabled) + kubectl + make; no language SDKs; README documents clone-to-running incl. context prerequisite | Require local .NET/Python/Node | Multi-stage Docker builds make host SDKs unnecessary; R21's promise depends on it | R21, D14 |

## Risk & Stress-Test Scenarios

### Forward — runtime failure scenarios

| Scenario | How the Design Handles It |
|----------|---------------------------|
| A pod crash-loops or dies at runtime | Isolated by design — no pod depends on any other, so no cascade is possible; K8s restarts; `make status` shows it, `make logs` reaches it |
| Two `make deploy` runs race | Last-writer-wins per object against identical manifests — both converge; deploy-during-teardown can error, teardown re-run fixes; single-developer tool, not worth locking |
| Apply ordering: postgres sorts before secrets in a directory apply | Handled by A11 (namespace + secrets applied first) — the transient `CreateContainerConfigError` state is designed out |
| Rebuilt image, same `:local` tag, then `make deploy` — old code still running | **GAP — see Open Questions** (stale-image refresh loop; cannot fire during Task 00 itself) |
| Ship-and-break rollback | Complete: teardown deletes namespace + PVC; every manifest kind is namespaced (no CRDs/cluster-scoped residue); repo reverts with git |
| Wrong kubectl context (D14) | Accepted risk, bounded: six namespaced hello-world pods, recoverable via teardown against that cluster; README prerequisite |
| Resource exhaustion on laptop | Requests-only, ~1.2 CPU / ~1.1Gi total across six pods; PVC capped at 1Gi and no data exists |
| Third-party image pull with no network on first run | Accepted (REQ edge case): N1 covers app images only; after first pull the machine works offline |

### Backward — regression risk per touched area (brownfield only)

Greenfield — no existing behavior to regress. The forward-looking analog was checked: what Tasks 01–05 inherit. Secret key names match upstream image env contracts verbatim (no rename at Task 02); uniform Service `:80` supports Task 01's same-origin `/api` routing untouched; labels extend for ingress selectors; `make deploy` semantics stay pure so future targets add without redefining it. One inheritance risk found: the stale-image loop above.

## Open Questions

- **How does a developer refresh a rebuilt local image without teardown?** (`IfNotPresent` + unchanged pod template = no rollout; the classic local-dev loop.)
  - **Impact if unresolved:** the moment Task 01 edits code, `make build && make deploy` appears to ignore the change; developer confusion, exactly the illegible failure the REQ designs against.
  - **Suggested default:** README documents `kubectl rollout restart deployment/<name> -n expense-tracker` as the refresh step for now; revisit (possibly a `make restart` target) when Task 01's loop exists. Cannot fire during Task 00 itself — hello-worlds don't change after initial build.
- **Does Postgres data need to survive a re-deploy?** (carried from REQ, D8)
  - **Impact if unresolved:** none at this stage — no tables, no data.
  - **Suggested default:** decide in the schema task, where it can be tested; teardown is the supported clean-slate path until then.
- **Should `make deploy` guard against a non-Docker-Desktop kubectl context?** (carried from REQ, D14)
  - **Impact if unresolved:** six hello-world pods can land in an unintended cluster; recoverable via teardown.
  - **Suggested default:** README prerequisite; add the guard if the repo ever targets a shared cluster.
- **When do liveness/readiness probes arrive?** (carried from REQ, D3)
  - **Impact if unresolved:** pods report Running while the app inside is unhealthy — acceptable while each app answers one static request.
  - **Suggested default:** first task where a service depends on Postgres or RabbitMQ.
- **Where do application images get published for production?** (carried from REQ, D4)
  - **Impact if unresolved:** none locally; local↔production workflow gap remains.
  - **Suggested default:** the CI task, which is where the push would live.

## Out of Scope

- Routing or communication between services (reason: proves containers boot; belongs to the tasks that need it)
- Database schema, tables, migrations (reason: Postgres runs empty; schema arrives with the first entity)
- Any business logic (reason: Foundation Tasks 01–05 and feature tickets)
- Authentication/authorization (reason: Auth0 is its own task; nothing to protect)
- `ingress.yaml` / Traefik IngressRoute (reason: no ingress controller on Docker Desktop; port-forward proves boot — D2)
- Liveness/readiness probes (reason: no health beyond process start — D3)
- CI workflow and automated tests (reason: nothing to test or publish — D2)
- Container registry publication of application images (reason: local-only — D4)
- Production / Hetzner k3s deployment, Vercel frontend deploy (reason: ADR-008 production topology unchanged — D1)
- Postgres connectivity verification (reason: nothing connects yet)
- kubectl context enforcement (reason: declined — D14)
- ConfigMaps (reason: nothing needs configuration; flagged deviation from the foundation plan's annotation)
