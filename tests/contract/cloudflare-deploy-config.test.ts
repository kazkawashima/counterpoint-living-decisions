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
  readonly env: Readonly<
    Record<
      string,
      {
        readonly vars: {
          readonly JUDGE_MANAGED_REALTIME_ROUTE_ENABLED: string;
          readonly JUDGE_STRUCTURED_AI_ROUTE_ENABLED: string;
          readonly OPENAI_MODE: string;
        };
      }
    >
  >;
  readonly name: string;
  readonly r2_buckets: readonly {
    readonly binding: string;
    readonly bucket_name: string;
    readonly preview_bucket_name: string;
    readonly remote: boolean;
  }[];
  readonly vars: {
    readonly JUDGE_MANAGED_REALTIME_ROUTE_ENABLED: string;
    readonly JUDGE_STRUCTURED_AI_ROUTE_ENABLED: string;
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
  env: {
    legacy: {
      vars: {
        JUDGE_IP_HMAC_SECRET: "nested-must-never-render-as-a-var",
        JUDGE_MANAGED_REALTIME_ROUTE_ENABLED: "enabled",
        JUDGE_STRUCTURED_AI_ROUTE_ENABLED: "enabled",
        OPENAI_API_KEY_JUDGE: "nested-must-never-render-as-a-var",
        OPENAI_MODE: "live",
      },
    },
  },
  name: "counterpoint-living-decisions",
  r2_buckets: [
    {
      binding: "ARTIFACTS",
      bucket_name: "counterpoint-artifacts-preview",
      remote: false,
    },
  ],
  vars: {
    JUDGE_IP_HMAC_SECRET: "must-never-render-as-a-var",
    JUDGE_MANAGED_REALTIME_ROUTE_ENABLED: "enabled",
    JUDGE_STRUCTURED_AI_ROUTE_ENABLED: "enabled",
    OPENAI_API_KEY_JUDGE: "must-never-render-as-a-var",
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
        env: {
          legacy: {
            vars: {
              JUDGE_MANAGED_REALTIME_ROUTE_ENABLED: "disabled",
              JUDGE_STRUCTURED_AI_ROUTE_ENABLED: "disabled",
              OPENAI_MODE: "disabled",
            },
          },
        },
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
          JUDGE_MANAGED_REALTIME_ROUTE_ENABLED: "disabled",
          JUDGE_STRUCTURED_AI_ROUTE_ENABLED: "disabled",
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
