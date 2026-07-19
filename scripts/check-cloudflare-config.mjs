import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import ts from "typescript";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

function expectCondition(condition, message, violations) {
  if (!condition) {
    violations.push(message);
  }
}

export function validateCloudflareConfiguration(config, packageJson) {
  const violations = [];
  const d1 = config.d1_databases?.find(({ binding }) => binding === "DB");
  const r2 = config.r2_buckets?.find(({ binding }) => binding === "ARTIFACTS");
  const meetingBinding = config.durable_objects?.bindings?.find(
    ({ name }) => name === "MEETINGS",
  );
  const firstMigration = config.migrations?.[0];

  expectCondition(
    config.main === "apps/worker/src/index.ts",
    "Worker entrypoint must be apps/worker/src/index.ts.",
    violations,
  );
  expectCondition(
    config.assets?.directory === "apps/web/dist" &&
      config.assets?.binding === "ASSETS",
    "Static assets must use the ASSETS binding and apps/web/dist.",
    violations,
  );
  expectCondition(
    config.assets?.not_found_handling === "single-page-application",
    "Static asset fallback must preserve SPA navigation.",
    violations,
  );
  for (const route of ["/api/*", "/health", "/ready"]) {
    expectCondition(
      config.assets?.run_worker_first?.includes(route) === true,
      `${route} must run through the Worker before the SPA fallback.`,
      violations,
    );
  }
  expectCondition(
    d1?.database_name === "counterpoint-preview" &&
      d1?.migrations_dir === "apps/worker/migrations" &&
      d1?.remote === false,
    "DB must be a local-by-default preview D1 binding with committed migrations.",
    violations,
  );
  expectCondition(
    d1?.database_id === undefined && d1?.preview_database_id === undefined,
    "Opaque remote D1 IDs must not be invented in the local scaffold.",
    violations,
  );
  expectCondition(
    r2?.bucket_name === "counterpoint-artifacts-preview" &&
      r2?.remote === false,
    "ARTIFACTS must be a local-by-default preview R2 binding.",
    violations,
  );
  expectCondition(
    meetingBinding?.class_name === "MeetingCoordinator",
    "MEETINGS must bind to MeetingCoordinator.",
    violations,
  );
  expectCondition(
    firstMigration?.tag === "v1" &&
      firstMigration?.new_sqlite_classes?.includes("MeetingCoordinator") ===
        true,
    "The first Durable Object migration must introduce MeetingCoordinator with SQLite storage.",
    violations,
  );
  expectCondition(
    config.vars?.OPENAI_API_KEY_JUDGE === undefined,
    "OPENAI_API_KEY_JUDGE must never be an ordinary Worker var.",
    violations,
  );
  expectCondition(
    packageJson.scripts?.["dev:worker"]?.includes("--ip 0.0.0.0") === true,
    "dev:worker must bind Wrangler to 0.0.0.0.",
    violations,
  );
  for (const scriptName of [
    "cloudflare:d1:migrate:local",
    "cloudflare:dry-run",
    "cloudflare:types",
    "cloudflare:types:check",
    "dev:worker",
  ]) {
    expectCondition(
      packageJson.scripts?.[scriptName]?.includes(
        "CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false",
      ) === true,
      `${scriptName} must disable Wrangler's .env fallback.`,
      violations,
    );
  }

  return violations;
}

export async function checkCloudflareConfiguration(root = repositoryRoot) {
  const [config, packageJson] = await Promise.all([
    readFile(resolve(root, "wrangler.jsonc"), "utf8").then((source) => {
      const parsed = ts.parseConfigFileTextToJson("wrangler.jsonc", source);
      if (parsed.error !== undefined) {
        throw new SyntaxError(
          ts.flattenDiagnosticMessageText(parsed.error.messageText, "\n"),
        );
      }
      return parsed.config;
    }),
    readFile(resolve(root, "package.json"), "utf8").then(JSON.parse),
  ]);
  return validateCloudflareConfiguration(config, packageJson);
}

const invokedAsScript =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedAsScript) {
  const violations = await checkCloudflareConfiguration();
  if (violations.length > 0) {
    console.error(violations.join("\n"));
    process.exitCode = 1;
  } else {
    console.log("Cloudflare configuration contract is valid.");
  }
}
