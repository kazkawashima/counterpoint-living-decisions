#!/usr/bin/env bash
set -euo pipefail

readonly judge_user_id="${CLOUDFLARE_JUDGE_USER_ID:-judge}"
if [[ ! "${judge_user_id}" =~ ^[a-z][a-z0-9-]{2,31}$ ]]; then
  echo "Invalid CLOUDFLARE_JUDGE_USER_ID; use lowercase letters, digits, and hyphens." >&2
  exit 2
fi

read -r -s -p "Enter private password for ${judge_user_id}: " judge_password
printf '\n'
if [[ "${#judge_password}" -lt 16 ]]; then
  echo "Judge password must contain at least 16 characters." >&2
  unset judge_password
  exit 2
fi

password_hash="$(JUDGE_PASSWORD="${judge_password}" node --input-type=module <<'NODE'
import { randomBytes, scryptSync } from "node:crypto";

const password = process.env.JUDGE_PASSWORD;
if (password === undefined || password.length === 0) {
  throw new Error("JUDGE_PASSWORD is required");
}
const salt = randomBytes(16);
const derivedKey = scryptSync(password, salt, 32, {
  N: 16_384,
  p: 1,
  r: 8,
  maxmem: 64 * 1024 * 1024,
});
console.log(
  [
    "scrypt",
    "v1",
    "16384",
    "8",
    "1",
    salt.toString("base64url"),
    derivedKey.toString("base64url"),
  ].join("$"),
);
NODE
)"
unset judge_password

sql_file="$(mktemp "${TMPDIR:-/tmp}/counterpoint-judge.XXXXXX.sql")"
cleanup() {
  rm -f -- "${sql_file}"
}
trap cleanup EXIT

{
  printf "INSERT INTO users (user_id, password_hash, active) VALUES ('%s', '%s', 1) ON CONFLICT(user_id) DO UPDATE SET password_hash = excluded.password_hash, active = 1;\n" "${judge_user_id}" "${password_hash}"
  printf "INSERT OR IGNORE INTO participant_assignments (meeting_id, participant_id, user_id, role, active) VALUES ('meeting-global-ai-rollout', 'participant-%s', '%s', 'facilitator', 1);\n" "${judge_user_id}" "${judge_user_id}"
} >"${sql_file}"
chmod 600 "${sql_file}"

export CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false
npx wrangler d1 execute counterpoint-production --remote --file "${sql_file}"
echo "Provisioned private production judge account: ${judge_user_id}"
