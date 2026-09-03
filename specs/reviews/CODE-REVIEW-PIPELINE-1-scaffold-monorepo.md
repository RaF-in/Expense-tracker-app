# Review Report

## Metadata

| Field | Value |
|-------|-------|
| **Review Mode** | Pipeline: ARCH-1-scaffold-monorepo (Task T3) |
| **Target** | `specs/architecture/ARCH-1-scaffold-monorepo.md` → `specs/tasks/TASKS-1-scaffold-monorepo.md` (Task T3: Scaffold the frontend as a built SPA served by nginx) |
| **Date** | 2026-09-03 |
| **Tech Stack** | TypeScript 5.5, React 18.3, Vite 5.4, nginx (stable-alpine), Docker multi-stage build, Node 22-alpine |
| **Checks Run** | task-completion, code-quality, config-dependencies, typescript-strictness |
| **Checks Skipped** | test-coverage (no tests in task scope), security/database/express (no such surface), react-patterns/accessibility (single static component), performance/async-patterns/runtime-behavior (no logic), documentation/migration/requirement-coverage (infra scaffold, no public API/docs surface) |
| **Files Changed** | 8 (7 new `frontend/` files + 1 status-line update in TASKS doc) |
| **Lines Changed** | +105 / -1 |

## Review Process

- [x] Preflight checks passed
- [x] Diff gathered (8 files, 106 lines)
- [x] Tech stack detected: TypeScript, React, Vite, nginx, Docker
- [x] Context read (ARCH-1, TASKS-1 Task T3, REQ-1 R4/R5/R6; no CLAUDE.md present)
- [x] Triage proposed and developer confirmed
- [x] 4 checks dispatched: task-completion, code-quality, config-dependencies, typescript-strictness
- [x] Results collected and deduplicated
- [x] Report compiled
- [x] Verdict determined
- [x] Report saved to specs/reviews/

## Verdict: ⚠️ PASS WITH FINDINGS

Task T3 is functionally complete: the page identifies "Expense Tracker" with no Vite-starter leftovers, the Dockerfile is a correct multi-stage node→nginx build with no dev-server path, nginx's SPA fallback (`try_files ... /index.html`) is present for Task 01's router, and no scope boundaries (router/CSS framework/backend calls) were crossed. `npm run build` was independently run and verified to succeed by three of the four checks, and `tsc -b`'s lack of `composite`/`references` was confirmed empirically to be a non-issue. The one real gap is build-context hygiene: there's no `.dockerignore`, so a developer who has locally run `npm install` before `docker build` can have their host `node_modules` silently ride along and clobber the container's own install — flagged independently by all three technical checks. No lockfile is committed either, so `npm install` (not `npm ci`) re-resolves caret ranges on every build, which today pulls in two known (dev-only, no runtime exposure) CVEs. Neither issue blocks merge, but both are cheap to close before this Dockerfile becomes the copy-paste template for future services. The `ui`-mode checklist items requiring a live container/browser (screenshot evidence, DevTools network tab, `docker exec ps aux`) are correctly left for the developer per the task's verification mode.

### Finding Counts

| Category | 🔴 | 🟠 | 🟡 | 💭 | ⚠️ |
|----------|-----|-----|-----|-----|-----|
| Task Completion | 0 | 0 | 0 | 0 | 5 |
| Code Quality / Config & Dependencies (merged) | 0 | 1 | 2 | 2 | 0 |
| TypeScript Strictness | 0 | 0 | 0 | 0 | 0 |
| **Total** | **0** | **1** | **2** | **2** | **5** |

## Findings

### 🟠 High

**1. No `.dockerignore` in `frontend/` — host `node_modules` can clobber the container's build** (`frontend/Dockerfile:5-8`)
Flagged independently by task-completion, code-quality, and config-dependencies checks. The build stage runs `RUN npm install` (line 6) then `COPY . .` (line 8). If a developer has run `npm install` on the host beforehand (normal for editor/IDE support — reviewers themselves did this while verifying the build), the host-platform `node_modules/` — including platform-specific native binaries (esbuild, Rollup) — gets copied into the build context and overwrites the container's own Linux/musl-built install. This is the classic "clean checkout works, local build is broken" Docker+Node failure mode, and it undermines R5's "`make build` completes successfully" guarantee on a machine that isn't a fresh clone. The sibling `.NET` service Dockerfiles in this repo avoid the problem by copying only `src/` explicitly rather than `COPY . .` — `frontend/` is the only Dockerfile in the repo using a broad copy.
*Recommendation:* add `frontend/.dockerignore` with at least `node_modules`, `dist`, `.vite`, `.git`.

### 🟡 Medium

