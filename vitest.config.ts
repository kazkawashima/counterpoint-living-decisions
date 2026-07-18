import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    clearMocks: true,
    environment: "node",
    passWithNoTests: true,
    projects: [
      {
        test: {
          include: ["packages/**/*.test.ts", "tests/unit/**/*.test.ts"],
          name: "unit",
        },
      },
      {
        test: {
          include: ["tests/contract/**/*.test.ts"],
          name: "contract",
        },
      },
      {
        test: {
          include: ["tests/integration/**/*.test.ts"],
          name: "integration",
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
