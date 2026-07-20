import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { writeCloudflareDeployConfiguration } from "./render-cloudflare-deploy-config.mjs";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const TARGETS = new Set(["preview", "production"]);
const MODES = new Set(["--dry-run", "--apply"]);

export function parseReconciliationArguments(args) {
  if (args.length < 1 || args.length > 2 || !TARGETS.has(args[0])) {
    throw new TypeError(
      "Usage: reconcile-judge-structured-ai.mjs <preview|production> [--dry-run|--apply]",
    );
  }
  const rawMode = args[1] ?? "--dry-run";
  if (!MODES.has(rawMode)) {
    throw new TypeError("Mode must be --dry-run or --apply");
  }
  return {
    mode: rawMode.slice(2),
    target: args[0],
  };
}

export function reconciliationSummary(counts) {
  return `Judge structured-AI reconciliation: attempted=${counts.attempted} settled=${counts.settled} released=${counts.released} failed=${counts.failed}`;
}

function sqlLiteral(value) {
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return String(value);
  }
  if (typeof value === "string") {
    return `'${value.replaceAll("'", "''")}'`;
  }
  throw new TypeError("Unsupported reconciliation SQL binding");
}

export function renderReconciliationSql(statement) {
  let bindingIndex = 0;
  const sql = statement.sql.replaceAll("?", () => {
    const value = statement.bindings[bindingIndex];
    bindingIndex += 1;
    return sqlLiteral(value);
  });
  if (bindingIndex !== statement.bindings.length) {
    throw new Error("Reconciliation SQL binding count mismatch");
  }
  return sql.trim();
}

function wranglerExecute(configPath, sql) {
  const {
    JUDGE_IP_HMAC_SECRET: _judgeIpHmacSecret,
    OPENAI_API_KEY: _openAiApiKey,
    OPENAI_API_KEY_JUDGE: _openAiApiKeyJudge,
    REGULATORY_WEBHOOK_SECRET: _regulatoryWebhookSecret,
    ...safeEnvironment
  } = process.env;
  void _judgeIpHmacSecret;
  void _openAiApiKey;
  void _openAiApiKeyJudge;
  void _regulatoryWebhookSecret;
  const result = spawnSync(
    "npx",
    [
      "wrangler",
      "d1",
      "execute",
      "DB",
      "--remote",
      "--config",
      configPath,
      "--json",
      "--command",
      sql,
    ],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: {
        ...safeEnvironment,
        CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false",
        WRANGLER_LOG_PATH: ".wrangler/wrangler.log",
        WRANGLER_SEND_METRICS: "false",
      },
    },
  );
  if (result.status !== 0) {
    throw new Error("Remote D1 reconciliation statement failed");
  }
  return result.stdout;
}

function queryRows(output) {
  const parsed = JSON.parse(output);
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  const rows = entries.flatMap((entry) =>
    Array.isArray(entry?.results) ? entry.results : [],
  );
  return rows;
}

function changes(output) {
  const parsed = JSON.parse(output);
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  return entries.reduce(
    (total, entry) =>
      total +
      (Number.isSafeInteger(entry?.meta?.changes) ? entry.meta.changes : 0),
    0,
  );
}

function rowIdentity(row) {
  return {
    claimKeyHash: row.claim_key_hash,
    createdAtEpoch: row.created_at_epoch,
    requestFingerprint: row.request_fingerprint,
    reservationId: row.reservation_id,
  };
}

function assertUsageIdentity(row) {
  if (
    row.usage_status !== null &&
    (row.usage_request_fingerprint !== row.request_fingerprint ||
      row.usage_operation !== row.operation ||
      row.usage_model !== row.model ||
      row.usage_pricing_version !== row.pricing_version)
  ) {
    throw new Error("Stale claim usage identity mismatch");
  }
}

