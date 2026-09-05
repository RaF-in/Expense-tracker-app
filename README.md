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

Kubernetes needs credentials for Postgres and RabbitMQ. The real file that carries them,
`k8s/secrets.yaml`, is **gitignored on purpose** so credentials never end up in version control.
Before your first deploy, create it from the committed placeholder template:

```
cp k8s/secrets.yaml.template k8s/secrets.yaml
```

Then edit `k8s/secrets.yaml` and replace the placeholder `changeme` values for `POSTGRES_USER`,
`POSTGRES_PASSWORD`, `RABBITMQ_DEFAULT_USER`, and `RABBITMQ_DEFAULT_PASS` with values of your
choosing. Leave `POSTGRES_DB` as `expense_tracker` — it's a database name, not a credential.

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
if any application image is missing (run `make build` first) or if `k8s/secrets.yaml` doesn't
exist yet (see First-run setup above). It's also idempotent: running it again after a successful
deploy is safe and leaves the same pods running.

### Verify via the Ingress

With the `ingress-nginx` controller installed (see First-run setup above) and `make deploy` run,
the frontend and core-api are reachable through one origin, `http://localhost`, with no
port-forwarding required:

```
curl http://localhost/api/health
# {"status":"ok","timestamp":"...","version":"0.1.0"}
```

Open `http://localhost` in a browser — the Dashboard page should show "Connected to API ✓", and
the Expenses/Settings nav links should work without a full page reload.

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
