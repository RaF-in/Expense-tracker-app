# Requirements: Scaffold Monorepo — All 6 Pods Boot on Local Kubernetes

> **Date:** August 25, 2026
> **Issue:** #1
> **Type:** infrastructure
> **Source:** GitHub issue #1 (`specs/context/1.md`), Foundation Plan (`docs/planning/expense-tracker-foundation-plan.md`), ADR-003, ADR-008
> **Phase:** 1 of 5 (Requirement Engineering)

## Summary

Stand up the skeleton of the Expense Tracker system so that one developer, on one
laptop, can bring the entire platform up with two commands and see all six
components running. Each of the four application services is a "hello world" that
proves only one thing: its container builds, starts, and answers. No routing
between services, no database tables, no business logic, no authentication.

This is Task 00 of the Foundation phase. Its value is not features — it is that
every subsequent task starts from a repo that boots, and can be verified against a
running system rather than against a developer's imagination.

## Problem & Motivation

The project has a complete set of ADRs and a foundation plan, but no code. The
decided architecture is three polyglot microservices plus a React SPA (ADR-003),
deployed to Kubernetes (ADR-008). That shape is only credible once it actually
runs somewhere.

**Trigger:** the team is about to begin feature work, and the project's governing
rule is that *every task leaves the repo bootable*. That rule is unenforceable
until there is a bootable baseline to preserve.

**Who benefits:** the developers building Tasks 01–05, who get a working local
environment instead of assembling one per-feature; and any teammate joining later,
who can clone and boot rather than reverse-engineer.

**If we don't do it:** service scaffolding gets improvised inside feature tasks,
Docker and Kubernetes problems surface tangled with business-logic problems, and
the "repo always boots" rule quietly dies in week one.

## Users & Consumers

- **Developers on this project** — need one reliable command sequence that brings
  up the full system locally, and a fast way to see what is running and read logs
  when something is not.
- **A teammate cloning the repo for the first time** — needs to go from clone to
  six running pods by following the README, with no tribal knowledge.
- **Later foundation and feature tasks (01–05)** — need a stable place to add
  code: a service directory that already builds into an image, and a manifest that
  already deploys it.

## Environment Positioning — Read This First

The Kubernetes manifests produced by this task describe a **local development
environment on Docker Desktop Kubernetes**. They are *not* the production
deployment.

ADR-008 stands unamended: in production, Postgres is Supabase, RabbitMQ is
CloudAMQP, and the React SPA is served from Vercel. The in-cluster `postgres.yaml`
and `rabbitmq.yaml` exist so a developer can boot the whole system offline on a
laptop without provisioning managed services. Nobody should later read
`k8s/postgres.yaml` as a statement of production intent.

## Functional Requirements

