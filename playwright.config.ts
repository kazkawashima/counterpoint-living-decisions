import { defineConfig, devices } from "@playwright/test";

function reachableHost(): string {
  // CI/sandbox-safe alias exercises a hostname distinct from localhost.
  // Set E2E_HOST to the machine's LAN/Tailscale address for a physical-device run.
  return process.env.E2E_HOST ?? "127.0.0.2";
}

const webPort = 5173;
const apiPort = 8787;

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
        DATABASE_PATH: "./data/e2e-counterpoint.sqlite",
        HOST: "0.0.0.0",
        NODE_ENV: "test",
        OPENAI_API_KEY: "",
        PORT: String(apiPort),
      },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      url: `http://127.0.0.1:${String(apiPort)}/health`,
    },
    {
      command:
        "npm run dev --workspace @counterpoint/web -- --port 5173 --strictPort",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      url: `http://127.0.0.1:${String(webPort)}`,
    },
  ],
  workers: 1,
});
