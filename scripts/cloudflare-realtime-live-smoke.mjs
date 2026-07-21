import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { chromium, expect } from "@playwright/test";

const apiKey = process.env.OPENAI_API_KEY;
if (
  apiKey === undefined ||
  apiKey.trim().length === 0 ||
  apiKey.trim() !== apiKey ||
  /[\r\n]/u.test(apiKey)
) {
  throw new Error("OPENAI_API_KEY is required for the live Realtime smoke");
}

const repositoryRoot = resolve(import.meta.dirname, "..");
const port = Number.parseInt(
  process.env.CLOUDFLARE_REALTIME_SMOKE_PORT ?? "8793",
  10,
);
if (!Number.isSafeInteger(port) || port < 1024 || port > 65_535) {
  throw new TypeError(
    "CLOUDFLARE_REALTIME_SMOKE_PORT must be a non-privileged port",
  );
}

const origin = `http://127.0.0.2:${String(port)}`;
const safeFailureReasons = new Set([
  "OFFER_REJECTED",
  "PROVIDER_LOCATION_INVALID",
  "PROVIDER_REJECTED",
  "PROVIDER_SDP_INVALID",
  "PROVIDER_UNAVAILABLE",
]);

class SmokeFailure extends Error {
  constructor(channel, reason, providerStatus) {
    super("Live Realtime smoke failed");
    this.channel = channel;
    this.providerStatus = providerStatus;
    this.reason = reason;
  }
}

function report(input) {
  process.stdout.write(
    `${JSON.stringify({
      channel: input.channel,
      model: input.model ?? null,
      passed: input.passed,
      providerStatus: input.providerStatus ?? null,
      reason: input.reason ?? null,
    })}\n`,
  );
}

function childEnvironment(logPath) {
  const allowed = [
    "HOME",
    "LANG",
    "PATH",
    "TMPDIR",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "no_proxy",
  ];
  return Object.fromEntries([
    ...allowed.flatMap((name) => {
      const value = process.env[name];
      return value === undefined ? [] : [[name, value]];
    }),
    ["CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV", "true"],
    ["WRANGLER_LOG_PATH", logPath],
    ["WRANGLER_SEND_METRICS", "false"],
  ]);
}

async function waitForWorker(worker) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (worker.exitCode !== null) {
      throw new SmokeFailure("startup", "WORKER_START_FAILED");
    }
    try {
      const response = await fetch(`${origin}/ready`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) return;
    } catch {
      // Wrangler is still starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
  }
  throw new SmokeFailure("startup", "WORKER_START_TIMEOUT");
}

function safeFailure(body) {
  if (typeof body !== "object" || body === null || !("details" in body)) {
    return { reason: "UNKNOWN" };
  }
  const details = body.details;
  if (typeof details !== "object" || details === null) {
    return { reason: "UNKNOWN" };
  }
  const reason =
    "reason" in details &&
    typeof details.reason === "string" &&
    safeFailureReasons.has(details.reason)
      ? details.reason
      : "UNKNOWN";
  const providerStatus =
    "providerStatus" in details &&
    typeof details.providerStatus === "number" &&
    Number.isInteger(details.providerStatus)
      ? details.providerStatus
      : undefined;
  return { providerStatus, reason };
}

