import { fileURLToPath } from "node:url";

import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const migrationsPath = fileURLToPath(
  new URL("./apps/worker/migrations/", import.meta.url),
);

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(migrationsPath),
        },
      },
      wrangler: {
        configPath: "./wrangler.jsonc",
      },
    })),
  ],
  test: {
    hookTimeout: 30_000,
    include: ["tests/cloudflare/**/*.test.ts"],
    setupFiles: ["./tests/cloudflare/setup.ts"],
    testTimeout: 20_000,
    watch: false,
  },
});
