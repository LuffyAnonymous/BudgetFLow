#!/bin/bash
# Starts n8n locally with the env vars its workflows need, read from the
# project's .env (N8N_BUDGETFLOW_* keys — see .env for why they're prefixed).
#
# Usage: ./n8n/start-n8n-dev.sh
# Stop with: pkill -f "n8n start"

set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "No .env found in $(pwd) — run this from the budgetflow repo." >&2
  exit 1
fi

# shellcheck disable=SC1091
source <(grep -E '^(N8N_BUDGETFLOW_BASE_URL|N8N_BUDGETFLOW_SERVICE_API_KEY|CRON_SECRET|IMPORT_CLEANUP_SECRET)=' .env)

if [ -z "${N8N_BUDGETFLOW_SERVICE_API_KEY:-}" ]; then
  echo "N8N_BUDGETFLOW_SERVICE_API_KEY is not set in .env — generate one via" >&2
  echo "POST /api/settings/service-api-key while signed in, then add it." >&2
  exit 1
fi

echo "Starting n8n with BUDGETFLOW_BASE_URL=$N8N_BUDGETFLOW_BASE_URL ..."

env BUDGETFLOW_BASE_URL="$N8N_BUDGETFLOW_BASE_URL" \
    BUDGETFLOW_SERVICE_API_KEY="$N8N_BUDGETFLOW_SERVICE_API_KEY" \
    CRON_SECRET="$CRON_SECRET" \
    IMPORT_CLEANUP_SECRET="$IMPORT_CLEANUP_SECRET" \
    N8N_BLOCK_ENV_ACCESS_IN_NODE="false" \
    n8n start
