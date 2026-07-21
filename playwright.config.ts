import { defineConfig, devices } from "@playwright/test";

function reachableHost(): string {
  // CI/sandbox-safe alias exercises a hostname distinct from localhost.
  // Set E2E_HOST to the machine's LAN/Tailscale address for a physical-device run.
  return process.env.E2E_HOST ?? "127.0.0.2";
}

const webPort = Number(process.env.E2E_WEB_PORT ?? "5173");
const apiPort = Number(process.env.E2E_API_PORT ?? "8787");
const runtimeSuffix = String(process.pid);

export default defineConfig({
  expect: {
    timeout: 8_000,
  },
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: false,
  outputDir: "test-results",
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
      },
    },
  ],
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  retries: process.env.CI ? 1 : 0,
  testDir: "tests/e2e",
  timeout: 45_000,
  use: {
    baseURL: `http://${reachableHost()}:${String(webPort)}`,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  webServer: [
    {
      command: "npm run dev --workspace @counterpoint/server",
      env: {
        DATABASE_PATH: `/tmp/counterpoint-e2e-${runtimeSuffix}.sqlite`,
        HOST: "0.0.0.0",
        NODE_ENV: "test",
        OPENAI_API_KEY: "",
        OPENAI_FAKE_EXACT_SNIPPET:
          "Regional launch requires a documented approval gate.",
        OPENAI_FAKE_MODE: "deterministic",
        PORT: String(apiPort),
        STORAGE_PATH: `/tmp/counterpoint-e2e-${runtimeSuffix}-artifacts`,
      },
      reuseExistingServer: false,
      timeout: 120_000,
      url: `http://127.0.0.1:${String(apiPort)}/health`,
    },
    {
      command: `npm run dev --workspace @counterpoint/web -- --port ${String(webPort)} --strictPort`,
      reuseExistingServer: false,
      timeout: 120_000,
      url: `http://127.0.0.1:${String(webPort)}`,
    },
  ],
  workers: 1,
});
