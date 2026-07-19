import { describe, expect, it } from "vitest";

import {
  checkCloudflareConfiguration,
  validateCloudflareConfiguration,
} from "../../scripts/check-cloudflare-config.mjs";

describe("Cloudflare configuration contract", () => {
  it("keeps local resource bindings, routing, and network exposure reproducible", async () => {
    await expect(checkCloudflareConfiguration()).resolves.toEqual([]);
  });

  it("rejects a judge key in ordinary Worker vars", () => {
    const violations = validateCloudflareConfiguration(
      {
        assets: {
          binding: "ASSETS",
          directory: "apps/web/dist",
          not_found_handling: "single-page-application",
          run_worker_first: ["/api/*", "/health", "/ready"],
        },
        d1_databases: [
          {
            binding: "DB",
            database_name: "counterpoint-preview",
            migrations_dir: "apps/worker/migrations",
            remote: false,
          },
        ],
        durable_objects: {
          bindings: [{ class_name: "MeetingCoordinator", name: "MEETINGS" }],
        },
        main: "apps/worker/src/index.ts",
        migrations: [{ new_sqlite_classes: ["MeetingCoordinator"], tag: "v1" }],
        r2_buckets: [
          {
            binding: "ARTIFACTS",
            bucket_name: "counterpoint-artifacts-preview",
            remote: false,
          },
        ],
        vars: { OPENAI_API_KEY_JUDGE: "must-not-be-here" },
      },
      {
        scripts: Object.fromEntries(
          [
            "cloudflare:d1:migrate:local",
            "cloudflare:dry-run",
            "cloudflare:types",
            "cloudflare:types:check",
            "dev:worker",
          ].map((name) => [
            name,
            "CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false wrangler dev --ip 0.0.0.0",
          ]),
        ),
      },
    );

    expect(violations).toContain(
      "OPENAI_API_KEY_JUDGE must never be an ordinary Worker var.",
    );
  });
});
