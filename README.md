# Expense Tracker App

A monorepo scaffold: two .NET Minimal APIs (`core-api`, `ingestion-service`), a FastAPI service
(`receipt-service`), and a Vite+React frontend served by nginx, deployed as plain Kubernetes
manifests alongside Postgres and RabbitMQ, all in one `expense-tracker` namespace on a local
Docker Desktop Kubernetes cluster.

## Prerequisites

- **Docker Desktop**, with **Kubernetes enabled** and its context **selected** as your current
  `kubectl` context (`kubectl config current-context` should print `docker-desktop`)
- `kubectl`
- `make`

No .NET, Python, or Node SDK is needed on the host — every service builds entirely inside Docker
via a multi-stage Dockerfile.

## First-run setup

Kubernetes needs credentials for Postgres and RabbitMQ, plus Auth0 tenant values for login. The
real file that carries them, `k8s/secrets.yaml`, is **gitignored on purpose** so credentials and
environment-specific values never end up in version control. Before your first deploy, create it
from the committed placeholder template:

```
cp k8s/secrets.yaml.template k8s/secrets.yaml
```

Then edit `k8s/secrets.yaml` and replace the placeholder `changeme` values for `POSTGRES_USER`,
`POSTGRES_PASSWORD`, `RABBITMQ_DEFAULT_USER`, and `RABBITMQ_DEFAULT_PASS` with values of your
choosing. Leave `POSTGRES_DB` as `expense_tracker` — it's a database name, not a credential.

The same file also needs three Auth0 keys: `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, and `AUTH0_AUDIENCE`.
They come from an Auth0 tenant — follow [`docs/auth0-setup-runbook.md`](docs/auth0-setup-runbook.md)
to create or look up the values (domain and clientId from the SPA application, audience from the
API identifier). These three are public by design; they live in the Secret so environment-specific
values stay out of git. **A pre-existing `k8s/secrets.yaml` will not gain these keys by pulling** —
add them by hand, or `make deploy` refuses to run (see below) and, if bypassed, both pods
crash-loop naming the missing setting.

For frontend development outside the cluster (`npm run dev`), the same values are needed at
runtime, delivered the same template-plus-gitignored-file way:

```
cp frontend/config.js.template frontend/public/config.js
```

Then fill in the same three `AUTH0_*` values in `frontend/public/config.js`.

The cluster also needs an ingress controller to route browser traffic at `http://localhost` to
the frontend and core-api Services. This is a one-time, manual install of `ingress-nginx` — it's
cluster infrastructure, not an application image, so it isn't part of `make deploy`:

```
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.11.3/deploy/static/provider/cloud/deploy.yaml
```

Wait for the controller pod to be ready before deploying:

```
kubectl wait --namespace ingress-nginx \
  --for=condition=ready pod \
  --selector=app.kubernetes.io/component=controller \
  --timeout=120s
```

## Build, deploy, verify

```
make build     # builds all 4 application images
make deploy    # applies manifests; guards check images and secrets.yaml first
make status    # shows pod/service/PVC status
```

`make deploy` is guarded: it refuses to run — with an actionable message and no cluster changes —
if any application image is missing (run `make build` first), if `k8s/secrets.yaml` doesn't
exist yet, or if it's missing any required Secret key — including the three `AUTH0_*` keys from
First-run setup above. It's also idempotent: running it again after a successful deploy is safe
and leaves the same pods running.

### Verify via the Ingress

With the `ingress-nginx` controller installed (see First-run setup above) and `make deploy` run,
the frontend and core-api are reachable through one origin, `http://localhost`, with no
port-forwarding required:

```
curl http://localhost/api/health
# {"status":"ok","timestamp":"...","version":"0.1.0"}
```

Open `http://localhost` in a browser — **the app now requires sign-in**: you are redirected to the
Auth0 login page first. Sign in (email/password or Google — see the runbook for the test user),
and you land on the Dashboard, which should show "Connected to API ✓"; the Expenses/Settings nav
links should work without a full page reload, and the top-right shows your initials avatar with a
Log out button. Every page redirects to Auth0 until you've signed in — that's the route
protection working, not a broken deploy.

