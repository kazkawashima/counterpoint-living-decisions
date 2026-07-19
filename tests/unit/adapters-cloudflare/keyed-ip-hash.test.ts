import { describe, expect, it } from "vitest";

import { createKeyedIpHash } from "@counterpoint/adapters-cloudflare";

const HASH_PATTERN = /^hmac-sha256:[a-f0-9]{64}$/u;

describe("createKeyedIpHash", () => {
  it.each([
    "0.0.0.0",
    "203.0.113.42",
    "255.255.255.255",
    "::",
    "::1",
    "2001:db8::1",
    "2001:db8:0:1:2:3:4:5",
    "2001:db8::ff00:42:8329",
    "::ffff:c000:280",
  ])("hashes the canonical IP address %s", async (ipAddress) => {
    await expect(createKeyedIpHash("test-secret")(ipAddress)).resolves.toMatch(
      HASH_PATTERN,
    );
  });

  it.each([
    "",
    " ",
    "\t203.0.113.42",
    "203.0.113.42 ",
    "203.0.113.42, 198.51.100.7",
    "203.0.113.42:443",
    "http://203.0.113.42",
    "example.com",
    "127.1",
    "2130706433",
    "0x7f.0.0.1",
    "01.2.3.4",
    "256.1.1.1",
    "1.2.3",
    "1.2.3.4.",
    "[2001:db8::1]",
    "[2001:db8::1]:443",
    "2001:db8::1, 2001:db8::2",
    "fe80::1%eth0",
    "2001:DB8::1",
    "2001:0db8::1",
    "2001:db8:0:0:1::1",
    "2001:db8::0:1",
    "2001:db8:0:1:0:0:1:1",
    "2001:db8:0:0:1:1:0:0",
    "2001:db8::1::2",
    "2001:db8:::1",
    "2001:db8:1:2:3:4:5",
    "2001:db8:1:2:3:4:5:6:7",
    "::ffff:192.0.2.128",
  ])("rejects a non-canonical or malformed address: %s", async (ipAddress) => {
    const hashIp = createKeyedIpHash("test-secret");

    await expect(hashIp(ipAddress)).rejects.toThrow(
      "IP address must be a canonical IPv4 or IPv6 address",
    );
  });

  it.each([undefined, null, false, 0, {}, []])(
    "rejects a missing-ish non-string address without leaking the secret",
    async (ipAddress) => {
      const hashIp = createKeyedIpHash("test-secret");

      // @ts-expect-error Runtime validation must reject non-string inputs.
      await expect(hashIp(ipAddress)).rejects.toThrowError(
        "IP address must be a canonical IPv4 or IPv6 address",
      );

      try {
        // @ts-expect-error Runtime validation must reject non-string inputs.
        await hashIp(ipAddress);
      } catch (error) {
        expect(String(error)).not.toContain("test-secret");
      }
    },
  );

  it("is deterministic and matches a stable HMAC-SHA-256 vector", async () => {
    const hashIp = createKeyedIpHash("test-secret");

    const first = await hashIp("203.0.113.42");
    const second = await hashIp("203.0.113.42");

    expect(second).toBe(first);
    expect(first).toBe(
      "hmac-sha256:76bf74a868ffe3479ef0ad49ba6b8d32ebcf4fc9459c1547dbc7493e405c5262",
    );
  });

  it("separates hashes produced with different secrets", async () => {
    const first = await createKeyedIpHash("first-secret")("2001:db8::1");
    const second = await createKeyedIpHash("second-secret")("2001:db8::1");

    expect(first).toMatch(HASH_PATTERN);
    expect(second).toMatch(HASH_PATTERN);
    expect(first).not.toBe(second);
  });

  it("does not expose the raw address or secret in validation errors", async () => {
    const secret = "sensitive-secret-value";
    const rawAddress = "sensitive-hostname.example";

    try {
      await createKeyedIpHash(secret)(rawAddress);
      throw new Error("Expected IP validation to fail");
    } catch (error) {
      expect(String(error)).not.toContain(rawAddress);
      expect(String(error)).not.toContain(secret);
    }
  });

  it.each(["", " ", "\t", "\n"])(
    "rejects an empty secret without exposing its supplied value",
    (secret) => {
      expect(() => createKeyedIpHash(secret)).toThrow(
        "IP hash secret must be a non-empty string",
      );

      try {
        createKeyedIpHash(secret);
      } catch (error) {
        expect(String(error)).not.toContain(JSON.stringify(secret));
      }
    },
  );

  it.each([undefined, null, false, 0, {}, []])(
    "rejects a missing-ish non-string secret",
    (secret) => {
      // @ts-expect-error Runtime validation must reject non-string inputs.
      expect(() => createKeyedIpHash(secret)).toThrow(
        "IP hash secret must be a non-empty string",
      );
    },
  );
});
