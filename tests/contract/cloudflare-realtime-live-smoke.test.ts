import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("Cloudflare live Realtime smoke contract", () => {
  it("runs through a secret-safe temporary Wrangler env and two browser passes", async () => {
    const [packageSource, script] = await Promise.all([
      readFile("package.json", "utf8"),
      readFile("scripts/cloudflare-realtime-live-smoke.mjs", "utf8"),
    ]);
    const packageJson = JSON.parse(packageSource) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["smoke:cloudflare:realtime-live"]).toBe(
      "node --env-file-if-exists=.env scripts/cloudflare-realtime-live-smoke.mjs",
    );
    expect(script).toContain("mkdtemp(");
    expect(script).toContain("mode: 0o600");
    expect(script).toContain('"--env-file"');
    expect(script).toContain('"--ip"');
    expect(script).toContain('"0.0.0.0"');
    expect(script).toContain("for (let pass = 1; pass <= 2; pass += 1)");
    expect(script).toContain('["private", "shared"]');
    expect(script).toContain("OPENAI_API_KEY is required");
    expect(script).not.toContain("console.log(apiKey");
    expect(script).not.toContain("console.error(apiKey");
  });
});
