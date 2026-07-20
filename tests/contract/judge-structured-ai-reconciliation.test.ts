import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  parseReconciliationArguments,
  reconciliationSummary,
  runReconciliationCommand,
} from "../../scripts/reconcile-judge-structured-ai.mjs";
import {
  buildAbandonExpiredReservedStatement,
  buildAbandonReservedStatement,
  buildFinalizeFullReservationStatement,
  buildListStaleStatement,
  buildMarkSettledStatement,
  buildReleaseReservedStatement,
} from "../../packages/adapters-cloudflare/src/judge-structured-ai-reconciliation.js";

const shellUrl = new URL(
  "../../scripts/reconcile-judge-structured-ai.sh",
  import.meta.url,
);
const approvalUrl = new URL(
  "../../scripts/cloudflare-remote-approval.sh",
  import.meta.url,
);
const deployUrl = new URL(
  "../../scripts/cloudflare-deploy.sh",
  import.meta.url,
);
const packageUrl = new URL("../../package.json", import.meta.url);

describe("judge structured-AI reconciliation command", () => {
  it("accepts only a target and dry-run/apply mode, defaulting to dry-run", () => {
    expect(parseReconciliationArguments(["preview"])).toEqual({
      mode: "dry-run",
      target: "preview",
    });
    expect(parseReconciliationArguments(["production", "--apply"])).toEqual({
      mode: "apply",
      target: "production",
    });
    expect(() => parseReconciliationArguments(["staging"])).toThrow();
    expect(() =>
      parseReconciliationArguments(["preview", "--apply", "extra"]),
    ).toThrow();
  });

  it("prints only content-free reconciliation counts", () => {
    expect(
      reconciliationSummary({
        attempted: 3,
        failed: 1,
        released: 1,
        settled: 1,
      }),
    ).toBe(
      "Judge structured-AI reconciliation: attempted=3 settled=1 released=1 failed=1",
    );
  });

  it("shares bounded statements between Worker and operator execution", () => {
    const select = buildListStaleStatement({ limit: 20, nowEpoch: 200 });
    expect(select.sql).toContain("LIMIT ?");
    expect(select.bindings).toEqual([200, 20]);
    expect(select.sql).not.toMatch(/source|prompt|output|secret/iu);

    const identity = {
      claimKeyHash: `sha256:${"a".repeat(64)}`,
      createdAtEpoch: 100,
      requestFingerprint: `sha256:${"b".repeat(64)}`,
      reservationId: "judge-ai:reservation",
    };
    expect(buildAbandonReservedStatement(identity).sql).toContain(
      "status = 'reserved'",
    );
    expect(buildAbandonExpiredReservedStatement(identity, 200).sql).toContain(
      "lease_expires_at_epoch < ?",
    );
    expect(buildReleaseReservedStatement(identity, 200).sql).toContain(
      "status = 'reserved'",
    );
    expect(
      buildFinalizeFullReservationStatement(identity.reservationId, 200).sql,
    ).toContain("status = 'reserved'");
    expect(
      buildMarkSettledStatement({
        ...identity,
        expectedStatus: "provider_started",
        reuseAfterEpoch: 90_200,
        settledAtEpoch: 200,
      }).sql,
    ).toContain("status = ?");
  });

  it("uses one approval helper for deploy and reconcile apply without judge secrets", async () => {
    const [shell, approval, deploy, packageSource] = await Promise.all([
      readFile(shellUrl, "utf8"),
      readFile(approvalUrl, "utf8"),
      readFile(deployUrl, "utf8"),
      readFile(packageUrl, "utf8"),
    ]);

    expect(shell).toContain(
      'source "$script_dir/cloudflare-remote-approval.sh"',
    );
    expect(deploy).toContain(
      'source "$script_dir/cloudflare-remote-approval.sh"',
    );
    expect(approval).toContain("CLOUDFLARE_DEPLOYMENT_APPROVED");
    expect(approval).toContain("CLOUDFLARE_PRODUCTION_CONFIRMATION");
    expect(approval).toContain("git status --porcelain");
    expect(approval).toContain("GITHUB_SHA");
    expect(shell).toContain("unset OPENAI_API_KEY OPENAI_API_KEY_JUDGE");
    expect(shell).toContain("JUDGE_IP_HMAC_SECRET");
    expect(shell).not.toContain("wrangler secret");
    expect(packageSource).toContain(
      "npm run build --workspace @counterpoint/adapters-cloudflare",
    );
  });

  it("keeps dry-run SELECT-only and apply generation/status conditional", async () => {
    const shell = await readFile(shellUrl, "utf8");
    expect(shell).toContain("--dry-run");
    expect(shell).toContain("--apply");
    expect(shell).toContain("assert_cloudflare_remote_approval");
    expect(shell).toContain(
      'node "$script_dir/reconcile-judge-structured-ai.mjs"',
    );
    expect(shell).not.toContain("OPENAI_API_KEY_JUDGE=");
  });

  it("executes only the stale SELECT during dry-run", async () => {
    const sql: string[] = [];
    const result = await runReconciliationCommand({
      configPath: ".wrangler/reconcile/preview.wrangler.json",
      execute: (_configPath: string, statement: string) => {
        sql.push(statement);
        return JSON.stringify([{ meta: { changes: 0 }, results: [] }]);
      },
      mode: "dry-run",
    });

    expect(result).toEqual({
      attempted: 0,
      failed: 0,
      released: 0,
      settled: 0,
    });
    expect(sql).toHaveLength(1);
    expect(sql[0]).toContain("SELECT");
    expect(sql[0]).not.toMatch(/\b(?:DELETE|INSERT|UPDATE)\b/u);
  });

  it("full-finalizes provider-started work without issuing release SQL", async () => {
    const sql: string[] = [];
    const row = {
      claim_key_hash: `sha256:${"a".repeat(64)}`,
      created_at_epoch: 100,
      lease_expires_at_epoch: 150,
      model: "gpt-5.6",
      operation: "private_disclosure",
      pricing_version: "pricing-v1",
      request_fingerprint: `sha256:${"b".repeat(64)}`,
      reservation_id: "judge-ai:reservation",
      status: "provider_started",
      usage_model: "gpt-5.6",
      usage_operation: "private_disclosure",
      usage_pricing_version: "pricing-v1",
      usage_request_fingerprint: `sha256:${"b".repeat(64)}`,
      usage_status: "reserved",
    };
    const result = await runReconciliationCommand({
      configPath: ".wrangler/reconcile/preview.wrangler.json",
      execute: (_configPath: string, statement: string) => {
        sql.push(statement);
        return sql.length === 1
          ? JSON.stringify([{ meta: { changes: 0 }, results: [row] }])
          : JSON.stringify([{ meta: { changes: 2 }, results: [] }]);
      },
      mode: "apply",
    });

    expect(result).toEqual({
      attempted: 1,
      failed: 0,
      released: 0,
      settled: 1,
    });
    expect(sql[1]).toContain("actual_cost_micro_usd = reserved_cost_micro_usd");
    expect(sql[1]).toContain("status = 'settled'");
    expect(sql[1]).not.toContain("status = 'released'");
  });
});
