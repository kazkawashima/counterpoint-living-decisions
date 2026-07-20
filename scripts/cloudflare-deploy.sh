#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/cloudflare-remote-approval.sh"

export CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false
export WRANGLER_LOG_PATH=".wrangler/wrangler.log"
export WRANGLER_SEND_METRICS=false
unset OPENAI_API_KEY OPENAI_API_KEY_JUDGE JUDGE_IP_HMAC_SECRET REGULATORY_WEBHOOK_SECRET

usage() {
  echo "Usage: $0 --plan <preview|production> | --apply <preview|production>"
}

mode="${1:-}"
target="${2:-}"
if [[ "$target" != "preview" && "$target" != "production" ]]; then
  usage
  exit 2
fi

worker_name_default="counterpoint-living-decisions-$target"
bucket_name_default="counterpoint-artifacts-$target"

if [[ "$mode" == "--plan" ]]; then
  echo "Cloudflare $target deployment plan (no remote changes):"
  echo "1. Require a clean, verified main commit and approved GitHub Environment."
  echo "2. Render an ignored 0600 Wrangler config from exact remote resource IDs."
  echo "3. Build, scan, run security tests, and perform a target-config dry run."
  echo "4. Apply forward-only D1 migrations remotely; Wrangler captures a backup."
  echo "5. Deploy with --strict, then run health/readiness/SPA/authentication smoke."
  echo "6. Save content hashes, commit, Worker name, and deployment status locally."
  echo "Judge secret registration is a separate C4 operation and is not performed."
  exit 0
fi

if [[ "$mode" != "--apply" ]]; then
  usage
  exit 2
fi

assert_cloudflare_remote_approval "$target"
for name in \
  CLOUDFLARE_API_TOKEN \
  CLOUDFLARE_ACCOUNT_ID \
  CLOUDFLARE_D1_DATABASE_ID \
  CLOUDFLARE_DEPLOY_URL
do
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required deployment input: $name" >&2
    exit 4
  fi
done

worker_name="${CLOUDFLARE_WORKER_NAME:-$worker_name_default}"
bucket_name="${CLOUDFLARE_R2_BUCKET_NAME:-$bucket_name_default}"
config_path=".wrangler/deploy/$target.wrangler.json"
dry_run_path=".wrangler/deploy/$target-dry-run"
status_path=".wrangler/deploy/$target-deployment-status.json"
private_log=".wrangler/deploy/$target-private-command.log"
commit_sha="$(git rev-parse HEAD)"

mkdir -p ".wrangler/deploy"
: >"$private_log"

run_private() {
  local phase="$1"
  shift
  echo "Running private phase: $phase"
  if ! "$@" >>"$private_log" 2>&1; then
    echo "Private phase failed: $phase. Raw output remains only in ignored runner state." >&2
    return 1
  fi
}

node scripts/cloudflare-remote-smoke.mjs \
  --validate-only \
  "$CLOUDFLARE_DEPLOY_URL"
npm run security:verify
CLOUDFLARE_R2_BUCKET_NAME="$bucket_name" \
  CLOUDFLARE_WORKER_NAME="$worker_name" \
  node scripts/render-cloudflare-deploy-config.mjs "$target" "$config_path"
run_private "target configuration dry run" npx wrangler deploy \
  --config "$config_path" \
  --dry-run \
  --outdir "$dry_run_path" \
  --strict
run_private "forward D1 migrations" npx wrangler d1 migrations apply DB \
  --config "$config_path" \
  --remote
run_private "strict Worker deploy" npx wrangler deploy \
  --config "$config_path" \
  --message "Approved $target deployment $commit_sha" \
  --strict \
  --tag "$commit_sha"
node scripts/cloudflare-remote-smoke.mjs "$CLOUDFLARE_DEPLOY_URL"
node scripts/cloudflare-flagship-smoke.mjs "$CLOUDFLARE_DEPLOY_URL"
echo "Recording private deployment status."
if ! npx wrangler deployments status \
  --config "$config_path" \
  --json >"$status_path" 2>>"$private_log"
then
  echo "Deployment status capture failed. Raw output remains only in ignored runner state." >&2
  exit 6
fi
node scripts/record-cloudflare-deployment.mjs \
  "." \
  "$target" \
  "$config_path" \
  "$status_path" \
  "$CLOUDFLARE_DEPLOY_URL" \
  "$worker_name"

echo "Cloudflare $target deployment completed for commit $commit_sha."