| ID  | Requirement | Acceptance Criterion |
|-----|-------------|----------------------|
| R1  | `services/core-api/` contains a minimal .NET Core Web API that responds on its root path. | Port-forwarding the `core-api` service and issuing `GET /` returns `{ "service": "core-api", "status": "running" }`. |
| R2  | `services/receipt-service/` contains a minimal Python HTTP service that responds on its root path. | Port-forwarding the `receipt-service` service and issuing `GET /` returns `{ "service": "receipt-service", "status": "running" }`. |
| R3  | `services/ingestion-service/` contains a minimal .NET Core HTTP service that responds on its root path. | Port-forwarding the `ingestion-service` service and issuing `GET /` returns `{ "service": "ingestion-service", "status": "running" }`. |
| R4  | `frontend/` contains a Vite + React application serving a minimal page that names the application and indicates it is running. | Port-forwarding the `frontend` service and loading it in a browser renders that page — not Vite's untouched starter content. |
| R5  | Each of the four application services builds into a container image. | `make build` completes successfully and all four images are present in the local Docker image list. |
| R6  | The frontend image serves its built static assets through nginx rather than a development server. | The running frontend container serves the production build; no Vite dev server process is involved. |
| R7  | An `expense-tracker` namespace is created, and every resource in this task is created inside it. | `kubectl get all -n expense-tracker` lists the six workloads; the default namespace is untouched. |
| R8  | A Postgres 16 StatefulSet with a PersistentVolumeClaim is deployed. No schema, tables, or migrations. | `kubectl get pods -n expense-tracker` shows `postgres-0` Running with a Bound PVC. |
| R9  | A RabbitMQ Deployment and Service are deployed with the management UI enabled. | The management UI loads over a port-forward and accepts a login using the credentials from `secrets.yaml`. |
| R10 | Each of the four application services has a Deployment and a ClusterIP Service. | Each of the four appears in `kubectl get svc -n expense-tracker` and each has a Running pod. |
| R11 | `secrets.yaml` supplies the Postgres credentials and the RabbitMQ admin credentials to the workloads that need them. | Postgres and RabbitMQ start using those values; neither relies on a hardcoded credential in its Deployment or StatefulSet manifest. |
| R12 | A committed placeholder template of the secrets file exists; the real `secrets.yaml` is gitignored. | The template is present in the repository, `secrets.yaml` is listed in `.gitignore`, and `git status` on a configured working copy does not offer the real file for commit. |
| R13 | `make build` builds all four application images. | Running it from a clean checkout produces all four images and exits zero. |
| R14 | `make deploy` applies all manifests and brings the system up. | After `make build && make deploy`, `kubectl get pods -n expense-tracker` shows six pods and all reach Running. |
| R15 | `make status` shows the current state of everything in the namespace. | Running it prints the pods and their states, including a non-Running state when one exists. |
| R16 | `make logs svc=<name>` streams the logs of a named service. | `make logs svc=core-api` prints that service's container logs. |
| R17 | A teardown target removes the entire deployment. | Running it deletes the `expense-tracker` namespace; `kubectl get ns` no longer lists it, and the PVC is gone with it. |
| R18 | `make deploy` refuses to run, with an actionable message, when the four application images are not present locally. | With images absent, it exits non-zero and prints a message directing the developer to run `make build` first. No pods are created. |
| R19 | `make deploy` refuses to run, with an actionable message, when `secrets.yaml` is absent. | With the file absent, it exits non-zero and prints a message directing the developer to copy the template. No pods are created. |
| R20 | `make deploy` is idempotent. | Running it twice in a row against an already-deployed namespace succeeds both times and leaves the same six pods Running. |
| R21 | The README documents prerequisites and the full clone-to-running sequence. | A teammate who has not seen this conversation can follow the README on a machine with Docker Desktop and reach six Running pods without asking a question. |

## Non-Functional Requirements

| ID  | Requirement | Acceptance Criterion |
|-----|-------------|----------------------|
| N1  | The four application images are never pushed to, or pulled from, a remote registry. | Deploying with no network access to any registry still starts all four application pods, using the locally built images. |
| N2  | Third-party images (Postgres 16, RabbitMQ) are obtained from their public registry when not already present locally. | On a machine that has never pulled them, `make deploy` retrieves them and both pods start. |
| N3  | The whole system runs within the resources of a developer laptop running Docker Desktop. | All six pods reach Running concurrently on a standard Docker Desktop Kubernetes configuration and stay Running. |
| N4  | No real or production credential is committed to the repository at any point in this task. | The only credential material in version control is the placeholder template, containing no usable value. |
| N5  | The boot sequence is reproducible from a clean state. | Teardown followed by `make deploy` returns the system to six Running pods. |

## Behaviors & Domain Rules

### Boot as the unit of done

The task is complete when the system boots, not when the files exist. A service
directory that compiles but whose pod crash-loops is not done. The verification
sequence in the ticket — `make build && make deploy`, then `kubectl get pods`,
then a `curl` against core-api — is the definition of completion, not a suggestion.

### Hello-world means hello-world

Each service answers one request with a fixed response naming itself and its
status. It does not connect to Postgres, does not publish to or consume from
RabbitMQ, does not call another service, and does not read a configuration value
it does not need. Postgres and RabbitMQ are deployed and running, but nothing
talks to them yet — their presence proves the infrastructure boots, nothing more.

### Images are local, and that is deliberate

The four application images live only on the developer's machine. Docker Desktop's
Kubernetes shares the local Docker image store, which is what makes this work. The
manifests must therefore be written so Kubernetes uses the local image and never
tries to fetch it from a registry — the images have no registry to be fetched from.
This constraint applies only to the four application images; Postgres and RabbitMQ
are ordinary public images and pull normally.

### Failures should be legible

