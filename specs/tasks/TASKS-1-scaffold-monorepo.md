# Tasks

> **Date:** August 30, 2026
> **Issue:** #1
> **Phase:** 3 of 5 (Task Generation)
> **Architecture source:** `specs/architecture/ARCH-1-scaffold-monorepo.md`
> **Requirements source:** `specs/requirements/REQ-1-scaffold-monorepo.md`

_No task uses `tdd` or `test-after`: REQ places automated tests and the `tests/`
directories explicitly out of scope (D2), so no assertion suite exists to write.
Every task's done-signal is therefore a command exit code (`checklist`) or a human
eyeball on a rendered page (`ui`). ARCH's "Touched but not changed" list is empty
(greenfield), so no task carries regression-guard scenarios — the two M-risk Areas
of Impact are handled through implementation-note callouts instead._

---

## Task T1: Scaffold the two .NET Minimal API services

> **Status:** done
> **Verification:** checklist
> **Effort:** m
> **Priority:** critical
> **Depends on:** None
> **Satisfies REQs:** R1, R3, R5
> **Footprint slice:** New: `services/core-api/{src/Program.cs, core-api.csproj, Dockerfile}`, `services/ingestion-service/{src/Program.cs, ingestion-service.csproj, Dockerfile}`
> **High-risk areas touched:** Repo conventions (M) — the Dockerfile shape and image tag established here are copied by every future .NET service

### Description

Creates `core-api` and `ingestion-service` as ASP.NET Core Minimal APIs that each answer `GET /` with a fixed status JSON naming themselves, plus a multi-stage Dockerfile per service that builds them into locally-tagged images. These two are byte-for-byte the same shape apart from the service name string; they are bundled into one task because splitting a copy-paste into two tasks doubles the ceremony without adding a verification signal. Nothing here connects to anything — no database, no queue, no peer service.

### Verification Checklist

- **`docker build -t expense-tracker/core-api:local services/core-api`** — expected: exits 0; the build runs entirely inside Docker via a multi-stage `sdk` → `aspnet` image, with no .NET SDK installed on the host _(verifies R1, R5; ARCH A13)_
- **`docker build -t expense-tracker/ingestion-service:local services/ingestion-service`** — expected: exits 0, same multi-stage shape _(verifies R3, R5)_
- **`docker run --rm -p 8080:8080 expense-tracker/core-api:local`, then `curl -i localhost:8080/`** — expected: `200`, `Content-Type: application/json`, body semantically equal to `{"service":"core-api","status":"running"}` (key order and whitespace not asserted) _(verifies R1)_
- **Same for `ingestion-service`** — expected: body semantically equal to `{"service":"ingestion-service","status":"running"}`; the `service` value is the directory name verbatim _(verifies R3)_
- **`curl -o /dev/null -w '%{http_code}' localhost:8080/nope`** — expected: `404` from the framework default; no custom 404 handler was written _(verifies ARCH API contract)_
- **`docker logs <container>`** — expected: one startup line per service naming the service and its listen port, so `make logs` has non-empty output to reach in T6 _(verifies ARCH cross-cutting: logging)_
- **`grep -rEi 'postgres|rabbit|amqp|ConnectionString|http://' services/core-api services/ingestion-service`** — expected: no hits; neither service references infrastructure or a peer _(verifies REQ "hello-world means hello-world"; ARCH module boundaries)_
- **`docker images | grep expense-tracker`** — expected: both images tagged exactly `:local`; no `:latest`, no registry prefix _(verifies N1; ARCH A4)_

### Implementation Notes

- **Module(s):** `services/core-api/`, `services/ingestion-service/` — each depends on its own directory only (ARCH Module Boundaries).
- **Pattern reference:** none exists — this task *is* the pattern. Write `core-api` first, then mirror it exactly for `ingestion-service` so future .NET services have one shape to copy.
- **Key decisions:** A2 (Minimal API in `Program.cs`, not an MVC controllers scaffold — R1/R3 say "minimal"; controllers arrive with real features); A3 (pin .NET by major tag, current LTS — expected .NET 10; sanity-check the exact tag at implementation time, but do not scaffold onto .NET 8, whose window closes Nov 2026); A5 (listen on the runtime-native 8080 inside the container; do not force the app to port 80); A13 (multi-stage build so no host SDK is required).
- **Libraries:** none beyond the framework. The `.csproj` files carry project metadata only — the first package reference arrives with database work.
- **High-risk callouts:** *Repo conventions (M)* — the image name `expense-tracker/<svc>:local` and the sealed-build-context rule (nothing outside a service directory enters its image) propagate to every successor service. A mistake here is silent and repeated. The last two checklist items exist specifically to catch it.

### Scope Boundaries

- Do NOT add liveness/readiness probes or a `/health` endpoint (ARCH Out of Scope, D3 — `core-api` gains `/api/health` in Task 01, not here).
- Do NOT add a database connection, an ORM, a queue client, or any configuration binding (ARCH Out of Scope; REQ "wiring the services to Postgres or RabbitMQ since they're right there" is a listed common mistake).
- Do NOT add CORS, authentication, logging frameworks, or DI registrations beyond what the Minimal API template needs.
- Do NOT write Kubernetes manifests here — those are T5.
- Only implement one route (`GET /`) per service, returning a fixed object.

