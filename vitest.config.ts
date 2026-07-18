import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@counterpoint/adapters-cloudflare": fileURLToPath(
        new URL("./packages/adapters-cloudflare/src/index.ts", import.meta.url),
      ),
      "@counterpoint/adapters-node": fileURLToPath(
        new URL("./packages/adapters-node/src/index.ts", import.meta.url),
      ),
      "@counterpoint/adapters-openai": fileURLToPath(
        new URL("./packages/adapters-openai/src/index.ts", import.meta.url),
      ),
      "@counterpoint/application": fileURLToPath(
        new URL("./packages/application/src/index.ts", import.meta.url),
      ),
      "@counterpoint/domain": fileURLToPath(
        new URL("./packages/domain/src/index.ts", import.meta.url),
      ),
      "@counterpoint/ports": fileURLToPath(
        new URL("./packages/ports/src/index.ts", import.meta.url),
      ),
      "@counterpoint/protocol": fileURLToPath(
        new URL("./packages/protocol/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    clearMocks: true,
    environment: "node",
    passWithNoTests: true,
    projects: [
      {
        extends: true,
        test: {
          include: ["packages/**/*.test.ts", "tests/unit/**/*.test.ts"],
          name: "unit",
        },
      },
      {
        extends: true,
        test: {
          include: ["tests/contract/**/*.test.ts"],
          name: "contract",
        },
      },
      {
        extends: true,
        test: {
          include: ["tests/integration/**/*.test.ts"],
          name: "integration",
        },
      },
      {
        extends: true,
        test: {
          include: ["tests/e2e/**/*.test.ts"],
          name: "e2e",
        },
      },
    ],
    restoreMocks: true,
    watch: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      reportsDirectory: "coverage",
    },
  },
});
