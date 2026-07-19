/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { describe, expect, it } from "vitest";

import { WebCryptoSessionTokenIssuer } from "../../packages/adapters-cloudflare/src/session-tokens.js";

describe("Cloudflare session-token issuer", () => {
  it("issues opaque tokens and stores only deterministic SHA-256 digests", async () => {
    const issuer = new WebCryptoSessionTokenIssuer();
    const first = await issuer.issue();
    const second = await issuer.issue();

    expect(first.value).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(first.hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(first.value).not.toBe(second.value);
    await expect(issuer.digest(first.value)).resolves.toBe(first.hash);
    expect(JSON.stringify({ hash: first.hash })).not.toContain(first.value);
  });
});
