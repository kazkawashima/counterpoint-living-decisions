import { createHash, createHmac } from "node:crypto";

import {
  NodeHmacWebhookVerifier,
  type NodeHmacWebhookVerifierOptions,
} from "@counterpoint/adapters-node";
import type { Clock, WebhookVerifier } from "@counterpoint/ports";
import { describe, expect, it } from "vitest";

const SECRET = "synthetic-webhook-secret";
const NOW_SECONDS = 1_753_000_000;

class FixedClock implements Clock {
  constructor(private readonly value: string) {}

  now(): string {
    return this.value;
  }
}

function options(
  overrides: Partial<NodeHmacWebhookVerifierOptions> = {},
): NodeHmacWebhookVerifierOptions {
  return {
    clock: new FixedClock(new Date(NOW_SECONDS * 1_000).toISOString()),
    secret: SECRET,
    ...overrides,
  };
}

function signature(
  timestamp: string,
  rawBody: Uint8Array,
  secret = SECRET,
): string {
  const digest = createHmac("sha256", secret)
    .update(`${timestamp}.`, "utf8")
    .update(rawBody)
    .digest("hex");
  return `v1=${digest}`;
}

describe("NodeHmacWebhookVerifier", () => {
  it("implements WebhookVerifier and hashes the exact valid payload bytes", async () => {
    const rawBody = Uint8Array.from([
      0x7b, 0x22, 0x65, 0xcc, 0x81, 0x22, 0x3a, 0xff, 0x7d,
    ]);
    const timestamp = String(NOW_SECONDS);
    const verifier: WebhookVerifier = new NodeHmacWebhookVerifier(options());

    await expect(
      verifier.verify({
        rawBody,
        signature: signature(timestamp, rawBody),
        timestamp,
      }),
    ).resolves.toEqual({
      kind: "valid",
      payloadHash: `sha256:${createHash("sha256")
        .update(rawBody)
        .digest("base64url")}`,
    });
  });

  it("accepts lowercase and uppercase hexadecimal digests", async () => {
    const rawBody = new TextEncoder().encode('{"event":"changed"}');
    const timestamp = String(NOW_SECONDS);
    const verifier = new NodeHmacWebhookVerifier(options());
    const lowercase = signature(timestamp, rawBody);
    const uppercase = `v1=${lowercase.slice(3).toUpperCase()}`;

    await expect(
      verifier.verify({ rawBody, signature: lowercase, timestamp }),
    ).resolves.toMatchObject({ kind: "valid" });
    await expect(
      verifier.verify({ rawBody, signature: uppercase, timestamp }),
    ).resolves.toMatchObject({ kind: "valid" });
  });

  it.each([
    ["fractional timestamp", "1753000000.0", `v1=${"0".repeat(64)}`],
    ["negative timestamp", "-1", `v1=${"0".repeat(64)}`],
    ["timestamp with whitespace", " 1753000000", `v1=${"0".repeat(64)}`],
    ["unsafe integer timestamp", "9007199254740992", `v1=${"0".repeat(64)}`],
    ["missing signature version", String(NOW_SECONDS), "0".repeat(64)],
    ["wrong signature version", String(NOW_SECONDS), `v2=${"0".repeat(64)}`],
    ["short signature digest", String(NOW_SECONDS), `v1=${"0".repeat(63)}`],
    ["non-hex signature digest", String(NOW_SECONDS), `v1=${"g".repeat(64)}`],
  ])("rejects a malformed %s", async (_label, timestamp, candidate) => {
    const verifier = new NodeHmacWebhookVerifier(options());

    await expect(
      verifier.verify({
        rawBody: new Uint8Array(),
        signature: candidate,
        timestamp,
      }),
    ).resolves.toEqual({ kind: "invalid", reason: "malformed" });
  });

  it("uses the default 300-second window in both time directions", async () => {
    const rawBody = new TextEncoder().encode("{}");
    const verifier = new NodeHmacWebhookVerifier(options());

    for (const offset of [-300, 300]) {
      const timestamp = String(NOW_SECONDS + offset);
      await expect(
        verifier.verify({
          rawBody,
          signature: signature(timestamp, rawBody),
          timestamp,
        }),
      ).resolves.toMatchObject({ kind: "valid" });
    }

    for (const offset of [-301, 301]) {
      const timestamp = String(NOW_SECONDS + offset);
      await expect(
        verifier.verify({
          rawBody,
          signature: signature(timestamp, rawBody),
          timestamp,
        }),
      ).resolves.toEqual({ kind: "invalid", reason: "expired" });
    }
  });

  it("supports a configured timestamp window", async () => {
    const rawBody = new TextEncoder().encode("{}");
    const timestamp = String(NOW_SECONDS - 31);
    const verifier = new NodeHmacWebhookVerifier(
      options({ maxAgeSeconds: 30 }),
    );

    await expect(
      verifier.verify({
        rawBody,
        signature: signature(timestamp, rawBody),
        timestamp,
      }),
    ).resolves.toEqual({ kind: "invalid", reason: "expired" });
  });

  it("returns mismatch for a well-formed signature from another secret", async () => {
    const rawBody = new TextEncoder().encode('{"event":"changed"}');
    const timestamp = String(NOW_SECONDS);
    const verifier = new NodeHmacWebhookVerifier(options());

    await expect(
      verifier.verify({
        rawBody,
        signature: signature(timestamp, rawBody, "different-secret"),
        timestamp,
      }),
    ).resolves.toEqual({ kind: "invalid", reason: "mismatch" });
  });

  it("remains stateless across repeated valid deliveries", async () => {
    const rawBody = new TextEncoder().encode('{"event":"changed"}');
    const timestamp = String(NOW_SECONDS);
    const input = {
      rawBody,
      signature: signature(timestamp, rawBody),
      timestamp,
    };
    const verifier = new NodeHmacWebhookVerifier(options());

    await expect(verifier.verify(input)).resolves.toMatchObject({
      kind: "valid",
    });
    await expect(verifier.verify(input)).resolves.toMatchObject({
      kind: "valid",
    });
  });

  it("rejects invalid constructor configuration without exposing a secret", () => {
    expect(() => new NodeHmacWebhookVerifier(options({ secret: "" }))).toThrow(
      "Webhook secret must not be empty",
    );

    const secret = "do-not-include-this-secret-in-errors";
    let thrown: unknown;
    try {
      new NodeHmacWebhookVerifier(options({ maxAgeSeconds: -1, secret }));
    } catch (error) {
      thrown = error;
    }
    expect(String(thrown)).not.toContain(secret);
  });
});