The two ways a newcomer will fail are running `make deploy` without building, and
running it without a secrets file. Both are caught before any resource is created,
with a message that names the fix. The alternative — letting Kubernetes surface
them as `ImagePullBackOff` or a pod stuck in `CreateContainerConfigError` minutes
later — costs a beginner an afternoon.

**Why these rules matter:**

- **Local-only images** is the single decision that makes a laptop-first workflow
  possible without a registry, and the single easiest thing to get wrong. Get it
  wrong and every pod fails identically and mysteriously.
- **No inter-service communication** keeps this task's failure surface tiny. When
  a pod does not start, the cause is the container or the manifest — never a
  dependency, a connection string, or a race between services.
- **Deployed-but-unused Postgres and RabbitMQ** front-load the slow, fiddly
  infrastructure (a StatefulSet, a PVC, a management plugin) into a task with no
  business logic competing for attention.
- **Gitignored secrets from day one** matters because the next credentials to
  arrive are Auth0's. Establishing the pattern while the only secret is a
  throwaway Postgres password is far cheaper than retrofitting it after a real
  secret has been committed and must be rotated and purged from history.
- **Namespace-scoped everything** makes teardown a single delete and keeps the
  project from leaving debris in a developer's default namespace.

**Common mistakes:**

- Writing manifests that pull the application images from a registry — the most
  likely first-attempt failure, and it presents as all four pods in
  `ImagePullBackOff` at once.
- Dockerizing the frontend around Vite's dev server instead of building static
  assets and serving them with nginx. It appears to work locally and is wrong.
- Reaching for a Deployment for Postgres because it is the familiar workload type.
  Postgres needs the StatefulSet and its PVC.
- Enabling RabbitMQ's management plugin but never actually loading the UI, then
  reporting R9 as met because the pod is Running.
- Committing the real `secrets.yaml` alongside the template because both files
  were created in the same edit.
- Wiring the services to Postgres or RabbitMQ "since they're right there" — out of
  scope, and it converts a boot problem into a distributed-systems problem.
- Assuming `make deploy` implies `make build`. It does not; they are separate
  steps by decision, with a guard instead of an implicit rebuild.

## Edge Cases & Failure Modes

| Scenario | Decision | Rationale |
|----------|----------|-----------|
| `make deploy` run before `make build`; application images do not exist locally. | Fail fast, exit non-zero, print a message naming `make build`. Create nothing. | Turns the most common newcomer failure from a cryptic `ImagePullBackOff` into one readable line. |
| `make deploy` run on a fresh clone; `secrets.yaml` does not exist. | Fail fast, exit non-zero, print a message directing the developer to copy the template. Create nothing. | The file is gitignored by design, so its absence is the *expected* state of a fresh clone — it must be handled as a first-run step, not an error. |
| `make deploy` run twice in a row on an already-deployed namespace. | Succeed both times; converge to the same six Running pods. | Re-deploying after editing one manifest is the normal inner loop. It must not require a teardown. |
| Namespace already exists when `make deploy` runs. | Not an error; proceed. | Follows directly from idempotency. |
| Postgres PVC already exists from a previous deploy. | Reuse it. Whether data survives a re-deploy is explicitly **not** claimed at this stage. | There are no tables and no data. Making a durability promise now would be untested and could be silently broken by Task 01's schema work. |
| Developer needs a guaranteed clean slate. | Use the teardown target, which deletes the namespace and the PVC with it, then deploy again. | One explicit, obvious reset path rather than partial-cleanup guesswork. |
| A pod is not Running — crash-looping, pending, or failing to pull. | `make status` surfaces the actual pod state, and `make logs svc=<name>` reaches its logs. | These two targets are the entire debugging surface this task ships; they must be useful on the unhappy path, which is the only path where they matter. |
| kubectl's current context points at a cluster other than Docker Desktop. | Not guarded. Documented as a README prerequisite: Docker Desktop Kubernetes must be enabled and selected. | Explicitly decided (D12). At scaffold stage the blast radius is six hello-world pods in a namespace that teardown removes. Revisit if this repo ever targets a shared cluster. |
| Postgres pod is Running but not accepting connections. | Out of scope for this task's acceptance. | Nothing connects to Postgres yet. Connectivity becomes verifiable — and required — in the task that introduces the schema. |
| A local port used for verification is already occupied. | Not handled in the manifests; the developer chooses another local port when port-forwarding. | Port-forward's local port is a per-developer runtime choice, not a property of the system. |
| Postgres or RabbitMQ image not present locally and no network available. | Deploy fails on the image pull. Accepted. | N1's offline guarantee covers only the four application images; third-party images require a first-time pull, after which the machine works offline. |

