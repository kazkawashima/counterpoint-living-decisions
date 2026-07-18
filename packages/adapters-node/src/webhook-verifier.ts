import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import type {
  Clock,
  WebhookVerificationInput,
  WebhookVerificationResult,
  WebhookVerifier,
} from "@counterpoint/ports";

const DEFAULT_MAX_AGE_SECONDS = 300;
const SIGNATURE_PATTERN = /^v1=([0-9a-fA-F]{64})$/;
const UNIX_SECONDS_PATTERN = /^(?:0|[1-9]\d*)$/;

export interface NodeHmacWebhookVerifierOptions {
  readonly clock: Clock;
  readonly maxAgeSeconds?: number;
  readonly secret: string;
}

function parseUnixSeconds(value: string): number | undefined {
  if (!UNIX_SECONDS_PATTERN.test(value)) {
    return undefined;
  }

  const seconds = Number(value);
  return Number.isSafeInteger(seconds) ? seconds : undefined;
}

function currentUnixSeconds(clock: Clock): number {
  const milliseconds = Date.parse(clock.now());
  if (!Number.isFinite(milliseconds)) {
    throw new TypeError("Clock must return a valid timestamp");
  }
  return Math.floor(milliseconds / 1_000);
}

export class NodeHmacWebhookVerifier implements WebhookVerifier {
  readonly #clock: Clock;
  readonly #maxAgeSeconds: number;
  readonly #secret: Buffer;

  constructor(options: NodeHmacWebhookVerifierOptions) {
    if (options.secret.length === 0) {
      throw new TypeError("Webhook secret must not be empty");
    }
    if (
      options.maxAgeSeconds !== undefined &&
      (!Number.isSafeInteger(options.maxAgeSeconds) ||
        options.maxAgeSeconds < 0)
    ) {
      throw new TypeError("Webhook maximum age must be a non-negative integer");
    }

    this.#clock = options.clock;
    this.#maxAgeSeconds = options.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS;
    this.#secret = Buffer.from(options.secret, "utf8");
  }

  async verify(
    input: WebhookVerificationInput,
  ): Promise<WebhookVerificationResult> {
    await Promise.resolve();

    const timestamp = parseUnixSeconds(input.timestamp);
    const signatureHex = SIGNATURE_PATTERN.exec(input.signature)?.[1];
    if (timestamp === undefined || signatureHex === undefined) {
      return { kind: "invalid", reason: "malformed" };
    }

    const ageSeconds = Math.abs(currentUnixSeconds(this.#clock) - timestamp);
    if (ageSeconds > this.#maxAgeSeconds) {
      return { kind: "invalid", reason: "expired" };
    }

    const expectedSignature = createHmac("sha256", this.#secret)
      .update(`${input.timestamp}.`, "utf8")
      .update(input.rawBody)
      .digest();
    const receivedSignature = Buffer.from(signatureHex, "hex");
    if (!timingSafeEqual(expectedSignature, receivedSignature)) {
      return { kind: "invalid", reason: "mismatch" };
    }

    const payloadHash = createHash("sha256")
      .update(input.rawBody)
      .digest("base64url");
    return {
      kind: "valid",
      payloadHash: `sha256:${payloadHash}`,
    };
  }
}
