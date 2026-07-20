import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("Cloudflare preview resource command boundary", () => {
  it("exposes separate plan and guarded apply commands", async () => {
    const [manifestText, script] = await Promise.all([
      readFile(new URL("../../package.json", import.meta.url), "utf8"),
      readFile(
        new URL(
          "../../scripts/cloudflare-preview-resources.sh",
          import.meta.url,
        ),
        "utf8",
      ),
    ]);
    const manifest = JSON.parse(manifestText) as {
      scripts: Record<string, string>;
    };

    expect(manifest.scripts["cloudflare:resources:plan"]).toBe(
      "bash scripts/cloudflare-preview-resources.sh --plan",
    );
    expect(manifest.scripts["cloudflare:resources:create:preview"]).toBe(
      "bash scripts/cloudflare-preview-resources.sh --apply",
    );
    expect(script).toContain(
      'expected_confirmation="counterpoint-preview:${CLOUDFLARE_ACCOUNT_ID}"',
    );
    expect(script).toContain("wrangler d1 list --json");
    expect(script).toContain("wrangler r2 bucket list --json");
    expect(script).not.toContain("wrangler secret");
  });
});
