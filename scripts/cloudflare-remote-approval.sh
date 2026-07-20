#!/usr/bin/env bash

assert_cloudflare_remote_approval() {
  local target="$1"
  if [[ "${CLOUDFLARE_DEPLOYMENT_APPROVED:-}" != "$target" ]]; then
    echo "Refusing remote Cloudflare mutation without target-specific approval." >&2
    return 3
  fi
  if [[ "$target" == "production" && "${CLOUDFLARE_PRODUCTION_CONFIRMATION:-}" != "counterpoint-production" ]]; then
    echo "Refusing production mutation without the exact production confirmation." >&2
    return 3
  fi
  if [[ -n "$(git status --porcelain)" ]]; then
    echo "Refusing remote Cloudflare mutation from a dirty worktree." >&2
    return 5
  fi
  local commit_sha
  commit_sha="$(git rev-parse HEAD)"
  if [[ -n "${GITHUB_SHA:-}" && "$GITHUB_SHA" != "$commit_sha" ]]; then
    echo "Refusing remote Cloudflare mutation because GITHUB_SHA does not match HEAD." >&2
    return 5
  fi
}