### Files Expected

**New files:** _(from ARCH "New files / modules")_
- `services/core-api/src/Program.cs` (Minimal API, `GET /` status JSON — grows in Task 01 with `/api/health` and CORS)
- `services/core-api/core-api.csproj` (project metadata only)
- `services/core-api/Dockerfile` (multi-stage sdk → aspnet runtime; only touched on runtime-version bumps)
- `services/ingestion-service/src/Program.cs` (same shape as core-api — the email-parsing task grows it)
- `services/ingestion-service/ingestion-service.csproj` (project metadata only)
- `services/ingestion-service/Dockerfile` (multi-stage sdk → aspnet runtime)

**Modified files:** none.

**Must NOT modify:**
- `services/receipt-service/`, `frontend/` (owned by T2 and T3)
- `k8s/`, `Makefile`, `README.md` (owned by T4–T7)

---

## Task T2: Scaffold the receipt-service FastAPI service

> **Status:** done
> **Verification:** checklist
> **Effort:** s
> **Priority:** critical
> **Depends on:** None
> **Satisfies REQs:** R2, R5
> **Footprint slice:** New: `services/receipt-service/{src/main.py, requirements.txt, Dockerfile}`
> **High-risk areas touched:** Repo conventions (M) — establishes the Python service shape

### Description

Creates `receipt-service` as a FastAPI application answering `GET /` with its status JSON, served by uvicorn on port 8000, with a multi-stage Dockerfile producing `expense-tracker/receipt-service:local`. FastAPI is chosen over Flask or `http.server` because it costs the same as a hello-world today and the receipt pipeline task grows into async OCR/AI work and queue consumption without a framework swap.

### Verification Checklist

- **`cat services/receipt-service/requirements.txt`** — expected: `fastapi` and `uvicorn` only; no OCR, AI, or message-queue libraries _(verifies ARCH scope boundary; those arrive with the receipt pipeline task)_
- **`docker build -t expense-tracker/receipt-service:local services/receipt-service`** — expected: exits 0; multi-stage build on a Python 3.12 base, no Python toolchain required on the host _(verifies R5; ARCH A3, A13)_
- **`docker run --rm -p 8000:8000 expense-tracker/receipt-service:local`, then `curl -i localhost:8000/`** — expected: `200`, `application/json`, body semantically equal to `{"service":"receipt-service","status":"running"}` _(verifies R2)_
- **`curl -o /dev/null -w '%{http_code}' localhost:8000/nope`** — expected: `404` from FastAPI's default handler _(verifies ARCH API contract)_
- **`docker logs <container>`** — expected: a startup line naming the service and port 8000 _(verifies ARCH cross-cutting: logging)_
- **`grep -rEi 'postgres|rabbit|amqp|psycopg|pika|http://' services/receipt-service`** — expected: no hits _(verifies REQ "hello-world means hello-world")_

### Implementation Notes

- **Module(s):** `services/receipt-service/` — own directory only, dependencies limited to fastapi and uvicorn (ARCH Module Boundaries).
- **Pattern reference:** mirror T1's Dockerfile structure (multi-stage, sealed context, `:local` tag) in Python idiom; the container-shape convention is shared even though the toolchain is not.
- **Key decisions:** A2 (FastAPI + uvicorn); A3 (Python pinned by major tag, expected 3.12 — not 3.13); A5 (uvicorn listens on the native 8000 inside the container).
- **Libraries:** `fastapi`, `uvicorn` — pinned in `requirements.txt`.
- **High-risk callouts:** *Repo conventions (M)* — this is the only Python service in the repo for now, so its Dockerfile is the template a future Python service copies. Keep the build context sealed to `services/receipt-service/`.

### Scope Boundaries

- Do NOT add a RabbitMQ consumer, OCR, or any AI/model dependency (ARCH Out of Scope — receipt pipeline task).
- Do NOT add probes, a `/health` route, or configuration loading (D3; nothing to configure).
- Do NOT add Pydantic models or routers — one inline route is the whole surface.
- Only implement `GET /` returning a fixed object.

### Files Expected

**New files:** _(from ARCH "New files / modules")_
- `services/receipt-service/src/main.py` (FastAPI app, `GET /` — the receipt pipeline task adds the queue consumer and OCR)
- `services/receipt-service/requirements.txt` (fastapi + uvicorn only; OCR/AI libs later)
- `services/receipt-service/Dockerfile` (multi-stage python → slim)

**Modified files:** none.

**Must NOT modify:**
- `services/core-api/`, `services/ingestion-service/`, `frontend/` (owned by T1 and T3)
- `k8s/`, `Makefile`, `README.md` (owned by T4–T7)

---

## Task T3: Scaffold the frontend as a built SPA served by nginx