### Verify each service

Port-forwarding each Service directly (bypassing the Ingress) still works and remains useful for
debugging one service in isolation:

```
kubectl port-forward svc/core-api 8080:80 -n expense-tracker &
curl localhost:8080/
# {"service":"core-api","status":"running"}

kubectl port-forward svc/receipt-service 8000:80 -n expense-tracker &
curl localhost:8000/
# {"service":"receipt-service","status":"running"}

kubectl port-forward svc/ingestion-service 8081:80 -n expense-tracker &
curl localhost:8081/
# {"service":"ingestion-service","status":"running"}
```

For the frontend, port-forward and open it in a browser:

```
kubectl port-forward svc/frontend 8082:80 -n expense-tracker &
```

Then visit `http://localhost:8082` — the page should name **Expense Tracker** and show it's
running.

For RabbitMQ, port-forward the management UI and log in with the `RABBITMQ_DEFAULT_USER` /
`RABBITMQ_DEFAULT_PASS` values from your `k8s/secrets.yaml`:

```
kubectl port-forward svc/rabbitmq 15672:15672 -n expense-tracker &
```

Then visit `http://localhost:15672` and confirm the management overview loads after login.

`kubectl get` and `kubectl port-forward` are read/verify commands only — the Makefile is the
sole write path into the cluster; nothing here `kubectl apply`s or `kubectl delete`s on your
behalf outside of `make deploy` / `make teardown`.

## How local images work

Application images are never pushed to or pulled from a registry — they're built locally and
referenced by an unqualified `expense-tracker/<service>:local` tag with an explicit
`imagePullPolicy: IfNotPresent`. Docker Desktop's Kubernetes shares the same local image store as
the Docker Desktop daemon, so the unqualified name normalizes to `docker.io/expense-tracker/…`
and resolves against that shared store without ever hitting the network. **Do not "fix" this by
adding a registry prefix** — that would break the local-only guarantee and cause Kubernetes to
try to pull from a registry that doesn't have these images.

## Rollout after a configuration change

Landing the Auth0 integration is a **breaking change for every existing checkout**: the order
that works is

1. update `k8s/secrets.yaml` (add `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_AUDIENCE` — see
   First-run setup above),
2. `make build`,
3. `make deploy`,
4. `make restart`.

Skipping step 1 crash-loops both the core-api and frontend pods **loudly and by design** —
each exits at startup naming the missing setting rather than serving a broken app (`make deploy`'s
key guard usually catches it even earlier, with a message naming the missing key; the crash-loop
is the backstop, not a bug). For a later change to an existing value (e.g. rotating an Auth0
setting), steps 3–4 alone are enough: a Secret change needs a pod restart, never an image
rebuild, because the frontend renders its `config.js` from the pod environment at container
start.

## Refreshing a rebuilt image

Because the image tag never changes (`:local`) and the pod template never changes, Kubernetes
won't automatically pick up a rebuilt image — `make deploy` alone looks like a no-op. After
`make build` produces a new image, restart the affected deployment to pick it up:

```
kubectl rollout restart deployment/<name> -n expense-tracker
```

This is a provisional workaround; a dedicated `make restart` target may replace it once there's
a real edit-and-reload development loop to support.

## Operator reference

| Command | What it does |
|---|---|
| `make build` | Builds all 4 application images as `expense-tracker/<service>:local` |
| `make deploy` | Guards (images present, `k8s/secrets.yaml` present), then applies the manifests |
| `make status` | Shows `kubectl get all,pvc -n expense-tracker` |
| `make logs svc=<name>` | Streams logs for one of: `core-api`, `receipt-service`, `ingestion-service`, `frontend`, `postgres`, `rabbitmq` |
| `make teardown` | Deletes the `expense-tracker` namespace (and its PVC) for a full reset; safe to run on an already-clean cluster |

## Local development only

Everything in this repo describes the **local development environment** only — Postgres,
RabbitMQ, and all four application services running on a single-developer Docker Desktop
Kubernetes cluster with no ingress and no external exposure. It does not document or configure
any production deployment target.
