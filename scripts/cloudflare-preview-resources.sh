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

if [[ ! "${CLOUDFLARE_ACCOUNT_ID:-}" =~ ^[a-f0-9]{32}$ ]]; then
  echo "Refusing remote changes. Set the exact 32-character CLOUDFLARE_ACCOUNT_ID for the intended preview account." >&2
  exit 3
fi

expected_confirmation="counterpoint-preview:${CLOUDFLARE_ACCOUNT_ID}"
if [[ "${CLOUDFLARE_PREVIEW_MUTATION_APPROVED:-}" != "${expected_confirmation}" ]]; then
  echo "Refusing remote changes. Use the documented account-bound confirmation only at an approved deployment boundary." >&2
  exit 4
fi

resource_state_directory="$(mktemp -d)"
trap 'rm -rf "${resource_state_directory}"' EXIT

echo "Inspecting preview resources in the explicitly selected Cloudflare account."
npx wrangler d1 list --json > "${resource_state_directory}/d1.json"
if node -e 'const fs=require("node:fs");const rows=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.exit(rows.some(({name})=>name==="counterpoint-preview")?0:1)' "${resource_state_directory}/d1.json"; then
  echo "D1 database counterpoint-preview already exists; leaving it unchanged."
else
  echo "Creating D1 database counterpoint-preview. Save Wrangler's opaque ID without editing it."
  npx wrangler d1 create counterpoint-preview
fi

npx wrangler r2 bucket list --json > "${resource_state_directory}/r2.json"
if node -e 'const fs=require("node:fs");const rows=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.exit(rows.some(({name})=>name==="counterpoint-artifacts-preview")?0:1)' "${resource_state_directory}/r2.json"; then
  echo "R2 bucket counterpoint-artifacts-preview already exists; leaving it unchanged."
else
  echo "Creating R2 bucket counterpoint-artifacts-preview."
  npx wrangler r2 bucket create counterpoint-artifacts-preview
fi
echo "Resource creation finished. Do not deploy, migrate remotely, or add secrets until those actions are separately approved."
