import { afterEach, describe, expect, it, vi } from "vitest";

import { ScryptPasswordVerifier } from "@counterpoint/adapters-cloudflare";

const PRODUCT_PASSWORD = "counterpoint-product";
const PRODUCT_HASH =
  "scrypt$v1$16384$8$1$OEwpNCxv86k8IZcEdTDf4g$n6qQBhlpokry1hjffTiNXyS3i9kgTdck1mtoYylMNNc";

const verifier = new ScryptPasswordVerifier();

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ScryptPasswordVerifier", () => {
  it("verifies the existing fixed demo hash and rejects a wrong password", async () => {
    await expect(verifier.verify(PRODUCT_PASSWORD, PRODUCT_HASH)).resolves.toBe(
      true,
    );
    await expect(verifier.verify("wrong-password", PRODUCT_HASH)).resolves.toBe(
      false,
    );
  }, 15_000);

  it.each([
    "not-an-encoded-hash",
    "scrypt$v1$16384$8$1$not-base64$not-base64",
    "scrypt$v1$16384$8$1$OEwpNCxv86k8IZcEdTDf4g$short",
    "scrypt$v1$16384$8$1$OEwpNCxv86k8IZcEdTDf4g$n6qQBhlpokry1hjffTiNXyS3i9kgTdck1mtoYylMNNc$extra",
    "scrypt$v1$16385$8$1$OEwpNCxv86k8IZcEdTDf4g$n6qQBhlpokry1hjffTiNXyS3i9kgTdck1mtoYylMNNc",
    "scrypt$v1$16384$16$1$OEwpNCxv86k8IZcEdTDf4g$n6qQBhlpokry1hjffTiNXyS3i9kgTdck1mtoYylMNNc",
    "scrypt$v1$16384$8$2$OEwpNCxv86k8IZcEdTDf4g$n6qQBhlpokry1hjffTiNXyS3i9kgTdck1mtoYylMNNc",
  ])("fails closed for an invalid encoded hash: %s", async (hash) => {
    await expect(verifier.verify(PRODUCT_PASSWORD, hash)).resolves.toBe(false);
  });

  it("rejects a hash above the supported cost before invoking WebCrypto", async () => {
    const importKey = vi.spyOn(crypto.subtle, "importKey");
    const deriveBits = vi.spyOn(crypto.subtle, "deriveBits");
    const highCostHash = PRODUCT_HASH.replace("$16384$", "$4294967296$");

    await expect(verifier.verify(PRODUCT_PASSWORD, highCostHash)).resolves.toBe(
      false,
    );
    expect(importKey).not.toHaveBeenCalled();
    expect(deriveBits).not.toHaveBeenCalled();
  });

  it("rejects oversized password and hash inputs without allocating scrypt memory", async () => {
    const importKey = vi.spyOn(crypto.subtle, "importKey");
    const oversizedPassword = "x".repeat(1025);
    const oversizedHash = `${PRODUCT_HASH}${"x".repeat(256)}`;

    await expect(
      verifier.verify(oversizedPassword, PRODUCT_HASH),
    ).resolves.toBe(false);
    await expect(
      verifier.verify(PRODUCT_PASSWORD, oversizedHash),
    ).resolves.toBe(false);
    expect(importKey).not.toHaveBeenCalled();
  });

  it("fails closed when the Workers WebCrypto implementation is unavailable", async () => {
    vi.spyOn(crypto.subtle, "importKey").mockRejectedValue(
      new Error("crypto unavailable"),
    );

    await expect(verifier.verify(PRODUCT_PASSWORD, PRODUCT_HASH)).resolves.toBe(
      false,
    );
  });

  it("rejects non-string runtime inputs without throwing", async () => {
    // @ts-expect-error Runtime boundary must reject non-string passwords.
    await expect(verifier.verify(null, PRODUCT_HASH)).resolves.toBe(false);
    // @ts-expect-error Runtime boundary must reject non-string hashes.
    await expect(verifier.verify(PRODUCT_PASSWORD, null)).resolves.toBe(false);
  });
});
