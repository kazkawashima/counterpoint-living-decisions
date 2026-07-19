import { defineConfig, devices } from "@playwright/test";

function reachableHost(): string {
  return process.env.E2E_HOST ?? "127.0.0.2";
}

const workerPort = 8792;

export default defineConfig({
  expect: { timeout: 8_000 },
  fullyParallel: false,
  outputDir: "test-results/cloudflare",
  projects: [
    {
      name: "chromium-cloudflare",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  reporter: process.env.CI ? "github" : "list",
  testDir: "tests/e2e-cloudflare",
  timeout: 45_000,
  use: {
    baseURL: `http://${reachableHost()}:${String(workerPort)}`,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run cloudflare:dev:browser",
    env: {
      CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false",
      WRANGLER_LOG_PATH: ".wrangler/wrangler.log",
      WRANGLER_SEND_METRICS: "false",
    },
    reuseExistingServer: false,
    timeout: 120_000,
    url: `http://127.0.0.1:${String(workerPort)}/health`,
  },
  workers: 1,
});
