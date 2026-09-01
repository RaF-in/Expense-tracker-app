#!/usr/bin/env bash
# .worktree-setup.sh — prepare a fresh worktree of this monorepo.
#
# Invoked by the create-git-worktree skill (Step 9a) from the worktree root.
# Keep it idempotent: it may be run more than once on the same worktree.
set -euo pipefail

echo "Preparing worktree: $(pwd)"

# --- .NET services -----------------------------------------------------------
dotnet restore services/core-api/core-api.csproj
dotnet restore services/ingestion-service/ingestion-service.csproj

# --- Python receipt-service (uncomment when the service lands) ---------------
# (cd services/receipt-service && pip install -r requirements.txt)

# --- React frontend (uncomment when the frontend lands) ----------------------
# (cd frontend && npm ci)

echo "Worktree setup complete."