> **Status:** done
> **Verification:** ui
> **Effort:** m
> **Priority:** critical
> **Depends on:** None
> **Satisfies REQs:** R4, R5, R6
> **Footprint slice:** New: `frontend/{package.json, vite.config.ts, index.html, src/main.tsx, Dockerfile, nginx.conf}`
> **High-risk areas touched:** Repo conventions (M); Task 01 "route resolves" (L) inherits the nginx SPA fallback

### Description

Creates a minimal Vite + React (TypeScript) application whose page names the Expense Tracker application and shows it is running, packaged by a multi-stage Dockerfile that builds static assets with Node and serves them with nginx. This is `ui`-mode because R4's acceptance is a human looking at a rendered page and confirming it is *this* application rather than Vite's untouched starter — no assertion captures that. R6's "built assets, not a dev server" is verified in the same pass, since serving the Vite dev server from a container is the listed common mistake that "appears to work locally and is wrong".

### Verification Checklist

- **`docker build -t expense-tracker/frontend:local frontend`** — expected: exits 0; a Node 22 build stage produces `dist/`, an nginx `stable-alpine` stage serves it; no Node toolchain needed on the host _(verifies R5, R6; ARCH A3, A6, A13)_
- **`docker run --rm -p 8081:80 expense-tracker/frontend:local`, then load `http://localhost:8081` in a browser** — expected: the page names **Expense Tracker** and visibly indicates the application is running; none of Vite's starter content is present (no Vite or React logos, no counter button). Evidence: screenshot _(verifies R4; REQ D12)_
- **View source / DevTools Network on that page** — expected: hashed asset filenames under `/assets/`; no `/@vite/client`, no HMR websocket, no module-graph requests. Evidence: screenshot _(verifies R6)_
- **Hard-refresh at `http://localhost:8081/some/deep/path`** — expected: `200` and the same page renders (nginx `try_files … /index.html` fallback), not nginx's default 404. Evidence: screenshot _(verifies ARCH A6 — Task 01's React Router depends on this)_
- **`docker exec <container> ps aux`** — expected: nginx master and worker processes only; no `node` and no `vite` process in the running container _(verifies R6)_
- **`grep -rEi 'localhost:|core-api|/api/' frontend/src frontend/index.html`** — expected: no hits; the page calls no backend _(verifies REQ "no routing between services")_

#### Testable Seams

None. There is no conditional rendering, no handler, and no state in this page — a component test here would assert that a static string is a static string. Component tests arrive with Task 01, when routing and real UI state exist. This is consistent with REQ D2 (automated tests out of scope for Task 00).

### Implementation Notes

- **Module(s):** `frontend/` — own directory only; `nginx.conf` lives here, not in `k8s/` (ARCH Module Boundaries).
- **Pattern reference:** none — this is the pattern. Task 01 adds React Router, Tailwind, and shadcn on top of it (ADR-007), so keep the structure conventional Vite.
- **Key decisions:** A6 (TypeScript; a minimal identifying page rather than Vite's starter; multi-stage build; nginx serves static assets; SPA fallback committed as `frontend/nginx.conf` now — two lines today versus a 404-on-refresh debugging session when Task 01's router lands); A3 (Node pinned by major tag, expected 22; nginx `stable-alpine`); A5 (nginx listens on 80 inside the container).
- **Libraries:** `react`, `react-dom`, `vite`, `typescript`, `@vitejs/plugin-react` — nothing else. No router, no CSS framework, no component library.
- **High-risk callouts:** *Repo conventions (M)* — the two-stage build-then-serve Dockerfile is the frontend deployment shape for the life of the repo. *Task 01 inheritance* — the SPA fallback in `nginx.conf` is the specific thing Task 01 depends on; verify the deep-path refresh item rather than assuming the directive is correct.

### Scope Boundaries

- Do NOT add React Router, Tailwind, shadcn, or any component library (ARCH Out of Scope — Task 01, ADR-007).
- Do NOT call any backend service or add an API client (ARCH Out of Scope — no routing between services).
- Do NOT containerize the Vite dev server or add a dev-server path to the Dockerfile (R6; REQ common mistake).
- Do NOT add authentication, state management, or a design system.
- Only implement a single page identifying the application and its running state.

### Files Expected

