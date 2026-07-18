import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createLocalServerRuntime,
  createServerApp,
  readServerConfiguration,
} from "../apps/server/dist/index.js";

import { checkArchitecture } from "./check-architecture.mjs";

const violations = await checkArchitecture();

if (violations.length > 0) {
  throw new Error(`Deployment smoke failed:\n${violations.join("\n")}`);
}

const directory = await mkdtemp(join(tmpdir(), "counterpoint-deploy-smoke-"));
const runtime = await createLocalServerRuntime(
  readServerConfiguration({
    DATABASE_PATH: join(directory, "counterpoint.sqlite"),
    OPENAI_API_KEY: "",
    PORT: "8787",
  }),
);

try {
  const app = createServerApp(runtime);
  const health = await app.request("http://100.96.14.8:8787/health");
  const readiness = await app.request("http://100.96.14.8:8787/ready");
  if (health.status !== 200 || readiness.status !== 200) {
    throw new Error(
      `Deployment health failed: health=${String(health.status)}, readiness=${String(readiness.status)}`,
    );
  }
  console.log(
    "Deployment smoke passed: architecture, migration, health, and readiness are valid.",
  );
} finally {
  runtime.close();
  await rm(directory, { force: true, recursive: true });
}