## Decisions Log

| #   | Decision | Alternatives Considered | Chosen Because |
|-----|----------|-------------------------|----------------|
| 1 | The manifests define a local development environment only; ADR-008 stands unamended. | Revise ADR-008 to self-host Postgres/RabbitMQ in production; or one manifest set with environment overlays for local vs. managed backing services. | The managed-services decision is sound and unchanged. In-cluster Postgres and RabbitMQ exist purely so the system boots on a laptop. Overlays would add a configuration layer to a task whose point is that there is nothing to configure. |
| 2 | Scope is the ticket's component table plus `secrets.yaml`. | Also include `ingress.yaml`; also include the CI workflow; also include per-service test scaffolding. | Docker Desktop Kubernetes ships no ingress controller, so ingress would pull controller installation into a scaffold task; port-forward proves boot equally well. CI and tests are meaningful once there is behavior to test. |
| 3 | Acceptance is the ticket as written: six pods Running plus a `curl` against core-api. | Liveness/readiness probes on all four services; probes plus `curl` verification of all four. | Deliberately minimal. Probes describe health, and at this stage there is no health to describe beyond "the process started". They arrive with the first real dependency. |
| 4 | The four application images are built locally and never pushed to a remote registry; manifests never attempt to pull them. | Push to GitHub Container Registry, as ADR-008 specifies for production. | Three hello-world development services do not justify a registry round-trip on every change. Docker Desktop shares its image store with its Kubernetes, so local images are directly usable. |
| 5 | Third-party images (Postgres 16, RabbitMQ) pull from their public registry when absent locally. | Vendor or pre-pull them as a documented setup step. | Standard behavior for standard images; no reason to special-case them. |
| 6 | `make build` and `make deploy` are separate steps; deploy does not build. | Make `deploy` depend on `build` so a bare `make deploy` always rebuilds. | Rebuilding four images on every manifest tweak is slow enough to discourage the inner loop. The guard (D7) recovers the safety without the cost. |
| 7 | `make deploy` fails fast with an actionable message when the images or `secrets.yaml` are missing. | Deploy anyway and let the failure surface as `ImagePullBackOff` / a config error, treating that as a normal signal a developer should read. | Both are first-run failures that hit newcomers hardest, at exactly the moment they have the least context to diagnose them. |
| 8 | `make deploy` is idempotent; no claim is made about Postgres data surviving a re-deploy. | Guarantee PVC retention across deploys; or tear down and recreate everything on every deploy. | Idempotency is needed for the normal inner loop. A durability guarantee would be untested and unused while there are no tables — better made when it can be verified. |
| 9 | Add a teardown target beyond the ticket's four; it deletes the namespace and everything within. | Ticket's four targets only, with manual `kubectl delete` for resets. | Resetting is frequent during scaffolding, and hand-typed deletes are exactly how orphaned resources accumulate. |
| 10 | `secrets.yaml` is gitignored; a placeholder template is committed. It holds the Postgres credentials and the RabbitMQ admin credentials. | Commit throwaway dev values directly; or generate the file from defaults at deploy time. | The next secret to arrive is Auth0's. Establishing the habit while the only secret is disposable costs one README step; retrofitting it after a real secret is in git history costs a rotation and a history rewrite. |
| 11 | RabbitMQ's management UI must be loaded and logged into as a verification step, using the credentials from `secrets.yaml`. | Treat a Running pod as sufficient. | It verifies three things at once: the plugin is enabled, the service is reachable, and the secret is genuinely wired through. |
| 12 | The frontend serves a minimal page naming the application and showing it is running. | Ship Vite's untouched starter page. | It is the visual counterpart of the other services' status JSON, makes a wrong-thing-served mistake obvious at a glance, and removes boilerplate that would otherwise be deleted later anyway. |
| 13 | README setup documentation is in scope. | Defer documentation to a separate task. | The gitignored secrets file makes a fresh clone non-obvious to boot. Without the README, R21 is unachievable and the task's stated value — anyone can boot this — does not exist. |
| 14 | No kubectl-context guard; documented as a README prerequisite instead. | Refuse to deploy unless the current context is Docker Desktop. | Explicitly declined. Low blast radius at this stage — six hello-world pods in a namespace that teardown removes. Flagged in Open Questions for the point where a shared cluster enters the picture. |