**New files:** _(from ARCH "New files / modules")_
- `frontend/package.json` (minimal app naming itself + running status; Task 01 adds Router/Tailwind/shadcn)
- `frontend/vite.config.ts`
- `frontend/index.html`
- `frontend/src/main.tsx`
- `frontend/Dockerfile` (node build stage → nginx serve stage; no path to a dev server exists — R6)
- `frontend/nginx.conf` (server block with SPA fallback; Task 01's router depends on it)

**Modified files:** none.

**Must NOT modify:**
- `services/` (owned by T1 and T2)
- `k8s/`, `Makefile`, `README.md` (owned by T4–T7)

---

## Task T4: Deploy the infrastructure manifests and gitignore the real secrets file

> **Status:** done
> **Verification:** checklist
> **Effort:** m
> **Priority:** critical
> **Depends on:** None
> **Satisfies REQs:** R7, R8, R9, R11, R12, R20, N4
> **Footprint slice:** New: `k8s/namespace.yaml`, `k8s/secrets.yaml.template`, `k8s/postgres.yaml`, `k8s/rabbitmq.yaml`, `.gitignore`
> **High-risk areas touched:** Local Docker Desktop cluster (M); Repo conventions (M) — manifest layout, labels, and namespace-in-metadata are set here

### Description

Creates the `expense-tracker` namespace, the credentials Secret pattern, and the two third-party workloads: a Postgres 16 StatefulSet with a 1Gi PVC and a RabbitMQ Deployment running the management-plugin image, both taking their credentials from the Secret via `envFrom.secretRef`. It also creates the repository's first `.gitignore`, which keeps the real `k8s/secrets.yaml` out of version control while its placeholder template is committed. This task deploys and verifies independently of the application images, because Postgres and RabbitMQ pull from public registries and depend on nothing this repo builds.

### Verification Checklist

- **`kubectl apply -f k8s/namespace.yaml -f k8s/secrets.yaml`, then `kubectl apply -f k8s/postgres.yaml -f k8s/rabbitmq.yaml`** — expected: every object reconciles without error; `kubectl get ns` lists `expense-tracker` and the `default` namespace is untouched _(verifies R7)_
- **`kubectl get pods,pvc -n expense-tracker`** — expected: `postgres-0` Running; its PVC is `Bound`, `1Gi`, on the cluster-default StorageClass (no StorageClass name hardcoded in the manifest) _(verifies R8; ARCH A7)_
- **`kubectl get pods -n expense-tracker`** — expected: the rabbitmq pod is Running _(verifies R9)_
- **OPERATOR HANDOFF — RabbitMQ management UI login.** Run `kubectl port-forward svc/rabbitmq 15672:15672 -n expense-tracker`, open `http://localhost:15672` in a browser, and log in with the `RABBITMQ_DEFAULT_USER` / `RABBITMQ_DEFAULT_PASS` values from your `k8s/secrets.yaml` — expected: the login succeeds and the management overview loads. Evidence: screenshot of the logged-in overview. This single step proves the plugin is enabled, the Service is reachable, and the Secret is genuinely wired through _(verifies R9, R11; REQ D11 — a Running pod alone is explicitly not sufficient, and reporting R9 met from pod status is a listed common mistake)_
- **`grep -rEi 'password|user' k8s/postgres.yaml k8s/rabbitmq.yaml`** — expected: only `envFrom.secretRef` references; zero credential literals in either manifest _(verifies R11, N4; ARCH A9)_
- **`cat k8s/secrets.yaml.template`** — expected: committed, all five keys present as `stringData` (`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `RABBITMQ_DEFAULT_USER`, `RABBITMQ_DEFAULT_PASS`), placeholder values that parse as YAML but are unusable as credentials; `POSTGRES_DB` carries the real value `expense_tracker`, which is a name and not a credential _(verifies R12, N4; ARCH Data Models)_
- **`git check-ignore -v k8s/secrets.yaml` and `git status --porcelain`** — expected: the path is matched by a `.gitignore` rule, and with a real `secrets.yaml` present `git status` does not offer it for commit _(verifies R12; REQ common mistake: committing the real file alongside the template in the same edit)_
- **Re-apply all four manifests unchanged** — expected: succeeds again; `kubectl get pvc -n expense-tracker -o jsonpath='{.items[0].metadata.uid}'` returns the same UID as before, i.e. the existing PVC is reused rather than recreated _(verifies R20; REQ D8 — reuse, with no durability claim made)_
- **`grep -c 'namespace: expense-tracker' k8s/*.yaml` and inspect labels** — expected: every manifest carries `namespace: expense-tracker` in its metadata and the `app.kubernetes.io/part-of`, `name`, and `component` labels, with selectors matching on `name` only; nothing depends on a `kubectl -n` flag _(verifies ARCH A12 and manifest conventions)_

### Implementation Notes

- **Module(s):** `k8s/` — declarative local-environment topology, no dependencies (ARCH Module Boundaries).
- **Pattern reference:** none — this task sets the one-file-per-workload manifest convention that T5 and every future workload copy.
- **Key decisions:** A7 (Postgres as a StatefulSet with `volumeClaimTemplates`, 1Gi, no StorageClass named — not a Deployment plus a standalone PVC; reaching for a Deployment is a listed REQ common mistake); A8 (`rabbitmq:3.13-management` image variant so the plugin is baked in, Service with named ports `amqp:5672` and `management:15672`); A9 (one Secret, five keys, referenced never inlined); A3 (`postgres:16`, pinned by major); A12 (labels, `replicas: 1`, requests-only resources ~250m/256Mi for these two); D1 (no kustomize, no overlays, no Helm — a configuration layer would defeat "nothing to configure").
- **Libraries:** none — plain YAML applied with `kubectl`.
- **High-risk callouts:** *Local Docker Desktop cluster (M)* — everything lands in one namespace and the residual risk is a wrong current kubectl context (D14, accepted, README prerequisite in T7); confirm `kubectl config current-context` before applying. *Repo conventions (M)* — labels, namespace-in-metadata, and the `envFrom.secretRef` credential pattern propagate to every future manifest; the last checklist item exists to catch drift now rather than after five services have copied it.
- **Flagged deviation:** the foundation plan's `postgres.yaml` annotation mentions a ConfigMap. None is created — nothing in this task needs configuration (ARCH Patterns & Conventions). Do not add one.

### Scope Boundaries

- Do NOT create a schema, tables, seed data, or an init script for Postgres (ARCH Out of Scope — schema arrives with the first entity).
- Do NOT verify Postgres connectivity or add a client to test it (ARCH Out of Scope — nothing connects yet).
- Do NOT add a ConfigMap (nothing needs configuration; flagged deviation above).
- Do NOT add probes, a NetworkPolicy, an HPA, a PDB, or ingress (ARCH Out of Scope, D2/D3).
- Do NOT commit a real `k8s/secrets.yaml`, and do NOT put usable values in the template (N4).
- Do NOT write the application workload manifests here — those are T5.
- Only implement the namespace, the Secret template, and the two infrastructure workloads.

### Files Expected

**New files:** _(from ARCH "New files / modules")_
- `k8s/namespace.yaml` (the `expense-tracker` namespace)
- `k8s/secrets.yaml.template` (committed placeholder Secret, 5 keys, `stringData`; absorbs Auth0 keys later — D10)
- `k8s/postgres.yaml` (StatefulSet with `volumeClaimTemplates` 1Gi + Service `:5432`, creds via `envFrom.secretRef`; consumed by the schema task)
- `k8s/rabbitmq.yaml` (Deployment on `3.13-management` + Service with named ports `amqp:5672` and `management:15672`, creds via `envFrom.secretRef`; consumed by the receipt pipeline task)
- `.gitignore` (**created** — none exists: `k8s/secrets.yaml` plus standard build artifacts; grows with toolchains)

**Modified files:** none.

**Must NOT modify:**
- `services/`, `frontend/` (owned by T1–T3)
- `k8s/core-api.yaml`, `k8s/receipt-service.yaml`, `k8s/ingestion-service.yaml`, `k8s/frontend.yaml` (owned by T5)
- `Makefile`, `README.md` (owned by T6 and T7)

---

## Task T5: Deployment and ClusterIP Service manifests for the four application workloads

> **Status:** not started
> **Verification:** checklist
> **Effort:** m
> **Priority:** critical
> **Depends on:** T1, T2, T3, T4
> **Satisfies REQs:** R1, R2, R3, R4, R10, R14, N1, N3
> **Footprint slice:** New: `k8s/core-api.yaml`, `k8s/receipt-service.yaml`, `k8s/ingestion-service.yaml`, `k8s/frontend.yaml`
> **High-risk areas touched:** Repo conventions (M) — the `:local` + `IfNotPresent` image pattern every future service copies; Local Docker Desktop cluster (M)

### Description

Gives each of the four application images a Deployment and a ClusterIP Service in the `expense-tracker` namespace, wired so Kubernetes uses the locally built image and never attempts a registry fetch. Each Service exposes port 80 and forwards to that container's runtime-native port, which makes the verification commands uniform across services. This is the task where the local-only image decision either works or fails — and when it fails, all four pods land in `ImagePullBackOff` simultaneously, which REQ names as the most likely first-attempt failure.

### Verification Checklist

- **Inspect all four manifests** — expected: each contains exactly one Deployment and one ClusterIP Service, `replicas: 1`, requests-only resources (~100m CPU / 128Mi memory), no limits set _(verifies R10, N3; ARCH A12 — limits would manufacture OOM kills a hello-world cannot justify)_
- **`grep -E 'image:|imagePullPolicy:' k8s/{core-api,receipt-service,ingestion-service,frontend}.yaml`** — expected: every image is `expense-tracker/<svc>:local` with an explicit `imagePullPolicy: IfNotPresent`; no `:latest` tag and no registry prefix anywhere _(verifies N1, R5; ARCH A4 — a non-`latest` tag makes Kubernetes' own default enforce local-only, and the explicit policy documents the intent)_
- **`grep -A2 'ports:' k8s/*.yaml` for the four app services** — expected: Services declare `port: 80` with `targetPort` 8080 (core-api), 8000 (receipt-service), 8080 (ingestion-service), 80 (frontend) _(verifies ARCH A5)_
- **`kubectl apply -f k8s/` then `kubectl get pods -n expense-tracker`** — expected: all four application pods reach Running alongside postgres and rabbitmq — six in total; zero pods in `ImagePullBackOff` or `ErrImagePull` _(verifies R14, N1)_
- **`kubectl get svc -n expense-tracker`** — expected: `core-api`, `receipt-service`, `ingestion-service`, and `frontend` all listed as ClusterIP _(verifies R10)_
- **Port-forward each API Service on its Service port (`kubectl port-forward svc/<name> <local>:80 -n expense-tracker`) and `curl localhost:<local>/`** — expected: each returns its own status JSON (`core-api`, `receipt-service`, `ingestion-service`). Going through the Service port rather than the container port is what proves the `port → targetPort` mapping, not just that the container works _(verifies R1, R2, R3, R10)_
- **Port-forward `svc/frontend <local>:80` and load it in a browser** — expected: the Expense Tracker page renders _(verifies R4)_
- **`grep -E 'secretRef|POSTGRES|RABBITMQ|env:' k8s/{core-api,receipt-service,ingestion-service,frontend}.yaml`** — expected: no hits; no application Deployment references the Secret, a connection string, a queue name, or a peer service DNS name _(verifies ARCH A9 and module boundary rules — "no service references another service or the infra")_

### Implementation Notes

- **Module(s):** `k8s/` (ARCH Module Boundaries).
- **Pattern reference:** `k8s/postgres.yaml` and `k8s/rabbitmq.yaml` from T4 — follow their one-file-per-workload layout, `namespace: expense-tracker` in metadata, and label scheme exactly.
- **Key decisions:** A4 (`expense-tracker/<svc>:local` + explicit `IfNotPresent`, never pushed or pulled; the unqualified name normalizes to `docker.io/expense-tracker/…` and resolves against Docker Desktop's shared image store — documented in T7's README so nobody "fixes" it by adding a registry prefix); A5 (uniform `port: 80 → targetPort: <native>`); A9 (application Deployments reference no Secret — wiring them up "since they're right there" is a listed REQ common mistake that converts a boot problem into a distributed-systems problem); A12 (labels, single replica, requests only).
- **Libraries:** none — plain YAML.
- **High-risk callouts:** *Repo conventions (M)* — these four files are the template every future service manifest is copied from; the image-tag and pull-policy checklist item is the guard against propagating the single easiest thing to get wrong. *Local Docker Desktop cluster (M)* — this is the point where all six pods coexist; if the cluster is resource-starved, N3 fails here and not earlier.
- Depends on T1–T3 for the images to exist locally and on T4 for the namespace; apply order does not matter within this task because none of these pods depends on another.

### Scope Boundaries

- Do NOT add probes, ingress, an IngressRoute, a NetworkPolicy, an HPA, or a PDB (ARCH Out of Scope, D2/D3).
- Do NOT set resource limits, add replicas, or add an autoscaler (ARCH A12, N3).
- Do NOT give any application Deployment an env var, a ConfigMap, or a `secretRef` (ARCH A9).
- Do NOT add a registry prefix, a `:latest` tag, or an `imagePullSecret` (N1, A4).
- Only implement one Deployment plus one ClusterIP Service per application service.

### Files Expected

**New files:** _(from ARCH "New files / modules")_
- `k8s/core-api.yaml` (Deployment + ClusterIP Service, per manifest conventions; grows independently)
- `k8s/receipt-service.yaml` (same)
- `k8s/ingestion-service.yaml` (same)
- `k8s/frontend.yaml` (same)

**Modified files:** none.

**Must NOT modify:**
- `k8s/namespace.yaml`, `k8s/secrets.yaml.template`, `k8s/postgres.yaml`, `k8s/rabbitmq.yaml`, `.gitignore` (owned by T4)
- `services/`, `frontend/` (owned by T1–T3)
- `Makefile`, `README.md` (owned by T6 and T7)

---

## Task T6: The Makefile — five targets and two fail-fast guards

> **Status:** not started
> **Verification:** checklist
> **Effort:** l
> **Priority:** critical
> **Depends on:** T1, T2, T3, T4, T5
> **Satisfies REQs:** R5, R13, R14, R15, R16, R17, R18, R19, R20, N5
> **Footprint slice:** New: `Makefile`
> **High-risk areas touched:** Repo conventions (M) — the guard pattern and `deploy` semantics every future target is added around; Local Docker Desktop cluster (M)

### Description

Builds the operator surface: `build`, `deploy`, `status`, `logs svc=<name>`, and `teardown`, with two guards that run before any `kubectl` call. `build` and `deploy` are deliberately separate — rebuilding four images on every manifest tweak would discourage the inner loop — and the guards recover the safety that separation gives up. The unhappy-path items in this checklist are the point of the task: REQ states that `status` and `logs` "must be useful on the unhappy path, which is the only path where they matter", and that the two guard failures are what hit newcomers hardest at the moment they have the least context.

### Verification Checklist

- **`make build` from a clean checkout** — expected: exits 0; `docker images` lists all four `expense-tracker/*:local` images, each built from its own service directory as the build context _(verifies R5, R13; ARCH sealed-build-units convention)_
- **Deliberately break one service's build (e.g. a syntax error in `services/core-api/src/Program.cs`), run `make build`** — expected: exits non-zero and the output names `core-api` as the failing service, not just a raw Docker error. Revert the break afterwards _(verifies ARCH error tier 2: build failures stop and name the failing service)_
- **`docker rmi` the four application images, then `make deploy`** — expected: exits non-zero with a message naming `make build` as the fix, **and** `kubectl get all -n expense-tracker` shows nothing was created _(verifies R18; REQ D7 — turns a cryptic `ImagePullBackOff` into one readable line)_
- **Restore the images, move `k8s/secrets.yaml` aside, then `make deploy`** — expected: exits non-zero with a message directing the developer to copy `k8s/secrets.yaml.template`, and nothing is created _(verifies R19; the file is gitignored by design, so its absence is the expected state of a fresh clone)_
- **Read the `deploy` recipe, and confirm via the two runs above that no namespace exists afterwards** — expected: both guards execute before the first `kubectl` invocation; a guard failure has zero side effects _(verifies R18, R19; ARCH A10)_
- **`make deploy` on the happy path** — expected: applies `k8s/namespace.yaml` and `k8s/secrets.yaml` first, then the `k8s/` directory; six pods reach Running; the postgres pod never passes through a transient `CreateContainerConfigError` caused by racing the Secret _(verifies R14; ARCH A11 — a plain directory apply sorts `postgres.yaml` before `secrets.yaml`)_
- **`make deploy` a second time immediately after** — expected: exits 0 both times, leaving the same six pods Running _(verifies R20)_
- **`make status`** — expected: prints `kubectl get all,pvc -n expense-tracker` output showing pods and their states. Then force a failure (e.g. `kubectl set image deployment/core-api core-api=expense-tracker/core-api:nope -n expense-tracker`) and re-run — expected: the non-Running state is visible in the output. Restore with `make deploy` afterwards _(verifies R15; REQ: these targets must be useful on the unhappy path)_
- **`make logs svc=core-api`** — expected: streams that container's logs (the startup line from T1 appears). **`make logs svc=postgres`** — expected: resolves to `sts/postgres` rather than a Deployment. **`make logs` with no `svc`, and with `svc=nonsense`** — expected: exits non-zero and lists the six valid service names _(verifies R16)_
- **`make teardown`** — expected: `kubectl get ns` no longer lists `expense-tracker` and the PVC is gone with it. Run it a second time on the now-clean cluster — expected: exits 0 silently _(verifies R17; REQ D9)_
- **`make deploy` after that teardown** — expected: returns the system to six Running pods from a clean state _(verifies N5)_

### Implementation Notes

- **Module(s):** `Makefile` — the only write path into the cluster; may depend on the Docker CLI, kubectl, and file tests only (ARCH Module Boundaries).
- **Pattern reference:** none — this establishes the operator surface. Future targets are added alongside these without redefining `deploy` semantics.
- **Key decisions:** A10 (five targets; guards before any kubectl call with actionable messages that name the missing thing *and* the fix; `teardown` uses `--ignore-not-found` so it is idempotent); A11 (apply `namespace.yaml` + `secrets.yaml` explicitly first, then the directory — this removes the transient error state at zero cost, with no ordering logic to maintain); D6 (`deploy` must NOT depend on `build`); A4 (Guard A checks the four images in the local Docker store).
- **Libraries:** none — `make`, `docker`, `kubectl`. No new toolchain dependency (no Taskfile, no skaffold, no shell script directory).
- **High-risk callouts:** *Repo conventions (M)* — `deploy`'s semantics (guarded, idempotent, apply-only, never builds) are inherited by every target added later; keep the recipe pure. *Local Docker Desktop cluster (M)* — `teardown` deleting the namespace is the full recovery path for a wrong-context deploy, so verify the second-run-succeeds behavior rather than assuming it.
- Targets are sequential, stop on first failure, and propagate non-zero exits (ARCH Makefile contract).

### Scope Boundaries

- Do NOT make `deploy` depend on `build` or trigger an implicit rebuild (REQ D6 — they are separate steps by decision).
- Do NOT add a kubectl-context guard (ARCH Out of Scope, D14 — declined; it is a README prerequisite in T7).
- Do NOT add a `make restart` target, a `make test` target, a push/publish target, or a watch loop (ARCH Out of Scope; the refresh step is documented in T7's README, and a `make restart` target is explicitly deferred until Task 01's loop exists).
- Do NOT introduce shell scripts, a Taskfile, or skaffold (ARCH Tech Choices — zero new toolchain deps).
- Only implement the five targets named in ARCH's Makefile contract.

### Files Expected

**New files:** _(from ARCH "New files / modules")_
- `Makefile` (five targets per the ARCH Makefile contract; new targets add later without redefining `deploy` semantics)

**Modified files:** none.

**Must NOT modify:**
- `services/`, `frontend/`, `k8s/` (owned by T1–T5 — if a manifest needs changing to make a target work, that is a signal to revisit the earlier task, not to edit it from here)
- `README.md` (owned by T7)

---

## Task T7: README — prerequisites, first-run setup, and a verified clone-to-running path

> **Status:** not started
> **Verification:** checklist
> **Effort:** m
> **Priority:** high
> **Depends on:** T6
> **Satisfies REQs:** R21, N5, R12
> **Footprint slice:** Modified: `README.md` (rewritten from a single line)
> **High-risk areas touched:** Local Docker Desktop cluster (M) — the kubectl-context prerequisite is the documented mitigation for the one accepted risk (D14); Repo conventions (M)

### Description

Rewrites the one-line README into the document that makes R21 true: a teammate who has not seen this conversation follows it on a machine with Docker Desktop and reaches six Running pods without asking a question. Documentation is in scope precisely because the gitignored secrets file makes a fresh clone non-obvious to boot (REQ D13). The final checklist item is the real acceptance test for the whole issue — teardown to a clean state, then follow the README verbatim.

### Verification Checklist

- **Read the prerequisites section** — expected: it names Docker Desktop with Kubernetes **enabled and its context selected**, `kubectl`, and `make`; and states explicitly that no .NET, Python, or Node SDK is needed on the host because every build happens inside Docker _(verifies R21; ARCH A13, D14 — the context prerequisite is the documented mitigation for the one accepted risk)_
- **Read the first-run section** — expected: it instructs the developer to copy `k8s/secrets.yaml.template` to `k8s/secrets.yaml` and edit the values, and explains that the real file is gitignored on purpose _(verifies R12, R21; REQ D10)_
- **Read the local-images explanation** — expected: the README states that Docker Desktop shares its image store with its Kubernetes, that `expense-tracker/<svc>:local` normalizes to `docker.io/expense-tracker/…` and resolves locally, and that the unqualified name must NOT be "fixed" by adding a registry prefix _(verifies ARCH A4 / Patterns & Conventions — this note exists to stop a future contributor from breaking N1)_
- **Read the refresh note** — expected: the README documents `kubectl rollout restart deployment/<name> -n expense-tracker` as the way to pick up a rebuilt image with an unchanged pod template, noting it is provisional pending a possible `make restart` target _(addresses ARCH Open Question 1, per its suggested default; the loop cannot fire during Task 00 itself but bites the moment Task 01 edits code)_
- **Read the verify section** — expected: it gives the port-forward and `curl` command for each of the three APIs, the browser step for the frontend, and the RabbitMQ management-UI login step; it presents `kubectl get` and `port-forward` as read/verify commands only, with the Makefile as the sole write path _(verifies R21; ARCH module boundary rules)_
- **Run every command the README prints, exactly as written** — expected: each produces the output the README says it will; no command has a typo, a wrong namespace, or a wrong port _(verifies R21)_
- **CLEAN-SLATE RUN (task acceptance): `make teardown`, then follow the README top to bottom without consulting anything else and without asking a question** — expected: `kubectl get pods -n expense-tracker` shows six pods, all Running _(verifies R21, N5, R14 — REQ's "boot is the unit of done")_

### Implementation Notes

- **Module(s):** documentation only; no code or manifest changes.
- **Pattern reference:** the current `README.md` is a single title line — this is effectively a rewrite, not an edit.
- **Key decisions:** D13 (README setup documentation is in scope; without it R21 is unachievable and the task's stated value — anyone can boot this — does not exist); D14 (no context guard in code; the README prerequisite is the mitigation); A13 (host toolchain is Docker Desktop + kubectl + make, no language SDKs); A4 (the local-image mechanism is documented here so nobody "fixes" it).
- **Libraries:** none.
- **High-risk callouts:** *Local Docker Desktop cluster (M)* — the wrong-context risk was accepted on the condition that the README carries the prerequisite; if that line is missing, an explicitly accepted risk becomes an undocumented one. *Repo conventions (M)* — the local-image explanation is the written form of the convention T5 encodes; both must agree.
- Write it last, after T6, so every documented command has actually been run.

### Scope Boundaries

- Do NOT document production or Hetzner k3s deployment, Vercel, Supabase, or CloudAMQP (ARCH Out of Scope, D1 — ADR-008's production topology is unchanged and unaddressed here; the README should make clear these manifests describe the local development environment only).
- Do NOT document features that do not exist yet (no API reference, no architecture essay — ADRs already live in `docs/`).
- Do NOT add a CONTRIBUTING guide, badges, screenshots beyond what verification needs, or a license section unless asked.
- Do NOT add a kubectl-context guard to the Makefile while documenting the prerequisite (D14).
- Only implement prerequisites, first-run setup, the build/deploy/verify sequence, the local-image explanation, the refresh note, and teardown.

### Files Expected

**New files:** none.

**Modified files:** _(from ARCH "Modified files / modules")_
- `README.md` (rewritten from a single line: prerequisites — Docker Desktop with K8s enabled and selected, kubectl, make, **no language SDKs** since builds happen in Docker; first-run secrets step; build/deploy/verify sequence; local-image mechanism; rebuilt-image refresh step; teardown)

**Must NOT modify:**
- `Makefile` (owned by T6 — if the README cannot describe a target honestly, fix the target in T6, not the prose here)
- `services/`, `frontend/`, `k8s/`, `.gitignore` (owned by T1–T5)
- `docs/` (ADRs and the foundation plan are inputs to this work, not outputs of it)