export async function runReconciliationCommand(input) {
  const {
    buildAbandonExpiredReservedStatement,
    buildFinalizeFullReservationStatement,
    buildListStaleStatement,
    buildMarkSettledStatement,
    buildReleaseReservedStatement,
  } =
    await import("../packages/adapters-cloudflare/dist/judge-structured-ai-reconciliation.js");
  const nowEpoch = Math.floor(Date.now() / 1_000);
  const select = buildListStaleStatement({ limit: 20, nowEpoch });
  const selected = queryRows(
    input.execute(input.configPath, renderReconciliationSql(select)),
  );
  if (input.mode === "dry-run") {
    return {
      attempted: selected.length,
      failed: 0,
      released: 0,
      settled: 0,
    };
  }

  const counts = {
    attempted: selected.length,
    failed: 0,
    released: 0,
    settled: 0,
  };
  for (const row of selected) {
    try {
      assertUsageIdentity(row);
      const identity = rowIdentity(row);
      if (row.status === "reserved") {
        if (row.usage_status === "finalized") {
          const settled = buildMarkSettledStatement({
            ...identity,
            expectedStatus: "reserved",
            reuseAfterEpoch: nowEpoch + 25 * 60 * 60,
            settledAtEpoch: nowEpoch,
          });
          if (
            changes(
              input.execute(input.configPath, renderReconciliationSql(settled)),
            ) !== 1
          ) {
            throw new Error("Reserved settlement lost its generation");
          }
          counts.settled += 1;
          continue;
        }
        const abandon = buildAbandonExpiredReservedStatement(
          identity,
          nowEpoch,
        );
        const statements = [];
        if (row.usage_status === "reserved") {
          statements.push(
            renderReconciliationSql(
              buildReleaseReservedStatement(identity, nowEpoch),
            ),
          );
        }
        statements.push(renderReconciliationSql(abandon));
        const expectedChanges = row.usage_status === "reserved" ? 3 : 2;
        if (
          changes(input.execute(input.configPath, statements.join(";\n"))) !==
          expectedChanges
        ) {
          throw new Error("Reserved release lost its exact generation");
        }
        counts.released += 1;
        continue;
      }
      if (row.status !== "provider_started") {
        throw new Error("Unexpected stale lifecycle status");
      }
      const statements = [];
      if (row.usage_status === "reserved") {
        statements.push(
          renderReconciliationSql(
            buildFinalizeFullReservationStatement(row.reservation_id, nowEpoch),
          ),
        );
      } else if (row.usage_status !== "finalized") {
        throw new Error("Provider-started usage is unavailable");
      }
      statements.push(
        renderReconciliationSql(
          buildMarkSettledStatement({
            ...identity,
            expectedStatus: "provider_started",
            reuseAfterEpoch: nowEpoch + 25 * 60 * 60,
            settledAtEpoch: nowEpoch,
          }),
        ),
      );
      const expectedChanges = row.usage_status === "reserved" ? 2 : 1;
      if (
        changes(input.execute(input.configPath, statements.join(";\n"))) !==
        expectedChanges
      ) {
        throw new Error("Provider settlement lost its exact generation");
      }
      counts.settled += 1;
    } catch {
      counts.failed += 1;
    }
  }
  return counts;
}

async function main() {
  const parsed = parseReconciliationArguments(process.argv.slice(2));
  const configPath = `.wrangler/reconcile/${parsed.target}.wrangler.json`;
  await writeCloudflareDeployConfiguration({
    databaseId: process.env.CLOUDFLARE_D1_DATABASE_ID,
    outputPath: configPath,
    r2BucketName: process.env.CLOUDFLARE_R2_BUCKET_NAME,
    root: repositoryRoot,
    target: parsed.target,
    workerName: process.env.CLOUDFLARE_WORKER_NAME,
  });
  const result = await runReconciliationCommand({
    configPath,
    execute: wranglerExecute,
    mode: parsed.mode,
  });
  console.log(reconciliationSummary(result));
  if (result.failed > 0) {
    process.exitCode = 1;
  }
}

const invokedAsScript =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedAsScript) {
  await main();
}
