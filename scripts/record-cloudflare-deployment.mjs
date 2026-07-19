import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

import { validatedDeploymentOrigin } from "./cloudflare-remote-smoke.mjs";

const execFileAsync = promisify(execFile);

function target(value) {
  if (value !== "preview" && value !== "production") {
    throw new TypeError("Deployment target must be preview or production");
  }
  return value;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function deploymentRecord(input) {
  const selectedTarget = target(input.target);
  const origin = validatedDeploymentOrigin(input.origin);
  if (!/^[a-f0-9]{40}$/u.test(input.commitSha)) {
    throw new TypeError("Deployment commit must be a full Git SHA-1");
  }
  if (!/^[a-z0-9][a-z0-9-]{2,62}$/u.test(input.workerName)) {
    throw new TypeError("Worker name is invalid");
  }
  return {
    commitSha: input.commitSha,
    configSha256: sha256(input.configText),
    deploymentStatusSha256: sha256(input.deploymentStatusText),
    originHost: new URL(origin).host,
    recordedAt: input.recordedAt,
    target: selectedTarget,
    workerName: input.workerName,
  };
}

export async function writeDeploymentRecord(input) {
  const [configText, deploymentStatusText, git] = await Promise.all([
    readFile(input.configPath, "utf8"),
    readFile(input.deploymentStatusPath, "utf8"),
    execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: input.root,
      encoding: "utf8",
    }),
  ]);
  const record = deploymentRecord({
    commitSha: git.stdout.trim(),
    configText,
    deploymentStatusText,
    origin: input.origin,
    recordedAt: new Date().toISOString(),
    target: input.target,
    workerName: input.workerName,
  });
  const outputPath = resolve(
    input.root,
    `.wrangler/deploy/records/${input.target}-${record.commitSha}.json`,
  );
  const temporaryPath = `${outputPath}.tmp`;
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(temporaryPath, `${JSON.stringify(record, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(temporaryPath, outputPath);
  return { outputPath, record };
}

const invokedAsScript =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedAsScript) {
  const root = resolve(process.argv[2] ?? ".");
  const selectedTarget = target(process.argv[3]);
  const result = await writeDeploymentRecord({
    configPath: resolve(process.argv[4]),
    deploymentStatusPath: resolve(process.argv[5]),
    origin: process.argv[6],
    root,
    target: selectedTarget,
    workerName: process.argv[7],
  });
  console.log(
    JSON.stringify({
      commitSha: result.record.commitSha,
      outputPath: result.outputPath,
      target: result.record.target,
      workerName: result.record.workerName,
    }),
  );
}