**2. No `package-lock.json` committed; Dockerfile uses `npm install` instead of `npm ci`** (`frontend/package.json`, `frontend/Dockerfile:6`)
Flagged by code-quality and config-dependencies. All five dependencies use caret ranges, so every `docker build` re-resolves the tree fresh — two builds on different days can legitimately produce different transitive dependency trees, undermining the reproducible-local-image goal ARCH implies for `:local`-tagged images. config-dependencies demonstrated this is live today: a fresh `npm install` against this exact `package.json` resolved `vite@5.4.21`, pulling in a chain with two known CVEs (see #3).
*Recommendation:* generate and commit `frontend/package-lock.json`; switch the Dockerfile to `COPY package.json package-lock.json ./` + `RUN npm ci`.

**3. Two known CVEs in the resolved dev-dependency tree (vite/esbuild)** (`frontend/package.json`)
`npm audit` against the resolved tree reports GHSA-fx2h-pf6j-xcff (vite `server.fs.deny` bypass, high, CVSS 7.5) and GHSA-67mh-4wv8-2f99 (esbuild dev-server CORS, moderate). No non-breaking fix exists in the 5.x line. **No production exposure** — the runtime image (Dockerfile stage 2) ships only nginx serving prebuilt static files; no `vite`/`node` process exists at runtime. Risk is limited to a contributor running `npm run dev` on an untrusted network.
*Recommendation:* no action required for this task; revisit when a non-major vite fix lands or Task 01 touches dependencies anyway.

### 💭 Low

**4. `*.tsbuildinfo` not covered by `.gitignore`** (`.gitignore`)
Flagged by typescript-strictness and code-quality, both of which reproduced it by actually running `npm run build`: `tsc -b` (invoked by `npm run build`) writes `frontend/tsconfig.tsbuildinfo` on every build, and `.gitignore`'s Node section (`node_modules/`, `dist/`, `.vite/`) doesn't cover it, so every contributor who runs the documented build command gets a stray untracked file.
*Recommendation:* add `*.tsbuildinfo` to `.gitignore`.

**5. No `engines` field pinning Node version in `package.json`**
The Dockerfile deliberately pins `node:22-alpine` (ARCH A3), but `package.json` doesn't declare a matching `engines.node`, so a contributor on a different Node major running `npm install`/`npm run dev` locally gets no warning of the mismatch.
*Recommendation:* optional — add `"engines": { "node": ">=22 <23" }`.

## Check Sections

### Task Completion

**REQs:** 3/3 (R4, R5, R6) statically consistent with the implementation; UI/browser evidence correctly deferred to the developer per `ui` verification mode.

| REQ | Status | Notes |
|-----|--------|-------|
| R4 (page identifies app, not Vite starter) | ⚠️ Manual (statically consistent) | `main.tsx` renders "Expense Tracker" / "Application is running.", no Vite/React logos, no counter demo |
| R5 (builds into a container image) | ✅ Verified (partially, statically) | Multi-stage Dockerfile correct; `npm run build` independently run and succeeded; containerized `docker build` itself not exercised in the review environment |
| R6 (served via nginx, not dev server) | ✅ Verified (statically) | `nginx.conf` serves `dist/`; no dev-server path in Dockerfile; runtime process check is Manual |

Scope boundaries respected: no router/Tailwind/shadcn/component library, no backend/API client, no auth/state management added. "Must NOT modify" paths (`services/`, `k8s/`, `Makefile`, `README.md`) untouched. ARCH decisions A3, A5, A6 all followed (Node 22-alpine, nginx stable-alpine, port 80, TypeScript, multi-stage build, committed SPA fallback).

**Observation (not a finding):** `frontend/tsconfig.json` isn't listed in ARCH's Change Footprint or T3's "Files Expected", though it's required for the mandated TypeScript stack and for `npm run build` to function — reads as a spec enumeration gap, not implementer scope drift.

### Manual Checks Required (per T3's `ui` verification mode — developer must confirm)

- [ ] `docker build -t expense-tracker/frontend:local frontend` exits 0 (build was verified via direct `npm run build`, not inside Docker)
- [ ] Screenshot: rendered page at `http://localhost:8081` names "Expense Tracker", no Vite starter content
- [ ] Screenshot: DevTools Network tab shows hashed `/assets/` files, no `/@vite/client`, no HMR websocket
- [ ] Screenshot: hard-refresh at a deep path (e.g. `/some/deep/path`) returns 200 and renders the same page
- [ ] `docker exec <container> ps aux` shows nginx master/worker only, no `node`/`vite` process

### Code Quality & Config/Dependencies

See Findings #1, #2, #4, #5 above. No naming, structure, or convention issues beyond those — the scaffold is appropriately minimal for an infrastructure task, and the deliberate absence of router/CSS framework/tests matches the task's Scope Boundaries rather than being a gap.

### TypeScript Strictness

✅ No findings. `strict: true` plus `noUnusedLocals`/`noUnusedParameters`/`noFallthroughCasesInSwitch` all enabled. The one apparent risk — `tsc -b` build mode used without `composite`/`references` — was verified empirically (`tsc -b --dry`, a real `tsc -b` run, and a full `npm run build`) to work correctly: `composite` is only required on a project referenced *by* another composite project, and this is a standalone project. The non-null assertion `document.getElementById("root")!` in `main.tsx` is justified — `index.html` (same commit) statically declares `<div id="root">`, and it's the standard Vite React-template idiom.

## Prioritized Action Items

### Must Fix (🔴 Critical / 🟠 High)
- [ ] Add `frontend/.dockerignore` (excluding `node_modules`, `dist`, `.vite`, `.git`) — Finding #1

### Should Address (🟡 Medium)
- [ ] Commit `frontend/package-lock.json` and switch Dockerfile to `npm ci` — Finding #2
- [ ] No action needed now for the vite/esbuild dev-only CVEs; revisit when a non-major fix lands — Finding #3

### Nice to Have (💭 Low)
- [ ] Add `*.tsbuildinfo` to `.gitignore` — Finding #4
- [ ] Add `engines.node` to `frontend/package.json` — Finding #5

---
*Generated by Review — 2026-09-03*
