import { describe, expect, it } from "vitest";

import {
  renderCloudflareDeployConfiguration,
  writeCloudflareDeployConfiguration,
} from "../../scripts/render-cloudflare-deploy-config.mjs";

const databaseId = "a".repeat(32);
interface RenderedConfig {
  readonly d1_databases: readonly {
    readonly binding: string;
    readonly database_id: string;
    readonly database_name: string;
    readonly remote: boolean;
  }[];
  readonly name: string;
  readonly r2_buckets: readonly {
    readonly binding: string;
    readonly bucket_name: string;
    readonly preview_bucket_name: string;
    readonly remote: boolean;
  }[];
  readonly vars: {
    readonly OPENAI_MODE: string;
    readonly RUNTIME_MODE: string;
  };
}

const baseConfig = {
  d1_databases: [
    {
      binding: "DB",
      database_name: "counterpoint-preview",
      migrations_dir: "apps/worker/migrations",
      remote: false,
    },
  ],
  name: "counterpoint-living-decisions",
  r2_buckets: [
    {
      binding: "ARTIFACTS",
      bucket_name: "counterpoint-artifacts-preview",
      remote: false,
    },
  ],
  vars: {
    OPENAI_MODE: "disabled",
    RUNTIME_MODE: "preview",
  },
};

describe("Cloudflare remote deploy configuration", () => {
  it.each([
    {
      databaseName: "counterpoint-preview",
      r2BucketName: "counterpoint-artifacts-preview",
      target: "preview",
      workerName: "counterpoint-living-decisions-preview",
    },
    {
      databaseName: "counterpoint-production",
      r2BucketName: "counterpoint-artifacts-production",
      target: "production",
      workerName: "counterpoint-living-decisions-production",
    },
  ] as const)(
    "renders exact $target bindings without a judge secret",
    (input) => {
      const rendered = renderCloudflareDeployConfiguration({
        baseConfig,
        databaseId,
        target: input.target,
      }) as unknown as RenderedConfig;

      expect(rendered).toMatchObject({
        d1_databases: [
          {
            binding: "DB",
            database_id: databaseId,
            database_name: input.databaseName,
            remote: true,
          },
        ],
        name: input.workerName,
        r2_buckets: [
          {
            binding: "ARTIFACTS",
            bucket_name: input.r2BucketName,
            preview_bucket_name: input.r2BucketName,
            remote: true,
          },
        ],
        vars: {
          OPENAI_MODE: "disabled",
          RUNTIME_MODE: input.target,
        },
      });
      expect(JSON.stringify(rendered)).not.toContain("OPENAI_API_KEY_JUDGE");
      expect(JSON.stringify(rendered)).not.toContain("JUDGE_IP_HMAC_SECRET");
    },
  );

  it.each([
    ["unknown target", { target: "staging" }],
    ["empty database ID", { databaseId: "" }],
    ["malformed database ID", { databaseId: "not-an-id" }],
    ["unsafe Worker name", { workerName: "unsafe/name" }],
    ["unsafe R2 name", { r2BucketName: "UPPERCASE" }],
  ])("rejects %s before writing", (_label, override) => {
    expect(() => {
      void renderCloudflareDeployConfiguration({
        baseConfig,
        databaseId,
        target: "preview",
        ...override,
      });
    }).toThrow();
  });

  it("exports a writer without exposing remote IDs in its public summary shape", () => {
    expect(writeCloudflareDeployConfiguration).toBeTypeOf("function");
    const rendered = renderCloudflareDeployConfiguration({
      baseConfig,
      databaseId,
      target: "preview",
    }) as unknown as RenderedConfig;
    const summary = {
      configSha256: "b".repeat(64),
      outputPath: ".wrangler/deploy/preview.wrangler.json",
      target: "preview",
      workerName: rendered.name,
    };
    expect(JSON.stringify(summary)).not.toContain(databaseId);
  });
});
