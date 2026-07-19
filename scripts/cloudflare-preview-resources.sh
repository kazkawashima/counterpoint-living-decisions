#!/usr/bin/env bash
set -euo pipefail

export CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false
export WRANGLER_LOG_PATH=".wrangler/wrangler.log"
export WRANGLER_SEND_METRICS=false

usage() {
  echo "Usage: $0 --plan | --apply"
}

if [[ "${1:-}" == "--plan" ]]; then
  echo "Preview resource plan (no remote changes):"
  echo "1. D1 database: counterpoint-preview"
  echo "2. R2 bucket: counterpoint-artifacts-preview"
  echo "3. Durable Object namespace: provisioned by the first approved deploy"
  echo "4. Worker Secret: deferred to Plan 05 C3; never written by this script"
  exit 0
fi

if [[ "${1:-}" != "--apply" ]]; then
  usage
  exit 2
fi

if [[ "${CLOUDFLARE_PREVIEW_MUTATION_APPROVED:-}" != "yes" ]]; then
  echo "Refusing remote changes. Set CLOUDFLARE_PREVIEW_MUTATION_APPROVED=yes only at an approved deployment boundary." >&2
  exit 3
fi

echo "Creating preview resources. Save Wrangler's opaque D1 ID without editing it."
npx wrangler d1 create counterpoint-preview
npx wrangler r2 bucket create counterpoint-artifacts-preview
echo "Resource creation finished. Do not deploy, migrate remotely, or add secrets until those actions are separately approved."
