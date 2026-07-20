#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd -- "$script_dir/.." && pwd)"
cd "$repository_root"
source "$script_dir/cloudflare-remote-approval.sh"

export CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false
export WRANGLER_LOG_PATH=".wrangler/wrangler.log"
export WRANGLER_SEND_METRICS=false
unset OPENAI_API_KEY OPENAI_API_KEY_JUDGE JUDGE_IP_HMAC_SECRET REGULATORY_WEBHOOK_SECRET

usage() {
  echo "Usage: $0 <preview|production> [--dry-run|--apply]"
}

target="${1:-}"
mode="${2:---dry-run}"
if [[ "$target" != "preview" && "$target" != "production" ]]; then
  usage
  exit 2
fi
if [[ "$mode" != "--dry-run" && "$mode" != "--apply" ]] || [[ "$#" -gt 2 ]]; then
  usage
  exit 2
fi
if [[ "$mode" == "--apply" ]]; then
  assert_cloudflare_remote_approval "$target"
fi
if [[ -z "${CLOUDFLARE_API_TOKEN:-}" || -z "${CLOUDFLARE_ACCOUNT_ID:-}" || -z "${CLOUDFLARE_D1_DATABASE_ID:-}" ]]; then
  echo "Missing required Cloudflare reconciliation input." >&2
  exit 4
fi

node "$script_dir/reconcile-judge-structured-ai.mjs" "$target" "$mode"
