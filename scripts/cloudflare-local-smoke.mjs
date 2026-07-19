import { spawn } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const port = Number.parseInt(process.env.CLOUDFLARE_SMOKE_PORT ?? "8791", 10);
if (!Number.isSafeInteger(port) || port < 1024 || port > 65_535) {
  throw new TypeError("CLOUDFLARE_SMOKE_PORT must be a non-privileged port");
}

const externalHostBaseUrl = `http://127.0.0.2:${String(port)}`;
const workerEnvironment = {
  CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false",
  HOME: process.env.HOME,
  LANG: process.env.LANG,
  PATH: process.env.PATH,
  TMPDIR: process.env.TMPDIR,
  WRANGLER_LOG_PATH: ".wrangler/wrangler.log",
  WRANGLER_SEND_METRICS: "false",
};

const worker = spawn(
  process.execPath,
  [
    "node_modules/wrangler/bin/wrangler.js",
    "dev",
    "--config",
    "wrangler.jsonc",
    "--ip",
    "0.0.0.0",
    "--port",
    String(port),
  ],
  {
    cwd: repositoryRoot,
    env: Object.fromEntries(
      Object.entries(workerEnvironment).filter(
        (entry) => entry[1] !== undefined,
      ),
    ),
    stdio: ["ignore", "pipe", "pipe"],
  },
);

let diagnostics = "";
for (const stream of [worker.stdout, worker.stderr]) {
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    diagnostics = `${diagnostics}${chunk}`.slice(-16_000);
  });
}

async function waitForWorker() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (worker.exitCode !== null) {
      throw new Error(`Wrangler exited before the smoke test:\n${diagnostics}`);
    }
    try {
      const response = await fetch(`${externalHostBaseUrl}/health`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) {
        return;
      }
    } catch {
      // Wrangler is still starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
  }
  throw new Error(`Wrangler did not become ready:\n${diagnostics}`);
}

async function expectJson(path, expectedStatus, options, check) {
  const response = await fetch(`${externalHostBaseUrl}${path}`, {
    ...options,
    signal: AbortSignal.timeout(5_000),
  });
  if (response.status !== expectedStatus) {
    throw new Error(
      `${path} returned ${String(response.status)}, expected ${String(expectedStatus)}`,
    );
  }
  const body = await response.json();
  check(body);
}

function expectValue(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

try {
  await waitForWorker();
  await expectJson("/health", 200, {}, (body) => {
    expectValue(
      body.status === "ok" && body.protocolVersion === 1,
      "Health response did not match the protocol contract",
    );
  });
  await expectJson("/ready", 200, {}, (body) => {
    expectValue(
      body.status === "ready" && body.migrationsCurrent === true,
      "Cloudflare resources were not ready after local migrations",
    );
  });
  let bearerToken;
  await expectJson(
    "/api/v1/login",
    200,
    {
      body: JSON.stringify({
        password: "counterpoint-product",
        userId: "product",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
    (body) => {
      expectValue(
        typeof body.bearerToken === "string" && body.userId === "product",
        "Hosted Worker login did not return the demo session contract",
      );
      bearerToken = body.bearerToken;
    },
  );
  const authorization = { authorization: `Bearer ${bearerToken}` };
  await expectJson(
    "/api/v1/meetings",
    200,
    { headers: authorization },
    (body) => {
      expectValue(
        body.meetings?.some(
          (meeting) => meeting.meetingId === "meeting-global-ai-rollout",
        ) === true,
        "Hosted Worker did not expose the seeded flagship meeting",
      );
    },
  );
  await expectJson(
    "/api/v1/meetings/meeting-global-ai-rollout/projection",
    200,
    { headers: authorization },
    (body) => {
      expectValue(
        body.meeting?.purpose?.includes("Work & Productivity") === true &&
          body.participant?.userId === "product",
        "Hosted Worker did not expose the flagship projection",
      );
    },
  );

  const page = await fetch(`${externalHostBaseUrl}/`, {
    signal: AbortSignal.timeout(5_000),
  });
  const html = await page.text();
  expectValue(
    page.status === 200 &&
      page.headers.get("content-type")?.startsWith("text/html") === true &&
      html.includes("<title>Counterpoint — Living Decisions</title>"),
    "Static React assets were not served through the external-host-style URL",
  );

  console.log(
    `Cloudflare local smoke passed via ${externalHostBaseUrl}: static, health, readiness, login, meetings, and projection.`,
  );
} finally {
  if (worker.exitCode === null) {
    worker.kill("SIGTERM");
    await Promise.race([
      once(worker, "exit"),
      new Promise((resolveDelay) => setTimeout(resolveDelay, 5_000)),
    ]);
    if (worker.exitCode === null) {
      worker.kill("SIGKILL");
      await once(worker, "exit");
    }
  }
}