async function runBrowserSmoke(worker) {
  await waitForWorker(worker);
  let browser;
  let startupStage = "BROWSER_LAUNCH_FAILED";
  try {
    browser = await chromium.launch({ headless: true });
    startupStage = "BROWSER_SETUP_FAILED";
    const page = await browser.newPage({
      reducedMotion: "reduce",
      viewport: { height: 900, width: 1440 },
    });
    await page.route("**/api/v1/meetings/*/realtime/calls**", (route) =>
      route.continue({
        headers: {
          ...route.request().headers(),
          "CF-Connecting-IP": "203.0.113.247",
        },
      }),
    );

    let latestCall = {};
    page.on("response", async (response) => {
      const url = new URL(response.url());
      if (
        !/^\/api\/v1\/meetings\/[^/]+\/realtime\/calls$/u.test(url.pathname)
      ) {
        return;
      }
      const body = await response.json().catch(() => undefined);
      if (response.ok()) {
        latestCall = {
          model:
            typeof body === "object" &&
            body !== null &&
            "model" in body &&
            typeof body.model === "string"
              ? body.model
              : undefined,
        };
        return;
      }
      latestCall = safeFailure(body);
    });

    startupStage = "PAGE_LOAD_FAILED";
    await page.goto(origin);
    startupStage = "LOGIN_FAILED";
    await page.getByRole("button", { name: "Product" }).click();
    await page.getByLabel("Demo password").fill("counterpoint-product");
    await page.getByRole("button", { name: "Continue to meetings" }).click();
    await page
      .getByRole("article")
      .filter({ hasText: "Global AI Product Rollout" })
      .getByRole("button", { name: "Open workspace" })
      .click();
    startupStage = "JUDGE_ACCESS_FAILED";
    await expect(page.getByText("Judge-managed access")).toBeVisible({
      timeout: 15_000,
    });

    const channels = ["private", "shared"];
    for (let pass = 1; pass <= 2; pass += 1) {
      for (const channel of channels) {
        latestCall = {};
        const card = page.getByRole("article").filter({
          hasText:
            channel === "private" ? "Private agent" : "Shared room agent",
        });
        await card.getByRole("button", { name: "Connect" }).click();
        try {
          await expect(
            card.getByText("Connected", { exact: true }),
          ).toBeVisible({
            timeout: 25_000,
          });
        } catch {
          throw new SmokeFailure(
            channel,
            latestCall.reason ?? "UNKNOWN",
            latestCall.providerStatus,
          );
        }

        const terminated = page.waitForResponse(
          (response) =>
            response.request().method() === "POST" &&
            /\/realtime\/calls\/[^/]+\/terminate$/u.test(
              new URL(response.url()).pathname,
            ),
          { timeout: 15_000 },
        );
        await card.getByRole("button", { name: "Disconnect" }).click();
        await terminated;
        await expect(card.getByText("Off", { exact: true })).toBeVisible();
        report({
          channel,
          model: latestCall.model,
          passed: true,
        });
      }
    }
  } catch (error) {
    if (error instanceof SmokeFailure) throw error;
    throw new SmokeFailure("startup", startupStage);
  } finally {
    await browser?.close();
  }
}

const temporaryDirectory = await mkdtemp(
  join(tmpdir(), "counterpoint-realtime-smoke-"),
);
const envFile = join(temporaryDirectory, "wrangler.env");
const hmacSecret = randomBytes(32).toString("hex");
let worker;
let passed = false;
try {
  await writeFile(
    envFile,
    [
      "DEMO_STORY_MODE=enabled",
      `JUDGE_IP_HMAC_SECRET=${hmacSecret}`,
      "JUDGE_MANAGED_REALTIME_ROUTE_ENABLED=enabled",
      "JUDGE_STRUCTURED_AI_ROUTE_ENABLED=disabled",
      "JUDGE_USER_ID=product",
      `OPENAI_API_KEY_JUDGE=${apiKey}`,
      "OPENAI_MODE=disabled",
    ].join("\n"),
    { mode: 0o600 },
  );
  worker = spawn(
    process.execPath,
    [
      "node_modules/wrangler/bin/wrangler.js",
      "dev",
      "--config",
      "wrangler.jsonc",
      "--env-file",
      envFile,
      "--var",
      "DEMO_STORY_MODE:enabled",
      "--var",
      "JUDGE_MANAGED_REALTIME_ROUTE_ENABLED:enabled",
      "--var",
      "JUDGE_STRUCTURED_AI_ROUTE_ENABLED:disabled",
      "--var",
      "JUDGE_USER_ID:product",
      "--var",
      "OPENAI_MODE:disabled",
      "--ip",
      "0.0.0.0",
      "--port",
      String(port),
    ],
    {
      cwd: repositoryRoot,
      env: childEnvironment(join(temporaryDirectory, "wrangler.log")),
      stdio: "ignore",
    },
  );
  await runBrowserSmoke(worker);
  passed = true;
} catch (error) {
  report({
    channel: error instanceof SmokeFailure ? error.channel : "startup",
    passed: false,
    providerStatus:
      error instanceof SmokeFailure ? error.providerStatus : undefined,
    reason: error instanceof SmokeFailure ? error.reason : "UNKNOWN",
  });
} finally {
  if (worker?.exitCode === null) {
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
  await rm(temporaryDirectory, { force: true, recursive: true });
}

if (!passed) process.exitCode = 1;
