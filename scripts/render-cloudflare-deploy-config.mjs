import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import ts from "typescript";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const TARGETS = {
  preview: {
    databaseName: "counterpoint-preview",
    r2BucketName: "counterpoint-artifacts-preview",
    workerName: "counterpoint-living-decisions-preview",
  },
  production: {
    databaseName: "counterpoint-production",
    r2BucketName: "counterpoint-artifacts-production",
    workerName: "counterpoint-living-decisions-production",
  },
};
const D1_ID_PATTERN =
  /^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/iu;
const RESOURCE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{2,62}$/u;

function requiredNonEmpty(value, label) {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length === 0
  ) {
    throw new TypeError(`${label} must be nonempty and trimmed`);
  }
  return value;
}

function deploymentTarget(value) {
  if (value !== "preview" && value !== "production") {
    throw new TypeError("Deployment target must be preview or production");
  }
  return value;
}

function resourceName(value, fallback, label) {
  const selected =
    value === undefined ? fallback : requiredNonEmpty(value, label);
  if (!RESOURCE_NAME_PATTERN.test(selected)) {
    throw new TypeError(
      `${label} must use lowercase letters, digits, and hyphens`,
    );
  }
  return selected;
}

function safeWorkerVars(vars, runtimeMode) {
  const {
    DEMO_STORY_MODE: _demoStoryMode,
    JUDGE_IP_HMAC_SECRET: _judgeIpHmacSecret,
    OPENAI_API_KEY_JUDGE: _openAiApiKeyJudge,
    ...safeVars
  } = vars ?? {};
  void _judgeIpHmacSecret;
  void _openAiApiKeyJudge;
  void _demoStoryMode;
  return {
    ...safeVars,
    DEMO_STORY_MODE: runtimeMode === "preview" ? "enabled" : "disabled",
    JUDGE_MANAGED_REALTIME_ROUTE_ENABLED: "disabled",
    JUDGE_STRUCTURED_AI_ROUTE_ENABLED: "disabled",
    OPENAI_MODE: "disabled",
    ...(runtimeMode === undefined ? {} : { RUNTIME_MODE: runtimeMode }),
  };
}

function secureEnvironments(environments) {
  for (const environment of Object.values(environments ?? {})) {
    environment.vars = safeWorkerVars(environment.vars);
    secureEnvironments(environment.env);
  }
}

export function renderCloudflareDeployConfiguration(input) {
  const target = deploymentTarget(input.target);
  const defaults = TARGETS[target];
  const databaseId = requiredNonEmpty(input.databaseId, "D1 database ID");
  if (!D1_ID_PATTERN.test(databaseId)) {
    throw new TypeError(
      "D1 database ID must be 32 hexadecimal characters or a UUID",
    );
  }
  const workerName = resourceName(
    input.workerName,
    defaults.workerName,
    "Worker name",
  );
  const r2BucketName = resourceName(
    input.r2BucketName,
    defaults.r2BucketName,
    "R2 bucket name",
  );
  const base = structuredClone(input.baseConfig);
  const d1 = base.d1_databases?.find(({ binding }) => binding === "DB");
  const r2 = base.r2_buckets?.find(({ binding }) => binding === "ARTIFACTS");
  if (d1 === undefined || r2 === undefined) {
    throw new TypeError("Base config must define DB and ARTIFACTS bindings");
  }
  base.name = workerName;
  d1.database_id = databaseId;
  d1.database_name = defaults.databaseName;
  d1.remote = true;
  r2.bucket_name = r2BucketName;
  r2.preview_bucket_name = r2BucketName;
  r2.remote = true;
  base.vars = safeWorkerVars(base.vars, target);
  secureEnvironments(base.env);
  return base;
}

function parseJsonc(path, source) {
  const parsed = ts.parseConfigFileTextToJson(path, source);
  if (parsed.error !== undefined) {
    throw new SyntaxError(
      ts.flattenDiagnosticMessageText(parsed.error.messageText, "\n"),
    );
  }
  return parsed.config;
}

export async function writeCloudflareDeployConfiguration(input) {
  const basePath = resolve(input.root, "wrangler.jsonc");
  const baseConfig = parseJsonc(basePath, await readFile(basePath, "utf8"));
  const config = renderCloudflareDeployConfiguration({
    baseConfig,
    databaseId: input.databaseId,
    r2BucketName: input.r2BucketName,
    target: input.target,
    workerName: input.workerName,
  });
  config.main = resolve(input.root, config.main);
  config.assets.directory = resolve(input.root, config.assets.directory);
  for (const database of config.d1_databases) {
    database.migrations_dir = resolve(input.root, database.migrations_dir);
  }
  const serialized = `${JSON.stringify(config, null, 2)}\n`;
  const outputPath = resolve(input.root, input.outputPath);
  const temporaryPath = `${outputPath}.tmp`;
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(temporaryPath, serialized, { mode: 0o600 });
  await rename(temporaryPath, outputPath);
  return {
    configSha256: createHash("sha256").update(serialized).digest("hex"),
    outputPath,
    target: input.target,
    workerName: config.name,
  };
}

const invokedAsScript =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedAsScript) {
  const target = deploymentTarget(process.argv[2]);
  const outputPath =
    process.argv[3] ?? `.wrangler/deploy/${target}.wrangler.json`;
  const summary = await writeCloudflareDeployConfiguration({
    databaseId: process.env.CLOUDFLARE_D1_DATABASE_ID,
    outputPath,
    r2BucketName: process.env.CLOUDFLARE_R2_BUCKET_NAME,
    root: repositoryRoot,
    target,
    workerName: process.env.CLOUDFLARE_WORKER_NAME,
  });
  console.log(JSON.stringify(summary));
}
