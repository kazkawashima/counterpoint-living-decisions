import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";

import {
  checkRepositoryFilesForSecrets,
  findSecretViolations,
} from "../../scripts/check-secrets.mjs";

function entry(path: string, content: string | Buffer) {
  return {
    content: Buffer.isBuffer(content) ? content : Buffer.from(content),
    path,
  };
}

describe("repository secret scan", () => {
  it("keeps the current repository free of recognized secrets", async () => {
    await expect(checkRepositoryFilesForSecrets()).resolves.toEqual([]);
  });

  it("reports only paths and rule names for secret-shaped values", () => {
    const openAiKey = ["sk", "proj", "A".repeat(24)].join("-");
    const privateKey = [
      "-----BEGIN ",
      "PRIVATE",
      " KEY-----",
      "private material",
    ].join("");
    const violations = findSecretViolations([
      entry("src/config.ts", `export const value = "${openAiKey}";`),
      entry("certs/demo.txt", privateKey),
    ]);

    expect(violations).toEqual([
      { path: "src/config.ts", rule: "OpenAI API key" },
      { path: "certs/demo.txt", rule: "private key" },
    ]);
    expect(JSON.stringify(violations)).not.toContain(openAiKey);
    expect(JSON.stringify(violations)).not.toContain("private material");
  });

  it("rejects tracked secret filenames but permits empty examples", () => {
    expect(
      findSecretViolations([
        entry(".env", "SYNTHETIC=value"),
        entry("config/client.key", ""),
        entry(".env.example", "OPENAI_API_KEY=\n"),
        entry(".dev.vars.example", "OPENAI_API_KEY_JUDGE=\n"),
        entry(".dev.vars.example", "JUDGE_IP_HMAC_SECRET=\n"),
      ]),
    ).toEqual([
      { path: ".env", rule: "tracked secret-bearing filename" },
      { path: "config/client.key", rule: "tracked secret-bearing filename" },
    ]);
  });

  it("skips binary and oversized payload scanning", () => {
    const secretShape = ["sk", "svcacct", "B".repeat(24)].join("-");
    const binary = Buffer.from(`${secretShape}\0`);
    const oversized = Buffer.alloc(2 * 1024 * 1024 + 1, "A");
    oversized.set(Buffer.from(secretShape));

    expect(
      findSecretViolations([
        entry("docs/media/demo.png", binary),
        entry("docs/media/demo.webm", oversized),
      ]),
    ).toEqual([]);
  });
});