## Scope Boundaries

### In Scope

- `services/core-api/` — minimal .NET Core Web API with a root status response, and its Dockerfile.
- `services/receipt-service/` — minimal Python HTTP service with a root status response, and its Dockerfile.
- `services/ingestion-service/` — minimal .NET Core HTTP service with a root status response, and its Dockerfile.
- `frontend/` — Vite + React app serving a minimal identifying page, built and served via nginx in its Dockerfile.
- `k8s/namespace.yaml` — the `expense-tracker` namespace.
- `k8s/postgres.yaml` — Postgres 16 StatefulSet and PVC, no schema.
- `k8s/rabbitmq.yaml` — RabbitMQ Deployment and Service with the management UI enabled.
- `k8s/secrets.yaml` — Postgres and RabbitMQ credentials; gitignored, with a committed placeholder template.
- `k8s/` service manifests — Deployment and ClusterIP Service for each of the four application services.
- `Makefile` — `build`, `deploy`, `status`, `logs svc=<name>`, and a teardown target, with the two pre-deploy guards.
- `.gitignore` entry for the real secrets file.
- README section covering prerequisites, first-run setup, and the build/deploy/verify sequence.

### Out of Scope

- **Routing or communication between services** (reason: this task proves containers boot; inter-service calls belong to the tasks that need them).
- **Database schema, tables, and migrations** (reason: Postgres runs empty here; schema arrives with the first entity).
- **Any business logic** — no transactions, no receipts, no email ingestion, no dashboard (reason: Foundation Tasks 01–05 and the feature tickets).
- **Authentication and authorization** (reason: Auth0 integration is its own task; no endpoint here has anything to protect).
- **`ingress.yaml` / Traefik IngressRoute** (reason: Docker Desktop Kubernetes ships no ingress controller; port-forward is sufficient to verify boot — D2).
- **Liveness and readiness probes** (reason: nothing has meaningful health beyond process start — D3).
- **CI workflow (`.github/workflows/ci.yaml`)** (reason: nothing to test or publish yet — D2).
- **Automated tests of any kind, and the `tests/` directories** (reason: no behavior to assert — D2).
- **Container registry publication of application images** (reason: local-only by decision — D4; registry publication arrives with CI).
- **Production or Hetzner k3s deployment** (reason: this task targets Docker Desktop only; ADR-008's production topology is unchanged and unaddressed here — D1).
- **Vercel deployment of the frontend** (reason: same; ADR-008 production concern).
- **Postgres connectivity verification** (reason: nothing connects yet; becomes verifiable with the schema task).
- **kubectl context enforcement** (reason: declined; README prerequisite instead — D14).

## Open Questions

- **Does Postgres data need to survive a re-deploy?** Deliberately unanswered here (D8).
  - **Impact if unresolved:** none at this stage — there are no tables and no data.
  - **Suggested default:** decide it in the task that introduces the schema, where it can actually be tested. Until then, treat the teardown target as the supported way to reach a clean state.

- **Should `make deploy` guard against a non-Docker-Desktop kubectl context?** Declined for now (D14).
  - **Impact if unresolved:** a developer with a different current context deploys six hello-world pods into an unintended cluster. Recoverable via teardown, but noisy on a shared cluster.
  - **Suggested default:** README prerequisite for now; add the guard if and when this repo is ever pointed at a cluster shared with anyone else.

- **When do liveness and readiness probes arrive?** Out of scope here (D3).
  - **Impact if unresolved:** pods can report Running while the application inside is unhealthy — acceptable while each application does nothing but answer one static request.
  - **Suggested default:** introduce them in the first task where a service depends on Postgres or RabbitMQ, since that is the first point at which readiness means something distinct from started.

- **Where do the application images get published for production?** ADR-008 says GitHub Container Registry; this task deliberately does not touch it (D4).
  - **Impact if unresolved:** none locally; a gap between the local and production workflows remains unbridged.
  - **Suggested default:** address it in the CI task, which is where the push would live anyway.

---
_This requirements document is the input for the **plan-architecture** skill._
_Next step: `/plan-architecture from: specs/requirements/REQ-1-scaffold-monorepo.md`_
